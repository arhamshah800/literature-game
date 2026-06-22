import { CARD_CATALOG } from "./cards.ts";
import type { CardCode, PlayerCount } from "./types.ts";

export type DealtCard = {
  playerId: string;
  cardCode: CardCode;
};

export type DealPolicy = "strict_6_equal" | "eight_player_7_7_7_7_7_7_6_6";

export function cryptoShuffle<T>(
  values: readonly T[],
  randomInt: (exclusiveMax: number) => number
): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = shuffled[index];
    const swap = shuffled[swapIndex];
    if (current === undefined || swap === undefined) {
      throw new Error("Shuffle index out of range.");
    }
    shuffled[index] = swap;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

export function dealCards(
  playerIdsInSeatOrder: readonly string[],
  playerCount: PlayerCount,
  randomInt: (exclusiveMax: number) => number,
  policy: DealPolicy = "eight_player_7_7_7_7_7_7_6_6"
): DealtCard[] {
  if (playerIdsInSeatOrder.length !== playerCount) {
    throw new Error(`Expected ${playerCount} players, received ${playerIdsInSeatOrder.length}.`);
  }

  if (playerCount === 8 && policy !== "eight_player_7_7_7_7_7_7_6_6") {
    throw new Error("The selected deal policy does not support 8 players.");
  }

  if (playerCount === 6 && policy === "strict_6_equal") {
    return dealRoundRobin(playerIdsInSeatOrder, randomInt);
  }

  return dealRoundRobin(playerIdsInSeatOrder, randomInt);
}

function dealRoundRobin(
  playerIdsInSeatOrder: readonly string[],
  randomInt: (exclusiveMax: number) => number
): DealtCard[] {
  const shuffledCards = cryptoShuffle(
    CARD_CATALOG.map((card) => card.code),
    randomInt
  );

  return shuffledCards.map((cardCode, index) => {
    const playerId = playerIdsInSeatOrder[index % playerIdsInSeatOrder.length];
    if (!playerId) {
      throw new Error("Cannot deal to missing player.");
    }
    return { playerId, cardCode };
  });
}
