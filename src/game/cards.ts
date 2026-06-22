import type { BookCode, CardCode, CardDefinition, Suit } from "./types";

const SUITS = [
  ["clubs", "C"],
  ["diamonds", "D"],
  ["hearts", "H"],
  ["spades", "S"]
] as const satisfies readonly [Suit, "C" | "D" | "H" | "S"][];

const LOW_RANKS = ["2", "3", "4", "5", "6", "7"] as const;
const HIGH_RANKS = ["9", "10", "J", "Q", "K", "A"] as const;

const suitBookPrefix: Record<Suit, "clubs" | "diamonds" | "hearts" | "spades"> = {
  clubs: "clubs",
  diamonds: "diamonds",
  hearts: "hearts",
  spades: "spades"
};

function standardCard(
  rank: (typeof LOW_RANKS)[number] | (typeof HIGH_RANKS)[number] | "8",
  suit: Suit,
  suffix: "C" | "D" | "H" | "S",
  bookCode: BookCode,
  sortIndex: number
): CardDefinition {
  return {
    code: `${rank}${suffix}` as CardCode,
    rank,
    suit,
    bookCode,
    sortIndex,
    isJoker: false
  };
}

export const CARD_CATALOG: readonly CardDefinition[] = (() => {
  const cards: CardDefinition[] = [];
  let sortIndex = 0;

  for (const [suit, suffix] of SUITS) {
    const prefix = suitBookPrefix[suit];

    for (const rank of LOW_RANKS) {
      cards.push(standardCard(rank, suit, suffix, `${prefix}_low`, sortIndex++));
    }

    for (const rank of HIGH_RANKS) {
      cards.push(standardCard(rank, suit, suffix, `${prefix}_high`, sortIndex++));
    }
  }

  for (const [suit, suffix] of SUITS) {
    cards.push(standardCard("8", suit, suffix, "eights_jokers", sortIndex++));
  }

  cards.push({
    code: "JOKER_RED",
    rank: "JOKER",
    suit: null,
    bookCode: "eights_jokers",
    sortIndex: sortIndex++,
    isJoker: true
  });
  cards.push({
    code: "JOKER_BLACK",
    rank: "JOKER",
    suit: null,
    bookCode: "eights_jokers",
    sortIndex,
    isJoker: true
  });

  return cards;
})();

export const CARD_BY_CODE = new Map<CardCode, CardDefinition>(
  CARD_CATALOG.map((card) => [card.code, card])
);

export const BOOK_CODES = [
  "clubs_low",
  "clubs_high",
  "diamonds_low",
  "diamonds_high",
  "hearts_low",
  "hearts_high",
  "spades_low",
  "spades_high",
  "eights_jokers"
] as const satisfies readonly BookCode[];

export const BOOK_CARDS: Readonly<Record<BookCode, readonly CardCode[]>> =
  Object.freeze(
    BOOK_CODES.reduce(
      (books, bookCode) => {
        books[bookCode] = CARD_CATALOG.filter((card) => card.bookCode === bookCode)
          .sort((left, right) => left.sortIndex - right.sortIndex)
          .map((card) => card.code);
        return books;
      },
      {} as Record<BookCode, CardCode[]>
    )
  );

export function getCard(cardCode: CardCode): CardDefinition | undefined {
  return CARD_BY_CODE.get(cardCode);
}

export function getBookForCard(cardCode: CardCode): BookCode | undefined {
  return getCard(cardCode)?.bookCode;
}

export function getCardsForBook(bookCode: BookCode): readonly CardCode[] {
  return BOOK_CARDS[bookCode];
}

export function isCardCode(value: string): value is CardCode {
  return CARD_BY_CODE.has(value as CardCode);
}

export function isBookCode(value: string): value is BookCode {
  return BOOK_CODES.includes(value as BookCode);
}
