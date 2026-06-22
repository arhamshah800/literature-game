create schema if not exists game_private;
revoke all on schema game_private from public;
grant usage on schema game_private to authenticated;

do $$
begin
  create type public.literature_card_code as enum (
    '2C', '3C', '4C', '5C', '6C', '7C',
    '9C', '10C', 'JC', 'QC', 'KC', 'AC',
    '2D', '3D', '4D', '5D', '6D', '7D',
    '9D', '10D', 'JD', 'QD', 'KD', 'AD',
    '2H', '3H', '4H', '5H', '6H', '7H',
    '9H', '10H', 'JH', 'QH', 'KH', 'AH',
    '2S', '3S', '4S', '5S', '6S', '7S',
    '9S', '10S', 'JS', 'QS', 'KS', 'AS',
    '8C', '8D', '8H', '8S',
    'JOKER_RED', 'JOKER_BLACK'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.literature_book_code as enum (
    'clubs_low',
    'clubs_high',
    'diamonds_low',
    'diamonds_high',
    'hearts_low',
    'hearts_high',
    'spades_low',
    'spades_high',
    'eights_jokers'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.literature_action_type as enum (
    'initialize_game',
    'ask_card',
    'submit_claim'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.claim_assignment as (
    card_code public.literature_card_code,
    player_id uuid
  );
exception
  when duplicate_object then null;
end $$;

alter view if exists public.public_game_player_card_counts
  set (security_invoker = true);

alter policy "users can read only their own profile"
on public.profiles
using (id = (select auth.uid()));

alter policy "members can read their own action log rows"
on public.action_log
using (user_id = (select auth.uid()) and (game_id is null or public.is_game_member(game_id)));

create or replace view public."Users"
with (security_invoker = true)
as
select
  id,
  display_name,
  avatar_url,
  created_at
from public.profiles;

create or replace view public."Lobbies"
with (security_invoker = true)
as
select
  id,
  lobby_code,
  host_user_id,
  status,
  player_count,
  created_at,
  started_at,
  completed_at
from public.games;

create or replace view public."GameState"
with (security_invoker = true)
as
select
  id as game_id,
  status,
  current_turn_player_id,
  winning_team_index,
  version,
  started_at,
  completed_at
from public.games;

create or replace view public."PlayerHands"
with (security_invoker = true)
as
select
  gc.game_id,
  gc.holder_player_id as player_id,
  gc.card_code::public.literature_card_code as card_code,
  gc.book_code::public.literature_book_code as book_code,
  gc.updated_at
from public.game_cards gc
where gc.location_type = 'player';

create or replace view public."ActionLogs"
with (security_invoker = true)
as
select
  id,
  game_id,
  user_id,
  player_id,
  action_type,
  request_payload,
  response_payload,
  success,
  error_message,
  created_at
from public.action_log;

grant select on public."Users" to authenticated;
grant select on public."Lobbies" to authenticated;
grant select on public."GameState" to authenticated;
grant select on public."PlayerHands" to authenticated;
grant select on public."ActionLogs" to authenticated;

create or replace function game_private.raise(message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '%', message using errcode = 'P0001';
end;
$$;

create or replace function game_private.card_counts(target_game_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(jsonb_object_agg(player_id, card_count), '{}'::jsonb)
  from (
    select holder_player_id as player_id, count(*)::int as card_count
    from public.game_cards
    where game_id = target_game_id
      and location_type = 'player'
    group by holder_player_id
  ) counts;
$$;

create or replace function game_private.next_live_turn_player(
  target_game_id uuid,
  preferred_player_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  preferred_has_cards boolean;
  preferred_seat int;
  next_player_id uuid;
begin
  select exists (
    select 1
    from public.game_cards gc
    where gc.game_id = target_game_id
      and gc.location_type = 'player'
      and gc.holder_player_id = preferred_player_id
  )
  into preferred_has_cards;

  if preferred_has_cards then
    return preferred_player_id;
  end if;

  select gp.seat_index
  into preferred_seat
  from public.game_players gp
  where gp.game_id = target_game_id
    and gp.id = preferred_player_id;

  select candidate.id
  into next_player_id
  from public.game_players candidate
  where candidate.game_id = target_game_id
    and exists (
      select 1
      from public.game_cards gc
      where gc.game_id = candidate.game_id
        and gc.location_type = 'player'
        and gc.holder_player_id = candidate.id
    )
  order by
    case
      when preferred_seat is null then candidate.seat_index
      when candidate.seat_index > preferred_seat then 0
      else 1
    end,
    candidate.seat_index
  limit 1;

  return next_player_id;
end;
$$;

create or replace function game_private.emit_game_broadcast(
  target_game_id uuid,
  event_name text,
  event_version bigint,
  event_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'gameId', target_game_id,
      'version', event_version,
      'event', event_name,
      'payload', event_payload
    ),
    event_name,
    'game:' || target_game_id::text,
    true
  );
end;
$$;

create or replace function game_private.insert_event(
  target_game_id uuid,
  event_version bigint,
  event_name text,
  actor_player_id uuid,
  event_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.game_events (
    game_id,
    version,
    event_type,
    actor_player_id,
    payload
  )
  values (
    target_game_id,
    event_version,
    event_name,
    actor_player_id,
    event_payload
  );

  perform game_private.emit_game_broadcast(
    target_game_id,
    event_name,
    event_version,
    event_payload
  );
end;
$$;

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

  if player_count < 4 or player_count > 8 then
    perform game_private.raise('Literature requires 4 to 8 active players.');
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
      and gc.location_type = 'player'
      and gc.holder_player_id = asker_row.id
      and gc.card_code = requested_card::text
  ) then
    perform game_private.raise('A player cannot ask for a card already in their own hand.');
  end if;

  if not exists (
    select 1
    from public.game_cards gc
    where gc.game_id = target_game_id
      and gc.location_type = 'player'
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
    and gc.location_type = 'player'
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
    update public.game_cards
    set
      holder_player_id = asker_row.id,
      updated_at = now()
    where game_id = target_game_id
      and card_code = requested_card::text;

    result_type := 'hit';
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

  if result_type = 'hit' then
    payload := jsonb_build_object(
      'fromPlayerId', target_row.id,
      'toPlayerId', asker_row.id,
      'cardCode', requested_card,
      'bookCode', requested_book,
      'playerCardCounts', game_private.card_counts(target_game_id)
    );

    perform game_private.insert_event(
      target_game_id,
      new_version,
      'card.transferred',
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
    and gc.location_type = 'player'
  for update;

  select count(*)::int
  into live_book_card_count
  from public.game_cards gc
  where gc.game_id = target_game_id
    and gc.book_code = requested_book::text
    and gc.location_type = 'player';

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
      and gc.location_type = 'player'
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
      and gc.location_type = 'player'
      and gc.holder_player_id <> a.player_id
  )
  into all_locations_correct;

  select jsonb_object_agg(gc.card_code, gc.holder_player_id)
  into revealed_assignments
  from public.game_cards gc
  where gc.game_id = target_game_id
    and gc.book_code = requested_book::text
    and gc.location_type = 'player';

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

create or replace function public.initialize_game(target_game_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select game_private.initialize_game(target_game_id, auth.uid());
$$;

create or replace function public.process_card_ask(
  target_game_id uuid,
  target_player_id uuid,
  requested_card public.literature_card_code
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select game_private.process_card_ask(target_game_id, target_player_id, requested_card, auth.uid());
$$;

create or replace function public.process_claim(
  target_game_id uuid,
  requested_book public.literature_book_code,
  assignments public.claim_assignment[]
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select game_private.process_claim(target_game_id, requested_book, assignments, auth.uid());
$$;

revoke execute on function public.initialize_game(uuid) from public;
revoke execute on function public.process_card_ask(uuid, uuid, public.literature_card_code) from public;
revoke execute on function public.process_claim(uuid, public.literature_book_code, public.claim_assignment[]) from public;
grant execute on function public.initialize_game(uuid) to authenticated;
grant execute on function public.process_card_ask(uuid, uuid, public.literature_card_code) to authenticated;
grant execute on function public.process_claim(uuid, public.literature_book_code, public.claim_assignment[]) to authenticated;
grant execute on function game_private.initialize_game(uuid, uuid) to authenticated;
grant execute on function game_private.process_card_ask(uuid, uuid, public.literature_card_code, uuid) to authenticated;
grant execute on function game_private.process_claim(uuid, public.literature_book_code, public.claim_assignment[], uuid) to authenticated;

create or replace function public.try_uuid(value text)
returns uuid
language plpgsql
security invoker
set search_path = ''
immutable
as $$
begin
  return value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke execute on function public.try_uuid(text) from public;
grant execute on function public.try_uuid(text) to authenticated;

do $$
begin
  create policy "game members can receive private game broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and left((select realtime.topic()), 5) = 'game:'
    and public.is_game_member(public.try_uuid(substr((select realtime.topic()), 6)))
  );
exception
  when duplicate_object then null;
end $$;
