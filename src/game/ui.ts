import { BOOK_CODES, CARD_CATALOG } from "./cards";
import type { BookCode, CardCode, CardDefinition, MyHandState, PublicGameState, PublicPlayerState, TeamIndex } from "./types";
import type { ClientGameEvent } from "./clientEvents";

export type SeatPosition = {
  x: number;
  y: number;
  angle: number;
};

export type LayoutRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TableLayoutMetrics = {
  width: number;
  height: number;
  playerCount: number;
};

export type TableLayout = {
  compact: boolean;
  seatWidth: number;
  seatHeight: number;
  avatarSize: number;
  showSeatCards: boolean;
  seats: SeatPosition[];
  zones: {
    hud: LayoutRect;
    announcement: LayoutRect;
    turn: LayoutRect;
    seatArea: LayoutRect;
  };
};

export type HandLayoutMode = "fit" | "scroll";

export type HandLayout = {
  mode: HandLayoutMode;
  cardSize: "tiny" | "small" | "medium";
  visibleGroups: number;
  showNavigation: boolean;
};

export type Collision = {
  a: string;
  b: string;
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
  return buildTableLayout({ width: 1000, height: 620, playerCount: total }).seats[index] ?? {
    x: 50,
    y: 50,
    angle: 0
  };
}

export function buildTableLayout(metrics: TableLayoutMetrics): TableLayout {
  const width = Math.max(metrics.width, 320);
  const height = Math.max(metrics.height, 360);
  const playerCount = Math.max(metrics.playerCount, 1);
  const compact = width < 720 || height < 560;
  const padX = compact ? 16 : 120;
  const hudHeight = compact ? 78 : 94;
  const bottomReserve = compact ? 84 : 118;
  const seatWidth = compact ? 82 : 172;
  const seatHeight = compact ? 86 : 178;
  const avatarSize = compact ? 40 : 64;
  const top = hudHeight + seatHeight / 2 + 8;
  const bottom = height - bottomReserve - seatHeight / 2;
  const left = padX + seatWidth / 2;
  const right = width - padX - seatWidth / 2;
  const centerX = width / 2;
  const centerY = (top + bottom) / 2;
  const radiusX = Math.max(24, (right - left) / 2);
  const radiusY = Math.max(24, (bottom - top) / 2);

  const seats = compact
    ? compactSeatPositions({ width, height, playerCount, left, right, top, bottom })
    : Array.from({ length: playerCount }, (_, index) => {
        const angle = -90 + (360 / playerCount) * index;
        const radians = angle * Math.PI / 180;
        const x = clamp(centerX + Math.cos(radians) * radiusX, left, right);
        const y = clamp(centerY + Math.sin(radians) * radiusY, top, bottom);
        return {
          x: (x / width) * 100,
          y: (y / height) * 100,
          angle
        };
      });

  return {
    compact,
    seatWidth,
    seatHeight,
    avatarSize,
    showSeatCards: !compact && height >= 620,
    seats,
    zones: {
      hud: { id: "hud", x: 16, y: 16, width: width - 32, height: compact ? 56 : 68 },
      announcement: {
        id: "announcement",
        x: Math.max(16, width * 0.16),
        y: Math.max(hudHeight + 16, height * 0.28),
        width: Math.min(width - 32, width * 0.68),
        height: compact ? 76 : 92
      },
      turn: {
        id: "turn",
        x: Math.max(16, width * 0.31),
        y: Math.max(hudHeight + 110, height * 0.51),
        width: Math.min(width - 32, width * 0.38),
        height: 48
      },
      seatArea: {
        id: "seat-area",
        x: left - seatWidth / 2,
        y: top - seatHeight / 2,
        width: right - left + seatWidth,
        height: bottom - top + seatHeight
      }
    }
  };
}

export function seatRects(layout: TableLayout): LayoutRect[] {
  const tableWidth = 1000;
  const tableHeight = 620;
  return layout.seats.map((seat, index) => ({
    id: `seat-${index}`,
    x: seat.x / 100 * tableWidth - layout.seatWidth / 2,
    y: seat.y / 100 * tableHeight - layout.seatHeight / 2,
    width: layout.seatWidth,
    height: layout.seatHeight
  }));
}

export function hasCompactTable(metrics: Pick<TableLayoutMetrics, "width" | "height">) {
  return metrics.width < 720 || metrics.height < 560;
}

export function buildTeamRailSeatPositions(
  players: readonly Pick<PublicPlayerState, "seatIndex" | "teamIndex">[],
  metrics: Pick<TableLayoutMetrics, "width" | "height">
): SeatPosition[] {
  const width = Math.max(metrics.width, 320);
  const height = Math.max(metrics.height, 360);
  const railInset = width < 420 ? 64 : 82;
  const top = Math.max(84, height * 0.24);
  const bottom = Math.min(height - 58, height * 0.82);
  const byTeam = [0, 1].map((teamIndex) =>
    players
      .filter((player) => player.teamIndex === teamIndex)
      .sort((left, right) => left.seatIndex - right.seatIndex)
  ) as [
    Array<Pick<PublicPlayerState, "seatIndex" | "teamIndex">>,
    Array<Pick<PublicPlayerState, "seatIndex" | "teamIndex">>
  ];
  const seats: SeatPosition[] = [];

  byTeam.forEach((teamPlayers, teamIndex) => {
    const ySlots = distributedSlots(top, bottom, teamPlayers.length);
    const x = teamIndex === 0 ? railInset : width - railInset;
    teamPlayers.forEach((player, index) => {
      seats[player.seatIndex] = {
        x: x / width * 100,
        y: (ySlots[index] ?? (top + bottom) / 2) / height * 100,
        angle: teamIndex === 0 ? -90 : 90
      };
    });
  });

  return seats;
}

export function buildHandLayout(input: { containerWidth: number; groupCount: number; cardCount: number }): HandLayout {
  const width = Math.max(input.containerWidth, 320);
  const groupCount = Math.max(input.groupCount, 1);
  const cardCount = Math.max(input.cardCount, 0);
  const estimatedFitWidth = groupCount * 244 + (groupCount - 1) * 12;
  const cramped = width < estimatedFitWidth || width < 760;

  return {
    mode: cramped ? "scroll" : "fit",
    cardSize: width < 560 ? "tiny" : width < 880 || cardCount > 18 ? "small" : "medium",
    visibleGroups: Math.max(1, Math.floor(width / (width < 560 ? 220 : 256))),
    showNavigation: cramped
  };
}

export function deriveHandFilters(cards: readonly CardDefinition[]): Array<BookCode | "all"> {
  const present = new Set(cards.map((card) => card.bookCode));
  return ["all", ...BOOK_CODES.filter((bookCode) => present.has(bookCode))];
}

export function findCollisions(rects: readonly LayoutRect[], gap = 0): Collision[] {
  const collisions: Collision[] = [];
  for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
      const left = rects[leftIndex]!;
      const right = rects[rightIndex]!;
      if (rectsOverlap(left, right, gap)) {
        collisions.push({ a: left.id, b: right.id });
      }
    }
  }
  return collisions;
}

export function missAnnouncementText(targetName: string, cardName: string) {
  return `${targetName} did not have ${cardName}.`;
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
    } else if (input.state.pendingTransfer) {
      reason = "Say thank you before taking another action.";
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function compactSeatPositions(input: {
  width: number;
  height: number;
  playerCount: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}): SeatPosition[] {
  const topCount = Math.ceil(input.playerCount / 2);
  const bottomCount = input.playerCount - topCount;
  const topY = input.top;
  const bottomY = Math.max(input.bottom, topY + 88);
  const topXs = distributedSlots(input.left, input.right, topCount);
  const bottomXs = distributedSlots(input.left, input.right, bottomCount);

  return Array.from({ length: input.playerCount }, (_, index) => {
    const topRow = index < topCount;
    const rowIndex = topRow ? index : index - topCount;
    const rowCount = topRow ? topCount : bottomCount;
    const x = topRow ? topXs[rowIndex] ?? input.width / 2 : bottomXs[rowIndex] ?? input.width / 2;
    const y = topRow ? topY : bottomY;
    return {
      x: x / input.width * 100,
      y: y / input.height * 100,
      angle: topRow ? -110 + (rowCount > 1 ? (220 / (rowCount - 1)) * rowIndex : 110) : 110 - (rowCount > 1 ? (220 / (rowCount - 1)) * rowIndex : 110)
    };
  });
}

function distributedSlots(left: number, right: number, count: number) {
  if (count <= 0) return [];
  if (count === 1) return [(left + right) / 2];
  return Array.from({ length: count }, (_, index) => left + ((right - left) / (count - 1)) * index);
}

function rectsOverlap(left: LayoutRect, right: LayoutRect, gap: number) {
  return !(
    left.x + left.width + gap <= right.x ||
    right.x + right.width + gap <= left.x ||
    left.y + left.height + gap <= right.y ||
    right.y + right.height + gap <= left.y
  );
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
    case "card.thank_required":
      return [
        {
          id: `${event.id}:thank-required`,
          kind: "announcement",
          tone: "hit",
          askerPlayerId: event.payload.toPlayerId,
          targetPlayerId: event.payload.fromPlayerId,
          cardCode: event.payload.cardCode,
          text: "Say thank you before picking up the card."
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
    case "card.thank_penalty":
      return [
        {
          id: `${event.id}:thank-penalty`,
          kind: "announcement",
          tone: "miss",
          askerPlayerId: event.payload.toPlayerId,
          targetPlayerId: event.payload.fromPlayerId,
          cardCode: event.payload.cardCode,
          text: "No thank you. The card went back."
        },
        {
          id: `${event.id}:turn`,
          kind: "turn",
          playerId: event.payload.nextTurnPlayerId
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
    case "teams.renamed":
      return [{
        id: `${event.id}:teams-renamed`,
        kind: "announcement",
        tone: "claim",
        text: "Team names updated."
      }];
    default:
      return [];
  }
}
