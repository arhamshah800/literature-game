import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GameCard } from "./GameCard";
import { BOOK_CODES } from "../game/cards";
import { bookLabels } from "../game/display";
import { buildHandLayout, deriveHandFilters } from "../game/ui";
import type { BookCode, CardCode, CardDefinition } from "../game/types";
import { useElementSize } from "./useElementSize";

type HandFanProps = {
  cards: CardDefinition[];
  selectedCard: CardCode | null;
  onSelect: (cardCode: CardCode) => void;
};

export function HandFan({ cards, onSelect, selectedCard }: HandFanProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const size = useElementSize(shellRef);
  const filters = useMemo(() => deriveHandFilters(cards), [cards]);
  const [activeFilter, setActiveFilter] = useState<BookCode | "all">("all");
  const visibleCards = useMemo(
    () => activeFilter === "all" ? cards : cards.filter((card) => card.bookCode === activeFilter),
    [activeFilter, cards]
  );
  const groups = useMemo(() => groupCards(visibleCards), [visibleCards]);
  const layout = useMemo(
    () => buildHandLayout({ containerWidth: size.width || 960, groupCount: groups.length || 1, cardCount: visibleCards.length }),
    [groups.length, size.width, visibleCards.length]
  );

  useEffect(() => {
    if (!filters.includes(activeFilter)) {
      setActiveFilter("all");
    }
  }, [activeFilter, filters]);

  if (!cards.length) {
    return (
      <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-white/35 bg-white/10 text-sm font-bold text-white/75">
        Waiting for the deal
      </div>
    );
  }

  function scrollByGroup(direction: -1 | 1) {
    const element = scrollRef.current;
    if (!element) return;
    const amount = Math.max(220, Math.round(element.clientWidth * 0.82));
    element.scrollBy({ left: direction * amount, behavior: "smooth" });
  }

  return (
    <div
      ref={shellRef}
      className={`hand-fan-shell ${layout.mode === "scroll" ? "hand-overflows" : "hand-fits"}`}
      data-collision-zone="hand"
    >
      <div className="hand-filter-bar" data-collision-zone="hand-filters">
        {filters.map((filter) => (
          <button
            key={filter}
            className={`hand-filter ${activeFilter === filter ? "active" : ""}`}
            data-collision-check="hand-filter"
            onClick={() => {
              setActiveFilter(filter);
              window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" }));
            }}
          >
            {filter === "all" ? "All" : bookLabels[filter].replace(" Low", " L").replace(" High", " H")}
          </button>
        ))}
      </div>
      <div className="hand-navigation-row">
        {layout.showNavigation ? (
          <button className="hand-nav-button" onClick={() => scrollByGroup(-1)} title="Previous cards" data-collision-check="hand-prev">
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : null}
        <div ref={scrollRef} className="hand-group-scroll">
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
                      <GameCard card={card} selected={selectedCard === card.code} onClick={() => onSelect(card.code)} size={layout.cardSize === "medium" ? "medium" : "small"} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.section>
          ))}
          </div>
        </div>
        {layout.showNavigation ? (
          <button className="hand-nav-button" onClick={() => scrollByGroup(1)} title="Next cards" data-collision-check="hand-next">
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : null}
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
