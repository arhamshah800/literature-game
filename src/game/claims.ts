import { getCardsForBook } from "./cards.ts";
import type {
  CardCode,
  ClaimResolution,
  ClaimResolutionInput,
  HeldCard,
  TeamIndex
} from "./types.ts";

export function resolveClaim(input: ClaimResolutionInput): ClaimResolution {
  const expectedCards = getCardsForBook(input.bookCode);
  const expectedSet = new Set(expectedCards);

  if (input.assignments.length !== expectedCards.length) {
    throw new Error("A claim must name exactly six cards.");
  }

  const assignmentByCard = new Map<CardCode, string>();
  for (const assignment of input.assignments) {
    if (!expectedSet.has(assignment.cardCode)) {
      throw new Error(`Card ${assignment.cardCode} does not belong to ${input.bookCode}.`);
    }
    if (assignmentByCard.has(assignment.cardCode)) {
      throw new Error(`Card ${assignment.cardCode} is assigned more than once.`);
    }
    if (!input.playersById.has(assignment.playerId)) {
      throw new Error(`Assigned player ${assignment.playerId} is not in this game.`);
    }
    assignmentByCard.set(assignment.cardCode, assignment.playerId);
  }

  if (assignmentByCard.size !== expectedCards.length) {
    throw new Error("A claim must assign every card in the book.");
  }

  const actualCardsByCode = new Map<CardCode, HeldCard>();
  for (const card of input.actualCards) {
    if (card.bookCode === input.bookCode) {
      actualCardsByCode.set(card.cardCode, card);
    }
  }

  if (actualCardsByCode.size !== expectedCards.length) {
    throw new Error("The claimed book must still have all six cards held by players.");
  }

  const opponentTeam = opposingTeam(input.claimingPlayer.teamIndex);
  const revealedAssignments: Record<CardCode, string> = {} as Record<CardCode, string>;

  let opponentHoldsAnyCard = false;
  let allLocationsCorrect = true;

  for (const cardCode of expectedCards) {
    const actual = actualCardsByCode.get(cardCode);
    if (!actual) {
      throw new Error(`Missing actual holder for ${cardCode}.`);
    }

    revealedAssignments[cardCode] = actual.holderPlayerId;

    const actualHolder = input.playersById.get(actual.holderPlayerId);
    if (!actualHolder) {
      throw new Error(`Actual holder ${actual.holderPlayerId} is not in this game.`);
    }

    if (actualHolder.teamIndex === opponentTeam) {
      opponentHoldsAnyCard = true;
    }

    if (assignmentByCard.get(cardCode) !== actual.holderPlayerId) {
      allLocationsCorrect = false;
    }
  }

  if (opponentHoldsAnyCard) {
    return {
      result: "awarded_to_opponent",
      awardedTeamIndex: opponentTeam,
      revealedAssignments
    };
  }

  if (allLocationsCorrect) {
    return {
      result: "correct",
      awardedTeamIndex: input.claimingPlayer.teamIndex,
      revealedAssignments
    };
  }

  return {
    result: "cancelled_wrong_locations",
    awardedTeamIndex: null,
    revealedAssignments
  };
}

export function opposingTeam(teamIndex: TeamIndex): TeamIndex {
  return teamIndex === 0 ? 1 : 0;
}
