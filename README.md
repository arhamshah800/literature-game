# Literature Game

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646cff?logo=vite)](https://vitejs.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%7C%20Auth%20%7C%20Realtime%20%7C%20Edge%20Functions-3ecf8e?logo=supabase)](https://supabase.com/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://vercel.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> An authoritative, real-time multiplayer implementation of the team card game Literature, built with React, TypeScript, Supabase, and Vercel.

Literature Game brings the classic deduction card game online without trusting the browser with game authority. The client renders the table, hand, lobby, and player interactions, while Supabase Edge Functions and Postgres functions validate every mutation: room membership, turn order, card requests, transfers, claims, scoring, and completion.

The project is designed for shared rooms of 4, 6, or 8 players, anonymous guest sessions, private realtime room broadcasts, and secure hidden-card handling. It solves the hardest problem in online card games: keeping the experience fast and social while making the backend the source of truth.

## Contents

- [Features](#features)
- [Screenshots & Demo](#screenshots--demo)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Usage Guide](#usage-guide)
- [API Documentation](#api-documentation)
- [Database](#database)
- [Development](#development)
- [Deployment](#deployment)
- [Security](#security)
- [Performance](#performance)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## Features

### Multiplayer Lobby

- Create rooms for exactly 4, 6, or 8 players.
- Join by 6-character lobby code.
- Join a random waiting room with open seats.
- Anonymous Supabase guest sessions for room membership without visible login.
- Local persistence for display name, current game, current player, and sound preference.
- Host-only start, team randomization, and team renaming.
- Copyable lobby code and responsive seated-player lobby view.
- Heartbeat endpoint tracks connected players and supports stale-game cleanup.

### Authoritative Game Engine

- Immutable 54-card Literature deck catalog.
- Nine 6-card books:
  - Low and high books for clubs, diamonds, hearts, and spades.
  - Special `eights_jokers` book containing all four 8s plus two Jokers.
- Server-side shuffle and round-robin deal.
- Supported deal distributions:

| Players | Distribution |
| --- | --- |
| 4 | 14, 14, 13, 13 |
| 6 | 9 cards each |
| 8 | 7, 7, 7, 7, 7, 7, 6, 6 |

- Turn validation for asks, including opponent-only targeting, live-book checks, and "must hold another card in the book" rules.
- Claim resolution that awards correct books, awards opponent-held books to the opponent, or cancels incorrectly located same-team books.
- Completed-game scoring based on awarded books.

### Realtime Table Experience

- Private Supabase Realtime broadcast channel per game: `game:{gameId}`.
- Sanitized events for joins, starts, asks, transfers, misses, turns, claims, team renames, team randomization, and completion.
- Animated card transfers, turn indicators, announcements, celebration effects, and optional audio cues.
- Responsive game table with compact mobile team rails.
- Filterable hand view grouped by book.
- Card request carousel with legal/illegal request explanations.
- Claim board that assigns each card in a book to a teammate.
- "Thank you" pending-transfer flow: received cards enter a pending state until acknowledged or penalized.

### Security & Integrity

- Hidden card ownership is stored in Postgres and never trusted from the browser.
- Direct table writes are revoked from `anon` and `authenticated`.
- Row Level Security is enabled and forced on sensitive public tables.
- Mutations go through verified Supabase Edge Functions and private SQL functions.
- Idempotent mutation support with client-generated `requestId` values for asks, claims, and transfer resolution.
- Action logging for successful and failed operations.
- Realtime replication is limited to sanitized `game_events`; hidden `game_cards` and pending transfer rows are excluded from Realtime publication.

### Developer Experience

- Strict TypeScript configuration.
- Shared game logic under `src/game`.
- Vitest coverage for deck integrity, rules, claims, deal policy, team randomization, UI layout helpers, event adaptation, and validation.
- GitHub Actions workflow for install, optional lint, typecheck, tests, build, and Vercel production deploy.

## Screenshots & Demo

No screenshot, GIF, or video assets were found in the repository.

Add visual assets in a future `docs/` or `public/` folder and reference them here:

```md
![Lobby screenshot](docs/screenshots/lobby.png)
![Game table screenshot](docs/screenshots/game-table.png)
![Claim flow screenshot](docs/screenshots/claim-flow.png)
![Demo video](docs/demo/literature-game-demo.mp4)
```

There is a local developer-only table demo route:

```bash
npm run dev
open "http://localhost:5173/?demoTable"
```

Hosted production demo URL: **Not Found in Repository**

## Architecture

The application uses a thin client and an authoritative backend. The React app owns presentation, local input state, and optimistic UI affordances; Supabase owns identity, persistence, realtime delivery, and all sensitive game mutations.

```mermaid
flowchart LR
  Player["Player Browser"] --> React["React + Vite Client"]
  React --> Auth["Supabase Auth<br/>Anonymous Session"]
  React --> Edge["Supabase Edge Functions"]
  React --> RT["Supabase Realtime<br/>Private Broadcast Channel"]

  Edge --> Verify["JWT Verification"]
  Verify --> SQL["Postgres via postgres.js"]
  SQL --> PrivateFns["game_private SQL Functions"]
  PrivateFns --> Tables["Authoritative Tables"]
  PrivateFns --> Events["game_events"]
  Events --> Broadcast["realtime.send"]
  Broadcast --> RT
  RT --> React

  Tables --> State["Public State Projection<br/>getPublicState + getMyHand"]
  State --> Edge
  Edge --> React
```

### Data Flow

1. A visitor enters a display name and creates, joins, or randomly joins a room.
2. The client creates or reuses an anonymous Supabase session.
3. The client invokes an Edge Function with the Supabase auth token.
4. The Edge Function verifies the user, validates request shape, and starts a database transaction.
5. Private SQL functions mutate authoritative state where needed.
6. Sanitized events are inserted into `game_events` and broadcast to `game:{gameId}`.
7. Each client refreshes public game state and the authenticated player's hand.
8. The UI renders table state, private hand state, animations, and legal action controls.

### Component Relationships

```mermaid
flowchart TD
  App["src/App.tsx<br/>session, lobby, game flow"] --> Lobby["LobbyView"]
  App --> Table["GameTable"]
  App --> Ask["AskModal"]
  App --> Claim["ClaimModal"]
  Table --> Hand["HandFan"]
  Table --> Cards["GameCard"]
  Table --> Teams["TeamNameEditor"]
  Ask --> Carousel["CardCarousel"]
  Carousel --> Cards
  Claim --> Cards

  App --> SupabaseClient["src/lib/supabase.ts"]
  App --> GameLogic["src/game/*"]
  Table --> GameLogic
  Hand --> GameLogic
  Ask --> GameLogic
```

### Backend Mutation Path

```mermaid
sequenceDiagram
  participant C as React Client
  participant EF as Edge Function
  participant DB as Postgres
  participant PF as game_private Function
  participant RT as Realtime

  C->>EF: invoke("ask-card", body, Bearer token)
  EF->>EF: requireUser()
  EF->>DB: begin transaction
  EF->>DB: check idempotent requestId
  EF->>PF: process_card_ask(...)
  PF->>DB: validate turn, ownership, target, live book
  PF->>DB: update game_cards / pending_card_transfers / games
  PF->>DB: insert sanitized game_events
  DB->>RT: realtime.send(...)
  EF->>DB: getPublicState + getMyHand
  EF-->>C: updated state + private hand
  RT-->>C: broadcast event
```

## Tech Stack

| Area | Implementation | Evidence |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite | `package.json`, `src/App.tsx`, `vite.config.ts` |
| Styling | Tailwind CSS, custom CSS | `tailwind.config.ts`, `src/styles.css` |
| Backend | Supabase Edge Functions on Deno | `supabase/functions/*/index.ts` |
| Database | Supabase Postgres | `supabase/migrations/*.sql` |
| Authentication | Supabase anonymous auth | `supabase.auth.signInAnonymously()` in `src/App.tsx` |
| Realtime | Supabase Realtime private broadcasts | `realtime.send(...)`, `channel("game:{gameId}")` |
| Infrastructure | Supabase migrations, Edge Functions, pg_cron cleanup | `supabase/config.toml`, migrations |
| Hosting | Vercel frontend | `.github/workflows/ci-deploy.yml`, `.vercel/repo.json` |
| APIs | Supabase Edge Function endpoints | `create-game`, `join-game`, `ask-card`, etc. |
| UI Libraries | `framer-motion`, `lucide-react`, `canvas-confetti` | `package.json` |
| Tooling | TypeScript, Vitest, npm, GitHub Actions | `tsconfig.json`, `vitest.config.ts`, workflow |
| Formatting | Not Found in Repository | No Prettier or formatter config found |
| Linting | Not Found in Repository | CI runs `npm run lint --if-present`, but no `lint` script exists |

## Project Structure

```txt
.
├── .github/workflows/ci-deploy.yml
├── LICENSE
├── README.md
├── index.html
├── package-lock.json
├── package.json
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── src
│   ├── App.tsx
│   ├── styles.css
│   ├── components
│   │   ├── CardCarousel.tsx
│   │   ├── GameCard.tsx
│   │   ├── GameTable.tsx
│   │   ├── HandFan.tsx
│   │   ├── TeamNameEditor.tsx
│   │   └── useElementSize.ts
│   ├── game
│   │   ├── cards.ts
│   │   ├── claims.ts
│   │   ├── clientEvents.ts
│   │   ├── deal.ts
│   │   ├── display.ts
│   │   ├── events.ts
│   │   ├── index.ts
│   │   ├── lobbyCode.ts
│   │   ├── playerNames.ts
│   │   ├── rules.ts
│   │   ├── teamNames.ts
│   │   ├── teams.ts
│   │   ├── types.ts
│   │   └── ui.ts
│   └── lib
│       └── supabase.ts
├── supabase
│   ├── config.toml
│   ├── functions
│   │   ├── _shared
│   │   ├── ask-card
│   │   ├── create-game
│   │   ├── get-game-state
│   │   ├── heartbeat
│   │   ├── join-game
│   │   ├── join-random-game
│   │   ├── randomize-teams
│   │   ├── resolve-pending-transfer
│   │   ├── start-game
│   │   ├── submit-claim
│   │   └── update-team-names
│   └── migrations
│       ├── 000001_initial_authoritative_game_schema.sql
│       └── 202606*.sql
└── tests
    ├── game.test.ts
    └── ui.test.ts
```

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Main React application, auth bootstrap, local persistence, lobby/game orchestration, modals, and Edge Function calls. |
| `src/components/` | Reusable visual components for cards, hands, table, carousel, and team names. |
| `src/game/` | Shared domain logic: deck catalog, rules, claims, teams, events, layout helpers, and TypeScript types. |
| `src/lib/supabase.ts` | Supabase browser client and frontend environment validation. |
| `supabase/functions/` | Authenticated Edge Functions for all game operations. |
| `supabase/functions/_shared/` | Shared auth, database, HTTP, lobby, state, and validation helpers. |
| `supabase/migrations/` | Postgres schema, RLS, private game functions, realtime setup, cleanup cron, and security hardening. |
| `tests/` | Vitest unit tests for game rules and UI helper behavior. |
| `.github/workflows/ci-deploy.yml` | CI and production Vercel deployment workflow. |
| `dist/` | Build output currently present locally but ignored by git. |
| `src/server/`, `supabase/snippets/` | Empty directories at inspection time. |

## Installation

### Prerequisites

| Requirement | Version / Notes |
| --- | --- |
| Node.js | CI uses Node.js 22. |
| npm | Lockfile is present; use `npm ci` for reproducible installs. |
| Supabase CLI | Required for local Supabase, migrations, and function deployment. |
| Supabase project | Required for hosted Auth, Postgres, Realtime, and Edge Functions. |
| Vercel account | Required for production deployment through the included workflow. |

### Environment Setup

`.env.example` is **Not Found in Repository**, so create `.env.local` manually:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
```

For local Edge Function execution, configure Supabase function secrets:

```bash
supabase secrets set SUPABASE_URL=https://your-project-ref.supabase.co
supabase secrets set SUPABASE_ANON_KEY=your-supabase-anon-key
supabase secrets set SUPABASE_DB_URL=postgresql://postgres:password@host:5432/postgres
```

### Install Dependencies

```bash
npm ci
```

### Run Locally

Start the frontend:

```bash
npm run dev
```

Start or reset Supabase locally:

```bash
supabase start
supabase db reset
```

Serve Edge Functions locally:

```bash
supabase functions serve
```

The frontend defaults to Vite's local dev URL:

```txt
http://localhost:5173
```

### Build

```bash
npm run typecheck
npm test
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Environment Variables

| Variable | Purpose | Required | Example | Used By |
| --- | --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser Supabase project URL. | Required for frontend | `https://abc123.supabase.co` | `src/lib/supabase.ts` |
| `VITE_SUPABASE_ANON_KEY` | Browser-safe Supabase anon or publishable key. | Required for frontend | `eyJhbGciOi...` | `src/lib/supabase.ts` |
| `SUPABASE_URL` | Supabase project URL for Edge Functions. | Required for Edge Functions | `https://abc123.supabase.co` | `supabase/functions/_shared/auth.ts` |
| `SUPABASE_ANON_KEY` | Fallback anon key for token verification in Edge Functions. | Required unless `SUPABASE_PUBLISHABLE_KEYS` is set | `eyJhbGciOi...` | `supabase/functions/_shared/auth.ts` |
| `SUPABASE_PUBLISHABLE_KEYS` | JSON object containing Supabase publishable keys; code reads `.default`. | Optional | `{"default":"sb_publishable_..."}` | `supabase/functions/_shared/auth.ts` |
| `SUPABASE_DB_URL` | Postgres connection string for Edge Functions. | Required for Edge Functions | `postgresql://postgres:password@db.host:5432/postgres` | `supabase/functions/_shared/db.ts` |
| `VERCEL_TOKEN` | Vercel deployment token for GitHub Actions. | Required for CI deploy | GitHub Actions secret | `.github/workflows/ci-deploy.yml` |
| `VERCEL_ORG_ID` | Vercel team/user ID for GitHub Actions. | Required for CI deploy | GitHub Actions secret | `.github/workflows/ci-deploy.yml` |
| `VERCEL_PROJECT_ID` | Vercel project ID for GitHub Actions. | Required for CI deploy | GitHub Actions secret | `.github/workflows/ci-deploy.yml` |
| `VERCEL_OIDC_TOKEN` | Present in local `.env.local`, but no code reference was found. | Not Found in Repository | Not Found in Repository | Not Found in Repository |

Do not commit `.env.local` or production secrets. The repository ignores `.env*` files except a future `.env.example`.

## Usage Guide

### User Workflow

1. Enter a display name.
2. Create a room for 4, 6, or 8 players, join by code, or join a random open room.
3. Share the room code with other players.
4. The host may rename teams or randomize teams while the room is waiting.
5. Once the lobby is full and all required seats are connected, the host starts the game.
6. Players take turns requesting a specific card from an opposing player.
7. Successful asks create a pending transfer; the receiver must say thank you or pick up without thanks.
8. Players claim a book by assigning every card in that book to teammates.
9. The backend resolves claims, updates scores, removes claimed/cancelled books from active play, and advances turns.
10. The game completes when all books are claimed or cancelled.

### Common Tasks

| Task | How It Works |
| --- | --- |
| Create a room | `create-game` creates a lobby, profile row, host seat, lobby code, and public state. |
| Join by code | `join-game` validates lobby code, inserts a seat if available, and returns state. |
| Join random room | `join-random-game` selects a waiting room with capacity. |
| Start game | `start-game` calls private SQL to shuffle, deal, set active status, and emit start events. |
| Request a card | `ask-card` validates legal ask conditions and updates card state. |
| Resolve pending transfer | `resolve-pending-transfer` completes or penalizes the "thank you" flow. |
| Submit a claim | `submit-claim` validates assignments and awards or cancels the book. |
| Rename teams | `update-team-names` updates team labels and broadcasts the change. |
| Refresh state | `get-game-state` returns public game state plus only the caller's private hand. |

### Example Scenario

1. Ava creates a 6-player room.
2. Five friends join with the lobby code.
3. Ava randomizes teams and starts the game.
4. Ava asks an opposing player for `4C` because she holds another card in `clubs_low`.
5. If the target has `4C`, the card enters a pending transfer and Ava must acknowledge it.
6. Later, Ava claims `clubs_low` by assigning all six cards to teammates.
7. The server compares claimed locations against actual ownership and updates the book result.

## API Documentation

All endpoints are Supabase Edge Functions under:

```txt
{SUPABASE_URL}/functions/v1/{function-name}
```

All endpoints require a Supabase authenticated request. The frontend obtains this via anonymous auth and sends it through `supabase.functions.invoke`.

```http
Authorization: Bearer <supabase-access-token>
Content-Type: application/json
```

All endpoints support CORS `OPTIONS`. Error responses are JSON:

```json
{
  "error": "Human-readable error message."
}
```

### Endpoint Summary

| Function | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `create-game` | `POST` | Required | Create a waiting lobby and host seat. |
| `join-game` | `POST` | Required | Join a waiting lobby by code. |
| `join-random-game` | `POST` | Required | Join any waiting lobby with capacity. |
| `get-game-state` | `GET` | Required | Fetch public state and caller's hand. |
| `heartbeat` | `POST` | Required | Mark seated player connected and update `last_seen_at`. |
| `randomize-teams` | `POST` | Required, host only | Randomize waiting-room teams. |
| `update-team-names` | `POST` | Required, host only | Rename both teams before completion. |
| `start-game` | `POST` | Required, host only | Shuffle, deal, and activate a full lobby. |
| `ask-card` | `POST` | Required, current turn | Ask an opponent for a card. |
| `resolve-pending-transfer` | `POST` | Required, transfer participant rules in SQL | Resolve pending card transfer. |
| `submit-claim` | `POST` | Required, current turn | Claim an unresolved book. |

### Request and Response Examples

#### `POST /create-game`

```json
{
  "playerCount": 6,
  "displayName": "Ava"
}
```

Returns `gameId`, `lobbyCode`, `playerId`, and the current public `state`. Abbreviated example:

```jsonc
{
  "gameId": "00000000-0000-4000-8000-000000000000",
  "lobbyCode": "ABCD23",
  "playerId": "11111111-1111-4111-8111-111111111111",
  "state": {
    "gameId": "00000000-0000-4000-8000-000000000000",
    "lobbyCode": "ABCD23",
    "status": "waiting",
    "playerCount": 6,
    "currentTurnPlayerId": null,
    "teamNames": { "0": "Team 1", "1": "Team 2" },
    "version": 1,
    "players": [
      {
        "playerId": "11111111-1111-4111-8111-111111111111",
        "displayName": "Ava",
        "seatIndex": 0,
        "teamIndex": 0,
        "isConnected": true,
        "cardCount": 0
      }
    ],
    "books": [
      {
        "bookCode": "clubs_low",
        "status": "unclaimed",
        "awardedTeamIndex": null
      }
      // Eight additional book entries omitted.
    ],
    "pendingTransfer": null
  }
}
```

#### `POST /join-game`

```json
{
  "lobbyCode": "ABCD23",
  "displayName": "Bo"
}
```

Returns `gameId`, `playerId`, `seatIndex`, `teamIndex`, and `state`.

#### `POST /join-random-game`

```json
{
  "displayName": "Cy"
}
```

Returns `gameId`, `playerId`, `seatIndex`, `teamIndex`, and `state`.

#### `GET /get-game-state?gameId=<uuid>`

Returns public state and only the caller's private hand. Abbreviated example:

```jsonc
{
  "state": {
    "gameId": "00000000-0000-4000-8000-000000000000",
    "lobbyCode": "ABCD23",
    "status": "active",
    "playerCount": 6,
    "currentTurnPlayerId": "11111111-1111-4111-8111-111111111111",
    "teamNames": { "0": "Team 1", "1": "Team 2" },
    "version": 8,
    "players": [
      {
        "playerId": "11111111-1111-4111-8111-111111111111",
        "displayName": "Ava",
        "seatIndex": 0,
        "teamIndex": 0,
        "isConnected": true,
        "cardCount": 9
      }
    ],
    "books": [
      {
        "bookCode": "clubs_low",
        "status": "unclaimed",
        "awardedTeamIndex": null
      }
      // Eight additional book entries omitted.
    ],
    "pendingTransfer": null
  },
  "myHand": {
    "gameId": "00000000-0000-4000-8000-000000000000",
    "playerId": "11111111-1111-4111-8111-111111111111",
    "cards": [
      {
        "code": "2C",
        "rank": "2",
        "suit": "clubs",
        "bookCode": "clubs_low",
        "sortIndex": 0,
        "isJoker": false
      }
    ]
  }
}
```

#### `POST /heartbeat`

```json
{
  "gameId": "00000000-0000-4000-8000-000000000000"
}
```

Returns:

```json
{
  "ok": true,
  "playerId": "11111111-1111-4111-8111-111111111111"
}
```

#### `POST /randomize-teams`

```json
{
  "gameId": "00000000-0000-4000-8000-000000000000"
}
```

Returns `assignments` and `state`.

#### `POST /update-team-names`

```json
{
  "gameId": "00000000-0000-4000-8000-000000000000",
  "teamNames": {
    "0": "North Stars",
    "1": "South Squad"
  }
}
```

Returns `state` and `myHand`.

#### `POST /start-game`

```json
{
  "gameId": "00000000-0000-4000-8000-000000000000"
}
```

Returns `state` and `myHand`.

#### `POST /ask-card`

```json
{
  "gameId": "00000000-0000-4000-8000-000000000000",
  "targetPlayerId": "22222222-2222-4222-8222-222222222222",
  "cardCode": "4C",
  "requestId": "33333333-3333-4333-8333-333333333333"
}
```

Returns the private SQL function result plus `state` and `myHand`.

#### `POST /resolve-pending-transfer`

```json
{
  "gameId": "00000000-0000-4000-8000-000000000000",
  "transferId": "44444444-4444-4444-8444-444444444444",
  "action": "thank",
  "requestId": "55555555-5555-4555-8555-555555555555"
}
```

`action` must be one of:

| Value | Meaning |
| --- | --- |
| `thank` | Completes the transfer normally. |
| `pickup_without_thanks` | Resolves the transfer with the SQL-defined penalty flow. |

Returns the private SQL function result plus `state` and `myHand`.

#### `POST /submit-claim`

```json
{
  "gameId": "00000000-0000-4000-8000-000000000000",
  "bookCode": "clubs_low",
  "assignments": [
    { "cardCode": "2C", "playerId": "11111111-1111-4111-8111-111111111111" },
    { "cardCode": "3C", "playerId": "11111111-1111-4111-8111-111111111111" },
    { "cardCode": "4C", "playerId": "66666666-6666-4666-8666-666666666666" },
    { "cardCode": "5C", "playerId": "66666666-6666-4666-8666-666666666666" },
    { "cardCode": "6C", "playerId": "66666666-6666-4666-8666-666666666666" },
    { "cardCode": "7C", "playerId": "11111111-1111-4111-8111-111111111111" }
  ],
  "requestId": "77777777-7777-4777-8777-777777777777"
}
```

Returns the private SQL function result plus `state` and `myHand`.

## Database

The schema is defined in `supabase/migrations`. The first migration creates the core schema; later migrations add private authoritative functions, security hardening, pg_cron cleanup, team names, stricter input constraints, pending-transfer state, and the thank-you flow.

### Schema Overview

| Table / View | Purpose |
| --- | --- |
| `profiles` | Supabase user profile with display name. |
| `games` | Lobby and game lifecycle state, room code, host, team names, turn, winner, and version. |
| `game_players` | Seats, room membership, team assignment, connection state, and heartbeat timestamp. |
| `card_catalog` | Immutable 54-card deck and book metadata. |
| `game_cards` | Authoritative per-game card location and holder state. |
| `pending_card_transfers` | Pending thank-you transfer state. |
| `book_results` | Claimed or cancelled book outcomes. |
| `game_events` | Sanitized event log used for realtime broadcasts. |
| `action_log` | Mutation audit log with request/response payloads and idempotent request IDs. |
| `public_game_player_card_counts` | View exposing per-player card counts without card identities. |

### Entity Relationship Diagram

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : owns
  PROFILES ||--o{ GAMES : hosts
  PROFILES ||--o{ GAME_PLAYERS : joins
  GAMES ||--o{ GAME_PLAYERS : seats
  GAMES ||--o{ GAME_CARDS : contains
  CARD_CATALOG ||--o{ GAME_CARDS : defines
  GAME_PLAYERS ||--o{ GAME_CARDS : holds
  GAMES ||--o{ BOOK_RESULTS : records
  GAME_PLAYERS ||--o{ BOOK_RESULTS : claims
  GAMES ||--o{ GAME_EVENTS : emits
  GAME_PLAYERS ||--o{ GAME_EVENTS : acts
  GAMES ||--o{ ACTION_LOG : audits
  GAME_PLAYERS ||--o{ ACTION_LOG : performs
  GAMES ||--o{ PENDING_CARD_TRANSFERS : has
  GAME_PLAYERS ||--o{ PENDING_CARD_TRANSFERS : sends
  GAME_PLAYERS ||--o{ PENDING_CARD_TRANSFERS : receives

  PROFILES {
    uuid id PK
    text display_name
    text avatar_url
    timestamptz created_at
  }

  GAMES {
    uuid id PK
    text lobby_code UK
    uuid host_user_id FK
    game_status status
    int player_count
    uuid current_turn_player_id FK
    int winning_team_index
    text team_zero_name
    text team_one_name
    bigint version
  }

  GAME_PLAYERS {
    uuid id PK
    uuid game_id FK
    uuid user_id FK
    int seat_index
    int team_index
    boolean is_connected
    timestamptz last_seen_at
  }

  CARD_CATALOG {
    text code PK
    text rank
    text suit
    text book_code
    int sort_index
    boolean is_joker
  }

  GAME_CARDS {
    uuid id PK
    uuid game_id FK
    text card_code FK
    text book_code
    card_location_type location_type
    uuid holder_player_id FK
    int claimed_team_index
  }

  PENDING_CARD_TRANSFERS {
    uuid id PK
    uuid game_id FK
    text card_code FK
    text book_code
    uuid from_player_id FK
    uuid to_player_id FK
    text status
  }
```

### Enumerations

| Enum | Values |
| --- | --- |
| `game_status` | `waiting`, `active`, `completed`, `cancelled` |
| `card_location_type` | `deck`, `player`, `pending_transfer`, `claimed`, `cancelled` |
| `claim_result` | `correct`, `cancelled_wrong_locations`, `awarded_to_opponent` |
| `literature_card_code` | 54 card codes including `JOKER_RED` and `JOKER_BLACK` |
| `literature_book_code` | The nine Literature book codes |
| `literature_action_type` | Action audit categories from private SQL functions |

### Security Model in the Database

- RLS is enabled and forced on public data tables.
- Authenticated users can read only games they are seated in.
- Players can read only their own live cards from `game_cards`.
- Direct insert/update/delete/truncate privileges are revoked for client roles.
- Private `game_private` functions perform sensitive mutations.
- Public wrapper RPC functions created by an earlier migration are later revoked from `anon` and `authenticated`; current client mutations go through Edge Functions.
- `game_events` is the only game table added to Supabase Realtime publication.
- `pending_card_transfers` is explicitly removed from Realtime publication.

## Development

### Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite development server. |
| `npm run build` | Run TypeScript check and build production assets. |
| `npm run preview` | Preview the production build. |
| `npm run typecheck` | Run `tsc --noEmit`. |
| `npm test` | Run Vitest once. |
| `npm run test:watch` | Run Vitest in watch mode. |

### Code Standards

The repository enforces strict TypeScript:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `forceConsistentCasingInFileNames`

Shared rule logic belongs in `src/game` so both UI and backend-adjacent code can use the same card, claim, deal, team, and event types.

### Testing

Existing tests cover:

- 54-card catalog integrity.
- Nine 6-card book structure.
- Special 8s + Jokers book behavior.
- Ask validation.
- Deal distribution.
- Team randomization.
- Claim resolution.
- Table layout helpers.
- Hand layout helpers.
- Legal request option generation.
- Realtime event adaptation.
- Team and display-name validation.

Run:

```bash
npm test
```

### Linting and Formatting

- Lint script: **Not Found in Repository**
- Formatter config: **Not Found in Repository**

The GitHub Actions workflow runs `npm run lint --if-present`, so adding a `lint` script later will automatically include it in CI.

## Deployment

### Frontend Hosting

The included workflow deploys the frontend to Vercel on pushes to `main` after CI passes:

```mermaid
flowchart LR
  Push["Push to main"] --> CI["test-build job"]
  CI --> Install["npm ci"]
  Install --> Typecheck["npm run typecheck"]
  Typecheck --> Test["npm test"]
  Test --> Build["npm run build"]
  Build --> Pull["vercel pull --environment=production"]
  Pull --> VBuild["vercel build --prod"]
  VBuild --> Deploy["vercel deploy --prebuilt --prod"]
```

Required GitHub Actions secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

### Supabase Deployment

Automated Supabase deployment was **Not Found in Repository**.

Deploy migrations and functions with the Supabase CLI:

```bash
supabase link --project-ref <project-ref>
supabase db push

supabase functions deploy create-game
supabase functions deploy join-game
supabase functions deploy join-random-game
supabase functions deploy get-game-state
supabase functions deploy heartbeat
supabase functions deploy randomize-teams
supabase functions deploy update-team-names
supabase functions deploy start-game
supabase functions deploy ask-card
supabase functions deploy resolve-pending-transfer
supabase functions deploy submit-claim
```

Each function has `verify_jwt = true` in `supabase/config.toml`.

### Production Considerations

- Enable anonymous sign-ins in Supabase Auth.
- Configure `SUPABASE_DB_URL` as a secret for Edge Functions.
- Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel.
- Confirm Realtime private broadcast authorization is active for `game:*` topics.
- Confirm `pg_cron` is available for cleanup migration `20260622225728_auto_cleanup_disconnected_games.sql`.
- Do not expose service role keys to the browser.

## Security

### Authentication

The app uses Supabase anonymous authentication. Users do not create visible accounts; anonymous sessions are identity tokens used to associate browser sessions with room membership.

### Authorization

Authorization is enforced at several layers:

| Layer | Enforcement |
| --- | --- |
| Client | Disables unavailable UI actions and validates obvious input. |
| Edge Functions | Require Supabase JWTs, validate request shape, check host-only operations where implemented in TypeScript. |
| Postgres RLS | Restricts reads to game members and private hand ownership. |
| Private SQL functions | Validate turns, cards, claims, transfers, scoring, and completion. |
| Grants / revokes | Prevent direct table mutation by browser roles. |

### Sensitive State Handling

- Full card ownership lives in `game_cards`.
- `getPublicState` exposes card counts, player metadata, books, turn, team names, version, and pending transfer metadata.
- `getMyHand` exposes only the caller's cards.
- Opponent card identities are not sent to the browser.
- Realtime payloads are sanitized game events rather than raw table replication.

### Idempotency

The client creates UUID `requestId` values for actions that may be retried:

- `ask-card`
- `submit-claim`
- `resolve-pending-transfer`

Edge Functions use advisory locks and `action_log` replay checks to avoid duplicating successful mutations.

## Performance

### Current Optimizations

- Vite production build for static frontend assets.
- Supabase Realtime broadcasts avoid polling for primary game updates.
- Public state is projected in SQL and fetched as compact JSON.
- Card counts are exposed through a view instead of revealing full card state.
- Indexed lookups for lobby code, game players, game cards by holder/book, events by game/version, and pending transfers.
- UI layout helpers calculate responsive table and hand arrangements.
- Local animations use `framer-motion`; celebrations use `canvas-confetti`.
- Heartbeat runs every 20 seconds and refreshes on visibility changes.

### Scaling Considerations

- Edge Functions currently open Postgres connections via `postgres` with `max: 3`.
- Realtime fan-out is per game room topic.
- Old disconnected games are cleaned with a pg_cron job every minute.
- For larger deployments, add observability around Edge Function latency, database transaction duration, Realtime delivery, and cleanup volume.

## Roadmap

No `TODO` or `FIXME` comments were found in the repository. Based on the current implementation, a realistic roadmap is:

| Priority | Item | Rationale |
| --- | --- | --- |
| P0 | Add `.env.example` | Installation currently requires manually reconstructing env variables. |
| P0 | Add automated Supabase deployment docs or CI | Frontend deploy is automated, but migrations/functions are manual. |
| P1 | Add end-to-end tests | Unit tests are strong, but lobby-to-completion browser/API flows are not covered. |
| P1 | Add screenshots and demo video | The README is ready for assets, but none exist in the repo. |
| P1 | Add linting and formatting config | CI is prepared for linting, but no lint script/config exists. |
| P2 | Add observability | Edge Function logs, database timings, and Realtime delivery health are not surfaced in repo tooling. |
| P2 | Improve reconnect/resume UX | Local persistence exists, but richer reconnect status and stale-room handling could improve reliability. |
| P2 | Add contributor-facing architecture notes | Private SQL mutation functions are substantial and would benefit from deeper maintainer docs. |
| P3 | Spectator or replay mode | `game_events` creates a natural foundation for readonly replay experiences. |

## Contributing

Contributions should preserve the central invariant of the project: the browser may request game actions, but it must never be trusted as the authority for card ownership or game mutation.

### Development Workflow

1. Fork or branch from `main`.
2. Install dependencies with `npm ci`.
3. Configure Supabase environment variables.
4. Run Supabase migrations locally.
5. Make focused changes.
6. Add or update tests for rule, state, endpoint, or UI-helper behavior.
7. Run:

```bash
npm run typecheck
npm test
npm run build
```

8. Open a pull request with:
   - What changed.
   - Why it changed.
   - How it was tested.
   - Any schema or deployment notes.

### Pull Request Checklist

- No service role keys or secrets are committed.
- Hidden card state is not exposed to public client state.
- New game mutations are implemented through Edge Functions/private SQL, not browser table writes.
- RLS and grants are reviewed for any schema changes.
- Tests cover new rules or edge cases.
- README/API docs are updated when behavior changes.

## License

This project is licensed under the [MIT License](LICENSE).

## Acknowledgements

- Literature, the traditional team card game that inspired this implementation.
- Supabase for Auth, Postgres, Realtime, Edge Functions, and the local development workflow.
- Vercel for frontend hosting and deployment tooling.
- React, Vite, TypeScript, Tailwind CSS, Framer Motion, Lucide, and Vitest for the application foundation.
