# Literature Game

An authoritative, real-time multiplayer web implementation of the card game **Literature**.

This repository is for an online-only game. It is not a pass-and-play implementation, and it does not trust the browser with game authority. The frontend may display state and request actions, but the backend is the only place that validates turns, card ownership, card transfers, claims, scoring, and game completion.

The intended production stack is:

- **TypeScript** for all application and game logic.
- **Vercel** for the web frontend.
- **Supabase Auth** for user identity.
- **Supabase Postgres** for authoritative game state.
- **Supabase Realtime** for instant state updates.
- **Supabase Edge Functions** for authenticated game mutations.

## Current Repository Contents

```txt
src/game/
  cards.ts       Immutable 54-card catalog and nine Literature books.
  claims.ts      Claim resolution logic.
  deal.ts        Server-side shuffle/deal helpers.
  events.ts      Realtime event payload types.
  index.ts       Public game engine exports.
  rules.ts       Ask validation and shared rule helpers.
  types.ts       Core TypeScript domain types.

supabase/
  migrations/
    000001_initial_authoritative_game_schema.sql
  functions/
    _shared/       Auth, database, HTTP, lobby, and state helpers.
    create-game/   Create a lobby and host seat.
    join-game/     Join an existing lobby by code.
    start-game/    Server-side shuffle, deal, and start.
    ask-card/      Authoritative card ask endpoint.
    submit-claim/  Authoritative claim endpoint.
    get-game-state/ Public state plus the authenticated player's hand.

tests/
  game.test.ts   Core rule, catalog, claim, and deal tests.
```

## Game Rules Implemented

Literature is a team-based card deduction game.

This implementation models the following rules:

- The game supports **6 or 8 players**.
- Players are split into two teams.
- Seats alternate teams:
  - Seat `0` -> team `0`
  - Seat `1` -> team `1`
  - Seat `2` -> team `0`
  - Seat `3` -> team `1`
  - And so on.
- The game uses a **54-card deck**.
- The deck contains the normal 52 cards plus two Jokers.
- The deck is divided into **nine books** of six cards each.
- Each standard suit has a low half-suit:
  - `2, 3, 4, 5, 6, 7`
- Each standard suit has a high half-suit:
  - `9, 10, J, Q, K, A`
- The four `8`s and two Jokers form the ninth book:
  - `8C`
  - `8D`
  - `8H`
  - `8S`
  - `JOKER_RED`
  - `JOKER_BLACK`

The nine books are:

```txt
clubs_low       2C 3C 4C 5C 6C 7C
clubs_high      9C 10C JC QC KC AC
diamonds_low    2D 3D 4D 5D 6D 7D
diamonds_high   9D 10D JD QD KD AD
hearts_low      2H 3H 4H 5H 6H 7H
hearts_high     9H 10H JH QH KH AH
spades_low      2S 3S 4S 5S 6S 7S
spades_high     9S 10S JS QS KS AS
eights_jokers   8C 8D 8H 8S JOKER_RED JOKER_BLACK
```

The special `eights_jokers` book is intentionally treated exactly like every other book. It can be asked about, transferred, claimed, cancelled, and scored.

## Turn Rules

On a player's turn, they ask one specific opposing player for one specific card.

A valid ask must satisfy all of these conditions:

- The game is active.
- The asker is the current turn player.
- The target is seated in the same game.
- The target is on the opposing team.
- The requested card exists in the 54-card Literature deck.
- The requested card belongs to a live, unresolved book.
- The asker does not already hold the requested card.
- The asker holds at least one other card in the same book.

If the target has the requested card:

- The target passes the card.
- The backend transfers ownership in `game_cards`.
- The asker keeps the turn.
- A sanitized `card.transferred` event is emitted.

If the target does not have the requested card:

- No ownership information about the actual holder is revealed.
- The target becomes the current turn player.
- A sanitized `ask.missed` event is emitted.

## Claim Rules

A player may submit a claim for any unresolved book.

A claim must name exactly who holds each of the six cards in that book.

The backend resolves claims with this order:

1. If any member of the opposing team actually holds any card in the claimed book, the opposing team receives the book.
2. Else, if the claiming team holds all six cards and every stated location is correct, the claiming team receives the book.
3. Else, the claiming team had the book but stated at least one location incorrectly, so the book is cancelled and neither team receives it.

Once a book is claimed or cancelled, all six cards leave active play.

## 8-Player Deal Policy

A 54-card deck divides evenly among 6 players:

```txt
6 players -> 9 cards each
```

A 54-card deck does not divide evenly among 8 players. This repository currently uses a deterministic round-robin policy:

```txt
8 players -> 7, 7, 7, 7, 7, 7, 6, 6 cards
```

The architecture supports changing this policy in `src/game/deal.ts` if your house rules require a different 8-player distribution.

## Authoritative Backend Model

The key security rule is:

> The browser can request an action, but it never proves or mutates card ownership.

Sensitive state lives in `public.game_cards`.

Clients must not receive the full deck state. A player can read only their own live cards. Opponent hands are never sent to the browser.

The backend is responsible for:

- Creating lobbies.
- Assigning seats and teams.
- Shuffling the deck.
- Dealing cards.
- Validating asks.
- Transferring cards.
- Validating and resolving claims.
- Updating scores.
- Completing games.
- Emitting sanitized Realtime events.

## Supabase Schema

The initial migration is:

```txt
supabase/migrations/000001_initial_authoritative_game_schema.sql
```

It creates:

- `profiles`
- `games`
- `game_players`
- `card_catalog`
- `game_cards`
- `book_results`
- `game_events`
- `action_log`

It also creates:

- `game_status` enum
- `card_location_type` enum
- `claim_result` enum
- indexes for common game lookups
- RLS policies
- read-only helper functions:
  - `get_public_game_state(game_id)`
  - `get_my_hand(game_id)`

### Important Tables

#### `games`

Stores lobby and lifecycle state.

Important columns:

- `id`
- `lobby_code`
- `host_user_id`
- `status`
- `player_count`
- `current_turn_player_id`
- `winning_team_index`
- `version`

`version` is incremented during game mutations. Realtime events include this version so clients can detect missed or stale updates.

#### `game_players`

Stores seated players.

Important columns:

- `id`
- `game_id`
- `user_id`
- `seat_index`
- `team_index`
- `is_connected`

#### `card_catalog`

Stores the immutable 54-card deck and each card's book.

This includes the ninth book:

```txt
eights_jokers
```

#### `game_cards`

Stores the authoritative card location for each card in each game.

Important columns:

- `game_id`
- `card_code`
- `book_code`
- `location_type`
- `holder_player_id`
- `claimed_team_index`

This is the most sensitive table in the system.

#### `book_results`

Stores resolved books.

Important columns:

- `game_id`
- `book_code`
- `result`
- `claiming_team_index`
- `awarded_team_index`
- `claimed_by_player_id`

#### `game_events`

Stores sanitized Realtime events.

Clients subscribe to this table for game updates.

Important columns:

- `game_id`
- `version`
- `event_type`
- `actor_player_id`
- `payload`

## RLS and Anti-Cheat

RLS is enabled on all game tables.

Direct client mutations are not granted for the authoritative tables.

Clients may read:

- Their own profile.
- Profiles for displayed player names.
- Games they are seated in.
- Players in games they are seated in.
- Immutable card catalog rows.
- Their own live cards only.
- Resolved book results.
- Sanitized game events for games they are seated in.

Clients may not directly:

- Insert games.
- Insert players.
- Start games.
- Insert or update cards.
- Transfer cards.
- Resolve claims.
- Edit events.
- Read opponent hands.

All mutations go through Edge Functions.

## Edge Functions

The Edge Functions are in:

```txt
supabase/functions/
```

They are written in TypeScript and use:

- Supabase Auth token verification.
- Direct Postgres transactions through `postgres`.
- Shared pure game logic from `src/game`.
- Sanitized event writes to `game_events`.

Required Edge Function environment variables:

```txt
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_DB_URL
```

`SUPABASE_DB_URL` should be a Postgres connection string available only to trusted Edge Functions. Do not expose it to the browser.

### `create-game`

Creates a lobby and seats the authenticated user as host.

Request:

```json
{
  "playerCount": 6,
  "displayName": "Arham"
}
```

Response:

```json
{
  "gameId": "uuid",
  "lobbyCode": "ABC123",
  "playerId": "uuid",
  "state": {}
}
```

### `join-game`

Joins a waiting lobby by code.

Request:

```json
{
  "lobbyCode": "ABC123",
  "displayName": "Player Two"
}
```

Response:

```json
{
  "gameId": "uuid",
  "playerId": "uuid",
  "seatIndex": 1,
  "teamIndex": 1,
  "state": {}
}
```

### `start-game`

Starts a full lobby.

Only the host can call this endpoint.

Request:

```json
{
  "gameId": "uuid"
}
```

Backend behavior:

- Locks the game row.
- Verifies the caller is host.
- Verifies the game is waiting.
- Verifies the game is full.
- Shuffles the 54-card deck server-side.
- Deals the cards.
- Sets the game active.
- Sets the first turn player.
- Emits `game.started`.
- Emits `turn.changed`.

### `ask-card`

Asks an opposing player for a specific card.

Request:

```json
{
  "gameId": "uuid",
  "targetPlayerId": "uuid",
  "cardCode": "JOKER_RED"
}
```

The backend validates the full ask. The client does not validate ownership.

Response:

```json
{
  "result": "hit",
  "currentTurnPlayerId": "uuid",
  "state": {},
  "myHand": {}
}
```

or:

```json
{
  "result": "miss",
  "currentTurnPlayerId": "uuid",
  "state": {},
  "myHand": {}
}
```

### `submit-claim`

Claims one complete book.

Request:

```json
{
  "gameId": "uuid",
  "bookCode": "eights_jokers",
  "assignments": [
    { "cardCode": "8C", "playerId": "uuid" },
    { "cardCode": "8D", "playerId": "uuid" },
    { "cardCode": "8H", "playerId": "uuid" },
    { "cardCode": "8S", "playerId": "uuid" },
    { "cardCode": "JOKER_RED", "playerId": "uuid" },
    { "cardCode": "JOKER_BLACK", "playerId": "uuid" }
  ]
}
```

Response:

```json
{
  "result": "correct",
  "awardedTeamIndex": 0,
  "revealedAssignments": {
    "8C": "uuid",
    "8D": "uuid",
    "8H": "uuid",
    "8S": "uuid",
    "JOKER_RED": "uuid",
    "JOKER_BLACK": "uuid"
  },
  "state": {},
  "myHand": {}
}
```

### `get-game-state`

Fetches the current public state plus the authenticated player's hand.

Request:

```txt
GET /functions/v1/get-game-state?gameId=<uuid>
```

Response:

```json
{
  "state": {},
  "myHand": {}
}
```

## Realtime Events

Clients should subscribe to sanitized inserts on:

```txt
public.game_events
```

Filtered by:

```txt
game_id = <current game id>
```

Recommended channel name:

```txt
game:<gameId>
```

Base shape:

```ts
type GameEvent<TPayload> = {
  gameId: string;
  version: number;
  eventType: string;
  actorPlayerId: string | null;
  payload: TPayload;
  createdAt: string;
};
```

Implemented event types:

```txt
player.joined
game.started
turn.changed
card.asked
card.transferred
ask.missed
claim.resolved
game.completed
```

Clients should:

- Apply events in version order.
- Ignore stale versions.
- Refetch `get-game-state` if a version gap is detected.
- Refetch their hand after a transfer or claim involving them.

## Local Development

Install dependencies:

```bash
npm install
```

Run type checks:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

Run Supabase locally after installing the Supabase CLI:

```bash
supabase start
supabase db reset
```

Deploy functions:

```bash
supabase functions deploy create-game
supabase functions deploy join-game
supabase functions deploy start-game
supabase functions deploy ask-card
supabase functions deploy submit-claim
supabase functions deploy get-game-state
```

Set function secrets:

```bash
supabase secrets set SUPABASE_URL=...
supabase secrets set SUPABASE_ANON_KEY=...
supabase secrets set SUPABASE_DB_URL=...
```

## Frontend Integration Notes

The frontend should treat backend responses and Realtime events as authoritative.

It should keep separate state buckets:

```ts
type ClientState = {
  publicGameState: PublicGameState;
  myHand: MyHandState;
};
```

The UI can show:

- Lobby code.
- Seats.
- Teams.
- Current turn.
- Card counts.
- Claimed/cancelled books.
- Public ask history.
- Public claim results.
- The authenticated player's own hand.

The UI must not assume:

- Opponent card locations.
- Whether an ask should hit.
- Whether a claim is correct.
- Whether a card transfer is valid.

## Design Principles

This codebase follows these principles:

- Server authority over every meaningful game mutation.
- A single source of truth in Postgres.
- No full-deck state sent to clients.
- Explicit card catalog and book definitions.
- Sanitized Realtime events.
- Transactional game mutations.
- Pure TypeScript rule functions with tests.
- RLS as a backstop, not the only security layer.

## Known Product Decision

The only intentionally documented house-rule decision is 8-player dealing.

Current policy:

```txt
7, 7, 7, 7, 7, 7, 6, 6
```

If the product wants a different 8-player rule, update:

```txt
src/game/deal.ts
tests/game.test.ts
```

and document the new policy here.
