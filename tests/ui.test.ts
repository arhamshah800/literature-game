import { describe, expect, it } from "vitest";
import { adaptRealtimePayload } from "../src/game/clientEvents";
import { lobbyCodeLength, normalizeJoinCode } from "../src/game/lobbyCode";
import { maxDisplayNameLength, validateDisplayName } from "../src/game/playerNames";
import {
  buildHandLayout,
  buildRequestCardOptions,
  buildTableLayout,
  buildTeamRailSeatPositions,
  deriveHandFilters,
  effectFromEvent,
  findCollisions,
  missAnnouncementText,
  seatPosition
} from "../src/game/ui";
import { validateTeamNames } from "../src/game/teamNames";
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
  teamNames: { 0: "Team 1", 1: "Team 2" },
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

  it("computes compact mode for constrained table dimensions", () => {
    expect(buildTableLayout({ width: 640, height: 700, playerCount: 6 }).compact).toBe(true);
    expect(buildTableLayout({ width: 1200, height: 640, playerCount: 6 }).compact).toBe(false);
  });

  it("keeps reserved HUD controls separated in representative layouts", () => {
    const layout = buildTableLayout({ width: 1000, height: 620, playerCount: 6 });
    const collisions = findCollisions([
      { id: "score-icons", x: 16, y: 16, width: 176, height: 68 },
      { id: "room-sound-icons", x: 760, y: 16, width: 224, height: 68 },
      layout.zones.announcement,
      layout.zones.turn
    ], 8);

    expect(collisions).toEqual([]);
  });

  it("assigns compact mobile seats to opposing team rails", () => {
    const seats = buildTeamRailSeatPositions(players, { width: 390, height: 520 });

    expect(seats[0]?.x).toBeLessThan(40);
    expect(seats[2]?.x).toBeLessThan(40);
    expect(seats[1]?.x).toBeGreaterThan(60);
    for (const seat of seats.filter(Boolean)) {
      expect(seat.y).toBeGreaterThanOrEqual(15);
      expect(seat.y).toBeLessThanOrEqual(86);
    }
  });
});

describe("hand layout", () => {
  it("switches between fit and scroll modes based on available width", () => {
    expect(buildHandLayout({ containerWidth: 1280, groupCount: 3, cardCount: 12 })).toMatchObject({
      mode: "fit",
      showNavigation: false
    });
    expect(buildHandLayout({ containerWidth: 520, groupCount: 4, cardCount: 18 })).toMatchObject({
      mode: "scroll",
      showNavigation: true
    });
  });

  it("derives set filters only from cards in hand", () => {
    expect(deriveHandFilters(hand.cards)).toEqual(["all", "clubs_low"]);
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
  it("formats miss announcements without Go Fish wording", () => {
    const text = missAnnouncementText("Bo", "the Queen of Hearts");

    expect(text).toBe("Bo did not have the Queen of Hearts.");
    expect(text).not.toContain("Go Fish");
  });

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

describe("team names", () => {
  it("trims valid team names and rejects empty or long names", () => {
    expect(validateTeamNames({ 0: "  North Stars  ", 1: "South  Squad" })).toEqual({
      0: "North Stars",
      1: "South Squad"
    });
    expect(() => validateTeamNames({ 0: " ", 1: "Team 2" })).toThrow("Team 1 name is required.");
    expect(() => validateTeamNames({ 0: "Team 1", 1: "x".repeat(25) })).toThrow("24 characters");
  });
});

describe("name and room code limits", () => {
  it("trims display names and rejects empty or too-long names", () => {
    expect(validateDisplayName("  Sarah   Jane  ")).toBe("Sarah Jane");
    expect(() => validateDisplayName(" ")).toThrow("Enter your name first.");
    expect(() => validateDisplayName("x".repeat(maxDisplayNameLength + 1))).toThrow("24 characters");
  });

  it("normalizes join codes to six uppercase alphanumeric characters", () => {
    expect(lobbyCodeLength).toBe(6);
    expect(normalizeJoinCode(" ab-c12z9 ")).toBe("ABC12Z");
  });
});
