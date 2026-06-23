import { requireUser } from "../_shared/auth.ts";
import { createSqlClient, insertGameEvent, logAction } from "../_shared/db.ts";
import { errorResponse, handleOptions, jsonResponse, readJsonBody } from "../_shared/http.ts";
import { getMyHand, getPublicState } from "../_shared/state.ts";

type UpdateTeamNamesRequest = {
  gameId: string;
  teamNames: Record<string, unknown>;
};

type TeamIndex = 0 | 1;

const maxTeamNameLength = 24;

function validateTeamName(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!normalized) {
    throw new Error(`${label} name is required.`);
  }
  if (normalized.length > maxTeamNameLength) {
    throw new Error(`${label} name must be ${maxTeamNameLength} characters or fewer.`);
  }
  return normalized;
}

function validateTeamNames(input: unknown): Record<TeamIndex, string> {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    0: validateTeamName(value[0] ?? value["0"], "Team 1"),
    1: validateTeamName(value[1] ?? value["1"], "Team 2")
  };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const sql = createSqlClient();
  let requestBody: UpdateTeamNamesRequest | null = null;
  let userId: string | null = null;
  let playerId: string | null = null;

  try {
    const user = await requireUser(request);
    userId = user.id;
    requestBody = await readJsonBody<UpdateTeamNamesRequest>(request);

    if (!requestBody.gameId) {
      throw new Error("gameId is required.");
    }

    const teamNames = validateTeamNames(requestBody.teamNames);

    const result = await sql.begin(async (tx) => {
      const gameRows = await tx`
        select id, host_user_id, status
        from public.games
        where id = ${requestBody!.gameId}::uuid
        for update
      `;
      const game = gameRows[0];
      if (!game) {
        throw new Error("Game not found.");
      }
      if (game.host_user_id !== user.id) {
        throw new Error("Only the host can rename teams.");
      }
      if (!["waiting", "active"].includes(game.status)) {
        throw new Error("Team names can only be changed before the game is completed.");
      }

      const playerRows = await tx`
        select id
        from public.game_players
        where game_id = ${requestBody!.gameId}::uuid
          and user_id = ${user.id}::uuid
      `;
      playerId = playerRows[0]?.id ?? null;
      if (!playerId) {
        throw new Error("You are not seated in this game.");
      }

      const versionRows = await tx`
        update public.games
        set
          team_zero_name = ${teamNames[0]},
          team_one_name = ${teamNames[1]},
          version = version + 1
        where id = ${requestBody!.gameId}::uuid
        returning version
      `;
      const version = Number(versionRows[0].version);

      await insertGameEvent(tx, {
        gameId: requestBody!.gameId,
        version,
        eventType: "teams.renamed",
        actorPlayerId: playerId,
        payload: { teamNames }
      });

      const responsePayload = {
        state: await getPublicState(tx, requestBody!.gameId),
        myHand: await getMyHand(tx, { gameId: requestBody!.gameId, userId: user.id })
      };

      await logAction(tx, {
        gameId: requestBody!.gameId,
        userId: user.id,
        playerId,
        actionType: "update_team_names",
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
          actionType: "update_team_names",
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
