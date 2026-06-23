import { useEffect } from "react";
import confetti from "canvas-confetti";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Hand, Sparkles, Volume2, VolumeX } from "lucide-react";
import { bookLabels, formatCardName, initials, teamNames } from "../game/display";
import { seatPosition, type TableEffect } from "../game/ui";
import type { CardCode, MyHandState, PublicGameState, PublicPlayerState, TeamIndex } from "../game/types";
import { GameCard } from "./GameCard";
import { HandFan } from "./HandFan";

type GameTableProps = {
  busyAction: string | null;
  effects: TableEffect[];
  hand: MyHandState | null;
  isMyTurn: boolean;
  me: PublicPlayerState | null;
  onAskOpen: (open: boolean) => void;
  onClaimOpen: (open: boolean) => void;
  onEmote: (text: string) => void;
  onSelectCard: (cardCode: CardCode) => void;
  onToggleSound: () => void;
  selectedCard: CardCode | null;
  soundMuted: boolean;
  state: PublicGameState;
};

export function GameTable({
  busyAction,
  effects,
  hand,
  isMyTurn,
  me,
  onAskOpen,
  onClaimOpen,
  onEmote,
  onSelectCard,
  onToggleSound,
  selectedCard,
  soundMuted,
  state
}: GameTableProps) {
  const scores = scoreBooks(state);
  const celebrationKey = effects.find((effect) => effect.kind === "celebration")?.id;
  const announcements = effects.filter((effect): effect is Extract<TableEffect, { kind: "announcement" }> => effect.kind === "announcement");

  useEffect(() => {
    if (!celebrationKey) return;
    void confetti({
      particleCount: 80,
      spread: 62,
      startVelocity: 42,
      origin: { y: 0.62 }
    });
  }, [celebrationKey]);

  return (
    <div className="game-scene">
      <div className="table-top">
        <TableHud state={state} scores={scores} soundMuted={soundMuted} onToggleSound={onToggleSound} />
        <div className="absolute inset-0">
          {state.players.map((player) => (
            <PlayerSeat
              key={player.playerId}
              active={player.playerId === state.currentTurnPlayerId}
              effect={effects.find((item) => item.kind === "speech" && item.playerId === player.playerId)}
              me={player.playerId === me?.playerId}
              player={player}
              totalSeats={state.playerCount}
            />
          ))}
        </div>
        <TransferLayer effects={effects} state={state} />
        <CenterAnnouncements announcements={announcements} state={state} />
        <div className="turn-indicator">
          <motion.div
            key={state.currentTurnPlayerId ?? "waiting"}
            className="mx-auto w-fit rounded-full border border-white/30 bg-zinc-950/60 px-5 py-2 text-sm font-black text-white shadow-soft backdrop-blur"
            initial={{ scale: 0.88, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
          >
            {isMyTurn ? "Your turn" : `${state.players.find((player) => player.playerId === state.currentTurnPlayerId)?.displayName ?? "Waiting"} is up`}
          </motion.div>
        </div>
      </div>
      <BookRibbon state={state} />

      <section className="hand-dock">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white/55">Your hand</p>
            <h2 className="text-2xl font-black text-white">{hand?.cards.length ?? 0} cards</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {["Nice", "Thinking", "Close", "Wow"].map((label) => (
              <button key={label} className="table-chip" onClick={() => onEmote(label)}>{label}</button>
            ))}
          </div>
        </div>
        <HandFan cards={hand?.cards ?? []} selectedCard={selectedCard} onSelect={onSelectCard} />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button className="primary-button table-action" onClick={() => onAskOpen(true)} disabled={!isMyTurn || busyAction === "ask"}>
            <Hand className="h-4 w-4" />
            Request Card
          </button>
          <button className="secondary-button table-action" onClick={() => onClaimOpen(true)} disabled={!isMyTurn || busyAction === "claim"}>
            <Check className="h-4 w-4" />
            Claim Book
          </button>
        </div>
      </section>

      {state.status === "completed" ? <EndGameOverlay state={state} scores={scores} /> : null}
    </div>
  );
}

function TableHud({
  onToggleSound,
  scores,
  soundMuted,
  state
}: {
  onToggleSound: () => void;
  scores: Record<TeamIndex, number>;
  soundMuted: boolean;
  state: PublicGameState;
}) {
  return (
    <div className="absolute left-4 right-4 top-4 z-10 flex items-center justify-between gap-3">
      <div className="flex gap-2">
        <ScoreBadge label={teamNames[0]} score={scores[0]} tone="north" />
        <ScoreBadge label={teamNames[1]} score={scores[1]} tone="south" />
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-black text-white/75 sm:inline-flex">
          Room {state.lobbyCode}
        </span>
        <button className="icon-button border-white/20 bg-white/15 text-white hover:bg-white/25" onClick={onToggleSound} title={soundMuted ? "Unmute sounds" : "Mute sounds"}>
          {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function ScoreBadge({ label, score, tone }: { label: string; score: number; tone: "north" | "south" }) {
  return (
    <div className={`score-badge ${tone === "north" ? "from-emerald-300/80 to-cyan-300/80" : "from-rose-300/80 to-amber-200/80"}`}>
      <span>{label}</span>
      <strong>{score}</strong>
    </div>
  );
}

function BookRibbon({ state }: { state: PublicGameState }) {
  return (
    <div className="book-ribbon">
      {state.books.map((book) => (
        <span
          key={book.bookCode}
          className={[
            "book-token",
            book.status === "unclaimed"
              ? "bg-white/10 text-white/75"
              : book.status === "cancelled"
                ? "bg-zinc-900/45 text-white/45 line-through"
                : book.awardedTeamIndex === 0
                  ? "bg-emerald-300 text-zinc-950"
                  : "bg-rose-300 text-zinc-950"
          ].join(" ")}
          title={bookLabels[book.bookCode]}
        >
          {bookLabels[book.bookCode].replace(" Low", " L").replace(" High", " H")}
        </span>
      ))}
    </div>
  );
}

function CenterAnnouncements({
  announcements,
  state
}: {
  announcements: Extract<TableEffect, { kind: "announcement" }>[];
  state: PublicGameState;
}) {
  const announcement = announcements.at(-1);

  return (
    <div className="announcement-lane">
      <AnimatePresence mode="popLayout">
        {announcement ? (
          <motion.div
            key={announcement.id}
            className={`center-announcement ${announcement.tone}`}
            initial={{ opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
          >
            {announcementText(announcement, state)}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function announcementText(effect: Extract<TableEffect, { kind: "announcement" }>, state: PublicGameState) {
  if (effect.text) return effect.text;
  const asker = playerName(state, effect.askerPlayerId);
  const target = playerName(state, effect.targetPlayerId);
  const card = effect.cardCode ? formatCardName(effect.cardCode) : "a card";

  if (effect.tone === "ask") return `${asker} asked ${target} for ${card}.`;
  if (effect.tone === "hit") return `${target} had ${card}. Card transferred.`;
  if (effect.tone === "miss") return `${target} did not have ${card}. Go Fish.`;
  if (effect.tone === "turn") return `${playerName(state, effect.playerId)} has the turn.`;
  return effect.text ?? "Claim resolved.";
}

function PlayerSeat({
  active,
  effect,
  me,
  player,
  totalSeats
}: {
  active: boolean;
  effect: TableEffect | undefined;
  me: boolean;
  player: PublicPlayerState;
  totalSeats: number;
}) {
  const position = seatPosition(player.seatIndex, totalSeats);
  return (
    <motion.div
      className="player-seat"
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: player.isConnected ? 1 : 0.45 }}
      transition={{ type: "spring", stiffness: 220, damping: 20 }}
    >
      <AnimatePresence>
        {effect?.kind === "speech" ? (
          <motion.div
            key={effect.id}
            className={`speech-bubble ${effect.tone}`}
            initial={{ opacity: 0, y: 10, scale: 0.88 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.92 }}
          >
            {effect.text}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <motion.div
        className={[
          "seat-avatar",
          active ? "active" : "",
          me ? "me" : "",
          player.teamIndex === 0 ? "team-north" : "team-south"
        ].join(" ")}
        {...(active
          ? {
              animate: { boxShadow: ["0 0 0 0 rgba(255,255,255,0.6)", "0 0 0 16px rgba(255,255,255,0)"] },
              transition: { duration: 1.5, repeat: Infinity }
            }
          : {})}
      >
        {initials(player.displayName)}
      </motion.div>
      <div className="seat-nameplate">
        <span className="block truncate">{me ? "You" : player.displayName}</span>
        <span className="text-white/55">{player.cardCount} cards</span>
      </div>
      <div className="seat-card-backs">
        {Array.from({ length: Math.min(player.cardCount, 5) }, (_, index) => (
          <GameCard key={index} back size="tiny" />
        ))}
      </div>
    </motion.div>
  );
}

function TransferLayer({ effects, state }: { effects: TableEffect[]; state: PublicGameState }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <AnimatePresence>
        {effects.filter((effect): effect is Extract<TableEffect, { kind: "transfer" }> => effect.kind === "transfer").map((effect) => {
          const from = seatForPlayer(state, effect.fromPlayerId);
          const to = seatForPlayer(state, effect.toPlayerId);
          const midX = (from.x + to.x) / 2;
          const midY = Math.min(from.y, to.y) - 14;
          return (
            <motion.div
              key={effect.id}
              className="absolute"
              initial={{ left: `${from.x}%`, top: `${from.y}%`, scale: 0.72, rotate: -12, opacity: 0 }}
              animate={{
                left: [`${from.x}%`, `${midX}%`, `${to.x}%`],
                top: [`${from.y}%`, `${midY}%`, `${to.y}%`],
                scale: [0.72, 1.1, 0.76],
                rotate: [-12, 9, 18],
                opacity: [0, 1, 0]
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.15, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <GameCard cardCode={effect.cardCode} size="small" glow />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function EndGameOverlay({ scores, state }: { scores: Record<TeamIndex, number>; state: PublicGameState }) {
  const winner = scores[0] >= scores[1] ? 0 : 1;
  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/70 p-4 backdrop-blur"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        className="w-full max-w-xl rounded-2xl border border-white/20 bg-white/15 p-6 text-center text-white shadow-soft"
        initial={{ y: 30, scale: 0.94 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 20 }}
      >
        <Sparkles className="mx-auto h-10 w-10 text-amber-200" />
        <p className="mt-3 text-sm font-black uppercase tracking-[0.22em] text-white/60">Final table</p>
        <h2 className="mt-2 text-4xl font-black">{teamNames[winner]} wins</h2>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <ScoreBadge label={teamNames[0]} score={scores[0]} tone="north" />
          <ScoreBadge label={teamNames[1]} score={scores[1]} tone="south" />
        </div>
        <div className="mt-5 grid gap-2 text-left">
          {state.books.filter((book) => book.status !== "unclaimed").map((book) => (
            <div key={book.bookCode} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-sm font-bold">
              <span>{bookLabels[book.bookCode]}</span>
              <span>{book.status === "cancelled" ? "Cancelled" : teamNames[book.awardedTeamIndex ?? 0]}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

function seatForPlayer(state: PublicGameState, playerId: string) {
  const player = state.players.find((candidate) => candidate.playerId === playerId);
  return seatPosition(player?.seatIndex ?? 0, state.playerCount);
}

function playerName(state: PublicGameState, playerId: string | undefined) {
  return state.players.find((player) => player.playerId === playerId)?.displayName ?? "Someone";
}

function scoreBooks(state: PublicGameState): Record<TeamIndex, number> {
  return {
    0: state.books.filter((book) => book.status === "claimed" && book.awardedTeamIndex === 0).length,
    1: state.books.filter((book) => book.status === "claimed" && book.awardedTeamIndex === 1).length
  };
}
