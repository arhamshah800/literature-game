alter table public.games
  add column team_zero_name text not null default 'Team 1',
  add column team_one_name text not null default 'Team 2';

alter table public.games
  add constraint games_team_zero_name_not_blank check (length(btrim(team_zero_name)) between 1 and 24),
  add constraint games_team_one_name_not_blank check (length(btrim(team_one_name)) between 1 and 24);

create or replace function public.get_public_game_state(target_game_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'gameId', g.id,
    'lobbyCode', g.lobby_code,
    'status', g.status,
    'playerCount', g.player_count,
    'currentTurnPlayerId', g.current_turn_player_id,
    'version', g.version,
    'teamNames', jsonb_build_object(
      '0', g.team_zero_name,
      '1', g.team_one_name
    ),
    'players', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'playerId', gp.id,
          'displayName', p.display_name,
          'seatIndex', gp.seat_index,
          'teamIndex', gp.team_index,
          'isConnected', gp.is_connected,
          'cardCount', coalesce(counts.card_count, 0)
        )
        order by gp.seat_index
      )
      from public.game_players gp
      join public.profiles p on p.id = gp.user_id
      left join public.public_game_player_card_counts counts
        on counts.game_id = gp.game_id
        and counts.player_id = gp.id
      where gp.game_id = g.id
    ), '[]'::jsonb),
    'books', (
      select jsonb_agg(
        jsonb_build_object(
          'bookCode', book.book_code,
          'status',
            case
              when br.result is null then 'unclaimed'
              when br.result = 'cancelled_wrong_locations' then 'cancelled'
              else 'claimed'
            end,
          'awardedTeamIndex', br.awarded_team_index
        )
        order by book.sort_order
      )
      from (
        values
          ('clubs_low', 0),
          ('clubs_high', 1),
          ('diamonds_low', 2),
          ('diamonds_high', 3),
          ('hearts_low', 4),
          ('hearts_high', 5),
          ('spades_low', 6),
          ('spades_high', 7),
          ('eights_jokers', 8)
      ) as book(book_code, sort_order)
      left join public.book_results br
        on br.game_id = g.id
        and br.book_code = book.book_code
    )
  )
  from public.games g
  where g.id = target_game_id
$$;
