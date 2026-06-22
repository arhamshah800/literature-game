import { motion } from "framer-motion";
import { CARD_BY_CODE } from "../game/cards";
import { formatCard } from "../game/display";
import type { CardCode, CardDefinition } from "../game/types";

type GameCardProps = {
  back?: boolean;
  card?: CardDefinition | undefined;
  cardCode?: CardCode | undefined;
  disabled?: boolean;
  glow?: boolean;
  onClick?: (() => void) | undefined;
  selected?: boolean;
  size?: "tiny" | "small" | "medium" | "large";
  title?: string | undefined;
};

const sizeClasses = {
  tiny: "h-16 w-11",
  small: "h-24 w-16",
  medium: "h-36 w-24",
  large: "h-48 w-32"
};

export function GameCard({
  back = false,
  card,
  cardCode,
  disabled = false,
  glow = false,
  onClick,
  selected = false,
  size = "medium",
  title
}: GameCardProps) {
  const resolved = card ?? (cardCode ? CARD_BY_CODE.get(cardCode) : undefined);
  const red = resolved?.suit === "hearts" || resolved?.suit === "diamonds" || resolved?.code === "JOKER_RED";
  const accent = resolved?.suit === "hearts"
    ? "from-rose-400 to-red-600"
    : resolved?.suit === "diamonds"
      ? "from-sky-300 to-cyan-600"
      : resolved?.suit === "clubs"
        ? "from-emerald-300 to-green-700"
        : resolved?.suit === "spades"
          ? "from-slate-400 to-zinc-800"
          : resolved?.code === "JOKER_RED"
            ? "from-fuchsia-300 to-rose-600"
          : "from-amber-200 to-zinc-900";
  const interactiveMotion = !disabled && onClick
    ? {
        onClick,
        whileHover: { y: -18, scale: 1.1, rotate: 0 },
        whileTap: { scale: 0.96 }
      }
    : {};

  return (
    <motion.button
      type="button"
      className={[
        "game-card relative shrink-0 overflow-hidden rounded-lg border text-left shadow-card outline-none",
        sizeClasses[size],
        disabled ? "cursor-not-allowed opacity-35 saturate-0 blur-[0.35px]" : "cursor-pointer",
        selected ? "selected-card" : "",
        glow ? "received-card" : "",
        back ? "card-back border-white/30 bg-ink" : "border-white/70 bg-cardFace"
      ].join(" ")}
      disabled={disabled || !onClick}
      title={title ?? (resolved ? formatCard(resolved.code) : "Card back")}
      animate={selected ? { y: -28, scale: 1.06, rotate: 0 } : { y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 360, damping: 24 }}
      {...interactiveMotion}
    >
      {back || !resolved ? (
        <span className="absolute inset-1 rounded-md border border-white/25 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.24),transparent_34%),linear-gradient(135deg,#ff7468,#7c4dff_45%,#00a6a6)]">
          <span className="absolute inset-3 rounded border border-white/25" />
          <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/65" />
        </span>
      ) : (
        <>
          <span className={`absolute inset-x-0 top-0 h-2 bg-gradient-to-r ${accent}`} />
          <span className={`absolute left-2 top-3 text-base font-black leading-none ${red ? "text-rose-600" : "text-zinc-900"}`}>
            {resolved.rank}
          </span>
          <span className={`absolute right-2 top-3 text-xs font-black uppercase tracking-wide ${red ? "text-rose-600" : "text-zinc-900"}`}>
            {resolved.suit?.slice(0, 1) ?? "J"}
          </span>
          <span className="absolute inset-x-2 top-1/2 -translate-y-1/2 text-center">
            <span className={`block text-3xl font-black ${red ? "text-rose-600" : "text-zinc-900"}`}>
              {resolved.isJoker ? "Joker" : resolved.rank}
            </span>
            <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
              {resolved.isJoker ? "Wild" : resolved.suit}
            </span>
          </span>
          <span className={`absolute bottom-2 right-2 rotate-180 text-base font-black leading-none ${red ? "text-rose-600" : "text-zinc-900"}`}>
            {resolved.rank}
          </span>
        </>
      )}
    </motion.button>
  );
}
