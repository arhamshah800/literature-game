import { requireUser } from "../_shared/auth.ts";
import { createSqlClient, insertGameEvent, logAction } from "../_shared/db.ts";
import { errorResponse, handleOptions, jsonResponse, readJsonBody } from "../_shared/http.ts";
import { getMyHand, getPublicState } from "../_shared/state.ts";
import { isCardCode } from "../../../src/game/cards.ts";
import { countCardsByPlayer, validateAsk } from "../../../src/game/rules.ts";
import type { BookCode, CardCode, HeldCard, PlayerRef } from "../../../src/game/types.ts";

type AskCardRequest = {
  gameId: string;
  targetPlayerId: string;
  cardCode: string;
};

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
      if (game.status !== "active") {
        throw new Error("Only active games accept card asks.");
      }

      const playerRows = await tx`
        select id, team_index
        from public.game_players
        where game_id = ${game.id}
          and user_id = ${user.id}
      `;
      const askerRow = playerRows[0];
      if (!askerRow) {
        throw new Error("You are not seated in this game.");
      }
      playerId = askerRow.id;
      if (game.current_turn_player_id !== askerRow.id) {
        throw new Error("It is not your turn.");
      }

      const targetRows = await tx`
        select id, team_index
        from public.game_players
        where game_id = ${game.id}
          and id = ${requestBody!.targetPlayerId}
      `;
      const targetRow = targetRows[0];
      if (!targetRow) {
        throw new Error("Target player is not seated in this game.");
      }

      const asker: PlayerRef = {
        playerId: askerRow.id,
        teamIndex: Number(askerRow.team_index) as 0 | 1
      };
      const target: PlayerRef = {
        playerId: targetRow.id,
        teamIndex: Number(targetRow.team_index) as 0 | 1
      };

      const handRows = await tx`
        select card_code, book_code, holder_player_id
        from public.game_cards
        where game_id = ${game.id}
          and location_type = 'player'
          and holder_player_id = ${asker.playerId}
        for update
      `;
      const askerHand: HeldCard[] = handRows.map((row) => ({
        cardCode: row.card_code as CardCode,
        bookCode: row.book_code as BookCode,
        holderPlayerId: row.holder_player_id
      }));

      const resolvedBooks = await tx`
        select book_code
        from public.book_results
        where game_id = ${game.id}
      `;
      const claimedOrCancelledBookCodes = new Set<BookCode>(
        resolvedBooks.map((row) => row.book_code as BookCode)
      );

      const validation = validateAsk({
        asker,
        target,
        requestedCard: requestBody!.cardCode as CardCode,
        askerHand,
        claimedOrCancelledBookCodes
      });
      if (!validation.ok) {
        throw new Error(validation.reason);
      }

      const requestedRows = await tx`
        select card_code, book_code, holder_player_id
        from public.game_cards
        where game_id = ${game.id}
          and card_code = ${requestBody!.cardCode}
          and location_type = 'player'
        for update
      `;
      const requestedCard = requestedRows[0];
      if (!requestedCard) {
        throw new Error("The requested card is no longer held by a player.");
      }

      await insertGameEvent(tx, {
        gameId: game.id,
        version: Number(game.version) + 1,
        eventType: "card.asked",
        actorPlayerId: asker.playerId,
        payload: {
          askerPlayerId: asker.playerId,
          targetPlayerId: target.playerId,
          cardCode: requestBody!.cardCode,
          bookCode: validation.bookCode
        }
      });

      let resultType: "hit" | "miss";
      let currentTurnPlayerId = asker.playerId;

      if (requestedCard.holder_player_id === target.playerId) {
        await tx`
          update public.game_cards
          set
            holder_player_id = ${asker.playerId},
            updated_at = now()
          where game_id = ${game.id}
            and card_code = ${requestBody!.cardCode}
        `;
        resultType = "hit";
      } else {
        currentTurnPlayerId = target.playerId;
        resultType = "miss";
      }

      const versionRows = await tx`
        update public.games
        set
          current_turn_player_id = ${currentTurnPlayerId},
          version = version + 1
        where id = ${game.id}
        returning version
      `;
      const version = Number(versionRows[0].version);

      const liveCards = await tx`
        select card_code, book_code, holder_player_id
        from public.game_cards
        where game_id = ${game.id}
          and location_type = 'player'
      `;
      const heldCards: HeldCard[] = liveCards.map((row) => ({
        cardCode: row.card_code as CardCode,
        bookCode: row.book_code as BookCode,
        holderPlayerId: row.holder_player_id
      }));

      if (resultType === "hit") {
        await insertGameEvent(tx, {
          gameId: game.id,
          version,
          eventType: "card.transferred",
          actorPlayerId: asker.playerId,
          payload: {
            fromPlayerId: target.playerId,
            toPlayerId: asker.playerId,
            cardCode: requestBody!.cardCode,
            bookCode: validation.bookCode,
            playerCardCounts: countCardsByPlayer(heldCards)
          }
        });
      } else {
        await insertGameEvent(tx, {
          gameId: game.id,
          version,
          eventType: "ask.missed",
          actorPlayerId: asker.playerId,
          payload: {
            askerPlayerId: asker.playerId,
            targetPlayerId: target.playerId,
            cardCode: requestBody!.cardCode,
            bookCode: validation.bookCode,
            nextTurnPlayerId: target.playerId
          }
        });
        await insertGameEvent(tx, {
          gameId: game.id,
          version,
          eventType: "turn.changed",
          actorPlayerId: asker.playerId,
          payload: {
            previousTurnPlayerId: asker.playerId,
            currentTurnPlayerId: target.playerId,
            reason: "ask_miss"
          }
        });
      }

      const responsePayload = {
        result: resultType,
        currentTurnPlayerId,
        state: await getPublicState(tx, game.id),
        myHand: await getMyHand(tx, { gameId: game.id, userId: user.id })
      };

      await logAction(tx, {
        gameId: game.id,
        userId: user.id,
        playerId: asker.playerId,
        actionType: "ask_card",
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
          actionType: "ask_card",
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
