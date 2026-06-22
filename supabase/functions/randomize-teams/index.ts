import { requireUser } from "../_shared/auth.ts";
import { createSqlClient, insertGameEvent, logAction } from "../_shared/db.ts";
import { errorResponse, handleOptions, jsonResponse, readJsonBody } from "../_shared/http.ts";
import { randomizeTeams } from "../_shared/lobby.ts";
import { getPublicState } from "../_shared/state.ts";

type RandomizeTeamsRequest = {
  gameId: string;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const sql = createSqlClient();
  let requestBody: RandomizeTeamsRequest | null = null;
  let userId: string | null = null;
  let playerId: string | null = null;

  try {
    const user = await requireUser(request);
    userId = user.id;
    requestBody = await readJsonBody<RandomizeTeamsRequest>(request);
    if (!requestBody.gameId) {
      throw new Error("gameId is required.");
    }

    const result = await sql.begin(async (tx) => {
      const games = await tx`
        select *
        from public.games
        where id = ${requestBody!.gameId}
        for update
      `;
      const game = games[0];
      if (!game) {
        throw new Error("Game not found.");
      }
      if (game.host_user_id !== user.id) {
        throw new Error("Only the host can randomize teams.");
      }
      if (game.status !== "waiting") {
        throw new Error("Teams can only be randomized before the game starts.");
      }

      const players = await tx`
        select id, user_id, seat_index, team_index
        from public.game_players
        where game_id = ${game.id}
        order by seat_index
        for update
      `;
      const hostPlayer = players.find((player) => player.user_id === user.id);
      playerId = hostPlayer?.id ?? null;

      if (players.length < 2) {
        throw new Error("At least two seated players are required to randomize teams.");
      }

      const assignments = randomizeTeams(players.map((player) => player.id));

      for (const assignment of assignments) {
        await tx`
          update public.game_players
          set team_index = ${assignment.teamIndex}
          where game_id = ${game.id}
            and id = ${assignment.playerId}
        `;
      }

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
        eventType: "teams.randomized",
        actorPlayerId: playerId,
        payload: {
          assignments
        }
      });

      const responsePayload = {
        assignments,
        state: await getPublicState(tx, game.id)
      };

      await logAction(tx, {
        gameId: game.id,
        userId: user.id,
        playerId,
        actionType: "randomize_teams",
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
          gameId: requestBody?.gameId ?? null,
          userId,
          playerId,
          actionType: "randomize_teams",
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
