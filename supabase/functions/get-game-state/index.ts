import { requireUser } from "../_shared/auth.ts";
import { createSqlClient } from "../_shared/db.ts";
import { errorResponse, handleOptions, jsonResponse } from "../_shared/http.ts";
import { getMyHand, getPublicState } from "../_shared/state.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const sql = createSqlClient();

  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const gameId = url.searchParams.get("gameId");
    if (!gameId) {
      throw new Error("gameId query parameter is required.");
    }

    const membership = await sql`
      select id
      from public.game_players
      where game_id = ${gameId}
        and user_id = ${user.id}
    `;
    if (!membership[0]) {
      throw new Error("You are not seated in this game.");
    }

    return jsonResponse({
      state: await getPublicState(sql, gameId),
      myHand: await getMyHand(sql, { gameId, userId: user.id })
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unknown error");
  } finally {
    await sql.end();
  }
});
