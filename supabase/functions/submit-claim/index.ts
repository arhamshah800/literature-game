import { requireUser } from "../_shared/auth.ts";
import { createSqlClient, insertGameEvent, logAction } from "../_shared/db.ts";
import { errorResponse, handleOptions, jsonResponse, readJsonBody } from "../_shared/http.ts";
import { getMyHand, getPublicState } from "../_shared/state.ts";
import { getCardsForBook, isBookCode, isCardCode } from "../../../src/game/cards.ts";
import { resolveClaim } from "../../../src/game/claims.ts";
import type {
  BookCode,
  CardCode,
  ClaimAssignment,
  HeldCard,
  PlayerRef,
  TeamIndex
} from "../../../src/game/types.ts";

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
        throw new Error("Only active games accept claims.");
      }

      const playerRows = await tx`
        select id, team_index
        from public.game_players
        where game_id = ${game.id}
          and user_id = ${user.id}
      `;
      const claimingPlayerRow = playerRows[0];
      if (!claimingPlayerRow) {
        throw new Error("You are not seated in this game.");
      }
      playerId = claimingPlayerRow.id;

      const existingResult = await tx`
        select id
        from public.book_results
        where game_id = ${game.id}
          and book_code = ${requestBody!.bookCode}
        for update
      `;
      if (existingResult[0]) {
        throw new Error("That book has already been resolved.");
      }

      const allPlayers = await tx`
        select id, team_index
        from public.game_players
        where game_id = ${game.id}
      `;
      const playersById = new Map<string, PlayerRef>(
        allPlayers.map((row) => [
          row.id,
          {
            playerId: row.id,
            teamIndex: Number(row.team_index) as TeamIndex
          }
        ])
      );

      const expectedCards = getCardsForBook(requestBody!.bookCode as BookCode);
      const bookRows = await tx`
        select card_code, book_code, holder_player_id
        from public.game_cards
        where game_id = ${game.id}
          and book_code = ${requestBody!.bookCode}
          and location_type = 'player'
        for update
      `;
      const actualCards: HeldCard[] = bookRows.map((row) => ({
        cardCode: row.card_code as CardCode,
        bookCode: row.book_code as BookCode,
        holderPlayerId: row.holder_player_id
      }));

      if (actualCards.length !== expectedCards.length) {
        throw new Error("That book is not fully live and cannot be claimed.");
      }

      const claimingPlayer: PlayerRef = {
        playerId: claimingPlayerRow.id,
        teamIndex: Number(claimingPlayerRow.team_index) as TeamIndex
      };

      const resolution = resolveClaim({
        bookCode: requestBody!.bookCode as BookCode,
        claimingPlayer,
        assignments: requestBody!.assignments,
        actualCards,
        playersById
      });

      if (resolution.result === "cancelled_wrong_locations") {
        await tx`
          update public.game_cards
          set
            location_type = 'cancelled',
            holder_player_id = null,
            claimed_team_index = null,
            updated_at = now()
          where game_id = ${game.id}
            and book_code = ${requestBody!.bookCode}
        `;
      } else {
        await tx`
          update public.game_cards
          set
            location_type = 'claimed',
            holder_player_id = null,
            claimed_team_index = ${resolution.awardedTeamIndex},
            updated_at = now()
          where game_id = ${game.id}
            and book_code = ${requestBody!.bookCode}
        `;
      }

      await tx`
        insert into public.book_results (
          game_id,
          book_code,
          result,
          claiming_team_index,
          awarded_team_index,
          claimed_by_player_id
        )
        values (
          ${game.id},
          ${requestBody!.bookCode},
          ${resolution.result},
          ${claimingPlayer.teamIndex},
          ${resolution.awardedTeamIndex},
          ${claimingPlayer.playerId}
        )
      `;

      const resultCounts = await tx`
        select
          count(*)::int as resolved_books,
          count(*) filter (where awarded_team_index = 0)::int as team_zero_books,
          count(*) filter (where awarded_team_index = 1)::int as team_one_books
        from public.book_results
        where game_id = ${game.id}
      `;
      const resolvedBooks = Number(resultCounts[0].resolved_books);
      const teamZeroBooks = Number(resultCounts[0].team_zero_books);
      const teamOneBooks = Number(resultCounts[0].team_one_books);
      const isComplete = resolvedBooks === 9;
      const winningTeamIndex =
        isComplete && teamZeroBooks !== teamOneBooks
          ? teamZeroBooks > teamOneBooks
            ? 0
            : 1
          : null;

      const versionRows = await tx`
        update public.games
        set
          status = case when ${isComplete} then 'completed'::public.game_status else status end,
          completed_at = case when ${isComplete} then now() else completed_at end,
          winning_team_index = ${winningTeamIndex},
          version = version + 1
        where id = ${game.id}
        returning version
      `;
      const version = Number(versionRows[0].version);

      await insertGameEvent(tx, {
        gameId: game.id,
        version,
        eventType: "claim.resolved",
        actorPlayerId: claimingPlayer.playerId,
        payload: {
          claimingPlayerId: claimingPlayer.playerId,
          claimingTeamIndex: claimingPlayer.teamIndex,
          bookCode: requestBody!.bookCode,
          result: resolution.result,
          awardedTeamIndex: resolution.awardedTeamIndex,
          revealedAssignments: resolution.revealedAssignments
        }
      });

      if (isComplete && winningTeamIndex !== null) {
        await insertGameEvent(tx, {
          gameId: game.id,
          version,
          eventType: "game.completed",
          actorPlayerId: claimingPlayer.playerId,
          payload: {
            winningTeamIndex,
            teamScores: {
              "0": teamZeroBooks,
              "1": teamOneBooks
            }
          }
        });
      }

      const responsePayload = {
        result: resolution.result,
        awardedTeamIndex: resolution.awardedTeamIndex,
        revealedAssignments: resolution.revealedAssignments,
        state: await getPublicState(tx, game.id),
        myHand: await getMyHand(tx, { gameId: game.id, userId: user.id })
      };

      await logAction(tx, {
        gameId: game.id,
        userId: user.id,
        playerId: claimingPlayer.playerId,
        actionType: "submit_claim",
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
