import { requireUser } from "../_shared/auth.ts";
import { createSqlClient, logAction } from "../_shared/db.ts";
import { errorResponse, handleOptions, jsonResponse, readJsonBody } from "../_shared/http.ts";
import { getMyHand, getPublicState } from "../_shared/state.ts";
import { isBookCode, isCardCode } from "../../../src/game/cards.ts";
import type { ClaimAssignment } from "../../../src/game/types.ts";

type SubmitClaimRequest = {
  gameId: string;
  bookCode: string;
  assignments: ClaimAssignment[];
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const sql = createSqlClient();
  let requestBody: SubmitClaimRequest | null = null;
  let userId: string | null = null;
  let playerId: string | null = null;

  try {
    const user = await requireUser(request);
    userId = user.id;
    requestBody = await readJsonBody<SubmitClaimRequest>(request);

    if (!requestBody.gameId || !requestBody.bookCode || !Array.isArray(requestBody.assignments)) {
      throw new Error("gameId, bookCode, and assignments are required.");
    }
    if (!isBookCode(requestBody.bookCode)) {
      throw new Error("bookCode is not a valid Literature book.");
    }
    for (const assignment of requestBody.assignments) {
      if (!isCardCode(assignment.cardCode)) {
        throw new Error(`Invalid card in claim assignment: ${assignment.cardCode}`);
      }
      if (!assignment.playerId) {
        throw new Error("Every claim assignment must include a playerId.");
      }
    }

    const result = await sql.begin(async (tx) => {
      const playerRows = await tx`
        select id
        from public.game_players
        where game_id = ${requestBody!.gameId}
          and user_id = ${user.id}
      `;
      playerId = playerRows[0]?.id ?? null;

      const rpcRows = await tx`
        with assignment_array as (
          select coalesce(array_agg(
            ((item->>'cardCode')::public.literature_card_code, (item->>'playerId')::uuid)::public.claim_assignment
          ), array[]::public.claim_assignment[]) as values
          from jsonb_array_elements(${tx.json(requestBody!.assignments)}) item
        )
        select game_private.process_claim(
          ${requestBody!.gameId},
          ${requestBody!.bookCode}::public.literature_book_code,
          assignment_array.values,
          ${user.id}
        ) as result
        from assignment_array
      `;
      const rpcResult = rpcRows[0]?.result ?? {};

      const responsePayload = {
        ...rpcResult,
        state: await getPublicState(tx, requestBody!.gameId),
        myHand: await getMyHand(tx, { gameId: requestBody!.gameId, userId: user.id })
      };

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
          actionType: "submit_claim",
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
