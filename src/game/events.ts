import type { BookCode, CardCode, ClaimResult, PlayerCount, TeamIndex } from "./types.ts";

export type GameEvent<TPayload> = {
  gameId: string;
  version: number;
  eventType: string;
  actorPlayerId: string | null;
  payload: TPayload;
  createdAt: string;
};

export type PlayerJoinedPayload = {
  playerId: string;
  displayName: string;
  seatIndex: number;
  teamIndex: TeamIndex;
};

export type GameStartedPayload = {
  firstTurnPlayerId: string;
  playerCount: PlayerCount;
  playerCardCounts: Record<string, number>;
};

export type CardAskedPayload = {
  askerPlayerId: string;
  targetPlayerId: string;
  cardCode: CardCode;
  bookCode: BookCode;
};

export type CardTransferredPayload = {
  fromPlayerId: string;
  toPlayerId: string;
  cardCode: CardCode;
  bookCode: BookCode;
  playerCardCounts: Record<string, number>;
};

export type AskMissedPayload = {
  askerPlayerId: string;
  targetPlayerId: string;
  cardCode: CardCode;
  bookCode: BookCode;
  nextTurnPlayerId: string;
};

export type TurnChangedPayload = {
  previousTurnPlayerId: string | null;
  currentTurnPlayerId: string;
  reason: "start" | "ask_success" | "ask_miss" | "claim";
};

export type ClaimResolvedPayload = {
  claimingPlayerId: string;
  claimingTeamIndex: TeamIndex;
  bookCode: BookCode;
  result: ClaimResult;
  awardedTeamIndex: TeamIndex | null;
  revealedAssignments: Record<CardCode, string>;
};

export type GameCompletedPayload = {
  winningTeamIndex: TeamIndex;
  teamScores: Record<"0" | "1", number>;
};

export type TeamsRenamedPayload = {
  teamNames: Record<TeamIndex, string>;
};

export type KnownGameEvent =
  | GameEvent<PlayerJoinedPayload>
  | GameEvent<GameStartedPayload>
  | GameEvent<CardAskedPayload>
  | GameEvent<CardTransferredPayload>
  | GameEvent<AskMissedPayload>
  | GameEvent<TurnChangedPayload>
  | GameEvent<ClaimResolvedPayload>
  | GameEvent<GameCompletedPayload>
  | GameEvent<TeamsRenamedPayload>;
