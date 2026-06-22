import type { BookCode, CardCode, TeamIndex } from "./types";

export const bookLabels: Record<BookCode, string> = {
  clubs_low: "Clubs Low",
  clubs_high: "Clubs High",
  diamonds_low: "Diamonds Low",
  diamonds_high: "Diamonds High",
  hearts_low: "Hearts Low",
  hearts_high: "Hearts High",
  spades_low: "Spades Low",
  spades_high: "Spades High",
  eights_jokers: "8s + Jokers"
};

export const teamNames: Record<TeamIndex, string> = {
  0: "North",
  1: "South"
};

export function formatCard(cardCode: CardCode | string) {
  if (cardCode === "JOKER_RED") return "Red Joker";
  if (cardCode === "JOKER_BLACK") return "Black Joker";
  return cardCode;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}
