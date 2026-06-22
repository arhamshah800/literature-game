import { requireUser } from "../_shared/auth.ts";
import { createSqlClient, insertGameEvent, logAction } from "../_shared/db.ts";
import { errorResponse, handleOptions, jsonResponse, readJsonBody } from "../_shared/http.ts";
import { randomInt } from "../_shared/lobby.ts";
import { getMyHand, getPublicState } from "../_shared/state.ts";
import { CARD_BY_CODE } from "../../../src/game/cards.ts";
import { dealCards } from "../../../src/game/deal.ts";
import { countCardsByPlayer } from "../../../src/game/rules.ts";
import type { HeldCard, PlayerCount } from "../../../src/game/types.ts";

type StartGameRequest = {
  gameId: string;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const sql = createSqlClient();
  let requestBody: StartGameRequest | null = null;
  let userId: string | null = null;
  let playerId: string | null = null;

  try {
    const user = await requireUser(request);
    userId = user.id;
    requestBody = await readJsonBody<StartGameRequest>(request);
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
        throw new Error("Only the host can start the game.");
      }
      if (game.status !== "waiting") {
        throw new Error("Only waiting games can be started.");
      }

      const players = await tx`
        select id, user_id, seat_index, team_index
        from public.game_players
        where game_id = ${game.id}
        order by seat_index
      `;

      if (players.length !== Number(game.player_count)) {
        throw new Error(`This game needs ${game.player_count} players before it can start.`);
      }

      const existingCards = await tx`
        select count(*)::int as count
        from public.game_cards
        where game_id = ${game.id}
      `;
      if (Number(existingCards[0].count) > 0) {
        throw new Error("This game has already been dealt.");
      }

      const hostPlayer = players.find((player) => player.user_id === user.id);
      playerId = hostPlayer?.id ?? null;
      const firstTurnPlayerId = players[0].id;
      const dealtCards = dealCards(
        players.map((player) => player.id),
        Number(game.player_count) as PlayerCount,
        randomInt
      );

      for (const dealt of dealtCards) {
        const card = CARD_BY_CODE.get(dealt.cardCode);
        if (!card) {
          throw new Error(`Unknown card generated during deal: ${dealt.cardCode}`);
        }

        await tx`
          insert into public.game_cards (
            game_id,
            card_code,
            book_code,
            location_type,
            holder_player_id
          )
          values (
            ${game.id},
            ${card.code},
            ${card.bookCode},
            'player',
            ${dealt.playerId}
          )
        `;
      }

      const versionRows = await tx`
        update public.games
        set
          status = 'active',
          current_turn_player_id = ${firstTurnPlayerId},
          started_at = now(),
          version = version + 1
        where id = ${game.id}
        returning version
      `;
      const version = Number(versionRows[0].version);

      const heldCards: HeldCard[] = dealtCards.map((dealt) => {
        const card = CARD_BY_CODE.get(dealt.cardCode);
        if (!card) {
          throw new Error(`Unknown card generated during count: ${dealt.cardCode}`);
        }
        return {
          cardCode: dealt.cardCode,
          bookCode: card.bookCode,
          holderPlayerId: dealt.playerId
        };
      });

      await insertGameEvent(tx, {
        gameId: game.id,
        version,
        eventType: "game.started",
        actorPlayerId: playerId,
        payload: {
          firstTurnPlayerId,
          playerCount: game.player_count,
          playerCardCounts: countCardsByPlayer(heldCards)
        }
      });

      await insertGameEvent(tx, {
        gameId: game.id,
        version,
        eventType: "turn.changed",
        actorPlayerId: playerId,
        payload: {
          previousTurnPlayerId: null,
          currentTurnPlayerId: firstTurnPlayerId,
          reason: "start"
        }
      });

      const responsePayload = {
        state: await getPublicState(tx, game.id),
        myHand: await getMyHand(tx, { gameId: game.id, userId: user.id })
      };

      await logAction(tx, {
        gameId: game.id,
        userId: user.id,
        playerId,
        actionType: "start_game",
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
          actionType: "start_game",
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
