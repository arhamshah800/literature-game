export type PlayerCount = 4 | 5 | 6 | 7 | 8;

export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

export type StandardRank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";

export type JokerCode = "JOKER_RED" | "JOKER_BLACK";

export type BookCode =
  | "clubs_low"
  | "clubs_high"
  | "diamonds_low"
  | "diamonds_high"
  | "hearts_low"
  | "hearts_high"
  | "spades_low"
  | "spades_high"
  | "eights_jokers";

export type CardCode =
  | `${"2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"}${"C" | "D" | "H" | "S"}`
  | `${"10" | "J" | "Q" | "K" | "A"}${"C" | "D" | "H" | "S"}`
  | JokerCode;

export type TeamIndex = 0 | 1;

export type GameStatus = "waiting" | "active" | "completed" | "cancelled";

export type CardLocationType = "deck" | "player" | "claimed" | "cancelled";

export type ClaimResult =
  | "correct"
  | "cancelled_wrong_locations"
  | "awarded_to_opponent";

export type CardDefinition = {
  code: CardCode;
  rank: StandardRank | "JOKER";
  suit: Suit | null;
  bookCode: BookCode;
  sortIndex: number;
  isJoker: boolean;
};

export type PlayerRef = {
  playerId: string;
  teamIndex: TeamIndex;
};

export type HeldCard = {
  cardCode: CardCode;
  bookCode: BookCode;
  holderPlayerId: string;
};

export type AskValidationInput = {
  asker: PlayerRef;
  target: PlayerRef;
  targetCardCount?: number;
  requestedCard: CardCode;
  askerHand: HeldCard[];
  claimedOrCancelledBookCodes: Set<BookCode>;
};

export type AskValidationResult =
  | { ok: true; bookCode: BookCode }
  | { ok: false; reason: string };

export type ClaimAssignment = {
  cardCode: CardCode;
  playerId: string;
};

export type ClaimResolutionInput = {
  bookCode: BookCode;
  claimingPlayer: PlayerRef;
  assignments: ClaimAssignment[];
  actualCards: HeldCard[];
  playersById: Map<string, PlayerRef>;
};

export type ClaimResolution = {
  result: ClaimResult;
  awardedTeamIndex: TeamIndex | null;
  revealedAssignments: Record<CardCode, string>;
};

export type PublicPlayerState = {
  playerId: string;
  displayName: string;
  seatIndex: number;
  teamIndex: TeamIndex;
  cardCount: number;
  isConnected: boolean;
};

export type PublicBookState = {
  bookCode: BookCode;
  status: "unclaimed" | "claimed" | "cancelled";
  awardedTeamIndex: TeamIndex | null;
};

export type PublicGameState = {
  gameId: string;
  lobbyCode: string;
  status: GameStatus;
  playerCount: PlayerCount;
  currentTurnPlayerId: string | null;
  version: number;
  players: PublicPlayerState[];
  books: PublicBookState[];
};

export type MyHandState = {
  gameId: string;
  playerId: string;
  cards: CardDefinition[];
};
