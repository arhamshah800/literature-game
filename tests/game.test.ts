import { describe, expect, it } from "vitest";
import { CARD_CATALOG, getCardsForBook } from "../src/game/cards";
import { resolveClaim } from "../src/game/claims";
import { dealCards } from "../src/game/deal";
import { validateAsk } from "../src/game/rules";
import { randomizeTeams } from "../src/game/teams";
import type { ClaimAssignment, HeldCard, PlayerRef } from "../src/game/types";

describe("Literature card catalog", () => {
  it("contains exactly 54 unique cards", () => {
    expect(CARD_CATALOG).toHaveLength(54);
    expect(new Set(CARD_CATALOG.map((card) => card.code))).toHaveLength(54);
  });

  it("contains nine books with six cards each", () => {
    const bookCodes = new Set(CARD_CATALOG.map((card) => card.bookCode));
    expect(bookCodes).toHaveLength(9);

    for (const bookCode of bookCodes) {
      expect(getCardsForBook(bookCode).length).toBe(6);
    }
  });

  it("models the 8s and Jokers as a normal queryable book", () => {
    expect(getCardsForBook("eights_jokers")).toEqual([
      "8C",
      "8D",
      "8H",
      "8S",
      "JOKER_RED",
      "JOKER_BLACK"
    ]);
  });
});

describe("ask validation", () => {
  const asker: PlayerRef = { playerId: "p1", teamIndex: 0 };
  const target: PlayerRef = { playerId: "p2", teamIndex: 1 };

  it("allows asking an opposing player for a card in a book the asker holds", () => {
    const result = validateAsk({
      asker,
      target,
      requestedCard: "4C",
      askerHand: [{ cardCode: "2C", bookCode: "clubs_low", holderPlayerId: "p1" }],
      claimedOrCancelledBookCodes: new Set()
    });

    expect(result).toEqual({ ok: true, bookCode: "clubs_low" });
  });

  it("rejects asking for a card already in the asker's hand", () => {
    const result = validateAsk({
      asker,
      target,
      requestedCard: "2C",
      askerHand: [{ cardCode: "2C", bookCode: "clubs_low", holderPlayerId: "p1" }],
      claimedOrCancelledBookCodes: new Set()
    });

    expect(result.ok).toBe(false);
  });

  it("rejects asking an opponent who has no cards", () => {
    const result = validateAsk({
      asker,
      target,
      targetCardCount: 0,
      requestedCard: "4C",
      askerHand: [{ cardCode: "2C", bookCode: "clubs_low", holderPlayerId: "p1" }],
      claimedOrCancelledBookCodes: new Set()
    });

    expect(result).toEqual({ ok: false, reason: "The opponent being asked must still have cards." });
  });

  it("allows the special 8s and Jokers book under the same rule", () => {
    const result = validateAsk({
      asker,
      target,
      requestedCard: "JOKER_RED",
      askerHand: [{ cardCode: "8S", bookCode: "eights_jokers", holderPlayerId: "p1" }],
      claimedOrCancelledBookCodes: new Set()
    });

    expect(result).toEqual({ ok: true, bookCode: "eights_jokers" });
  });
});

describe("deal policy", () => {
  const deterministicRandom = () => 0;

  it("deals 54 cards evenly to 6 players", () => {
    const dealt = dealCards(["p1", "p2", "p3", "p4", "p5", "p6"], 6, deterministicRandom);
    const counts = countByPlayer(dealt.map((card) => card.playerId));

    expect(dealt).toHaveLength(54);
    expect(Object.values(counts)).toEqual([9, 9, 9, 9, 9, 9]);
  });

  it("deals 54 cards to 8 players with the documented 7/7/7/7/7/7/6/6 policy", () => {
    const dealt = dealCards(
      ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"],
      8,
      deterministicRandom
    );
    const counts = countByPlayer(dealt.map((card) => card.playerId));

    expect(dealt).toHaveLength(54);
    expect(Object.values(counts)).toEqual([7, 7, 7, 7, 7, 7, 6, 6]);
  });

  it("rejects odd player counts at compile-time and runtime boundaries", () => {
    expect(() => dealCards(["p1", "p2", "p3", "p4", "p5"], 4, deterministicRandom)).toThrow(
      "Expected 4 players"
    );
  });
});

describe("team randomization", () => {
  const deterministicRandom = () => 0;

  it("splits an even number of players evenly across teams", () => {
    const assignments = randomizeTeams(
      ["p1", "p2", "p3", "p4", "p5", "p6"],
      deterministicRandom
    );
    const counts = countByPlayer(assignments.map((assignment) => `team-${assignment.teamIndex}`));

    expect(assignments).toHaveLength(6);
    expect(counts["team-0"]).toBe(3);
    expect(counts["team-1"]).toBe(3);
  });

  it("rejects odd player counts", () => {
    expect(() => randomizeTeams(["p1", "p2", "p3", "p4", "p5"], deterministicRandom)).toThrow(
      "odd number of players"
    );
  });

  it("rejects duplicate player IDs", () => {
    expect(() => randomizeTeams(["p1", "p1", "p2"], deterministicRandom)).toThrow(
      "duplicate player IDs"
    );
  });
});

describe("claim resolution", () => {
  const players = new Map<string, PlayerRef>([
    ["p1", { playerId: "p1", teamIndex: 0 }],
    ["p2", { playerId: "p2", teamIndex: 0 }],
    ["p3", { playerId: "p3", teamIndex: 1 }]
  ]);

  it("awards a correctly assigned same-team book to the claiming team", () => {
    const actualCards: HeldCard[] = [
      { cardCode: "2C", bookCode: "clubs_low", holderPlayerId: "p1" },
      { cardCode: "3C", bookCode: "clubs_low", holderPlayerId: "p1" },
      { cardCode: "4C", bookCode: "clubs_low", holderPlayerId: "p2" },
      { cardCode: "5C", bookCode: "clubs_low", holderPlayerId: "p2" },
      { cardCode: "6C", bookCode: "clubs_low", holderPlayerId: "p2" },
      { cardCode: "7C", bookCode: "clubs_low", holderPlayerId: "p1" }
    ];
    const assignments: ClaimAssignment[] = actualCards.map((card) => ({
      cardCode: card.cardCode,
      playerId: card.holderPlayerId
    }));

    expect(
      resolveClaim({
        bookCode: "clubs_low",
        claimingPlayer: { playerId: "p1", teamIndex: 0 },
        assignments,
        actualCards,
        playersById: players
      })
    ).toMatchObject({ result: "correct", awardedTeamIndex: 0 });
  });

  it("cancels a same-team book when locations are stated incorrectly", () => {
    const actualCards: HeldCard[] = [
      { cardCode: "2C", bookCode: "clubs_low", holderPlayerId: "p1" },
      { cardCode: "3C", bookCode: "clubs_low", holderPlayerId: "p1" },
      { cardCode: "4C", bookCode: "clubs_low", holderPlayerId: "p2" },
      { cardCode: "5C", bookCode: "clubs_low", holderPlayerId: "p2" },
      { cardCode: "6C", bookCode: "clubs_low", holderPlayerId: "p2" },
      { cardCode: "7C", bookCode: "clubs_low", holderPlayerId: "p1" }
    ];
    const assignments = actualCards.map((card) => ({
      cardCode: card.cardCode,
      playerId: card.cardCode === "2C" ? "p2" : card.holderPlayerId
    }));

    expect(
      resolveClaim({
        bookCode: "clubs_low",
        claimingPlayer: { playerId: "p1", teamIndex: 0 },
        assignments,
        actualCards,
        playersById: players
      })
    ).toMatchObject({ result: "cancelled_wrong_locations", awardedTeamIndex: null });
  });

  it("awards a claimed book to the opponent if the opponent holds any card", () => {
    const actualCards: HeldCard[] = [
      { cardCode: "8C", bookCode: "eights_jokers", holderPlayerId: "p1" },
      { cardCode: "8D", bookCode: "eights_jokers", holderPlayerId: "p1" },
      { cardCode: "8H", bookCode: "eights_jokers", holderPlayerId: "p2" },
      { cardCode: "8S", bookCode: "eights_jokers", holderPlayerId: "p2" },
      { cardCode: "JOKER_RED", bookCode: "eights_jokers", holderPlayerId: "p3" },
      { cardCode: "JOKER_BLACK", bookCode: "eights_jokers", holderPlayerId: "p1" }
    ];
    const assignments = actualCards.map((card) => ({
      cardCode: card.cardCode,
      playerId: card.holderPlayerId
    }));

    expect(
      resolveClaim({
        bookCode: "eights_jokers",
        claimingPlayer: { playerId: "p1", teamIndex: 0 },
        assignments,
        actualCards,
        playersById: players
      })
    ).toMatchObject({ result: "awarded_to_opponent", awardedTeamIndex: 1 });
  });
});

function countByPlayer(playerIds: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const playerId of playerIds) {
    counts[playerId] = (counts[playerId] ?? 0) + 1;
  }
  return counts;
}
