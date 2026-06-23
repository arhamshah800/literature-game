import { AnimatePresence, motion } from "framer-motion";
import { GameCard } from "./GameCard";
import { BOOK_CODES } from "../game/cards";
import { bookLabels } from "../game/display";
import type { BookCode, CardCode, CardDefinition } from "../game/types";

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

  const groups = groupCards(cards);

  return (
    <div className="hand-fan-shell">
      <div className="hand-group-scroll">
        <div className="hand-group-grid">
          {groups.map(([bookCode, bookCards]) => (
            <motion.section key={bookCode} className="hand-group" layout>
              <div className="hand-group-label">
                <span>{bookLabels[bookCode]}</span>
                <strong>{bookCards.length}/6</strong>
              </div>
              <div className="hand-group-cards">
                <AnimatePresence initial={false}>
                  {bookCards.map((card) => (
                    <motion.div
                      key={card.code}
                      layout
                      className="hand-card-slot"
                      initial={{ opacity: 0, y: 22, scale: 0.84 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 24, scale: 0.72 }}
                      transition={{ type: "spring", stiffness: 320, damping: 26 }}
                    >
                      <GameCard card={card} selected={selectedCard === card.code} onClick={() => onSelect(card.code)} size="small" />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.section>
          ))}
        </div>
      </div>
    </div>
  );
}

function groupCards(cards: CardDefinition[]): [BookCode, CardDefinition[]][] {
  return BOOK_CODES.map((bookCode) => [
    bookCode,
    cards.filter((card) => card.bookCode === bookCode).sort((left, right) => left.sortIndex - right.sortIndex)
  ] as [BookCode, CardDefinition[]]).filter(([, bookCards]) => bookCards.length > 0);
}
