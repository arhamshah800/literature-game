import { AnimatePresence, motion } from "framer-motion";
import { GameCard } from "./GameCard";
import type { CardCode, CardDefinition } from "../game/types";

type HandFanProps = {
  cards: CardDefinition[];
  selectedCard: CardCode | null;
  onSelect: (cardCode: CardCode) => void;
};

export function HandFan({ cards, onSelect, selectedCard }: HandFanProps) {
  if (!cards.length) {
    return (
      <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-white/35 bg-white/10 text-sm font-bold text-white/75">
        Waiting for the deal
      </div>
    );
  }

  const center = (cards.length - 1) / 2;

  return (
    <div className="hand-fan-shell">
      <div className="hand-fan-scroll">
        <div className="hand-fan-stage" style={{ width: `${Math.max(340, cards.length * 68 + 150)}px` }}>
          <AnimatePresence initial={false}>
            {cards.map((card, index) => {
              const offset = index - center;
              const rotate = offset * 5.4;
              const x = index * 58 + 40;
              const y = Math.abs(offset) * 4;
              return (
                <motion.div
                  key={card.code}
                  className="absolute bottom-0"
                  initial={{ opacity: 0, y: 60, rotate: 0 }}
                  animate={{ opacity: 1, x, y, rotate, zIndex: selectedCard === card.code ? 60 : index }}
                  exit={{ opacity: 0, y: 80, scale: 0.7 }}
                  transition={{ type: "spring", stiffness: 300, damping: 26 }}
                >
                  <GameCard card={card} selected={selectedCard === card.code} onClick={() => onSelect(card.code)} />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
