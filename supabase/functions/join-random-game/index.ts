import { requireUser } from "../_shared/auth.ts";
import { createSqlClient, insertGameEvent, logAction } from "../_shared/db.ts";
import { errorResponse, handleOptions, jsonResponse, readJsonBody } from "../_shared/http.ts";
import { teamForSeat } from "../_shared/lobby.ts";
import { ensureProfile, getPublicState } from "../_shared/state.ts";

type JoinRandomGameRequest = {
  displayName?: string;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const sql = createSqlClient();
  let requestBody: JoinRandomGameRequest | null = null;
  let userId: string | null = null;
  let gameId: string | null = null;

  try {
    const user = await requireUser(request);
    userId = user.id;
    requestBody = await readJsonBody<JoinRandomGameRequest>(request);
    const displayName = requestBody.displayName?.trim() || "Player";

    const result = await sql.begin(async (tx) => {
      await ensureProfile(tx, { userId: user.id, displayName });

      const candidates = await tx`
        select g.id
        from public.games g
        left join public.game_players gp on gp.game_id = g.id
        where g.status = 'waiting'
        group by g.id
        having count(gp.id)::int < g.player_count
        order by random()
        limit 1
      `;
      const candidate = candidates[0];
      if (!candidate) {
        throw new Error("No open rooms are available right now.");
      }

      const games = await tx`
        select *
        from public.games
        where id = ${candidate.id}
        for update
      `;
      const game = games[0];
      if (!game || game.status !== "waiting") {
        throw new Error("The selected room is no longer available. Try again.");
      }
      gameId = game.id;

      const existing = await tx`
        select id, seat_index, team_index
        from public.game_players
        where game_id = ${game.id}
          and user_id = ${user.id}
      `;
      if (existing[0]) {
        return {
          gameId: game.id,
          playerId: existing[0].id,
          seatIndex: existing[0].seat_index,
          teamIndex: existing[0].team_index,
          state: await getPublicState(tx, game.id)
        };
      }

      const countRows = await tx`
        select count(*)::int as count
        from public.game_players
        where game_id = ${game.id}
      `;
      const currentCount = Number(countRows[0].count);
      if (currentCount >= Number(game.player_count)) {
        throw new Error("The selected room just filled up. Try again.");
      }

      const seatIndex = currentCount;
      const teamIndex = teamForSeat(seatIndex);
      const players = await tx`
        insert into public.game_players (game_id, user_id, seat_index, team_index)
        values (${game.id}, ${user.id}, ${seatIndex}, ${teamIndex})
        returning id, seat_index, team_index
      `;

      const versionRows = await tx`
        update public.games
        set version = version + 1
        where id = ${game.id}
        returning version
      `;
      const version = Number(versionRows[0].version);

      await insertGameEvent(tx, {
        gameId: game.id,
        version,
        eventType: "player.joined",
        actorPlayerId: players[0].id,
        payload: {
          playerId: players[0].id,
          displayName,
          seatIndex: players[0].seat_index,
          teamIndex: players[0].team_index
        }
      });

      const responsePayload = {
        gameId: game.id,
        playerId: players[0].id,
        seatIndex: players[0].seat_index,
        teamIndex: players[0].team_index,
        state: await getPublicState(tx, game.id)
      };

      await logAction(tx, {
        gameId: game.id,
        userId: user.id,
        playerId: players[0].id,
        actionType: "join_random_game",
        requestPayload: requestBody,
        responsePayload,
        success: true
      });

      return responsePayload;
    });

    return jsonResponse(result);
  } catch (error) {
    if (userId) {
      try {
        await logAction(sql, {
          gameId,
          userId,
          playerId: null,
          actionType: "join_random_game",
          requestPayload: requestBody ?? {},
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown error"
        });
      } catch {
        // Logging must not hide the original error from the caller.
      }
    }
    return errorResponse(error instanceof Error ? error.message : "Unknown error");
  } finally {
    await sql.end();
  }
});
