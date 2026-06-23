import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
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
  const dragRef = useRef({ active: false, dragged: false, pointerId: -1, startScroll: 0, startX: 0 });
  const size = useElementSize(shellRef);
  const filters = useMemo(() => deriveHandFilters(cards), [cards]);
  const [activeFilter, setActiveFilter] = useState<BookCode | "all">("all");
  const visibleCards = useMemo(
    () => activeFilter === "all" ? cards : cards.filter((card) => card.bookCode === activeFilter),
    [activeFilter, cards]
  );
  const groups = useMemo(() => groupCards(visibleCards), [visibleCards]);
  const allCards = useMemo(
    () => [...cards].sort((left, right) => left.sortIndex - right.sortIndex),
    [cards]
  );
  const layout = useMemo(
    () => buildHandLayout({
      containerWidth: size.width || 960,
      groupCount: activeFilter === "all" ? Math.max(1, Math.ceil(allCards.length / 6)) : groups.length || 1,
      cardCount: visibleCards.length
    }),
    [activeFilter, allCards.length, groups.length, size.width, visibleCards.length]
  );
  const allMode = activeFilter === "all";

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

  function handleAllPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!allMode || !scrollRef.current) return;
    dragRef.current = {
      active: true,
      dragged: false,
      pointerId: event.pointerId,
      startScroll: scrollRef.current.scrollLeft,
      startX: event.clientX
    };
  }

  function handleAllPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!allMode || !drag.active || !scrollRef.current) return;

    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 4) {
      if (!scrollRef.current.hasPointerCapture(event.pointerId)) {
        scrollRef.current.setPointerCapture(event.pointerId);
      }
      drag.dragged = true;
      scrollRef.current.scrollLeft = drag.startScroll - deltaX;
      event.preventDefault();
    }
  }

  function handleAllPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (scrollRef.current?.hasPointerCapture(event.pointerId)) {
      scrollRef.current.releasePointerCapture(event.pointerId);
    }
    if (dragRef.current.dragged) {
      window.setTimeout(() => {
        dragRef.current.dragged = false;
      }, 120);
    }
    dragRef.current.active = false;
  }

  function handleAllCardKeyDown(event: KeyboardEvent<HTMLDivElement>, cardCode: CardCode) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(cardCode);
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
        {layout.showNavigation || allMode ? (
          <button className="hand-nav-button" onClick={() => scrollByGroup(-1)} title="Previous cards" data-collision-check="hand-prev">
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : null}
        <div
          ref={scrollRef}
          className={allMode ? "hand-all-scroll" : "hand-group-scroll"}
          onPointerCancel={allMode ? handleAllPointerEnd : undefined}
          onPointerDown={allMode ? handleAllPointerDown : undefined}
          onPointerMove={allMode ? handleAllPointerMove : undefined}
          onPointerUp={allMode ? handleAllPointerEnd : undefined}
        >
          {allMode ? (
            <div className="hand-all-fan" aria-label="All cards">
              <AnimatePresence initial={false}>
                {allCards.map((card, index) => {
                  const center = (allCards.length - 1) / 2;
                  const normalized = center ? (index - center) / center : 0;
                  const rotation = normalized * 18;
                  const curve = Math.abs(normalized) * 22;
                  const layer = Math.round(60 - Math.abs(index - center));
                  return (
                    <motion.div
                      key={card.code}
                      layout
                      className="hand-all-card-slot"
                      role="button"
                      style={{ zIndex: selectedCard === card.code ? 90 : layer }}
                      tabIndex={0}
                      title={card.code}
                      initial={{ opacity: 0, y: 34, rotate: rotation * 0.4, scale: 0.84 }}
                      animate={{ opacity: 1, y: curve, rotate: rotation, scale: 1 }}
                      exit={{ opacity: 0, y: 30, scale: 0.72 }}
                      transition={{ type: "spring", stiffness: 320, damping: 26 }}
                      onClick={() => onSelect(card.code)}
                      onKeyDown={(event) => handleAllCardKeyDown(event, card.code)}
                    >
                      <GameCard card={card} passive selected={selectedCard === card.code} size={layout.cardSize === "medium" ? "medium" : "small"} />
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          ) : (
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
          )}
        </div>
        {layout.showNavigation || allMode ? (
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
