import type {
  AskMissedPayload,
  CardAskedPayload,
  CardTransferredPayload,
  ClaimResolvedPayload,
  GameCompletedPayload,
  GameStartedPayload,
  PlayerJoinedPayload,
  TeamsRenamedPayload,
  TurnChangedPayload
} from "./events";

export type ClientGameEvent =
  | ClientEvent<"player.joined", PlayerJoinedPayload>
  | ClientEvent<"game.started", GameStartedPayload>
  | ClientEvent<"card.asked", CardAskedPayload>
  | ClientEvent<"card.transferred", CardTransferredPayload>
  | ClientEvent<"ask.missed", AskMissedPayload>
  | ClientEvent<"turn.changed", TurnChangedPayload>
  | ClientEvent<"claim.resolved", ClaimResolvedPayload>
  | ClientEvent<"game.completed", GameCompletedPayload>
  | ClientEvent<"teams.renamed", TeamsRenamedPayload>
  | ClientEvent<"teams.randomized", Record<string, never>>;

export type ClientEvent<TType extends string, TPayload> = {
  id: string;
  type: TType;
  version: number;
  payload: TPayload;
  receivedAt: number;
};

const knownEvents = new Set([
  "player.joined",
  "game.started",
  "card.asked",
  "card.transferred",
  "ask.missed",
  "turn.changed",
  "claim.resolved",
  "game.completed",
  "teams.renamed",
  "teams.randomized"
]);

type RealtimeEnvelope = {
  event?: unknown;
  version?: unknown;
  payload?: unknown;
};

export function adaptRealtimePayload(input: unknown): ClientGameEvent | null {
  if (!input || typeof input !== "object") return null;

  const envelope = input as RealtimeEnvelope;
  const nested = envelope.payload && typeof envelope.payload === "object"
    ? envelope.payload as RealtimeEnvelope
    : null;

  const type = typeof nested?.event === "string"
    ? nested.event
    : typeof envelope.event === "string"
      ? envelope.event
      : "";

  if (!knownEvents.has(type)) return null;

  const rawVersion = nested?.version ?? envelope.version;
  const version = typeof rawVersion === "number" ? rawVersion : Number(rawVersion);
  const payload = nested && "payload" in nested ? nested.payload : envelope.payload;

  return {
    id: `${Number.isFinite(version) ? version : 0}:${type}:${Date.now()}`,
    type,
    version: Number.isFinite(version) ? version : 0,
    payload: (payload && typeof payload === "object" ? payload : {}) as never,
    receivedAt: Date.now()
  } as ClientGameEvent;
}
