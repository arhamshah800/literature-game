import { CARD_CATALOG } from "./cards";
import type { BookCode, CardCode, CardDefinition, MyHandState, PublicGameState, PublicPlayerState, TeamIndex } from "./types";
import type { ClientGameEvent } from "./clientEvents";

export type SeatPosition = {
  x: number;
  y: number;
  angle: number;
};

export type RequestCardOption = {
  card: CardDefinition;
  legal: boolean;
  reason: string | null;
};

export type TableEffect =
  | {
      id: string;
      kind: "speech";
      playerId: string;
      text: string;
      tone: "ask" | "miss" | "join" | "claim";
    }
  | {
      id: string;
      kind: "transfer";
      fromPlayerId: string;
      toPlayerId: string;
      cardCode: CardCode;
      bookCode: BookCode;
    }
  | {
      id: string;
      kind: "announcement";
      tone: "ask" | "hit" | "miss" | "turn" | "claim";
      askerPlayerId?: string;
      targetPlayerId?: string;
      cardCode?: CardCode;
      playerId?: string;
      text?: string;
    }
  | {
      id: string;
      kind: "turn";
      playerId: string;
    }
  | {
      id: string;
      kind: "celebration";
      teamIndex: TeamIndex | null;
      text: string;
    };

export function seatPosition(index: number, total: number): SeatPosition {
  const safeTotal = Math.max(total, 1);
  const angle = -90 + (360 / safeTotal) * index;
  const radians = angle * Math.PI / 180;
  return {
    x: 50 + Math.cos(radians) * 32,
    y: 50 + Math.sin(radians) * 28,
    angle
  };
}

export function buildRequestCardOptions(input: {
  hand: MyHandState | null;
  me: PublicPlayerState | null;
  state: PublicGameState;
  targetPlayerId: string;
}): RequestCardOption[] {
  const handCards = input.hand?.cards ?? [];
  const heldCodes = new Set<CardCode>(handCards.map((card) => card.code));
  const heldLiveBooks = new Set<BookCode>(handCards.map((card) => card.bookCode));
  const liveBooks = new Set<BookCode>(
    input.state.books.filter((book) => book.status === "unclaimed").map((book) => book.bookCode)
  );
  const target = input.state.players.find((player) => player.playerId === input.targetPlayerId);

  return CARD_CATALOG.map((card) => {
    let reason: string | null = null;

    if (!input.me) {
      reason = "Join the table first.";
    } else if (input.state.currentTurnPlayerId !== input.me.playerId) {
      reason = "Wait for your turn.";
    } else if (!target) {
      reason = "Choose an opponent first.";
    } else if (target.teamIndex === input.me.teamIndex) {
      reason = "Choose a player on the other team.";
    } else if (target.cardCount <= 0) {
      reason = "That player has no cards.";
    } else if (!liveBooks.has(card.bookCode)) {
      reason = "This book is already resolved.";
    } else if (heldCodes.has(card.code)) {
      reason = "You already hold this card.";
    } else if (!heldLiveBooks.has(card.bookCode)) {
      reason = "You must hold at least one card from this set.";
    }

    return {
      card,
      legal: !reason,
      reason
    };
  });
}

export function effectFromEvent(event: ClientGameEvent): TableEffect[] {
  switch (event.type) {
    case "player.joined":
      return [{
        id: `${event.id}:join`,
        kind: "speech",
        playerId: event.payload.playerId,
        text: "Joined the table",
        tone: "join"
      }];
    case "card.asked":
      return [
        {
          id: `${event.id}:ask`,
          kind: "speech",
          playerId: event.payload.askerPlayerId,
          text: `Asked for ${event.payload.cardCode}`,
          tone: "ask"
        },
        {
          id: `${event.id}:ask-announcement`,
          kind: "announcement",
          tone: "ask",
          askerPlayerId: event.payload.askerPlayerId,
          targetPlayerId: event.payload.targetPlayerId,
          cardCode: event.payload.cardCode
        }
      ];
    case "card.transferred":
      return [
        {
          id: `${event.id}:transfer`,
          kind: "transfer",
          fromPlayerId: event.payload.fromPlayerId,
          toPlayerId: event.payload.toPlayerId,
          cardCode: event.payload.cardCode,
          bookCode: event.payload.bookCode
        },
        {
          id: `${event.id}:hit-announcement`,
          kind: "announcement",
          tone: "hit",
          askerPlayerId: event.payload.toPlayerId,
          targetPlayerId: event.payload.fromPlayerId,
          cardCode: event.payload.cardCode
        }
      ];
    case "ask.missed":
      return [
        {
          id: `${event.id}:miss`,
          kind: "speech",
          playerId: event.payload.targetPlayerId,
          text: "No card",
          tone: "miss"
        },
        {
          id: `${event.id}:miss-announcement`,
          kind: "announcement",
          tone: "miss",
          askerPlayerId: event.payload.askerPlayerId,
          targetPlayerId: event.payload.targetPlayerId,
          cardCode: event.payload.cardCode
        },
        {
          id: `${event.id}:turn`,
          kind: "turn",
          playerId: event.payload.nextTurnPlayerId
        }
      ];
    case "turn.changed":
      return [{
        id: `${event.id}:turn`,
        kind: "turn",
        playerId: event.payload.currentTurnPlayerId
      }];
    case "claim.resolved":
      return [
        {
          id: `${event.id}:claim`,
          kind: "speech",
          playerId: event.payload.claimingPlayerId,
          text: "Claimed a book",
          tone: "claim"
        },
        {
          id: `${event.id}:celebration`,
          kind: "celebration",
          teamIndex: event.payload.awardedTeamIndex,
          text: event.payload.result === "cancelled_wrong_locations" ? "Book cancelled" : "Book scored"
        }
      ];
    case "game.completed":
      return [{
        id: `${event.id}:complete`,
        kind: "celebration",
        teamIndex: event.payload.winningTeamIndex,
        text: "Game complete"
      }];
    default:
      return [];
  }
}
