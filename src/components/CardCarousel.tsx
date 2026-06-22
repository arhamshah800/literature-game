import { useMemo, useState } from "react";
import type { PanInfo } from "framer-motion";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { bookLabels } from "../game/display";
import type { CardCode } from "../game/types";
import type { RequestCardOption } from "../game/ui";
import { GameCard } from "./GameCard";

type CardCarouselProps = {
  options: RequestCardOption[];
  onPick: (cardCode: CardCode) => void;
};

export function CardCarousel({ onPick, options }: CardCarouselProps) {
  const firstLegal = useMemo(() => Math.max(0, options.findIndex((option) => option.legal)), [options]);
  const [activeIndex, setActiveIndex] = useState(firstLegal);
  const active = options[activeIndex] ?? options[0];

  function move(delta: number) {
    setActiveIndex((current) => {
      const next = current + delta;
      if (next < 0) return options.length - 1;
      if (next >= options.length) return 0;
      return next;
    });
  }

  function handleDragEnd(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (Math.abs(info.offset.x) < 24 && Math.abs(info.velocity.x) < 120) return;
    move(info.offset.x < 0 ? 1 : -1);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/20 bg-white/10 p-4 text-white shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button className="icon-button border-white/20 bg-white/15 text-white hover:bg-white/25" onClick={() => move(-1)} title="Previous card">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-black">{active ? bookLabels[active.card.bookCode] : "Cards"}</p>
          <p className="text-xs font-semibold text-white/65">Drag, wheel, swipe, or use arrows</p>
        </div>
        <button className="icon-button border-white/20 bg-white/15 text-white hover:bg-white/25" onClick={() => move(1)} title="Next card">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <motion.div
        className="relative h-56 touch-pan-y"
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        onDragEnd={handleDragEnd}
        onWheel={(event) => {
          if (Math.abs(event.deltaX) + Math.abs(event.deltaY) < 4) return;
          event.preventDefault();
          move(event.deltaY + event.deltaX > 0 ? 1 : -1);
        }}
      >
        {options.map((option, index) => {
          const offset = index - activeIndex;
          if (Math.abs(offset) > 4) return null;
          return (
            <motion.div
              key={option.card.code}
              className="absolute left-1/2 top-4"
              animate={{
                x: `calc(-50% + ${offset * 78}px)`,
                y: Math.abs(offset) * 13,
                rotate: offset * 6,
                scale: offset === 0 ? 1 : 0.78,
                opacity: Math.abs(offset) > 3 ? 0 : 1,
                zIndex: 20 - Math.abs(offset)
              }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
            >
              <GameCard
                card={option.card}
                disabled={!option.legal}
                selected={offset === 0 && option.legal}
                title={option.reason ?? undefined}
                size="large"
                {...(option.legal ? { onClick: () => onPick(option.card.code) } : {})}
              />
            </motion.div>
          );
        })}
      </motion.div>
      {active?.reason ? (
        <p className="mt-2 rounded-md bg-black/20 px-3 py-2 text-center text-xs font-bold text-white/75">{active.reason}</p>
      ) : (
        <p className="mt-2 rounded-md bg-emerald-300/20 px-3 py-2 text-center text-xs font-bold text-emerald-50">Ready to request</p>
      )}
    </div>
  );
}
