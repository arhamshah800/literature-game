import { getBookForCard } from "./cards";
import type { AskValidationInput, AskValidationResult, HeldCard } from "./types";

export function validateAsk(input: AskValidationInput): AskValidationResult {
  if (input.asker.playerId === input.target.playerId) {
    return { ok: false, reason: "A player cannot ask themself for a card." };
  }

  if (input.asker.teamIndex === input.target.teamIndex) {
    return { ok: false, reason: "A player must ask a member of the opposing team." };
  }

  if (input.targetCardCount !== undefined && input.targetCardCount <= 0) {
    return { ok: false, reason: "The opponent being asked must still have cards." };
  }

  const requestedBookCode = getBookForCard(input.requestedCard);
  if (!requestedBookCode) {
    return { ok: false, reason: "The requested card does not exist in the 54-card Literature deck." };
  }

  if (input.claimedOrCancelledBookCodes.has(requestedBookCode)) {
    return { ok: false, reason: "The requested card belongs to a book that is no longer live." };
  }

  const askerHasRequestedCard = input.askerHand.some(
    (card) => card.cardCode === input.requestedCard
  );
  if (askerHasRequestedCard) {
    return { ok: false, reason: "A player cannot ask for a card already in their own hand." };
  }

  const askerHasAnotherCardInBook = input.askerHand.some(
    (card) =>
      card.bookCode === requestedBookCode && card.cardCode !== input.requestedCard
  );
  if (!askerHasAnotherCardInBook) {
    return {
      ok: false,
      reason: "A player must hold another card in the same half-suit or special book."
    };
  }

  return { ok: true, bookCode: requestedBookCode };
}

export function countCardsByPlayer(cards: readonly HeldCard[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of cards) {
    counts[card.holderPlayerId] = (counts[card.holderPlayerId] ?? 0) + 1;
  }
  return counts;
}
