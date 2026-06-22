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
