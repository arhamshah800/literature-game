import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { BOOK_CODES, CARD_CATALOG, getCardsForBook } from "./game/cards";
import { adaptRealtimePayload } from "./game/clientEvents";
import { bookLabels, formatCard, getTeamName } from "./game/display";
import { lobbyCodeLength, normalizeJoinCode } from "./game/lobbyCode";
import { maxDisplayNameLength, validateDisplayName } from "./game/playerNames";
import { buildRequestCardOptions, effectFromEvent, type TableEffect } from "./game/ui";
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
import { CardCarousel } from "./components/CardCarousel";
import { GameCard } from "./components/GameCard";
import { GameTable } from "./components/GameTable";
import { TeamNameEditor } from "./components/TeamNameEditor";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import "./styles.css";

type BusyAction =
  | "auth"
  | "create"
  | "join"
  | "joinRandom"
  | "load"
  | "start"
  | "randomize"
  | "renameTeams"
  | "ask"
  | "claim"
  | null;

const storedGameIdKey = "literature.gameId";
const storedPlayerIdKey = "literature.playerId";
const storedNameKey = "literature.displayName";
const soundMutedKey = "literature.soundMuted";
const playerCountOptions = [4, 5, 6, 7, 8] as const;
const notSeatedError = "You are not seated in this game.";

type EdgeFunctionErrorContext = {
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

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

async function getEdgeFunctionErrorMessage(responseError: Error) {
  const context = (responseError as Error & { context?: EdgeFunctionErrorContext }).context;

  if (context?.json) {
    try {
      const body = await context.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
        return body.error;
      }
    } catch (caught) {
      if (!(caught instanceof Error) || caught.message !== "Body is unusable") {
        throw caught;
      }
    }
  }

  if (context?.text) {
    try {
      const text = await context.text();
      if (text) return text;
    } catch (caught) {
      if (!(caught instanceof Error) || caught.message !== "Body is unusable") {
        throw caught;
      }
    }
  }

  return responseError.message;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState(() => localStorage.getItem(storedNameKey) ?? "");
  const [gameId, setGameId] = useState(() => localStorage.getItem(storedGameIdKey) ?? "");
  const [playerId, setPlayerId] = useState(() => localStorage.getItem(storedPlayerIdKey) ?? "");
  const [state, setState] = useState<PublicGameState | null>(null);
  const [hand, setHand] = useState<MyHandState | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [playerCount, setPlayerCount] = useState<PlayerCount>(6);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [effects, setEffects] = useState<TableEffect[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardCode | null>(null);
  const [soundMuted, setSoundMuted] = useState(() => localStorage.getItem(soundMutedKey) === "true");
  const audioRef = useRef<AudioContext | null>(null);
  const audioArmedRef = useRef(false);
  const lastAutoJoinKeyRef = useRef("");

  const view = state?.status === "active" || state?.status === "completed" ? "game" : "lobby";
  const me = useMemo(
    () => state?.players.find((player) => player.playerId === playerId) ?? null,
    [playerId, state]
  );
  const hostPlayerId = state?.players.find((player) => player.seatIndex === 0)?.playerId;
  const isHost = Boolean(playerId && hostPlayerId === playerId);
  const canStart = Boolean(state && isHost && state.players.length === state.playerCount && state.status === "waiting");
  const isMyTurn = Boolean(state?.currentTurnPlayerId && state.currentTurnPlayerId === playerId);

  const armAudio = useCallback(() => {
    audioArmedRef.current = true;
  }, []);

  const playCue = useCallback((cue: "slide" | "turn" | "miss" | "claim" | "join" | "complete" | "invalid") => {
    if (soundMuted || !audioArmedRef.current) return;
    try {
      const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioRef.current ?? new AudioContextClass();
      audioRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const frequencies = {
        slide: 520,
        turn: 740,
        miss: 170,
        claim: 880,
        join: 420,
        complete: 660,
        invalid: 120
      };
      oscillator.frequency.setValueAtTime(frequencies[cue], now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, frequencies[cue] * 0.62), now + 0.16);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.22);
    } catch {
      // Browsers may block audio until a gesture; the visual feedback still carries the action.
    }
  }, [soundMuted]);

  const enqueueEffects = useCallback((nextEffects: TableEffect[]) => {
    if (!nextEffects.length) return;
    setEffects((current) => [...current, ...nextEffects]);
    for (const effect of nextEffects) {
      const ttl = effect.kind === "transfer" ? 1400 : effect.kind === "celebration" ? 3400 : 4200;
      window.setTimeout(() => {
        setEffects((current) => current.filter((item) => item.id !== effect.id));
      }, ttl);
    }
  }, []);

  const run = useCallback(async <T,>(action: BusyAction, work: () => Promise<T>): Promise<T | null> => {
    setBusyAction(action);
    setError("");
    try {
      return await work();
    } catch (caught) {
      playCue("invalid");
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      return null;
    } finally {
      setBusyAction(null);
    }
  }, [playCue]);

  const refreshGame = useCallback(async (targetGameId = gameId) => {
    if (!targetGameId) return;
    const { data, error: responseError } = await supabase.functions.invoke<{
      state: PublicGameState;
      myHand: MyHandState;
    }>(`get-game-state?gameId=${encodeURIComponent(targetGameId)}`, { method: "GET" });
    if (responseError) {
      const message = await getEdgeFunctionErrorMessage(responseError);
      if (message === notSeatedError) {
        leaveLocalGame();
        throw new Error("Your saved room is no longer available. Create or join a room to keep playing.");
      }
      throw new Error(message);
    }
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
    });
  }, [gameId, refreshGame, run, session]);

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
          (message) => {
            const clientEvent = adaptRealtimePayload(message);
            if (clientEvent) {
              const visualEffects = effectFromEvent(clientEvent);
              enqueueEffects(visualEffects);
              if (clientEvent.type === "card.transferred") playCue("slide");
              if (clientEvent.type === "turn.changed") playCue("turn");
              if (clientEvent.type === "ask.missed") playCue("miss");
              if (clientEvent.type === "claim.resolved") playCue("claim");
              if (clientEvent.type === "player.joined") playCue("join");
              if (clientEvent.type === "game.completed") playCue("complete");
            }
            void refreshGame(gameId);
          }
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enqueueEffects, gameId, playCue, refreshGame, session]);

  useEffect(() => {
    if (!session || !gameId) return;
    let cancelled = false;

    const sendHeartbeat = async () => {
      const { error: responseError } = await supabase.functions.invoke("heartbeat", {
        body: { gameId }
      });
      if (cancelled || !responseError) return;

      const context = responseError.context as { json?: () => Promise<unknown> } | undefined;
      if (!context?.json) return;

      try {
        const body = await context.json();
        if (body && typeof body === "object" && "error" in body && body.error === notSeatedError) {
          leaveLocalGame();
        }
      } catch {
        // A heartbeat should never interrupt play for a transient network issue.
      }
    };

    const heartbeatId = window.setInterval(() => {
      void sendHeartbeat();
    }, 20_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void sendHeartbeat();
      }
    };

    void sendHeartbeat();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeatId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [gameId, session]);

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
    const name = validateDisplayName(displayName);
    localStorage.setItem(storedNameKey, name);
    setDisplayName(name);
    await ensureAnonymousSession();
    return name;
  }

  async function resetGuest() {
    armAudio();
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
    if (responseError) {
      const message = await getEdgeFunctionErrorMessage(responseError);
      if (message.includes("Failed to send a request to the Edge Function")) {
        throw new Error(`Could not reach the ${name} Edge Function. Make sure Supabase migrations are pushed and this function is deployed.`);
      }
      throw new Error(message);
    }
    if (!data) throw new Error("No response returned.");
    return data;
  }

  async function createGame() {
    armAudio();
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
    });
  }

  async function joinGame(codeOverride?: string) {
    armAudio();
    await run("join", async () => {
      const name = await preparePlayer();
      const requestedCode = normalizeJoinCode(codeOverride ?? joinCode);
      if (requestedCode.length !== lobbyCodeLength) {
        throw new Error(`Enter the ${lobbyCodeLength}-character room code.`);
      }
      const result = await invokeGameFunction<{ gameId: string; playerId: string; state: PublicGameState }>("join-game", {
        lobbyCode: requestedCode,
        displayName: name
      });
      setGameId(result.gameId);
      setPlayerId(result.playerId);
      setState(result.state);
      localStorage.setItem(storedGameIdKey, result.gameId);
      localStorage.setItem(storedPlayerIdKey, result.playerId);
    });
  }

  function updateJoinCode(value: string) {
    const nextCode = normalizeJoinCode(value);
    setJoinCode(nextCode);
  }

  async function joinRandomGame() {
    armAudio();
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
    });
  }

  async function randomizeTeams() {
    if (!state) return;
    armAudio();
    await run("randomize", async () => {
      const result = await invokeGameFunction<{ state: PublicGameState }>("randomize-teams", { gameId: state.gameId });
      setState(result.state);
    });
  }

  async function updateTeamNames(teamNamesValue: Record<TeamIndex, string>) {
    if (!state) return;
    armAudio();
    await run("renameTeams", async () => {
      const result = await invokeGameFunction<{ state: PublicGameState; myHand?: MyHandState }>("update-team-names", {
        gameId: state.gameId,
        teamNames: teamNamesValue
      });
      setState(result.state);
      if (result.myHand) {
        setHand({
          ...result.myHand,
          cards: [...result.myHand.cards].sort((left, right) => left.sortIndex - right.sortIndex)
        });
      }
    });
  }

  async function startGame() {
    if (!state) return;
    armAudio();
    await run("start", async () => {
      const result = await invokeGameFunction<{ state: PublicGameState; myHand: MyHandState }>("start-game", { gameId: state.gameId });
      setState(result.state);
      setHand(result.myHand);
      playCue("turn");
    });
  }

  function leaveLocalGame() {
    setGameId("");
    setPlayerId("");
    setState(null);
    setHand(null);
    setEffects([]);
    setSelectedCard(null);
    localStorage.removeItem(storedGameIdKey);
    localStorage.removeItem(storedPlayerIdKey);
  }

  function addLocalBubble(text: string) {
    if (!me) return;
    armAudio();
    const effect: TableEffect = {
      id: `local:${Date.now()}:${text}`,
      kind: "speech",
      playerId: me.playerId,
      text,
      tone: "ask"
    };
    enqueueEffects([effect]);
  }

  useEffect(() => {
    if (state || busyAction || joinCode.length !== lobbyCodeLength) return;
    try {
      validateDisplayName(displayName);
    } catch {
      return;
    }

    const autoJoinKey = `${joinCode}:${displayName.trim()}`;
    if (lastAutoJoinKeyRef.current === autoJoinKey) return;
    lastAutoJoinKeyRef.current = autoJoinKey;
    void joinGame(joinCode);
  }, [busyAction, displayName, joinCode, state]);

  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("demoTable")) {
    return <DevTableDemo />;
  }

  if (!hasSupabaseConfig) {
    return <Shell error="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before running the client." />;
  }

  return (
    <Shell error={error}>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/70 text-white backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <button className="flex items-center gap-3 text-left" onClick={leaveLocalGame}>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-300 to-rose-300 text-zinc-950 shadow-card">
              <BookOpenCheck className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-base font-black">Literature</span>
              <span className="block text-xs font-bold text-white/55">{state?.lobbyCode ?? "Lobby"}</span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            {state ? (
              <button className="icon-button border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => void run("load", async () => refreshGame())} title="Refresh">
                <RefreshCw className="h-4 w-4" />
              </button>
            ) : null}
            <button className="secondary-button hidden border-white/20 bg-white/10 text-white hover:bg-white/20 sm:inline-flex" onClick={() => void resetGuest()} title="Reset guest">
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
          onDisplayName={(value) => setDisplayName(value.slice(0, maxDisplayNameLength))}
          onJoin={() => void joinGame()}
          onJoinRandom={() => void joinRandomGame()}
          onJoinCode={updateJoinCode}
          onPlayerCount={setPlayerCount}
          onRandomize={() => void randomizeTeams()}
          onStart={() => void startGame()}
          onTeamNames={(teamNamesValue) => void updateTeamNames(teamNamesValue)}
        />
      ) : state ? (
        <>
          <GameTable
            busyAction={busyAction}
            effects={effects}
            hand={hand}
            isHost={isHost}
            isMyTurn={isMyTurn}
            me={me}
            selectedCard={selectedCard}
            soundMuted={soundMuted}
            state={state}
            onAskOpen={setAskOpen}
            onClaimOpen={setClaimOpen}
            onEmote={addLocalBubble}
            onSelectCard={setSelectedCard}
            onTeamNames={(teamNamesValue) => void updateTeamNames(teamNamesValue)}
            onToggleSound={() => {
              armAudio();
              setSoundMuted((current) => {
                localStorage.setItem(soundMutedKey, String(!current));
                return !current;
              });
            }}
          />
          {askOpen ? (
            <AskModal
              busy={busyAction === "ask"}
              hand={hand}
              me={me}
              state={state}
              onClose={() => setAskOpen(false)}
              onSubmit={async (targetPlayerId, cardCode) => {
                armAudio();
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
            />
          ) : null}
          {claimOpen ? (
            <ClaimModal
              busy={busyAction === "claim"}
              me={me}
              state={state}
              onClose={() => setClaimOpen(false)}
              onSubmit={async (bookCode, assignments) => {
                armAudio();
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
            />
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}

function Shell({ children, error }: { children?: React.ReactNode; error?: string }) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_15%_10%,#1fb6b6_0,#20235a_25%,#121525_58%,#080913_100%)] text-ink">
      {children}
      {error ? (
        <div className="fixed bottom-4 left-1/2 z-[80] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg border border-rose-200/35 bg-zinc-950/85 px-4 py-3 text-sm font-bold text-white shadow-soft backdrop-blur">
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
  onTeamNames: (teamNames: Record<TeamIndex, string>) => void;
}) {
  const waiting = props.state?.status === "waiting";
  const nameReady = props.displayName.trim().length > 0 && props.displayName.trim().length <= maxDisplayNameLength;
  const joinCodeReady = props.joinCode.length === lobbyCodeLength;
  return (
    <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[360px_1fr]">
      <section className="panel rounded-xl p-4 text-white sm:p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-black">Lobby</h2>
          {props.state ? <LobbyCode code={props.state.lobbyCode} /> : null}
        </div>
        <div className="grid gap-4">
          <input
            className="control border-white/20 bg-white/10 text-white placeholder:text-white/45"
            maxLength={maxDisplayNameLength}
            value={props.displayName}
            onChange={(event) => props.onDisplayName(event.target.value)}
            placeholder="Display name"
          />
          <div className="rounded-xl border border-white/10 bg-white/10 p-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-black">Create a room</h3>
              <span className="text-xs font-bold text-white/65">{props.playerCount} players</span>
            </div>
            <div className="mb-3 grid grid-cols-5 gap-2">
              {playerCountOptions.map((count) => (
                <button
                  key={count}
                  className={`h-10 rounded-md border text-sm font-black transition ${
                    props.playerCount === count ? "border-cyan-200 bg-cyan-200 text-zinc-950" : "border-white/15 bg-white/10 text-white hover:bg-white/20"
                  }`}
                  onClick={() => props.onPlayerCount(count)}
                >
                  {count}
                </button>
              ))}
            </div>
            <button className="primary-button w-full" onClick={props.onCreate} disabled={!nameReady || props.busyAction === "create"}>
              {props.busyAction === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />}
              Create room
            </button>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/10 p-3">
            <h3 className="mb-3 text-sm font-black">Join a game</h3>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className="control uppercase border-white/20 bg-white/10 text-white placeholder:text-white/45"
                maxLength={lobbyCodeLength}
                value={props.joinCode}
                onChange={(event) => props.onJoinCode(event.target.value)}
                placeholder="Join code"
              />
              <button className="secondary-button border-white/20 bg-white/10 px-3 text-white hover:bg-white/20" onClick={props.onJoin} disabled={!nameReady || !joinCodeReady || props.busyAction === "join"}>
                {props.busyAction === "join" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <button className="secondary-button w-full border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={props.onJoinRandom} disabled={!nameReady || props.busyAction === "joinRandom"}>
            {props.busyAction === "joinRandom" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            Join random game
          </button>
        </div>
        {waiting && props.isHost ? (
          <>
            {props.state ? (
              <div className="mt-5 rounded-xl border border-white/10 bg-white/10 p-3">
                <h3 className="mb-3 text-sm font-black">Team names</h3>
                <TeamNameEditor
                  busy={props.busyAction === "renameTeams"}
                  teamNames={props.state.teamNames}
                  onSubmit={props.onTeamNames}
                />
              </div>
            ) : null}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="secondary-button border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={props.onRandomize} disabled={props.busyAction === "randomize"}>
                <Shuffle className="h-4 w-4" />
                Teams
              </button>
              <button className="primary-button" onClick={props.onStart} disabled={!props.canStart || props.busyAction === "start"}>
                <Play className="h-4 w-4" />
                Start
              </button>
            </div>
          </>
        ) : null}
      </section>
      <section className="panel min-h-[520px] rounded-xl p-4 text-white sm:p-5">
        {props.state ? (
          <>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-3xl font-black">
                  {props.state.players.length} / {props.state.playerCount} seated
                </h2>
                <p className="mt-1 text-sm font-bold text-white/60">Room {props.state.lobbyCode}</p>
              </div>
              <SeatMeter total={props.state.playerCount} filled={props.state.players.length} />
            </div>
            <TeamGrid
              currentTurnPlayerId={props.state.currentTurnPlayerId}
              players={props.state.players}
              teamNames={props.state.teamNames}
              totalSeats={props.state.playerCount}
            />
          </>
        ) : (
          <div className="flex min-h-[480px] items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/10">
            <div className="text-center">
              <Users className="mx-auto h-10 w-10 text-cyan-200" />
              <p className="mt-3 text-lg font-black">No room selected</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function AskModal(props: {
  busy: boolean;
  hand: MyHandState | null;
  me: PublicPlayerState | null;
  state: PublicGameState;
  onClose: () => void;
  onSubmit: (targetPlayerId: string, cardCode: CardCode) => Promise<void>;
}) {
  const opponents = props.state.players.filter((player) => props.me && player.teamIndex !== props.me.teamIndex);
  const [targetPlayerId, setTargetPlayerId] = useState(opponents.find((player) => player.cardCount > 0)?.playerId ?? opponents[0]?.playerId ?? "");
  const options = useMemo(
    () => buildRequestCardOptions({ hand: props.hand, me: props.me, state: props.state, targetPlayerId }),
    [props.hand, props.me, props.state, targetPlayerId]
  );

  return (
    <Modal title="Request Card" onClose={props.onClose}>
      <div className="grid gap-4 text-white">
        <label className="grid gap-2 text-sm font-black text-white/75">
          Opponent
          <select className="control border-white/20 bg-zinc-950/60 text-white" value={targetPlayerId} onChange={(event) => setTargetPlayerId(event.target.value)}>
            {opponents.map((player) => (
              <option key={player.playerId} value={player.playerId}>
                {player.displayName} ({player.cardCount})
              </option>
            ))}
          </select>
        </label>
        <CardCarousel
          options={options}
          onPick={(cardCode) => {
            if (!props.busy && targetPlayerId) void props.onSubmit(targetPlayerId, cardCode);
          }}
        />
        <p className="text-center text-xs font-bold text-white/55">Only cards your hand can legally request are bright and clickable.</p>
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
    <Modal title="Claim Board" onClose={props.onClose}>
      <div className="grid gap-4 text-white">
        <label className="grid gap-2 text-sm font-black text-white/75">
          Book
          <select className="control border-white/20 bg-zinc-950/60 text-white" value={bookCode} onChange={(event) => setBookCode(event.target.value as BookCode)}>
            {unresolvedBooks.map((unresolvedBook) => <option key={unresolvedBook} value={unresolvedBook}>{bookLabels[unresolvedBook]}</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <div key={card} className="rounded-xl border border-white/15 bg-white/10 p-3">
              <div className="mb-3 flex justify-center">
                <GameCard cardCode={card} size="small" />
              </div>
              <select
                className="control w-full border-white/20 bg-zinc-950/60 text-white"
                value={assignments[card] ?? ""}
                onChange={(event) => setAssignments((current) => ({ ...current, [card]: event.target.value }))}
                title={`Who holds ${formatCard(card)}?`}
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
          Submit Claim
        </button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-zinc-950/55 p-0 backdrop-blur-sm sm:place-items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-t-2xl border border-white/15 bg-zinc-950/90 p-4 shadow-soft sm:rounded-2xl sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-black text-white">{title}</h2>
          <button className="icon-button border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={onClose} title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TeamGrid({
  compact = false,
  currentTurnPlayerId,
  players,
  teamNames,
  totalSeats
}: {
  compact?: boolean;
  currentTurnPlayerId: string | null;
  players: PublicPlayerState[];
  teamNames?: Record<TeamIndex, string>;
  totalSeats?: number;
}) {
  const teams = [0, 1].map((teamIndex) => players.filter((player) => player.teamIndex === teamIndex)) as [PublicPlayerState[], PublicPlayerState[]];
  return (
    <div className={`grid gap-3 ${compact ? "" : "md:grid-cols-2"}`}>
      {teams.map((teamPlayers, index) => (
        <div key={index} className="rounded-xl border border-white/10 bg-white/10 p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-black">{getTeamName(teamNames, index as TeamIndex)}</h3>
            <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-bold text-white/65">
              {teamPlayers.length}
              {totalSeats ? ` / ${Math.ceil(totalSeats / 2)}` : ""}
            </span>
          </div>
          <div className="grid gap-2">
            {teamPlayers.map((player) => (
              <PlayerRow key={player.playerId} player={player} active={player.playerId === currentTurnPlayerId} />
            ))}
            {!teamPlayers.length ? <div className="h-12 rounded-md border border-dashed border-white/15" /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayerRow({ active, player }: { active: boolean; player: PublicPlayerState }) {
  return (
    <div className={`grid grid-cols-[36px_1fr_auto] items-center gap-2 rounded-lg border p-2 ${
      active ? "border-cyan-200/60 bg-cyan-200/20" : "border-white/10 bg-white/10"
    }`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-xs font-black">{player.seatIndex + 1}</span>
      <span className="min-w-0 truncate text-sm font-black">{player.displayName}</span>
      <span className="text-xs font-black text-white/60">{player.cardCount}</span>
    </div>
  );
}

function LobbyCode({ code }: { code: string }) {
  return (
    <button className="secondary-button h-9 border-white/20 bg-white/10 px-3 text-white hover:bg-white/20" onClick={() => void navigator.clipboard?.writeText(code)}>
      <Copy className="h-4 w-4" />
      {code}
    </button>
  );
}

function SeatMeter({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={`h-2 w-7 rounded-full ${index < filled ? "bg-cyan-200" : "bg-white/15"}`} />
      ))}
    </div>
  );
}

function DevTableDemo() {
  const [selectedCard, setSelectedCard] = useState<CardCode | null>(null);
  const players: PublicPlayerState[] = [
    { playerId: "p1", displayName: "Thomas", seatIndex: 0, teamIndex: 0, cardCount: 11, isConnected: true },
    { playerId: "p2", displayName: "Sarah", seatIndex: 1, teamIndex: 1, cardCount: 8, isConnected: true },
    { playerId: "p3", displayName: "Jonathan", seatIndex: 2, teamIndex: 0, cardCount: 7, isConnected: true },
    { playerId: "p4", displayName: "Priya", seatIndex: 3, teamIndex: 1, cardCount: 6, isConnected: true },
    { playerId: "p5", displayName: "Michael", seatIndex: 4, teamIndex: 0, cardCount: 5, isConnected: true },
    { playerId: "p6", displayName: "Alexandra", seatIndex: 5, teamIndex: 1, cardCount: 4, isConnected: true },
    { playerId: "p7", displayName: "Ben", seatIndex: 6, teamIndex: 0, cardCount: 3, isConnected: true },
    { playerId: "p8", displayName: "Nina", seatIndex: 7, teamIndex: 1, cardCount: 2, isConnected: true }
  ];
  const state: PublicGameState = {
    gameId: "demo",
    lobbyCode: "DEMO",
    status: "active",
    playerCount: 8,
    currentTurnPlayerId: "p1",
    teamNames: { 0: "Team Alpha", 1: "Team Bravo" },
    version: 1,
    players,
    books: BOOK_CODES.map((bookCode, index) => ({
      bookCode,
      status: index < 2 ? "claimed" : "unclaimed",
      awardedTeamIndex: index === 0 ? 0 : index === 1 ? 1 : null
    }))
  };
  const hand: MyHandState = {
    gameId: "demo",
    playerId: "p1",
    cards: CARD_CATALOG.slice(0, 22)
  };

  return (
    <Shell>
      <GameTable
        busyAction={null}
        effects={[
          {
            id: "demo-announcement",
            kind: "announcement",
            tone: "miss",
            askerPlayerId: "p1",
            targetPlayerId: "p2",
            cardCode: "QH"
          }
        ]}
        hand={hand}
        isHost
        isMyTurn
        me={players[0] ?? null}
        selectedCard={selectedCard}
        soundMuted
        state={state}
        onAskOpen={() => undefined}
        onClaimOpen={() => undefined}
        onEmote={() => undefined}
        onSelectCard={setSelectedCard}
        onTeamNames={() => undefined}
        onToggleSound={() => undefined}
      />
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
