create table if not exists public.pending_card_transfers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  card_code text not null references public.card_catalog(code),
  book_code text not null,
  from_player_id uuid not null references public.game_players(id),
  to_player_id uuid not null references public.game_players(id),
  status text not null default 'pending' check (status in ('pending', 'completed', 'penalized')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (from_player_id <> to_player_id)
);

create unique index if not exists pending_card_transfers_one_pending_per_game
on public.pending_card_transfers (game_id)
where status = 'pending';

create index if not exists pending_card_transfers_game_status_idx
on public.pending_card_transfers (game_id, status);

alter table public.pending_card_transfers enable row level security;
alter table public.pending_card_transfers force row level security;

revoke all on public.pending_card_transfers from anon, authenticated;

alter table public.games
  drop constraint if exists games_player_count_check;

alter table public.games
  add constraint games_player_count_check
  check (player_count in (4, 6, 8));

alter table public.game_cards
  drop constraint if exists game_cards_check;

alter table public.game_cards
  add constraint game_cards_check
  check (
    (
      location_type = 'player'::public.card_location_type
      and holder_player_id is not null
      and claimed_team_index is null
    )
    or (
      location_type = 'deck'::public.card_location_type
      and holder_player_id is null
      and claimed_team_index is null
    )
    or (
      location_type::text = 'pending_transfer'
      and holder_player_id is null
      and claimed_team_index is null
    )
    or (
      location_type = 'claimed'::public.card_location_type
      and holder_player_id is null
      and claimed_team_index is not null
    )
    or (
      location_type = 'cancelled'::public.card_location_type
      and holder_player_id is null
    )
  );

create or replace function game_private.initialize_game(
  target_game_id uuid,
  caller_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  game_row public.games%rowtype;
  player_count int;
  first_turn_player_id uuid;
  new_version bigint;
  player_ids uuid[];
  event_payload jsonb;
begin
  select *
  into game_row
  from public.games
  where id = target_game_id
  for update;

  if not found then
    perform game_private.raise('Game not found.');
  end if;

  if game_row.host_user_id <> caller_user_id then
    perform game_private.raise('Only the host can start the game.');
  end if;

  if game_row.status <> 'waiting'::public.game_status then
    perform game_private.raise('Only waiting games can be started.');
  end if;

  select array_agg(gp.id order by gp.seat_index), count(*)::int
  into player_ids, player_count
  from public.game_players gp
  where gp.game_id = target_game_id
    and gp.is_connected = true;

  if player_count not in (4, 6, 8) then
    perform game_private.raise('Literature requires 4, 6, or 8 active players.');
  end if;

  if player_count <> game_row.player_count then
    perform game_private.raise('The lobby is not full of active players.');
  end if;

  if exists (select 1 from public.game_cards where game_id = target_game_id) then
    perform game_private.raise('This game has already been dealt.');
  end if;

  first_turn_player_id := player_ids[1];

  with shuffled_cards as (
    select
      cc.code,
      cc.book_code,
      row_number() over (order by extensions.gen_random_bytes(32)) - 1 as zero_based_index
    from public.card_catalog cc
  )
  insert into public.game_cards (
    game_id,
    card_code,
    book_code,
    location_type,
    holder_player_id
  )
  select
    target_game_id,
    sc.code,
    sc.book_code,
    'player'::public.card_location_type,
    player_ids[(sc.zero_based_index % player_count) + 1]
  from shuffled_cards sc;

  update public.games
  set
    status = 'active'::public.game_status,
    current_turn_player_id = first_turn_player_id,
    started_at = now(),
    version = version + 1
  where id = target_game_id
  returning version into new_version;

  event_payload := jsonb_build_object(
    'firstTurnPlayerId', first_turn_player_id,
    'playerCount', player_count,
    'playerCardCounts', game_private.card_counts(target_game_id)
  );

  perform game_private.insert_event(
    target_game_id,
    new_version,
    'game.started',
    first_turn_player_id,
    event_payload
  );

  perform game_private.insert_event(
    target_game_id,
    new_version,
    'turn.changed',
    first_turn_player_id,
    jsonb_build_object(
      'previousTurnPlayerId', null,
      'currentTurnPlayerId', first_turn_player_id,
      'reason', 'start'
    )
  );

  insert into public.action_log (
    game_id,
    user_id,
    player_id,
    action_type,
    request_payload,
    response_payload,
    success
  )
  values (
    target_game_id,
    caller_user_id,
    first_turn_player_id,
    'initialize_game',
    jsonb_build_object('gameId', target_game_id),
    event_payload,
    true
  );

  return jsonb_build_object(
    'gameId', target_game_id,
    'version', new_version,
    'currentTurnPlayerId', first_turn_player_id,
    'playerCardCounts', game_private.card_counts(target_game_id)
  );
end;
$$;

create or replace function game_private.process_card_ask(
  target_game_id uuid,
  target_player_id uuid,
  requested_card public.literature_card_code,
  caller_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  game_row public.games%rowtype;
  asker_row public.game_players%rowtype;
  target_row public.game_players%rowtype;
  requested_book text;
  actual_holder_player_id uuid;
  result_type text;
  next_turn_player_id uuid;
  new_version bigint;
  pending_transfer_id uuid;
  payload jsonb;
begin
  select *
  into game_row
  from public.games
  where id = target_game_id
  for update;

  if not found then
    perform game_private.raise('Game not found.');
  end if;

  if game_row.status <> 'active'::public.game_status then
    perform game_private.raise('Only active games accept card asks.');
  end if;

  if exists (
    select 1
    from public.pending_card_transfers pct
    where pct.game_id = target_game_id
      and pct.status = 'pending'
    for update
  ) then
    perform game_private.raise('Say thank you before taking another action.');
  end if;

  select *
  into asker_row
  from public.game_players
  where game_id = target_game_id
    and user_id = caller_user_id;

  if not found then
    perform game_private.raise('You are not seated in this game.');
  end if;

  if game_row.current_turn_player_id <> asker_row.id then
    perform game_private.raise('It is not your turn.');
  end if;

  select *
  into target_row
  from public.game_players
  where game_id = target_game_id
    and id = target_player_id;

  if not found then
    perform game_private.raise('Target player is not seated in this game.');
  end if;

  if target_row.id = asker_row.id then
    perform game_private.raise('A player cannot ask themself for a card.');
  end if;

  if target_row.team_index = asker_row.team_index then
    perform game_private.raise('A player must ask a member of the opposing team.');
  end if;

  if not exists (
    select 1
    from public.game_cards gc
    where gc.game_id = target_game_id
      and gc.location_type = 'player'::public.card_location_type
      and gc.holder_player_id = target_row.id
  ) then
    perform game_private.raise('The opponent being asked must still have cards.');
  end if;

  select cc.book_code
  into requested_book
  from public.card_catalog cc
  where cc.code = requested_card::text;

  if requested_book is null then
    perform game_private.raise('The requested card does not exist in the 54-card Literature deck.');
  end if;

  if exists (
    select 1
    from public.book_results br
    where br.game_id = target_game_id
      and br.book_code = requested_book
  ) then
    perform game_private.raise('The requested card belongs to a book that is no longer live.');
  end if;

  if exists (
    select 1
    from public.game_cards gc
    where gc.game_id = target_game_id
      and gc.location_type = 'player'::public.card_location_type
      and gc.holder_player_id = asker_row.id
      and gc.card_code = requested_card::text
  ) then
    perform game_private.raise('A player cannot ask for a card already in their own hand.');
  end if;

  if not exists (
    select 1
    from public.game_cards gc
    where gc.game_id = target_game_id
      and gc.location_type = 'player'::public.card_location_type
      and gc.holder_player_id = asker_row.id
      and gc.book_code = requested_book
      and gc.card_code <> requested_card::text
  ) then
    perform game_private.raise('A player must hold another card in the same half-suit or special book.');
  end if;

  select gc.holder_player_id
  into actual_holder_player_id
  from public.game_cards gc
  where gc.game_id = target_game_id
    and gc.card_code = requested_card::text
    and gc.location_type = 'player'::public.card_location_type
  for update;

  if actual_holder_player_id is null then
    perform game_private.raise('The requested card is no longer held by a player.');
  end if;

  perform game_private.insert_event(
    target_game_id,
    game_row.version + 1,
    'card.asked',
    asker_row.id,
    jsonb_build_object(
      'askerPlayerId', asker_row.id,
      'targetPlayerId', target_row.id,
      'cardCode', requested_card,
      'bookCode', requested_book
    )
  );

  if actual_holder_player_id = target_row.id then
    insert into public.pending_card_transfers (
      game_id,
      card_code,
      book_code,
      from_player_id,
      to_player_id
    )
    values (
      target_game_id,
      requested_card::text,
      requested_book,
      target_row.id,
      asker_row.id
    )
    returning id into pending_transfer_id;

    update public.game_cards
    set
      location_type = 'pending_transfer'::public.card_location_type,
      holder_player_id = null,
      claimed_team_index = null,
      updated_at = now()
    where game_id = target_game_id
      and card_code = requested_card::text;

    result_type := 'hit_pending_thank';
    next_turn_player_id := asker_row.id;
  else
    result_type := 'miss';
    next_turn_player_id := game_private.next_live_turn_player(target_game_id, target_row.id);
  end if;

  update public.games
  set
    current_turn_player_id = next_turn_player_id,
    version = version + 1
  where id = target_game_id
  returning version into new_version;

  if result_type = 'hit_pending_thank' then
    payload := jsonb_build_object(
      'transferId', pending_transfer_id,
      'fromPlayerId', target_row.id,
      'toPlayerId', asker_row.id,
      'cardCode', requested_card,
      'bookCode', requested_book
    );

    perform game_private.insert_event(
      target_game_id,
      new_version,
      'card.thank_required',
      asker_row.id,
      payload
    );
  else
    payload := jsonb_build_object(
      'askerPlayerId', asker_row.id,
      'targetPlayerId', target_row.id,
      'cardCode', requested_card,
      'bookCode', requested_book,
      'nextTurnPlayerId', next_turn_player_id
    );

    perform game_private.insert_event(
      target_game_id,
      new_version,
      'ask.missed',
      asker_row.id,
      payload
    );

    perform game_private.insert_event(
      target_game_id,
      new_version,
      'turn.changed',
      asker_row.id,
      jsonb_build_object(
        'previousTurnPlayerId', asker_row.id,
        'currentTurnPlayerId', next_turn_player_id,
        'reason', 'ask_miss'
      )
    );
  end if;

  insert into public.action_log (
    game_id,
    user_id,
    player_id,
    action_type,
    request_payload,
    response_payload,
    success
  )
  values (
    target_game_id,
    caller_user_id,
    asker_row.id,
    'ask_card',
    jsonb_build_object(
      'gameId', target_game_id,
      'targetPlayerId', target_player_id,
      'cardCode', requested_card
    ),
    payload,
    true
  );

  return jsonb_build_object(
    'result', result_type,
    'currentTurnPlayerId', next_turn_player_id,
    'version', new_version,
    'transferId', pending_transfer_id,
    'playerCardCounts', game_private.card_counts(target_game_id)
  );
end;
$$;

create or replace function game_private.resolve_pending_transfer(
  target_game_id uuid,
  target_transfer_id uuid,
  resolution_action text,
  caller_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  game_row public.games%rowtype;
  actor_row public.game_players%rowtype;
  transfer_row public.pending_card_transfers%rowtype;
  next_turn_player_id uuid;
  new_version bigint;
  payload jsonb;
begin
  if resolution_action not in ('thank', 'pickup_without_thanks') then
    perform game_private.raise('Invalid pending transfer action.');
  end if;

  select *
  into game_row
  from public.games
  where id = target_game_id
  for update;

  if not found then
    perform game_private.raise('Game not found.');
  end if;

  if game_row.status <> 'active'::public.game_status then
    perform game_private.raise('Only active games can resolve pending cards.');
  end if;

  select *
  into actor_row
  from public.game_players
  where game_id = target_game_id
    and user_id = caller_user_id;

  if not found then
    perform game_private.raise('You are not seated in this game.');
  end if;

  select *
  into transfer_row
  from public.pending_card_transfers
  where id = target_transfer_id
    and game_id = target_game_id
    and status = 'pending'
  for update;

  if not found then
    perform game_private.raise('No pending card is waiting for thank you.');
  end if;

  if transfer_row.to_player_id <> actor_row.id then
    perform game_private.raise('Only the player receiving the card can resolve thank you.');
  end if;

  perform 1
  from public.game_cards gc
  where gc.game_id = target_game_id
    and gc.card_code = transfer_row.card_code
    and gc.location_type::text = 'pending_transfer'
  for update;

  if resolution_action = 'thank' then
    update public.game_cards
    set
      location_type = 'player'::public.card_location_type,
      holder_player_id = transfer_row.to_player_id,
      claimed_team_index = null,
      updated_at = now()
    where game_id = target_game_id
      and card_code = transfer_row.card_code;

    update public.pending_card_transfers
    set status = 'completed',
      resolved_at = now()
    where id = transfer_row.id;

    next_turn_player_id := actor_row.id;

    update public.games
    set
      current_turn_player_id = next_turn_player_id,
      version = version + 1
    where id = target_game_id
    returning version into new_version;

    payload := jsonb_build_object(
      'transferId', transfer_row.id,
      'fromPlayerId', transfer_row.from_player_id,
      'toPlayerId', transfer_row.to_player_id,
      'cardCode', transfer_row.card_code,
      'bookCode', transfer_row.book_code,
      'playerCardCounts', game_private.card_counts(target_game_id)
    );

    perform game_private.insert_event(
      target_game_id,
      new_version,
      'card.transferred',
      actor_row.id,
      payload
    );
  else
    update public.game_cards
    set
      location_type = 'player'::public.card_location_type,
      holder_player_id = transfer_row.from_player_id,
      claimed_team_index = null,
      updated_at = now()
    where game_id = target_game_id
      and card_code = transfer_row.card_code;

    update public.pending_card_transfers
    set status = 'penalized',
      resolved_at = now()
    where id = transfer_row.id;

    next_turn_player_id := game_private.next_live_turn_player(target_game_id, transfer_row.from_player_id);

    update public.games
    set
      current_turn_player_id = next_turn_player_id,
      version = version + 1
    where id = target_game_id
    returning version into new_version;

    payload := jsonb_build_object(
      'transferId', transfer_row.id,
      'fromPlayerId', transfer_row.from_player_id,
      'toPlayerId', transfer_row.to_player_id,
      'cardCode', transfer_row.card_code,
      'bookCode', transfer_row.book_code,
      'nextTurnPlayerId', next_turn_player_id,
      'playerCardCounts', game_private.card_counts(target_game_id)
    );

    perform game_private.insert_event(
      target_game_id,
      new_version,
      'card.thank_penalty',
      actor_row.id,
      payload
    );

    perform game_private.insert_event(
      target_game_id,
      new_version,
      'turn.changed',
      actor_row.id,
      jsonb_build_object(
        'previousTurnPlayerId', actor_row.id,
        'currentTurnPlayerId', next_turn_player_id,
        'reason', 'thank_penalty'
      )
    );
  end if;

  insert into public.action_log (
    game_id,
    user_id,
    player_id,
    action_type,
    request_payload,
    response_payload,
    success
  )
  values (
    target_game_id,
    caller_user_id,
    actor_row.id,
    'resolve_pending_transfer',
    jsonb_build_object(
      'gameId', target_game_id,
      'transferId', target_transfer_id,
      'action', resolution_action
    ),
    payload,
    true
  );

  return jsonb_build_object(
    'result', resolution_action,
    'currentTurnPlayerId', next_turn_player_id,
    'version', new_version,
    'playerCardCounts', game_private.card_counts(target_game_id)
  );
end;
$$;

create or replace function game_private.process_claim(
  target_game_id uuid,
  requested_book public.literature_book_code,
  assignments public.claim_assignment[],
  caller_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  game_row public.games%rowtype;
  claiming_player public.game_players%rowtype;
  expected_card_count int;
  assignment_count int;
  teammate_assignment_count int;
  live_book_card_count int;
  opponent_team_index int;
  opponent_holds_any boolean;
  all_locations_correct boolean;
  result_value public.claim_result;
  awarded_team int;
  resolved_books int;
  team_zero_books int;
  team_one_books int;
  is_complete boolean;
  winning_team int;
  new_turn_player_id uuid;
  new_version bigint;
  revealed_assignments jsonb;
  payload jsonb;
begin
  select *
  into game_row
  from public.games
  where id = target_game_id
  for update;

  if not found then
    perform game_private.raise('Game not found.');
  end if;

  if game_row.status <> 'active'::public.game_status then
    perform game_private.raise('Only active games accept claims.');
  end if;

  if exists (
    select 1
    from public.pending_card_transfers pct
    where pct.game_id = target_game_id
      and pct.status = 'pending'
    for update
  ) then
    perform game_private.raise('Say thank you before taking another action.');
  end if;

  select *
  into claiming_player
  from public.game_players
  where game_id = target_game_id
    and user_id = caller_user_id;

  if not found then
    perform game_private.raise('You are not seated in this game.');
  end if;

  if exists (
    select 1
    from public.book_results br
    where br.game_id = target_game_id
      and br.book_code = requested_book::text
    for update
  ) then
    perform game_private.raise('That book has already been resolved.');
  end if;

  select count(*)::int
  into expected_card_count
  from public.card_catalog cc
  where cc.book_code = requested_book::text;

  select count(*)::int
  into assignment_count
  from unnest(assignments) a;

  if assignment_count <> expected_card_count then
    perform game_private.raise('A claim must name exactly six cards.');
  end if;

  if exists (
    select 1
    from unnest(assignments) a
    group by a.card_code
    having count(*) > 1
  ) then
    perform game_private.raise('Each card can only be assigned once.');
  end if;

  if exists (
    select 1
    from unnest(assignments) a
    left join public.card_catalog cc on cc.code = a.card_code::text
    where cc.book_code is distinct from requested_book::text
  ) then
    perform game_private.raise('Every assigned card must belong to the claimed set.');
  end if;

  select count(*)::int
  into teammate_assignment_count
  from unnest(assignments) a
  join public.game_players gp
    on gp.game_id = target_game_id
    and gp.id = a.player_id
    and gp.team_index = claiming_player.team_index;

  if teammate_assignment_count <> expected_card_count then
    perform game_private.raise('Every claim assignment must name one of the claiming player''s teammates.');
  end if;

  perform 1
  from public.game_cards gc
  where gc.game_id = target_game_id
    and gc.book_code = requested_book::text
    and gc.location_type = 'player'::public.card_location_type
  for update;

  select count(*)::int
  into live_book_card_count
  from public.game_cards gc
  where gc.game_id = target_game_id
    and gc.book_code = requested_book::text
    and gc.location_type = 'player'::public.card_location_type;

  if live_book_card_count <> expected_card_count then
    perform game_private.raise('That book is not fully live and cannot be claimed.');
  end if;

  opponent_team_index := case when claiming_player.team_index = 0 then 1 else 0 end;

  select exists (
    select 1
    from public.game_cards gc
    join public.game_players holder
      on holder.id = gc.holder_player_id
    where gc.game_id = target_game_id
      and gc.book_code = requested_book::text
      and gc.location_type = 'player'::public.card_location_type
      and holder.team_index = opponent_team_index
  )
  into opponent_holds_any;

  select not exists (
    select 1
    from public.game_cards gc
    join unnest(assignments) a
      on a.card_code::text = gc.card_code
    where gc.game_id = target_game_id
      and gc.book_code = requested_book::text
      and gc.location_type = 'player'::public.card_location_type
      and gc.holder_player_id <> a.player_id
  )
  into all_locations_correct;

  select jsonb_object_agg(gc.card_code, gc.holder_player_id)
  into revealed_assignments
  from public.game_cards gc
  where gc.game_id = target_game_id
    and gc.book_code = requested_book::text
    and gc.location_type = 'player'::public.card_location_type;

  if opponent_holds_any then
    result_value := 'awarded_to_opponent'::public.claim_result;
    awarded_team := opponent_team_index;
  elsif all_locations_correct then
    result_value := 'correct'::public.claim_result;
    awarded_team := claiming_player.team_index;
  else
    result_value := 'cancelled_wrong_locations'::public.claim_result;
    awarded_team := null;
  end if;

  if awarded_team is null then
    update public.game_cards
    set
      location_type = 'cancelled'::public.card_location_type,
      holder_player_id = null,
      claimed_team_index = null,
      updated_at = now()
    where game_id = target_game_id
      and book_code = requested_book::text;
  else
    update public.game_cards
    set
      location_type = 'claimed'::public.card_location_type,
      holder_player_id = null,
      claimed_team_index = awarded_team,
      updated_at = now()
    where game_id = target_game_id
      and book_code = requested_book::text;
  end if;

  insert into public.book_results (
    game_id,
    book_code,
    result,
    claiming_team_index,
    awarded_team_index,
    claimed_by_player_id
  )
  values (
    target_game_id,
    requested_book::text,
    result_value,
    claiming_player.team_index,
    awarded_team,
    claiming_player.id
  );

  select
    count(*)::int,
    count(*) filter (where awarded_team_index = 0)::int,
    count(*) filter (where awarded_team_index = 1)::int
  into resolved_books, team_zero_books, team_one_books
  from public.book_results
  where game_id = target_game_id;

  is_complete := resolved_books = 9;
  winning_team := case
    when is_complete and team_zero_books > team_one_books then 0
    when is_complete and team_one_books > team_zero_books then 1
    else null
  end;

  new_turn_player_id := game_private.next_live_turn_player(
    target_game_id,
    game_row.current_turn_player_id
  );

  update public.games
  set
    current_turn_player_id = new_turn_player_id,
    status = case when is_complete then 'completed'::public.game_status else status end,
    completed_at = case when is_complete then now() else completed_at end,
    winning_team_index = winning_team,
    version = version + 1
  where id = target_game_id
  returning version into new_version;

  payload := jsonb_build_object(
    'claimingPlayerId', claiming_player.id,
    'claimingTeamIndex', claiming_player.team_index,
    'bookCode', requested_book,
    'result', result_value,
    'awardedTeamIndex', awarded_team,
    'revealedAssignments', coalesce(revealed_assignments, '{}'::jsonb),
    'nextTurnPlayerId', new_turn_player_id,
    'playerCardCounts', game_private.card_counts(target_game_id)
  );

  perform game_private.insert_event(
    target_game_id,
    new_version,
    'claim.resolved',
    claiming_player.id,
    payload
  );

  if new_turn_player_id is distinct from game_row.current_turn_player_id then
    perform game_private.insert_event(
      target_game_id,
      new_version,
      'turn.changed',
      claiming_player.id,
      jsonb_build_object(
        'previousTurnPlayerId', game_row.current_turn_player_id,
        'currentTurnPlayerId', new_turn_player_id,
        'reason', 'empty_hand_after_claim'
      )
    );
  end if;

  if is_complete then
    perform game_private.insert_event(
      target_game_id,
      new_version,
      'game.completed',
      claiming_player.id,
      jsonb_build_object(
        'winningTeamIndex', winning_team,
        'teamScores', jsonb_build_object('0', team_zero_books, '1', team_one_books)
      )
    );
  end if;

  insert into public.action_log (
    game_id,
    user_id,
    player_id,
    action_type,
    request_payload,
    response_payload,
    success
  )
  values (
    target_game_id,
    caller_user_id,
    claiming_player.id,
    'submit_claim',
    jsonb_build_object(
      'gameId', target_game_id,
      'bookCode', requested_book,
      'assignments', to_jsonb(assignments)
    ),
    payload,
    true
  );

  return jsonb_build_object(
    'result', result_value,
    'awardedTeamIndex', awarded_team,
    'revealedAssignments', coalesce(revealed_assignments, '{}'::jsonb),
    'currentTurnPlayerId', new_turn_player_id,
    'version', new_version
  );
end;
$$;

revoke insert, update, delete, truncate on public.pending_card_transfers from anon, authenticated;
revoke usage on schema game_private from anon, authenticated;
revoke execute on all functions in schema game_private from anon, authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pending_card_transfers'
  ) then
    alter publication supabase_realtime drop table public.pending_card_transfers;
  end if;
end $$;
