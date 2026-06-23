import { describe, expect, it } from "vitest";
import { adaptRealtimePayload } from "../src/game/clientEvents";
import { buildRequestCardOptions, effectFromEvent, seatPosition } from "../src/game/ui";
import type { MyHandState, PublicGameState, PublicPlayerState } from "../src/game/types";

const players: PublicPlayerState[] = [
  { playerId: "p1", displayName: "Ava", seatIndex: 0, teamIndex: 0, cardCount: 4, isConnected: true },
  { playerId: "p2", displayName: "Bo", seatIndex: 1, teamIndex: 1, cardCount: 4, isConnected: true },
  { playerId: "p3", displayName: "Cy", seatIndex: 2, teamIndex: 0, cardCount: 0, isConnected: true }
];

const state: PublicGameState = {
  gameId: "g1",
  lobbyCode: "ABCD",
  status: "active",
  playerCount: 4,
  currentTurnPlayerId: "p1",
  version: 1,
  players,
  books: [
    "clubs_low",
    "clubs_high",
    "diamonds_low",
    "diamonds_high",
    "hearts_low",
    "hearts_high",
    "spades_low",
    "spades_high",
    "eights_jokers"
  ].map((bookCode) => ({
    bookCode: bookCode as never,
    status: "unclaimed",
    awardedTeamIndex: null
  }))
};

const hand: MyHandState = {
  gameId: "g1",
  playerId: "p1",
  cards: [
    { code: "2C", rank: "2", suit: "clubs", bookCode: "clubs_low", sortIndex: 0, isJoker: false }
  ]
};

describe("table seating", () => {
  it("keeps generated seats inside the table coordinate system for 4-8 players", () => {
    for (let total = 4; total <= 8; total += 1) {
      for (let index = 0; index < total; index += 1) {
        const position = seatPosition(index, total);
        expect(position.x).toBeGreaterThanOrEqual(18);
        expect(position.x).toBeLessThanOrEqual(82);
        expect(position.y).toBeGreaterThanOrEqual(22);
        expect(position.y).toBeLessThanOrEqual(78);
      }
    }
  });
});

describe("request card options", () => {
  it("marks cards in held live books as legal when asking an opponent", () => {
    const options = buildRequestCardOptions({ hand, me: players[0]!, state, targetPlayerId: "p2" });

    expect(options.find((option) => option.card.code === "3C")).toMatchObject({ legal: true });
    expect(options.find((option) => option.card.code === "2C")).toMatchObject({
      legal: false,
      reason: "You already hold this card."
    });
    expect(options.find((option) => option.card.code === "9C")).toMatchObject({
      legal: false,
      reason: "You must hold at least one card from this set."
    });
  });
});

describe("event effects", () => {
  it("adapts realtime broadcasts and maps transfers to a table animation effect", () => {
    const event = adaptRealtimePayload({
      event: "card.transferred",
      payload: {
        gameId: "g1",
        version: 2,
        event: "card.transferred",
        payload: {
          fromPlayerId: "p2",
          toPlayerId: "p1",
          cardCode: "3C",
          bookCode: "clubs_low",
          playerCardCounts: { p1: 2, p2: 3 }
        }
      }
    });

    expect(event?.type).toBe("card.transferred");
    expect(effectFromEvent(event!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "transfer", fromPlayerId: "p2", toPlayerId: "p1", cardCode: "3C" }),
        expect.objectContaining({ kind: "announcement", tone: "hit", targetPlayerId: "p2", askerPlayerId: "p1" })
      ])
    );
  });
});
