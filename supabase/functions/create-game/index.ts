import { requireUser } from "../_shared/auth.ts";
import { createSqlClient, insertGameEvent, logAction } from "../_shared/db.ts";
import { errorResponse, handleOptions, jsonResponse, readJsonBody } from "../_shared/http.ts";
import { generateLobbyCode, teamForSeat } from "../_shared/lobby.ts";
import { ensureProfile, getPublicState } from "../_shared/state.ts";
import { validateDisplayName } from "../_shared/validation.ts";
import type { PlayerCount } from "../../../src/game/types.ts";

type CreateGameRequest = {
  playerCount: PlayerCount;
  displayName?: string;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const sql = createSqlClient();
  let requestBody: CreateGameRequest | null = null;
  let userId: string | null = null;

  try {
    const user = await requireUser(request);
    userId = user.id;
    requestBody = await readJsonBody<CreateGameRequest>(request);

    if (
      !Number.isInteger(requestBody.playerCount) ||
      requestBody.playerCount < 4 ||
      requestBody.playerCount > 8
    ) {
      throw new Error("playerCount must be between 4 and 8.");
    }

    const displayName = validateDisplayName(requestBody.displayName);

    const result = await sql.begin(async (tx) => {
      await ensureProfile(tx, { userId: user.id, displayName });

      let gameId = "";
      let lobbyCode = "";
      for (let attempt = 0; attempt < 10; attempt += 1) {
        lobbyCode = generateLobbyCode();
        try {
          const games = await tx`
            insert into public.games (lobby_code, host_user_id, player_count)
            values (${lobbyCode}, ${user.id}, ${requestBody!.playerCount})
            returning id, version
          `;
          gameId = games[0].id;
          break;
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("duplicate key")) {
            throw error;
          }
        }
      }

      if (!gameId) {
        throw new Error("Could not allocate a unique lobby code.");
      }

      const players = await tx`
        insert into public.game_players (game_id, user_id, seat_index, team_index)
        values (${gameId}, ${user.id}, 0, ${teamForSeat(0)})
        returning id, seat_index, team_index
      `;

      await tx`
        update public.games
        set version = version + 1
        where id = ${gameId}
        returning version
      `;

      const versionRows = await tx`
        select version from public.games where id = ${gameId}
      `;
      const version = Number(versionRows[0].version);

      await insertGameEvent(tx, {
        gameId,
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

      const state = await getPublicState(tx, gameId);
      const responsePayload = {
        gameId,
        lobbyCode,
        playerId: players[0].id,
        state
      };

      await logAction(tx, {
        gameId,
        userId: user.id,
        playerId: players[0].id,
        actionType: "create_game",
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
          gameId: null,
          userId,
          playerId: null,
          actionType: "create_game",
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
