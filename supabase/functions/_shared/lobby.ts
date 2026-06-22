import { cryptoShuffle } from "../../../src/game/deal.ts";
import { randomizeTeams as randomizeTeamAssignments } from "../../../src/game/teams.ts";

const LOBBY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomInt(exclusiveMax: number): number {
  if (!Number.isInteger(exclusiveMax) || exclusiveMax <= 0) {
    throw new Error("exclusiveMax must be a positive integer.");
  }

  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % exclusiveMax);
  const buffer = new Uint32Array(1);

  while (true) {
    crypto.getRandomValues(buffer);
    const value = buffer[0];
    if (value !== undefined && value < limit) {
      return value % exclusiveMax;
    }
  }
}

export function generateLobbyCode(length = 6): string {
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += LOBBY_ALPHABET[randomInt(LOBBY_ALPHABET.length)];
  }
  return code;
}

export function shuffledSeatOrder<T>(values: readonly T[]): T[] {
  return cryptoShuffle(values, randomInt);
}

export function teamForSeat(seatIndex: number): 0 | 1 {
  return seatIndex % 2 === 0 ? 0 : 1;
}

export function randomizeTeams(playerIds: readonly string[]) {
  return randomizeTeamAssignments(playerIds, randomInt);
}
