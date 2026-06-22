import { requireUser } from "../_shared/auth.ts";
import { createSqlClient, logAction } from "../_shared/db.ts";
import { errorResponse, handleOptions, jsonResponse, readJsonBody } from "../_shared/http.ts";
import { getMyHand, getPublicState } from "../_shared/state.ts";
import { isCardCode } from "../../../src/game/cards.ts";

type AskCardRequest = {
  gameId: string;
  targetPlayerId: string;
  cardCode: string;
  requestId?: string;
};

function isUuid(value: string | undefined): value is string {
  return Boolean(value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i));
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const sql = createSqlClient();
  let requestBody: AskCardRequest | null = null;
  let userId: string | null = null;
  let playerId: string | null = null;

  try {
    const user = await requireUser(request);
    userId = user.id;
    requestBody = await readJsonBody<AskCardRequest>(request);

    if (!requestBody.gameId || !requestBody.targetPlayerId || !requestBody.cardCode) {
      throw new Error("gameId, targetPlayerId, and cardCode are required.");
    }
    if (!isCardCode(requestBody.cardCode)) {
      throw new Error("cardCode is not a valid card in the Literature deck.");
    }
    if (requestBody.requestId && !isUuid(requestBody.requestId)) {
      throw new Error("requestId must be a valid UUID.");
    }

    const result = await sql.begin(async (tx) => {
      const playerRows = await tx`
        select id
        from public.game_players
        where game_id = ${requestBody!.gameId}
          and user_id = ${user.id}
      `;
      playerId = playerRows[0]?.id ?? null;

      if (requestBody!.requestId) {
        await tx`select pg_advisory_xact_lock(hashtextextended(${requestBody!.requestId}, 0))`;

        const replayRows = await tx`
          select response_payload
          from public.action_log
          where game_id = ${requestBody!.gameId}
            and user_id = ${user.id}
            and request_id = ${requestBody!.requestId}
            and action_type = 'ask_card'
            and success = true
          limit 1
        `;
        if (replayRows[0]?.response_payload) {
          return {
            ...replayRows[0].response_payload,
            state: await getPublicState(tx, requestBody!.gameId),
            myHand: await getMyHand(tx, { gameId: requestBody!.gameId, userId: user.id })
          };
        }
      }

      const rpcRows = await tx`
        select game_private.process_card_ask(
          ${requestBody!.gameId},
          ${requestBody!.targetPlayerId},
          ${requestBody!.cardCode}::public.literature_card_code,
          ${user.id}
        ) as result
      `;
      const rpcResult = rpcRows[0]?.result ?? {};

      const responsePayload = {
        ...rpcResult,
        state: await getPublicState(tx, requestBody!.gameId),
        myHand: await getMyHand(tx, { gameId: requestBody!.gameId, userId: user.id })
      };

      if (requestBody!.requestId) {
        await logAction(tx, {
          gameId: requestBody!.gameId,
          userId: user.id,
          playerId,
          actionType: "ask_card",
          requestId: requestBody!.requestId,
          requestPayload: requestBody,
          responsePayload: responsePayload,
          success: true
        });
      }

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
          actionType: "ask_card",
          requestId: requestBody?.requestId ?? null,
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
