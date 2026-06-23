import type { SqlClient } from "./db.ts";

export async function getPublicState(sql: SqlClient, gameId: string): Promise<unknown> {
  const rows = await sql`
    select jsonb_build_object(
      'gameId', g.id,
      'lobbyCode', g.lobby_code,
      'status', g.status,
      'playerCount', g.player_count,
      'currentTurnPlayerId', g.current_turn_player_id,
      'teamNames', jsonb_build_object(
        '0', coalesce(g.team_zero_name, 'Team 1'),
        '1', coalesce(g.team_one_name, 'Team 2')
      ),
      'version', g.version,
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
    ) as state
    from public.games g
    where g.id = ${gameId}::uuid
  `;
  return rows[0]?.state ?? null;
}

export async function getMyHand(
  sql: SqlClient,
  input: { gameId: string; userId: string }
): Promise<unknown> {
  const rows = await sql`
    select jsonb_build_object(
      'gameId', ${input.gameId}::uuid,
      'playerId', gp.id,
      'cards', coalesce(jsonb_agg(
        jsonb_build_object(
          'code', cc.code,
          'rank', cc.rank,
          'suit', cc.suit,
          'bookCode', cc.book_code,
          'sortIndex', cc.sort_index,
          'isJoker', cc.is_joker
        )
        order by cc.sort_index
      ) filter (where gc.id is not null), '[]'::jsonb)
    ) as hand
    from public.game_players gp
    left join public.game_cards gc
      on gc.game_id = gp.game_id
      and gc.location_type = 'player'
      and gc.holder_player_id = gp.id
    left join public.card_catalog cc on cc.code = gc.card_code
    where gp.game_id = ${input.gameId}::uuid
      and gp.user_id = ${input.userId}::uuid
    group by gp.id
  `;
  return rows[0]?.hand ?? null;
}

export async function ensureProfile(
  sql: SqlClient,
  input: { userId: string; displayName: string }
): Promise<void> {
  await sql`
    insert into public.profiles (id, display_name)
    values (${input.userId}, ${input.displayName})
    on conflict (id) do nothing
  `;
}
