import { requireUser } from "../_shared/auth.ts";
import { createSqlClient } from "../_shared/db.ts";
import { errorResponse, handleOptions, jsonResponse, readJsonBody } from "../_shared/http.ts";

type HeartbeatRequest = {
  gameId: string;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const sql = createSqlClient();

  try {
    const user = await requireUser(request);
    const requestBody = await readJsonBody<HeartbeatRequest>(request);
    if (!requestBody.gameId) {
      throw new Error("gameId is required.");
    }

    const rows = await sql`
      update public.game_players
      set
        is_connected = true,
        last_seen_at = now()
      where game_id = ${requestBody.gameId}::uuid
        and user_id = ${user.id}::uuid
      returning id
    `;

    if (!rows[0]) {
      throw new Error("You are not seated in this game.");
    }

    return jsonResponse({ ok: true, playerId: rows[0].id });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unknown error");
  } finally {
    await sql.end();
  }
});
