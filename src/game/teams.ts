import type { TeamIndex } from "./types.ts";

export type TeamAssignment = {
  playerId: string;
  teamIndex: TeamIndex;
};

export function randomizeTeams(
  playerIds: readonly string[],
  randomInt: (exclusiveMax: number) => number
): TeamAssignment[] {
  if (playerIds.length < 2) {
    throw new Error("At least two players are required to create teams.");
  }

  const uniquePlayerIds = new Set(playerIds);
  if (uniquePlayerIds.size !== playerIds.length) {
    throw new Error("Cannot randomize teams with duplicate player IDs.");
  }

  if (playerIds.length % 2 !== 0) {
    throw new Error("Cannot randomize teams with an odd number of players.");
  }

  const shuffled = shuffle(playerIds, randomInt);
  const teamZeroSize = shuffled.length / 2;

  return shuffled.map((playerId, index) => ({
    playerId,
    teamIndex: index < teamZeroSize ? 0 : 1
  }));
}

function shuffle<T>(
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
