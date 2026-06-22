import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  Copy,
  DoorOpen,
  Hand,
  Loader2,
  Play,
  RefreshCw,
  Shuffle,
  Users,
  X
} from "lucide-react";
import { BOOK_CODES, getCardsForBook } from "./game/cards";
import type {
  BookCode,
  CardCode,
  CardDefinition,
  ClaimAssignment,
  MyHandState,
  PlayerCount,
  PublicGameState,
  PublicPlayerState,
  TeamIndex
} from "./game/types";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import "./styles.css";

type GameEventRow = {
  id: string;
  game_id: string;
  version: number;
  event_type: string;
  actor_player_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

type BusyAction =
  | "auth"
  | "create"
  | "join"
  | "joinRandom"
  | "load"
  | "start"
  | "randomize"
  | "ask"
  | "claim"
  | null;

const storedGameIdKey = "literature.gameId";
const storedPlayerIdKey = "literature.playerId";
const storedNameKey = "literature.displayName";
const playerCountOptions = [4, 5, 6, 7, 8] as const;

function hashRequestKey(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function pendingRequestKey(action: "ask" | "claim", gameId: string, fingerprint: string) {
  return `literature.pending.${action}.${gameId}.${hashRequestKey(fingerprint)}`;
}

function getOrCreateRequestId(storageKey: string) {
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;

  const requestId = crypto.randomUUID();
  localStorage.setItem(storageKey, requestId);
  return requestId;
}

const bookLabels: Record<BookCode, string> = {
  clubs_low: "Clubs Low",
  clubs_high: "Clubs High",
  diamonds_low: "Diamonds Low",
  diamonds_high: "Diamonds High",
  hearts_low: "Hearts Low",
  hearts_high: "Hearts High",
  spades_low: "Spades Low",
  spades_high: "Spades High",
  eights_jokers: "8s + Jokers"
};

const teamNames: Record<TeamIndex, string> = {
  0: "North",
  1: "South"
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState(() => localStorage.getItem(storedNameKey) ?? "");
  const [gameId, setGameId] = useState(() => localStorage.getItem(storedGameIdKey) ?? "");
  const [playerId, setPlayerId] = useState(() => localStorage.getItem(storedPlayerIdKey) ?? "");
  const [state, setState] = useState<PublicGameState | null>(null);
  const [hand, setHand] = useState<MyHandState | null>(null);
  const [events, setEvents] = useState<GameEventRow[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [playerCount, setPlayerCount] = useState<PlayerCount>(6);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);

  const view = state?.status === "active" || state?.status === "completed" ? "game" : "lobby";
  const me = useMemo(
    () => state?.players.find((player) => player.playerId === playerId) ?? null,
    [playerId, state]
  );
  const hostPlayerId = state?.players.find((player) => player.seatIndex === 0)?.playerId;
  const isHost = Boolean(playerId && hostPlayerId === playerId);
  const canStart = Boolean(state && isHost && state.players.length === state.playerCount && state.status === "waiting");
  const isMyTurn = Boolean(state?.currentTurnPlayerId && state.currentTurnPlayerId === playerId);

  const run = useCallback(async <T,>(action: BusyAction, work: () => Promise<T>): Promise<T | null> => {
    setBusyAction(action);
    setError("");
    try {
      return await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      return null;
    } finally {
      setBusyAction(null);
    }
  }, []);

  const refreshGame = useCallback(async (targetGameId = gameId) => {
    if (!targetGameId) return;
    const { data, error: responseError } = await supabase.functions.invoke<{
      state: PublicGameState;
      myHand: MyHandState;
    }>(`get-game-state?gameId=${encodeURIComponent(targetGameId)}`, { method: "GET" });
    if (responseError) throw responseError;
    if (data?.state) setState(data.state);
    if (data?.myHand) {
      setHand({
        ...data.myHand,
        cards: [...data.myHand.cards].sort((left, right) => left.sortIndex - right.sortIndex)
      });
      setPlayerId(data.myHand.playerId);
      localStorage.setItem(storedPlayerIdKey, data.myHand.playerId);
    }
  }, [gameId]);

  const loadEvents = useCallback(async (targetGameId = gameId) => {
    if (!targetGameId) return;
    const { data, error: responseError } = await supabase
      .from("game_events")
      .select("id, game_id, version, event_type, actor_player_id, payload, created_at")
      .eq("game_id", targetGameId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (responseError) throw responseError;
    setEvents((data ?? []) as GameEventRow[]);
  }, [gameId]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !gameId) return;
    void run("load", async () => {
      await refreshGame(gameId);
      await loadEvents(gameId);
    });
  }, [gameId, loadEvents, refreshGame, run, session]);

  useEffect(() => {
    if (!session || !gameId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    void (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase
        .channel(`game:${gameId}`, { config: { private: true } })
        .on(
          "broadcast",
          { event: "*" },
          () => {
            void refreshGame(gameId);
            void loadEvents(gameId);
          }
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [gameId, loadEvents, refreshGame, session]);

  async function ensureAnonymousSession() {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      setSession(data.session);
      return data.session;
    }

    const { data: signInData, error: responseError } = await supabase.auth.signInAnonymously();
    if (responseError) throw responseError;
    if (!signInData.session) {
      throw new Error("Could not start a guest session.");
    }
    setSession(signInData.session);
    return signInData.session;
  }

  async function preparePlayer() {
    const name = displayName.trim();
    if (!name) {
      throw new Error("Enter your name first.");
    }
    localStorage.setItem(storedNameKey, name);
    await ensureAnonymousSession();
    return name;
  }

  async function resetGuest() {
    await run("auth", async () => {
      leaveLocalGame();
      localStorage.removeItem(storedNameKey);
      setDisplayName("");
      await supabase.auth.signOut();
      const { data: signInData, error: responseError } = await supabase.auth.signInAnonymously();
      if (responseError) throw responseError;
      setSession(signInData.session);
    });
  }

  async function invokeGameFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const { data, error: responseError } = await supabase.functions.invoke<T>(name, { body });
    if (responseError) throw responseError;
    if (!data) throw new Error("No response returned.");
    return data;
  }

  async function createGame() {
    await run("create", async () => {
      const name = await preparePlayer();
      const result = await invokeGameFunction<{ gameId: string; playerId: string; state: PublicGameState }>("create-game", {
        playerCount,
        displayName: name
      });
      setGameId(result.gameId);
      setPlayerId(result.playerId);
      setState(result.state);
      setHand(null);
      localStorage.setItem(storedGameIdKey, result.gameId);
      localStorage.setItem(storedPlayerIdKey, result.playerId);
      await loadEvents(result.gameId);
    });
  }

  async function joinGame() {
    await run("join", async () => {
      const name = await preparePlayer();
      const result = await invokeGameFunction<{ gameId: string; playerId: string; state: PublicGameState }>("join-game", {
        lobbyCode: joinCode,
        displayName: name
      });
      setGameId(result.gameId);
      setPlayerId(result.playerId);
      setState(result.state);
      localStorage.setItem(storedGameIdKey, result.gameId);
      localStorage.setItem(storedPlayerIdKey, result.playerId);
      await loadEvents(result.gameId);
    });
  }

  async function joinRandomGame() {
    await run("joinRandom", async () => {
      const name = await preparePlayer();
      const result = await invokeGameFunction<{ gameId: string; playerId: string; state: PublicGameState }>("join-random-game", {
        displayName: name
      });
      setGameId(result.gameId);
      setPlayerId(result.playerId);
      setState(result.state);
      setHand(null);
      localStorage.setItem(storedGameIdKey, result.gameId);
      localStorage.setItem(storedPlayerIdKey, result.playerId);
      await loadEvents(result.gameId);
    });
  }

  async function randomizeTeams() {
    if (!state) return;
    await run("randomize", async () => {
      const result = await invokeGameFunction<{ state: PublicGameState }>("randomize-teams", { gameId: state.gameId });
      setState(result.state);
    });
  }

  async function startGame() {
    if (!state) return;
    await run("start", async () => {
      const result = await invokeGameFunction<{ state: PublicGameState; myHand: MyHandState }>("start-game", { gameId: state.gameId });
      setState(result.state);
      setHand(result.myHand);
    });
  }

  function leaveLocalGame() {
    setGameId("");
    setPlayerId("");
    setState(null);
    setHand(null);
    setEvents([]);
    localStorage.removeItem(storedGameIdKey);
    localStorage.removeItem(storedPlayerIdKey);
  }

  if (!hasSupabaseConfig) {
    return <Shell error="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before running the client." />;
  }

  return (
    <Shell error={error}>
      <header className="sticky top-0 z-30 border-b border-bark/10 bg-oat/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <button className="flex items-center gap-3 text-left" onClick={leaveLocalGame}>
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-ink text-linen">
              <BookOpenCheck className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-base font-semibold text-ink">Literature</span>
              <span className="block text-xs text-bark">{state?.lobbyCode ?? "Lobby"}</span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            {state ? (
              <button className="icon-button" onClick={() => void run("load", async () => refreshGame())} title="Refresh">
                <RefreshCw className="h-4 w-4" />
              </button>
            ) : null}
            <button className="secondary-button hidden sm:inline-flex" onClick={() => void resetGuest()} title="Reset guest">
              New player
            </button>
          </div>
        </div>
      </header>
      {view === "lobby" ? (
        <LobbyView
          busyAction={busyAction}
          canStart={canStart}
          displayName={displayName}
          isHost={isHost}
          joinCode={joinCode}
          playerCount={playerCount}
          state={state}
          onCreate={() => void createGame()}
          onDisplayName={setDisplayName}
          onJoin={() => void joinGame()}
          onJoinRandom={() => void joinRandomGame()}
          onJoinCode={setJoinCode}
          onPlayerCount={setPlayerCount}
          onRandomize={() => void randomizeTeams()}
          onStart={() => void startGame()}
        />
      ) : (
        <GameBoard
          askOpen={askOpen}
          busyAction={busyAction}
          claimOpen={claimOpen}
          events={events}
          hand={hand}
          isMyTurn={isMyTurn}
          me={me}
          state={state}
          onAsk={async (targetPlayerId, cardCode) => {
            if (!state) return;
            await run("ask", async () => {
              const storageKey = pendingRequestKey("ask", state.gameId, `${targetPlayerId}:${cardCode}`);
              const requestId = getOrCreateRequestId(storageKey);
              const result = await invokeGameFunction<{ state: PublicGameState; myHand: MyHandState }>("ask-card", {
                gameId: state.gameId,
                targetPlayerId,
                cardCode,
                requestId
              });
              localStorage.removeItem(storageKey);
              setState(result.state);
              setHand(result.myHand);
              setAskOpen(false);
            });
          }}
          onAskOpen={setAskOpen}
          onClaim={async (bookCode, assignments) => {
            if (!state) return;
            await run("claim", async () => {
              const storageKey = pendingRequestKey("claim", state.gameId, JSON.stringify({ bookCode, assignments }));
              const requestId = getOrCreateRequestId(storageKey);
              const result = await invokeGameFunction<{ state: PublicGameState; myHand: MyHandState }>("submit-claim", {
                gameId: state.gameId,
                bookCode,
                assignments,
                requestId
              });
              localStorage.removeItem(storageKey);
              setState(result.state);
              setHand(result.myHand);
              setClaimOpen(false);
            });
          }}
          onClaimOpen={setClaimOpen}
        />
      )}
    </Shell>
  );
}

function Shell({ children, error }: { children?: React.ReactNode; error?: string }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#d8e1cf_0,#f7f0e5_34%,#fffaf1_100%)] text-ink">
      {children}
      {error ? (
        <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-md border border-clay/20 bg-linen px-4 py-3 text-sm font-medium text-ink shadow-soft">
          {error}
        </div>
      ) : null}
    </main>
  );
}

function LobbyView(props: {
  busyAction: BusyAction;
  canStart: boolean;
  displayName: string;
  isHost: boolean;
  joinCode: string;
  playerCount: PlayerCount;
  state: PublicGameState | null;
  onCreate: () => void;
  onDisplayName: (value: string) => void;
  onJoin: () => void;
  onJoinRandom: () => void;
  onJoinCode: (value: string) => void;
  onPlayerCount: (value: PlayerCount) => void;
  onRandomize: () => void;
  onStart: () => void;
}) {
  const waiting = props.state?.status === "waiting";
  return (
    <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[360px_1fr]">
      <section className="panel rounded-lg p-4 sm:p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-ink">Lobby</h2>
          {props.state ? <LobbyCode code={props.state.lobbyCode} /> : null}
        </div>
        <div className="grid gap-4">
          <input className="control" value={props.displayName} onChange={(event) => props.onDisplayName(event.target.value)} placeholder="Display name" />
          <div className="rounded-lg border border-bark/10 bg-linen/55 p-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">Create a room</h3>
              <span className="text-xs font-semibold text-bark">{props.playerCount} players</span>
            </div>
            <div className="mb-3 grid grid-cols-5 gap-2">
              {playerCountOptions.map((count) => (
                <button
                  key={count}
                  className={`h-10 rounded-md border text-sm font-semibold transition ${
                    props.playerCount === count ? "border-ink bg-ink text-linen" : "border-bark/15 bg-linen text-ink hover:border-clay/50"
                  }`}
                  onClick={() => props.onPlayerCount(count)}
                >
                  {count}
                </button>
              ))}
            </div>
            <button className="primary-button w-full" onClick={props.onCreate} disabled={!props.displayName.trim() || props.busyAction === "create"}>
              {props.busyAction === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />}
              Create room
            </button>
          </div>
          <div className="rounded-lg border border-bark/10 bg-linen/55 p-3">
            <h3 className="mb-3 text-sm font-bold text-ink">Join a game</h3>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className="control uppercase"
                value={props.joinCode}
                onChange={(event) => props.onJoinCode(event.target.value.toUpperCase())}
                placeholder="Join code"
              />
              <button className="secondary-button px-3" onClick={props.onJoin} disabled={!props.displayName.trim() || !props.joinCode || props.busyAction === "join"}>
                {props.busyAction === "join" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="rounded-lg border border-bark/10 bg-linen/55 p-3">
            <button className="secondary-button w-full" onClick={props.onJoinRandom} disabled={!props.displayName.trim() || props.busyAction === "joinRandom"}>
              {props.busyAction === "joinRandom" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              Join random game
            </button>
          </div>
        </div>
        {waiting && props.isHost ? (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button className="secondary-button" onClick={props.onRandomize} disabled={props.busyAction === "randomize"}>
              <Shuffle className="h-4 w-4" />
              Teams
            </button>
            <button className="primary-button" onClick={props.onStart} disabled={!props.canStart || props.busyAction === "start"}>
              <Play className="h-4 w-4" />
              Start
            </button>
          </div>
        ) : null}
      </section>
      <section className="panel min-h-[520px] rounded-lg p-4 sm:p-5">
        {props.state ? (
          <>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold text-ink">
                  {props.state.players.length} / {props.state.playerCount} seated
                </h2>
                <p className="mt-1 text-sm text-bark">Room {props.state.lobbyCode}</p>
              </div>
              <SeatMeter total={props.state.playerCount} filled={props.state.players.length} />
            </div>
            <TeamGrid players={props.state.players} currentTurnPlayerId={props.state.currentTurnPlayerId} totalSeats={props.state.playerCount} />
          </>
        ) : (
          <div className="flex min-h-[480px] items-center justify-center rounded-md border border-dashed border-bark/20 bg-linen/45">
            <div className="text-center">
              <Users className="mx-auto h-10 w-10 text-moss" />
              <p className="mt-3 text-lg font-semibold text-ink">No room selected</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function GameBoard(props: {
  busyAction: BusyAction;
  events: GameEventRow[];
  hand: MyHandState | null;
  isMyTurn: boolean;
  me: PublicPlayerState | null;
  state: PublicGameState | null;
  askOpen: boolean;
  claimOpen: boolean;
  onAskOpen: (open: boolean) => void;
  onClaimOpen: (open: boolean) => void;
  onAsk: (targetPlayerId: string, cardCode: CardCode) => Promise<void>;
  onClaim: (bookCode: BookCode, assignments: ClaimAssignment[]) => Promise<void>;
}) {
  if (!props.state) return null;
  const scores = scoreBooks(props.state);
  const currentPlayer = props.state.players.find((player) => player.playerId === props.state?.currentTurnPlayerId);
  return (
    <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 xl:grid-cols-[280px_1fr_360px]">
      <aside className="grid gap-4 xl:sticky xl:top-[84px] xl:self-start">
        <section className="panel rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-clay">Turn</p>
              <h2 className="mt-1 text-xl font-semibold text-ink">{currentPlayer?.displayName ?? "Waiting"}</h2>
            </div>
            <span className={`rounded-md px-2 py-1 text-xs font-bold ${props.isMyTurn ? "bg-sage text-ink" : "bg-parchment text-bark"}`}>
              {props.isMyTurn ? "You" : props.state.status}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <ScorePill label={teamNames[0]} score={scores[0]} />
            <ScorePill label={teamNames[1]} score={scores[1]} />
          </div>
        </section>
        <section className="panel rounded-lg p-4">
          <TeamGrid players={props.state.players} currentTurnPlayerId={props.state.currentTurnPlayerId} compact />
        </section>
      </aside>
      <section className="grid min-w-0 gap-4">
        <BookTrack state={props.state} />
        <PlayerHand cards={props.hand?.cards ?? []} />
        <div className="sticky bottom-3 z-20 grid grid-cols-2 gap-2 sm:relative sm:bottom-auto">
          <button className="primary-button" onClick={() => props.onAskOpen(true)} disabled={!props.isMyTurn || props.busyAction === "ask"}>
            <Hand className="h-4 w-4" />
            Ask
          </button>
          <button className="secondary-button" onClick={() => props.onClaimOpen(true)} disabled={props.busyAction === "claim"}>
            <Check className="h-4 w-4" />
            Claim
          </button>
        </div>
      </section>
      <ActivityLog events={props.events} players={props.state.players} />
      {props.askOpen ? (
        <AskModal
          busy={props.busyAction === "ask"}
          hand={props.hand?.cards ?? []}
          me={props.me}
          state={props.state}
          onClose={() => props.onAskOpen(false)}
          onSubmit={props.onAsk}
        />
      ) : null}
      {props.claimOpen ? (
        <ClaimModal
          busy={props.busyAction === "claim"}
          me={props.me}
          state={props.state}
          onClose={() => props.onClaimOpen(false)}
          onSubmit={props.onClaim}
        />
      ) : null}
    </div>
  );
}

function AskModal(props: {
  busy: boolean;
  hand: CardDefinition[];
  me: PublicPlayerState | null;
  state: PublicGameState;
  onClose: () => void;
  onSubmit: (targetPlayerId: string, cardCode: CardCode) => Promise<void>;
}) {
  const liveBooks = useMemo(
    () => new Set(props.state.books.filter((book) => book.status === "unclaimed").map((book) => book.bookCode)),
    [props.state.books]
  );
  const heldCodes = useMemo(() => new Set(props.hand.map((card) => card.code)), [props.hand]);
  const eligibleBooks = useMemo(
    () => [...new Set(props.hand.map((card) => card.bookCode))].filter((bookCode) => liveBooks.has(bookCode)),
    [liveBooks, props.hand]
  );
  const [bookCode, setBookCode] = useState<BookCode | "">(eligibleBooks[0] ?? "");
  const cards = useMemo(
    () => (bookCode ? getCardsForBook(bookCode).filter((cardCode) => !heldCodes.has(cardCode)) : []),
    [bookCode, heldCodes]
  );
  const [cardCode, setCardCode] = useState<CardCode | "">((cards[0] as CardCode | undefined) ?? "");
  const opponents = props.state.players.filter((player) => props.me && player.teamIndex !== props.me.teamIndex);
  const [targetPlayerId, setTargetPlayerId] = useState(opponents[0]?.playerId ?? "");

  useEffect(() => {
    if (bookCode && !cards.includes(cardCode as CardCode)) {
      setCardCode((cards[0] as CardCode | undefined) ?? "");
    }
  }, [bookCode, cardCode, cards]);

  return (
    <Modal title="Ask" onClose={props.onClose}>
      <div className="grid gap-3">
        <Select label="Opponent" value={targetPlayerId} onChange={setTargetPlayerId}>
          {opponents.map((player) => <option key={player.playerId} value={player.playerId}>{player.displayName}</option>)}
        </Select>
        <Select label="Set" value={bookCode} onChange={(value) => setBookCode(value as BookCode)}>
          {eligibleBooks.map((eligibleBook) => <option key={eligibleBook} value={eligibleBook}>{bookLabels[eligibleBook]}</option>)}
        </Select>
        <Select label="Card" value={cardCode} onChange={(value) => setCardCode(value as CardCode)}>
          {cards.map((card) => <option key={card} value={card}>{formatCard(card)}</option>)}
        </Select>
        <button className="primary-button" disabled={!targetPlayerId || !cardCode || props.busy} onClick={() => props.onSubmit(targetPlayerId, cardCode as CardCode)}>
          {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />}
          Send ask
        </button>
      </div>
    </Modal>
  );
}

function ClaimModal(props: {
  busy: boolean;
  me: PublicPlayerState | null;
  state: PublicGameState;
  onClose: () => void;
  onSubmit: (bookCode: BookCode, assignments: ClaimAssignment[]) => Promise<void>;
}) {
  const unresolvedBooks = useMemo(
    () => props.state.books.filter((book) => book.status === "unclaimed").map((book) => book.bookCode),
    [props.state.books]
  );
  const teammates = useMemo(
    () => props.state.players.filter((player) => props.me && player.teamIndex === props.me.teamIndex),
    [props.me, props.state.players]
  );
  const fallbackPlayerId = props.me?.playerId ?? teammates[0]?.playerId ?? "";
  const [bookCode, setBookCode] = useState<BookCode>(unresolvedBooks[0] ?? "clubs_low");
  const cards = getCardsForBook(bookCode);
  const [assignments, setAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(cards.map((card) => [card, fallbackPlayerId]))
  );

  useEffect(() => {
    setAssignments(Object.fromEntries(getCardsForBook(bookCode).map((card) => [card, fallbackPlayerId])));
  }, [bookCode, fallbackPlayerId]);

  return (
    <Modal title="Claim" onClose={props.onClose}>
      <div className="grid gap-3">
        <Select label="Set" value={bookCode} onChange={(value) => setBookCode(value as BookCode)}>
          {unresolvedBooks.map((unresolvedBook) => <option key={unresolvedBook} value={unresolvedBook}>{bookLabels[unresolvedBook]}</option>)}
        </Select>
        <div className="grid gap-2">
          {cards.map((card) => (
            <div key={card} className="grid grid-cols-[82px_1fr] items-center gap-2">
              <span className="rounded-md border border-bark/10 bg-oat px-3 py-2 text-sm font-semibold">{formatCard(card)}</span>
              <select
                className="control"
                value={assignments[card] ?? ""}
                onChange={(event) => setAssignments((current) => ({ ...current, [card]: event.target.value }))}
              >
                {teammates.map((player) => <option key={player.playerId} value={player.playerId}>{player.displayName}</option>)}
              </select>
            </div>
          ))}
        </div>
        <button
          className="primary-button"
          disabled={props.busy || cards.some((card) => !assignments[card])}
          onClick={() => props.onSubmit(bookCode, cards.map((cardCode) => ({ cardCode, playerId: assignments[cardCode] ?? "" })))}
        >
          {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Submit
        </button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-ink/20 p-0 backdrop-blur-sm sm:place-items-center sm:p-4">
      <div className="panel max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-lg p-4 sm:rounded-lg sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-ink">{title}</h2>
          <button className="icon-button" onClick={onClose} title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Select({ children, label, onChange, value }: { children: React.ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-bark">
      {label}
      <select className="control" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function PlayerHand({ cards }: { cards: CardDefinition[] }) {
  const grouped = groupCards(cards);
  return (
    <section className="panel rounded-lg p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-ink">Hand</h2>
        <span className="rounded-md bg-parchment px-2 py-1 text-xs font-bold text-bark">{cards.length} cards</span>
      </div>
      <div className="grid gap-4">
        {grouped.length ? grouped.map(([bookCode, bookCards]) => (
          <div key={bookCode}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-bark">{bookLabels[bookCode]}</h3>
              <span className="text-xs text-bark">{bookCards.length}/6</span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {bookCards.map((card) => <CardTile key={card.code} card={card} />)}
            </div>
          </div>
        )) : (
          <div className="rounded-md border border-dashed border-bark/20 bg-linen/55 p-8 text-center text-sm font-semibold text-bark">
            Waiting for the deal.
          </div>
        )}
      </div>
    </section>
  );
}

function CardTile({ card }: { card: CardDefinition }) {
  const color = card.suit === "hearts" || card.suit === "diamonds" || card.code === "JOKER_RED" ? "text-clay" : "text-ink";
  return (
    <div className="aspect-[5/7] rounded-md border border-bark/15 bg-linen p-2 shadow-sm">
      <div className={`text-lg font-bold ${color}`}>{formatCard(card.code)}</div>
      <div className="mt-6 text-xs font-semibold capitalize text-bark">{card.isJoker ? "Joker" : card.suit}</div>
    </div>
  );
}

function ActivityLog({ events, players }: { events: GameEventRow[]; players: PublicPlayerState[] }) {
  return (
    <aside className="panel rounded-lg p-4 xl:sticky xl:top-[84px] xl:max-h-[calc(100vh-104px)] xl:self-start xl:overflow-auto">
      <h2 className="mb-4 text-xl font-semibold text-ink">Activity</h2>
      <div className="grid gap-2">
        {events.map((event) => (
          <div key={event.id} className="rounded-md border border-bark/10 bg-linen/70 p-3 text-sm">
            <p className="font-semibold text-ink">{eventText(event, players)}</p>
            <p className="mt-1 text-xs text-bark">{new Date(event.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
          </div>
        ))}
        {!events.length ? <p className="rounded-md border border-dashed border-bark/20 p-4 text-sm font-semibold text-bark">No moves yet.</p> : null}
      </div>
    </aside>
  );
}

function BookTrack({ state }: { state: PublicGameState }) {
  return (
    <section className="panel rounded-lg p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-9">
        {state.books.map((book) => (
          <div
            key={book.bookCode}
            className={`rounded-md border px-3 py-2 ${
              book.status === "unclaimed"
                ? "border-bark/10 bg-linen"
                : book.awardedTeamIndex === 0
                  ? "border-moss/30 bg-sage"
                  : "border-clay/20 bg-parchment"
            }`}
          >
            <p className="truncate text-xs font-bold text-ink">{bookLabels[book.bookCode]}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-bark">
              {book.status === "unclaimed" ? "Live" : book.status === "cancelled" ? "Void" : teamNames[book.awardedTeamIndex ?? 0]}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamGrid({
  compact = false,
  currentTurnPlayerId,
  players,
  totalSeats
}: {
  compact?: boolean;
  currentTurnPlayerId: string | null;
  players: PublicPlayerState[];
  totalSeats?: number;
}) {
  const teams = [0, 1].map((teamIndex) => players.filter((player) => player.teamIndex === teamIndex)) as [PublicPlayerState[], PublicPlayerState[]];
  return (
    <div className={`grid gap-3 ${compact ? "" : "md:grid-cols-2"}`}>
      {teams.map((teamPlayers, index) => (
        <div key={index} className="rounded-lg border border-bark/10 bg-linen/60 p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-ink">{teamNames[index as TeamIndex]}</h3>
            <span className="rounded-md bg-oat px-2 py-1 text-xs font-bold text-bark">
              {teamPlayers.length}
              {totalSeats ? ` / ${Math.ceil(totalSeats / 2)}` : ""}
            </span>
          </div>
          <div className="grid gap-2">
            {teamPlayers.map((player) => (
              <PlayerRow key={player.playerId} player={player} active={player.playerId === currentTurnPlayerId} />
            ))}
            {!teamPlayers.length ? <div className="h-12 rounded-md border border-dashed border-bark/15" /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayerRow({ active, player }: { active: boolean; player: PublicPlayerState }) {
  return (
    <div className={`grid grid-cols-[32px_1fr_auto] items-center gap-2 rounded-md border p-2 ${
      active ? "border-clay/40 bg-parchment" : "border-bark/10 bg-linen"
    }`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-oat text-xs font-bold text-ink">{player.seatIndex + 1}</span>
      <span className="min-w-0 truncate text-sm font-semibold text-ink">{player.displayName}</span>
      <span className="text-xs font-bold text-bark">{player.cardCount}</span>
    </div>
  );
}

function LobbyCode({ code }: { code: string }) {
  return (
    <button className="secondary-button h-9 px-3" onClick={() => void navigator.clipboard?.writeText(code)}>
      <Copy className="h-4 w-4" />
      {code}
    </button>
  );
}

function SeatMeter({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={`h-2 w-7 rounded-full ${index < filled ? "bg-moss" : "bg-bark/15"}`} />
      ))}
    </div>
  );
}

function ScorePill({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-md border border-bark/10 bg-linen p-3">
      <p className="text-xs font-semibold text-bark">{label}</p>
      <p className="text-2xl font-bold text-ink">{score}</p>
    </div>
  );
}

function groupCards(cards: CardDefinition[]): [BookCode, CardDefinition[]][] {
  return BOOK_CODES.map((bookCode) => [
    bookCode,
    cards.filter((card) => card.bookCode === bookCode).sort((left, right) => left.sortIndex - right.sortIndex)
  ] as [BookCode, CardDefinition[]]).filter(([, bookCards]) => bookCards.length > 0);
}

function scoreBooks(state: PublicGameState): Record<TeamIndex, number> {
  return {
    0: state.books.filter((book) => book.status === "claimed" && book.awardedTeamIndex === 0).length,
    1: state.books.filter((book) => book.status === "claimed" && book.awardedTeamIndex === 1).length
  };
}

function playerName(players: PublicPlayerState[], playerId: unknown) {
  return players.find((player) => player.playerId === playerId)?.displayName ?? "Someone";
}

function eventText(event: GameEventRow, players: PublicPlayerState[]) {
  const payload = event.payload;
  switch (event.event_type) {
    case "player.joined":
      return `${playerName(players, payload.playerId)} joined ${teamNames[(payload.teamIndex as TeamIndex) ?? 0]}.`;
    case "game.started":
      return `Game started. ${playerName(players, payload.firstTurnPlayerId)} leads.`;
    case "teams.randomized":
      return "Teams randomized.";
    case "card.asked":
      return `${playerName(players, payload.askerPlayerId)} asked ${playerName(players, payload.targetPlayerId)} for ${formatCard(payload.cardCode as CardCode)}.`;
    case "card.transferred":
      return `${formatCard(payload.cardCode as CardCode)} moved to ${playerName(players, payload.toPlayerId)}.`;
    case "ask.missed":
      return `${playerName(players, payload.targetPlayerId)} did not have ${formatCard(payload.cardCode as CardCode)}.`;
    case "turn.changed":
      return `${playerName(players, payload.currentTurnPlayerId)} has the turn.`;
    case "claim.resolved":
      return `${playerName(players, payload.claimingPlayerId)} claimed ${bookLabels[payload.bookCode as BookCode]}.`;
    case "game.completed":
      return `${teamNames[payload.winningTeamIndex as TeamIndex]} won.`;
    default:
      return event.event_type;
  }
}

function formatCard(cardCode: CardCode | string) {
  if (cardCode === "JOKER_RED") return "Red Joker";
  if (cardCode === "JOKER_BLACK") return "Black Joker";
  return cardCode;
}

createRoot(document.getElementById("root")!).render(<App />);
