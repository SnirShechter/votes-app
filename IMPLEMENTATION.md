# Votes App — Detailed Technical Implementation Plan

> **Target:** https://votes.snir.sh
> **Stack:** Hono + React/Vite + PostgreSQL + Redis + SSE
> **Auth:** Authentik OIDC (SPA + PKCE, opaque tokens)
> **i18n:** Hebrew (RTL) + English (LTR)

---

## Table of Contents

1. [File Tree](#1-file-tree)
2. [Package Choices](#2-package-choices)
3. [Database Schema](#3-database-schema)
4. [Redis Key Design](#4-redis-key-design)
5. [Backend Architecture](#5-backend-architecture)
6. [SSE Implementation](#6-sse-implementation)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Docker Setup](#8-docker-setup)
9. [Build Order](#9-build-order)
10. [Known Gotchas](#10-known-gotchas)

---

## 1. File Tree

```
votes-app/
├── IMPLEMENTATION.md                # This file
├── docker-compose.yml               # Docker Compose: app + postgres + redis
├── Dockerfile                       # Multi-stage build (frontend + backend → single image)
├── .gitignore                       # Node, dist, env files
├── .env.example                     # Template for environment variables
│
├── backend/
│   ├── package.json                 # Backend dependencies (Hono, pg, ioredis, jose)
│   ├── tsconfig.json                # TS config: NodeNext module resolution
│   ├── src/
│   │   ├── index.ts                 # Entry point: Hono app, mount routes, serve static, start server
│   │   ├── types.ts                 # AppEnv type, shared TS interfaces
│   │   ├── db.ts                    # PostgreSQL connection pool (pg Pool)
│   │   ├── redis.ts                 # Redis client + pub/sub client (ioredis)
│   │   ├── migrate.ts               # Run SQL migrations on startup
│   │   │
│   │   ├── middleware/
│   │   │   └── auth.ts              # requireAuth middleware (JWT → userinfo fallback)
│   │   │
│   │   ├── routes/
│   │   │   ├── auth.ts              # GET /api/auth/me
│   │   │   ├── polls.ts             # CRUD: POST/GET/PUT/DELETE /api/polls
│   │   │   ├── pollControl.ts       # POST start/unlock/advance/finish
│   │   │   ├── voting.ts            # POST /api/polls/:id/vote, GET my-votes
│   │   │   ├── results.ts           # GET results, GET results/export (CSV)
│   │   │   ├── members.ts           # GET/PUT/DELETE members
│   │   │   ├── invites.ts           # POST/GET/DELETE invites, POST join
│   │   │   └── events.ts            # GET /api/polls/:id/events (SSE stream)
│   │   │
│   │   ├── services/
│   │   │   ├── pollState.ts         # Redis state management (read/write poll state)
│   │   │   ├── sse.ts               # SSE broadcaster (Redis pub/sub → response streams)
│   │   │   └── userinfo.ts          # Authentik userinfo fetcher with cache
│   │   │
│   │   └── migrations/
│   │       └── 001_initial.sql      # All CREATE TABLE statements
│   │
│   └── .env.example                 # Backend env template
│
└── frontend/
    ├── package.json                 # Frontend dependencies (React, oidc-client-ts, i18next)
    ├── tsconfig.json                # TS config for Vite/React
    ├── vite.config.ts               # Vite config with proxy to backend
    ├── index.html                   # HTML entry point
    ├── src/
    │   ├── main.tsx                 # React root: AuthProvider → I18nProvider → Router
    │   ├── App.tsx                  # Route definitions
    │   ├── api.ts                   # Fetch wrapper (attaches Bearer token, base URL)
    │   ├── types.ts                 # Shared frontend TypeScript types
    │   ├── index.css                # Tailwind imports + RTL/LTR base styles
    │   │
    │   ├── auth/
    │   │   ├── AuthProvider.tsx      # OIDC context (oidc-client-ts UserManager)
    │   │   ├── useAuth.ts           # useAuth() hook
    │   │   ├── CallbackPage.tsx     # /callback — handles OIDC redirect
    │   │   └── RequireAuth.tsx      # Route wrapper: redirect to login if unauthenticated
    │   │
    │   ├── i18n/
    │   │   ├── index.ts             # i18next init (he default, en secondary)
    │   │   ├── he.json              # Hebrew translations
    │   │   ├── en.json              # English translations
    │   │   └── LanguageToggle.tsx   # Toggle button component
    │   │
    │   ├── hooks/
    │   │   ├── useSSE.ts            # SSE hook: connect, parse events, reconnect
    │   │   ├── usePolls.ts          # React Query hooks for polls CRUD
    │   │   └── usePollState.ts      # Combines REST + SSE for live poll state
    │   │
    │   ├── components/
    │   │   ├── Layout.tsx           # App shell: header, nav, language toggle, logout
    │   │   ├── PollStatusBadge.tsx  # Colored badge: draft/active/finished
    │   │   ├── BarChart.tsx         # Horizontal bar chart for results (pure CSS/div)
    │   │   ├── LoadingSpinner.tsx   # Loading indicator
    │   │   └── ConfirmDialog.tsx    # Reusable confirmation modal
    │   │
    │   └── pages/
    │       ├── Dashboard.tsx        # / — list polls + join by code
    │       ├── CreatePoll.tsx       # /polls/new — multi-step poll creation form
    │       ├── EditPoll.tsx         # /polls/:id/edit — edit draft poll
    │       ├── ManagePoll.tsx       # /polls/:id/manage — admin control panel
    │       ├── ManageTabs/
    │       │   ├── ControlTab.tsx   # Control tab: start/unlock/advance/finish
    │       │   ├── ParticipantsTab.tsx # Members list + role management
    │       │   └── InvitesTab.tsx   # Create/list invites
    │       ├── VotePage.tsx         # /polls/:id/vote — voter experience
    │       ├── ResultsPage.tsx      # /polls/:id/results — live results display
    │       └── JoinPage.tsx         # /join/:token or /join?code=X — join flow
    │
    └── public/
        └── favicon.ico              # App favicon
```

---

## 2. Package Choices

### Backend (`backend/package.json`)

```json
{
  "name": "votes-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "pg": "^8.13.0",
    "ioredis": "^5.4.0",
    "jose": "^5.9.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^20.17.0",
    "@types/pg": "^8.11.0",
    "tsx": "^4.19.0"
  }
}
```

**Why these choices:**
- `pg` (not Drizzle) — raw SQL for full control, simpler for this project's direct SQL needs
- `ioredis` — best Redis client for Node.js, supports pub/sub natively
- `jose` — JWT verification (for the JWT-first attempt before userinfo fallback)
- `hono` + `@hono/node-server` — lightweight, fast, proven in file-share app
- `tsx` — dev runner with watch mode

### Frontend (`frontend/package.json`)

```json
{
  "name": "votes-frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.1.0",
    "oidc-client-ts": "^3.1.0",
    "i18next": "^24.2.0",
    "react-i18next": "^15.4.0",
    "react-hot-toast": "^2.5.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0"
  }
}
```

**Why these choices:**
- `oidc-client-ts` — proven OIDC SPA library, same as file-share
- `i18next` + `react-i18next` — industry standard i18n, supports RTL
- `react-router` v7 — same as file-share
- `react-hot-toast` — lightweight toast notifications
- `tailwindcss` v4 — utility-first CSS, same as file-share
- No chart library — horizontal bar charts built with pure CSS divs (simple, no dep needed)

---

## 3. Database Schema

### File: `backend/src/migrations/001_initial.sql`

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- POLLS
-- ============================================
CREATE TABLE polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  created_by VARCHAR(255) NOT NULL,           -- OIDC sub
  join_code CHAR(6) NOT NULL UNIQUE,
  allow_stats_view BOOLEAN NOT NULL DEFAULT true,
  is_anonymous BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_polls_created_by ON polls(created_by);
CREATE INDEX idx_polls_join_code ON polls(join_code);

-- ============================================
-- QUESTIONS
-- ============================================
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  type VARCHAR(10) NOT NULL DEFAULT 'single'
    CHECK (type IN ('single', 'multi')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (poll_id, order_index)
);

CREATE INDEX idx_questions_poll_id ON questions(poll_id);

-- ============================================
-- OPTIONS
-- ============================================
CREATE TABLE options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX idx_options_question_id ON options(question_id);

-- ============================================
-- POLL MEMBERS
-- ============================================
CREATE TABLE poll_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_sub VARCHAR(255) NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'voter'
    CHECK (role IN ('admin', 'voter')),
  invited_by VARCHAR(255),                     -- OIDC sub of inviter
  invited_via VARCHAR(10) NOT NULL DEFAULT 'direct'
    CHECK (invited_via IN ('link', 'code', 'email', 'direct')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_sub)
);

CREATE INDEX idx_poll_members_poll_id ON poll_members(poll_id);
CREATE INDEX idx_poll_members_user_sub ON poll_members(user_sub);

-- ============================================
-- VOTES
-- ============================================
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  user_sub VARCHAR(255) NOT NULL,
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, user_sub, option_id)
);

CREATE INDEX idx_votes_poll_id ON votes(poll_id);
CREATE INDEX idx_votes_question_id ON votes(question_id);
CREATE INDEX idx_votes_user_sub ON votes(user_sub);

-- ============================================
-- POLL INVITES
-- ============================================
CREATE TABLE poll_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL
    CHECK (type IN ('email', 'link', 'code')),
  email VARCHAR(255),                           -- NULL for link/code invites
  token VARCHAR(64) NOT NULL UNIQUE,
  role VARCHAR(10) NOT NULL DEFAULT 'voter'
    CHECK (role IN ('admin', 'voter')),
  max_uses INTEGER,                             -- NULL = unlimited
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,                       -- NULL = no expiry
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_poll_invites_poll_id ON poll_invites(poll_id);
CREATE INDEX idx_poll_invites_token ON poll_invites(token);
CREATE INDEX idx_poll_invites_email ON poll_invites(email) WHERE email IS NOT NULL;

-- ============================================
-- RESULT SNAPSHOTS (written when poll finishes)
-- ============================================
CREATE TABLE result_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  vote_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_result_snapshots_poll_id ON result_snapshots(poll_id);
```

---

## 4. Redis Key Design

### Key Patterns

| Key | Type | Description | TTL |
|-----|------|-------------|-----|
| `poll:{pollId}:state` | Hash | Current poll runtime state | None (deleted on cleanup) |
| `poll:{pollId}:counts:{questionId}` | Hash | Vote counts per option for a question | None (deleted on cleanup) |
| `poll:{pollId}:events` | Pub/Sub Channel | SSE broadcast channel | N/A (pub/sub) |
| `poll:{pollId}:connections` | Set | SSE connection IDs (for online count) | None (deleted on cleanup) |

### Hash Field Details

**`poll:{pollId}:state`**
```
HSET poll:{pollId}:state
  status          "active" | "finished"
  current_question "0"                    # 0-based index
  question_mode   "preview" | "open"
  started_at      "2025-01-15T10:00:00Z"
  finished_at     ""                      # empty until finished
  advanced_at     "2025-01-15T10:00:00Z"  # when current question was set
```

**`poll:{pollId}:counts:{questionId}`**
```
HSET poll:{pollId}:counts:{questionId}
  {optionId_1}  "5"    # string representation of count
  {optionId_2}  "12"
  {optionId_3}  "3"
```

**`poll:{pollId}:connections`**
```
SADD poll:{pollId}:connections "{connectionId}"
# Used to track active SSE connections for live member count
# Members added on SSE connect, removed on disconnect
```

### Pub/Sub Event Format

All events published to `poll:{pollId}:events` are JSON strings:

```typescript
// Published message format
interface SSEMessage {
  event: string;   // event type name
  data: unknown;   // event-specific payload
}
```

Event types and their payloads:

```typescript
// poll_started
{ event: "poll_started", data: { questionIndex: 0, questionId: string } }

// question_changed (advanced to next question in preview)
{ event: "question_changed", data: { questionIndex: number, questionId: string } }

// question_unlocked (question opened for voting)
{ event: "question_unlocked", data: { questionIndex: number, questionId: string } }

// vote_update (count changed)
{ event: "vote_update", data: { questionId: string, counts: Record<string, number> } }

// member_joined
{ event: "member_joined", data: { memberCount: number } }

// member_count (periodic or on SSE connect/disconnect)
{ event: "member_count", data: { online: number, total: number } }

// poll_finished
{ event: "poll_finished", data: {} }
```

---

## 5. Backend Architecture

### 5.0 Shared Types (`backend/src/types.ts`)

```typescript
import type { Env } from 'hono';

export interface AppEnv extends Env {
  Variables: {
    userId: string;     // OIDC sub, set by requireAuth
    userEmail?: string; // set by requireAuth from userinfo
    userName?: string;  // set by requireAuth from userinfo
  };
}

// ---------- Request/Response Types ----------

// Auth
export interface MeResponse {
  sub: string;
  email: string;
  name: string;
}

// Polls
export interface CreatePollRequest {
  title: string;
  description?: string;
  allowStatsView: boolean;
  isAnonymous: boolean;
  questions: {
    text: string;
    type: 'single' | 'multi';
    options: { text: string }[];
  }[];
}

export interface PollResponse {
  id: string;
  title: string;
  description: string | null;
  createdBy: string;
  joinCode: string;
  allowStatsView: boolean;
  isAnonymous: boolean;
  status: 'draft' | 'active' | 'finished';
  createdAt: string;
  updatedAt: string;
  myRole: 'admin' | 'voter' | null;
  memberCount: number;
  questions?: QuestionResponse[];
}

export interface QuestionResponse {
  id: string;
  orderIndex: number;
  text: string;
  type: 'single' | 'multi';
  options: OptionResponse[];
}

export interface OptionResponse {
  id: string;
  orderIndex: number;
  text: string;
}

export interface PollListResponse {
  polls: PollResponse[];
}

// Voting
export interface VoteRequest {
  questionId: string;
  optionIds: string[];
}

export interface MyVotesResponse {
  votes: {
    questionId: string;
    optionIds: string[];
  }[];
}

// Results
export interface QuestionResult {
  questionId: string;
  questionText: string;
  questionType: 'single' | 'multi';
  orderIndex: number;
  totalVoters: number;
  options: {
    optionId: string;
    text: string;
    count: number;
    percentage: number;
    voters?: string[];  // only if !isAnonymous and admin
  }[];
}

export interface ResultsResponse {
  pollId: string;
  title: string;
  status: 'active' | 'finished';
  isAnonymous: boolean;
  allowStatsView: boolean;
  currentQuestionIndex: number | null;
  questionMode: 'preview' | 'open' | null;
  questions: QuestionResult[];
}

// Members
export interface MemberResponse {
  userSub: string;
  email: string;
  name: string;
  role: 'admin' | 'voter';
  joinedAt: string;
}

// Invites
export interface CreateInviteRequest {
  type: 'email' | 'link';
  email?: string;       // required if type=email
  role: 'admin' | 'voter';
  maxUses?: number;      // null = unlimited
  expiresIn?: 'hour' | 'day' | 'week' | null;  // null = no expiry
}

export interface InviteResponse {
  id: string;
  type: 'email' | 'link' | 'code';
  email: string | null;
  token: string;
  role: 'admin' | 'voter';
  maxUses: number | null;
  useCount: number;
  expiresAt: string | null;
  createdAt: string;
  url: string;            // full join URL
}

// SSE state (sent on initial connect)
export interface PollStateResponse {
  status: 'draft' | 'active' | 'finished';
  currentQuestionIndex: number | null;
  questionMode: 'preview' | 'open' | null;
  onlineCount: number;
  totalMembers: number;
}

// Join
export interface JoinByCodeRequest {
  code: string;
}
```

### 5.1 Entry Point (`backend/src/index.ts`)

```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { runMigrations } from './migrate.js';

// Mount all route modules on /api
const api = new Hono();
api.route('/auth', authRoutes);
api.route('/polls', pollRoutes);        // CRUD
api.route('/polls', pollControlRoutes); // :id/start etc
api.route('/polls', votingRoutes);      // :id/vote
api.route('/polls', resultsRoutes);     // :id/results
api.route('/polls', membersRoutes);     // :id/members
api.route('/polls', invitesRoutes);     // :id/invites
api.route('/join', joinRoutes);         // /join/:token, /join/code
api.route('/polls', eventsRoutes);      // :id/events (SSE)

const app = new Hono();
app.use('/api/*', cors({
  origin: ['http://localhost:5173'],
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
}));
app.route('/api', api);

// Production: serve frontend static files
if (process.env.NODE_ENV === 'production') {
  app.use('*', serveStatic({ root: './public' }));
  app.get('*', serveStatic({ root: './public', path: 'index.html' }));
}

// Startup
const PORT = parseInt(process.env.PORT || '3000');
await runMigrations();
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Server running on port ${info.port}`);
});
```

### 5.2 Database (`backend/src/db.ts`)

```typescript
import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});

// Helper for single queries
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

// Helper that returns first row or null
export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
```

### 5.3 Redis (`backend/src/redis.ts`)

```typescript
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

// Regular client for commands
export const redis = new Redis(REDIS_URL);

// Separate client for pub/sub subscriber (required by ioredis)
export const redisSub = new Redis(REDIS_URL);

// Publish helper
export async function publishEvent(pollId: string, event: string, data: unknown): Promise<void> {
  const message = JSON.stringify({ event, data });
  await redis.publish(`poll:${pollId}:events`, message);
}
```

### 5.4 Migration Runner (`backend/src/migrate.ts`)

```typescript
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationFile = '001_initial.sql';
  const applied = await pool.query(
    'SELECT name FROM migrations WHERE name = $1',
    [migrationFile]
  );

  if (applied.rows.length === 0) {
    const sql = readFileSync(
      join(__dirname, 'migrations', migrationFile),
      'utf-8'
    );
    await pool.query(sql);
    await pool.query('INSERT INTO migrations (name) VALUES ($1)', [migrationFile]);
    console.log(`Applied migration: ${migrationFile}`);
  }
}
```

### 5.5 Auth Middleware (`backend/src/middleware/auth.ts`)

```typescript
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Context, Next } from 'hono';
import type { AppEnv } from '../types.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks) {
    const jwksUri = process.env.OIDC_JWKS_URI ||
      `${process.env.OIDC_ISSUER}jwks/`;
    jwks = createRemoteJWKSet(new URL(jwksUri));
  }
  return jwks;
}

async function verifyJwt(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, getJWKS(), {
    issuer: process.env.OIDC_ISSUER,
  });
  return payload;
}

// --- Userinfo fallback for opaque tokens ---

interface UserinfoCache {
  sub: string;
  email: string;
  name: string;
  expiresAt: number;
}

const userinfoCache = new Map<string, UserinfoCache>();
const USERINFO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchUserinfo(token: string): Promise<UserinfoCache> {
  const cached = userinfoCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const userinfoUrl = `${process.env.OIDC_ISSUER}userinfo/`;
  const response = await fetch(userinfoUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Userinfo request failed: ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (!data.sub || typeof data.sub !== 'string') {
    throw new Error('No sub claim in userinfo response');
  }

  const entry: UserinfoCache = {
    sub: data.sub,
    email: (data.email as string) || '',
    name: (data.name as string) || (data.preferred_username as string) || '',
    expiresAt: Date.now() + USERINFO_CACHE_TTL,
  };

  userinfoCache.set(token, entry);
  return entry;
}

/**
 * Resolve user from Bearer token.
 * Try JWT first → catch → fetch userinfo (opaque token).
 */
async function resolveUser(token: string): Promise<UserinfoCache> {
  try {
    const payload = await verifyJwt(token);
    return {
      sub: payload.sub as string,
      email: (payload as any).email || '',
      name: (payload as any).name || (payload as any).preferred_username || '',
      expiresAt: Date.now() + USERINFO_CACHE_TTL,
    };
  } catch {
    // JWT failed — token is opaque, use userinfo endpoint
  }

  return await fetchUserinfo(token);
}

/**
 * Required auth middleware.
 * Sets userId, userEmail, userName on context.
 * Returns 401 if no valid token.
 */
export async function requireAuth(c: any, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const user = await resolveUser(token);
    c.set('userId', user.sub);
    c.set('userEmail', user.email);
    c.set('userName', user.name);
  } catch (err: any) {
    console.error('requireAuth failed:', err.message);
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  await next();
}
```

> **CRITICAL:** Use `(c: any)` for route handler parameters. Hono's TypeScript generics cause issues with strict typing in route handlers. This matches the known gotcha.

### 5.6 Userinfo Service (`backend/src/services/userinfo.ts`)

For looking up users by email in Authentik (used in email invites):

```typescript
/**
 * Look up an Authentik user by email.
 * Uses the userinfo cache or the Authentik admin API if available.
 * For MVP: this checks poll_members table for any user with that email
 * who previously logged in. Cannot directly query Authentik users API
 * without admin token, so email invites are "pending" until the user logs in.
 */
export function isEmailLookupSupported(): boolean {
  // Without Authentik admin API token, we can't look up users by email
  // Email invites will be stored as pending and resolved on login
  return false;
}
```

### 5.7 Route: Auth (`backend/src/routes/auth.ts`)

#### `GET /api/auth/me`
- **Auth:** requireAuth
- **Response:** `MeResponse`
- **Logic:**
  1. Return `{ sub: c.get('userId'), email: c.get('userEmail'), name: c.get('userName') }`
  2. Also check for pending email invites: `SELECT * FROM poll_invites WHERE email = $1 AND type = 'email' AND use_count = 0`
  3. For each pending invite, auto-join the user to the poll (insert into `poll_members`, increment `use_count`)
  4. Return user info

```typescript
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne } from '../db.js';
import { publishEvent } from '../redis.js';
import type { AppEnv } from '../types.js';

const authRoutes = new Hono<AppEnv>();

authRoutes.get('/me', requireAuth, async (c: any) => {
  const sub = c.get('userId');
  const email = c.get('userEmail');
  const name = c.get('userName');

  // Auto-join any pending email invites for this user's email
  if (email) {
    const pendingInvites = await query(
      `SELECT pi.* FROM poll_invites pi
       WHERE pi.email = $1 AND pi.type = 'email'
       AND (pi.use_count < pi.max_uses OR pi.max_uses IS NULL)
       AND (pi.expires_at IS NULL OR pi.expires_at > now())`,
      [email]
    );

    for (const invite of pendingInvites) {
      // Try to insert member (ignore if already exists)
      const inserted = await queryOne(
        `INSERT INTO poll_members (poll_id, user_sub, role, invited_by, invited_via)
         VALUES ($1, $2, $3, NULL, 'email')
         ON CONFLICT (poll_id, user_sub) DO NOTHING
         RETURNING id`,
        [invite.poll_id, sub, invite.role]
      );
      if (inserted) {
        await query(
          'UPDATE poll_invites SET use_count = use_count + 1 WHERE id = $1',
          [invite.id]
        );
        // Notify via SSE
        const memberCount = await query(
          'SELECT COUNT(*) as count FROM poll_members WHERE poll_id = $1',
          [invite.poll_id]
        );
        await publishEvent(invite.poll_id, 'member_joined', {
          memberCount: parseInt(memberCount[0].count),
        });
      }
    }
  }

  return c.json({ sub, email, name });
});

export default authRoutes;
```

### 5.8 Route: Polls CRUD (`backend/src/routes/polls.ts`)

#### `POST /api/polls` — Create poll
- **Auth:** requireAuth
- **Request:** `CreatePollRequest`
- **Response:** `PollResponse` (201)
- **Logic:**
  1. Validate: title required, at least 1 question, each question has 2-5 options
  2. Generate random 6-char `join_code` (uppercase alphanumeric, retry on collision)
  3. `BEGIN` transaction
  4. `INSERT INTO polls` → get poll `id`
  5. For each question: `INSERT INTO questions` → get question `id`
  6. For each option: `INSERT INTO options`
  7. `INSERT INTO poll_members` (creator as admin, `invited_via='direct'`)
  8. `COMMIT`
  9. Return full poll object
- **Errors:** 400 (validation), 500 (DB)

```typescript
// Join code generator
function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1 to avoid confusion
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
```

#### `GET /api/polls` — List my polls
- **Auth:** requireAuth
- **Response:** `PollListResponse`
- **Logic:**
  1. Query polls where user is a member:
     ```sql
     SELECT p.*, pm.role as my_role,
       (SELECT COUNT(*) FROM poll_members WHERE poll_id = p.id) as member_count
     FROM polls p
     INNER JOIN poll_members pm ON pm.poll_id = p.id AND pm.user_sub = $1
     ORDER BY p.updated_at DESC
     ```
  2. Map rows to `PollResponse[]`

#### `GET /api/polls/:id` — Get poll details
- **Auth:** requireAuth
- **Response:** `PollResponse` (with questions/options)
- **Logic:**
  1. Fetch poll by ID
  2. Check user is a member: `SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2`
  3. If not a member → 403
  4. Fetch questions: `SELECT * FROM questions WHERE poll_id = $1 ORDER BY order_index`
  5. Fetch options: `SELECT * FROM options WHERE question_id = ANY($1) ORDER BY order_index`
  6. Assemble and return
- **Errors:** 403 (not member), 404 (not found)

#### `PUT /api/polls/:id` — Update poll (draft only)
- **Auth:** requireAuth
- **Response:** `PollResponse`
- **Logic:**
  1. Check user is admin of this poll
  2. Check poll status is `'draft'` — if not, return 400 "Can only edit draft polls"
  3. `BEGIN` transaction
  4. `UPDATE polls SET title=$1, description=$2, allow_stats_view=$3, is_anonymous=$4, updated_at=now()`
  5. Delete old questions and options: `DELETE FROM questions WHERE poll_id = $1` (cascades to options)
  6. Re-insert questions and options from request body
  7. `COMMIT`
  8. Return updated poll
- **Errors:** 400 (not draft), 403 (not admin), 404

#### `DELETE /api/polls/:id` — Delete poll
- **Auth:** requireAuth
- **Response:** 204
- **Logic:**
  1. Check user is admin of this poll
  2. `DELETE FROM polls WHERE id = $1` (cascades everything)
  3. Clean up Redis keys: `DEL poll:{id}:state`, `DEL poll:{id}:connections`, and all count keys
- **Errors:** 403 (not admin), 404

### 5.9 Route: Poll Control (`backend/src/routes/pollControl.ts`)

#### `POST /api/polls/:id/start` — Start poll
- **Auth:** requireAuth (admin)
- **Logic:**
  1. Verify user is admin
  2. Verify status is `'draft'`
  3. Get first question: `SELECT id FROM questions WHERE poll_id = $1 ORDER BY order_index LIMIT 1`
  4. `UPDATE polls SET status = 'active', updated_at = now() WHERE id = $1`
  5. Create Redis state:
     ```
     HSET poll:{id}:state
       status active
       current_question 0
       question_mode preview
       started_at {ISO now}
       finished_at ""
       advanced_at {ISO now}
     ```
  6. Initialize count hashes for all questions (set all option counts to 0):
     ```
     For each question:
       For each option:
         HSET poll:{id}:counts:{questionId} {optionId} 0
     ```
  7. Publish SSE: `poll_started { questionIndex: 0, questionId }`
  8. Return 200 `{ status: 'active', currentQuestion: 0 }`
- **Errors:** 400 (wrong status), 403 (not admin)

#### `POST /api/polls/:id/unlock` — Unlock current question for voting
- **Auth:** requireAuth (admin)
- **Logic:**
  1. Verify admin
  2. Get Redis state, verify `status=active` and `question_mode=preview`
  3. `HSET poll:{id}:state question_mode open`
  4. Get current question ID from DB using `current_question` index
  5. Publish SSE: `question_unlocked { questionIndex, questionId }`
  6. Return 200
- **Errors:** 400 (wrong mode)

#### `POST /api/polls/:id/advance` — Advance to next question
- **Auth:** requireAuth (admin)
- **Logic:**
  1. Verify admin
  2. Get Redis state, verify `status=active`
  3. Get total question count from DB
  4. If `current_question + 1 >= totalQuestions` → return 400 "No more questions, use /finish"
  5. `HSET poll:{id}:state current_question {next_index} question_mode preview advanced_at {ISO now}`
  6. Get next question ID from DB
  7. Publish SSE: `question_changed { questionIndex: nextIndex, questionId }`
  8. Return 200
- **Errors:** 400 (no more questions, wrong status)

#### `POST /api/polls/:id/finish` — Finish poll
- **Auth:** requireAuth (admin)
- **Logic:**
  1. Verify admin
  2. Get Redis state, verify `status=active`
  3. `UPDATE polls SET status = 'finished', updated_at = now() WHERE id = $1`
  4. `HSET poll:{id}:state status finished finished_at {ISO now}`
  5. **Snapshot counts to PG:**
     - For each question, read `HGETALL poll:{id}:counts:{questionId}`
     - `INSERT INTO result_snapshots (poll_id, question_id, option_id, vote_count)` for each
  6. Publish SSE: `poll_finished {}`
  7. Clean up Redis keys (optional — can leave for later reads, or delete after snapshot)
  8. Return 200
- **Errors:** 400 (wrong status)

### 5.10 Route: Voting (`backend/src/routes/voting.ts`)

#### `POST /api/polls/:id/vote` — Submit vote
- **Auth:** requireAuth (member)
- **Request:** `VoteRequest { questionId, optionIds }`
- **Response:** 200 `{ success: true }`
- **Logic:**
  1. Verify user is a member of this poll
  2. Get Redis state: verify poll is `active` and `question_mode=open`
  3. Get current question index from Redis, verify the questionId matches the current question
  4. Get question from DB: verify it belongs to this poll, get `type`
  5. Validate optionIds:
     - All must belong to this question
     - If `type=single`, exactly 1 optionId
     - If `type=multi`, 1 to N optionIds
  6. **For `single` type:**
     - `BEGIN` transaction
     - Delete existing votes: `DELETE FROM votes WHERE question_id = $1 AND user_sub = $2 RETURNING option_id`
     - For each deleted option: `HINCRBY poll:{id}:counts:{questionId} {deletedOptionId} -1`
     - Insert new vote: `INSERT INTO votes (poll_id, question_id, option_id, user_sub) VALUES (...)`
     - `HINCRBY poll:{id}:counts:{questionId} {optionId} 1`
     - `COMMIT`
  7. **For `multi` type:**
     - `BEGIN` transaction
     - Delete existing votes: `DELETE FROM votes WHERE question_id = $1 AND user_sub = $2 RETURNING option_id`
     - Decrement Redis counts for deleted
     - Insert new votes: `INSERT INTO votes ... ON CONFLICT DO NOTHING`
     - Increment Redis counts for new
     - `COMMIT`
  8. Read updated counts from Redis: `HGETALL poll:{id}:counts:{questionId}`
  9. Publish SSE: `vote_update { questionId, counts }`
  10. Return 200
- **Errors:** 400 (validation, wrong question), 403 (not member), 409 (already closed)
- **Rate limit:** Max 10 votes/sec per user (implement with simple in-memory counter)

#### `GET /api/polls/:id/my-votes` — Get my votes
- **Auth:** requireAuth (member)
- **Response:** `MyVotesResponse`
- **Logic:**
  1. Verify membership
  2. Query:
     ```sql
     SELECT question_id, array_agg(option_id) as option_ids
     FROM votes
     WHERE poll_id = $1 AND user_sub = $2
     GROUP BY question_id
     ```
  3. Return grouped by question

### 5.11 Route: Results (`backend/src/routes/results.ts`)

#### `GET /api/polls/:id/results` — Get results
- **Auth:** requireAuth (member)
- **Response:** `ResultsResponse`
- **Logic:**
  1. Verify membership, get role
  2. Get poll: check `allow_stats_view` — if false and role is `voter`, return 403
  3. Get all questions + options from DB
  4. **If poll is `active`:** read live counts from Redis `HGETALL poll:{id}:counts:{questionId}`
  5. **If poll is `finished`:** read from `result_snapshots` table
  6. Get Redis state for `currentQuestionIndex` and `questionMode`
  7. For each question, calculate percentages
  8. If `is_anonymous=false` and requester is admin:
     - Include voter names per option (join votes with userinfo cache)
  9. Return `ResultsResponse`

#### `GET /api/polls/:id/results/export` — Export CSV
- **Auth:** requireAuth (admin)
- **Response:** CSV file download
- **Logic:**
  1. Verify admin
  2. Get all questions, options, and vote counts
  3. If `is_anonymous=false`: include voter details
  4. Build CSV:
     ```
     Question,Option,Votes,Percentage[,Voters]
     "Question 1","Option A",5,50%[,"user1, user2"]
     ```
  5. Set headers: `Content-Type: text/csv`, `Content-Disposition: attachment; filename="poll-results.csv"`

### 5.12 Route: Members (`backend/src/routes/members.ts`)

#### `GET /api/polls/:id/members` — List members
- **Auth:** requireAuth (admin)
- **Response:** `MemberResponse[]`
- **Logic:**
  1. Verify admin
  2. Query: `SELECT * FROM poll_members WHERE poll_id = $1 ORDER BY joined_at`
  3. For each member, look up name/email from userinfo cache (or return sub as fallback)

#### `PUT /api/polls/:id/members/:sub/role` — Change member role
- **Auth:** requireAuth (admin)
- **Request:** `{ role: 'admin' | 'voter' }`
- **Logic:**
  1. Verify requester is admin
  2. Cannot change own role
  3. Cannot change the creator's role (the `created_by` from polls table)
  4. `UPDATE poll_members SET role = $1 WHERE poll_id = $2 AND user_sub = $3`
  5. Return 200
- **Errors:** 400 (cannot change creator), 403, 404

#### `DELETE /api/polls/:id/members/:sub` — Remove member
- **Auth:** requireAuth (admin)
- **Logic:**
  1. Verify admin
  2. Cannot remove the creator
  3. Cannot remove yourself
  4. `DELETE FROM poll_members WHERE poll_id = $1 AND user_sub = $2`
  5. Return 204
- **Errors:** 400 (cannot remove creator), 403, 404

### 5.13 Route: Invites (`backend/src/routes/invites.ts`)

#### `POST /api/polls/:id/invites` — Create invite
- **Auth:** requireAuth (admin)
- **Request:** `CreateInviteRequest`
- **Response:** `InviteResponse` (201)
- **Logic:**
  1. Verify admin
  2. Generate random token: 32 bytes hex (64 chars)
  3. Calculate `expires_at` from `expiresIn`:
     - `'hour'` → now + 1 hour
     - `'day'` → now + 24 hours
     - `'week'` → now + 7 days
     - `null` → null
  4. If `type='email'`:
     - Store invite with email, `max_uses=1`
     - Check if a user with that email already has a session (we can't query Authentik directly)
     - The invite stays pending; user auto-joins on next `/api/auth/me` call
  5. If `type='link'`:
     - Store invite with `max_uses` from request (null = unlimited)
  6. `INSERT INTO poll_invites` and return with full join URL: `${APP_URL}/join/${token}`
- **Rate limit:** Max 20 invites per poll per hour

#### `GET /api/polls/:id/invites` — List invites
- **Auth:** requireAuth (admin)
- **Response:** `InviteResponse[]`
- **Logic:** `SELECT * FROM poll_invites WHERE poll_id = $1 ORDER BY created_at DESC`

#### `DELETE /api/polls/:id/invites/:inviteId` — Delete invite
- **Auth:** requireAuth (admin)
- **Logic:** `DELETE FROM poll_invites WHERE id = $1 AND poll_id = $2`
- **Errors:** 404

#### `POST /api/join/:token` — Join via invite token
- **Auth:** requireAuth
- **Response:** `{ pollId: string, role: string }`
- **Logic:**
  1. Find invite: `SELECT * FROM poll_invites WHERE token = $1`
  2. Validate:
     - Exists → 404 if not
     - Not expired: `expires_at IS NULL OR expires_at > now()`
     - Not maxed out: `max_uses IS NULL OR use_count < max_uses`
  3. Check if already a member → if so, return `{ pollId, role: existingRole }`
  4. Insert member: `INSERT INTO poll_members (...) VALUES (...) ON CONFLICT DO NOTHING`
  5. Increment: `UPDATE poll_invites SET use_count = use_count + 1 WHERE id = $1`
  6. Publish SSE: `member_joined`
  7. Return `{ pollId: invite.poll_id, role: invite.role }`
- **Errors:** 400 (expired/maxed), 404 (not found)

#### `POST /api/join/code` — Join via 6-char code
- **Auth:** requireAuth
- **Request:** `JoinByCodeRequest { code: string }`
- **Response:** `{ pollId: string }`
- **Logic:**
  1. Normalize code: `code.toUpperCase().trim()`
  2. Find poll: `SELECT * FROM polls WHERE join_code = $1`
  3. If not found → 404
  4. Check if already a member → return pollId
  5. Insert member with `role='voter'`, `invited_via='code'`
  6. Publish SSE: `member_joined`
  7. Return `{ pollId }`
- **Errors:** 404

### 5.14 Route: SSE Events (`backend/src/routes/events.ts`)

See section 6 for detailed SSE implementation.

---

## 6. SSE Implementation

### Architecture

```
Client (EventSource) ←── SSE HTTP response (long-lived)
                              ↑
                         Hono route handler
                              ↑
                     Redis Pub/Sub subscriber
                              ↑
                     Redis PUBLISH (from any route handler)
```

### Backend SSE Handler (`backend/src/routes/events.ts`)

```typescript
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne } from '../db.js';
import { redis, redisSub } from '../redis.js';
import { randomUUID } from 'crypto';
import type { AppEnv } from '../types.js';

const eventsRoutes = new Hono<AppEnv>();

eventsRoutes.get('/:id/events', requireAuth, async (c: any) => {
  const pollId = c.req.param('id');
  const userId = c.get('userId');

  // Verify membership
  const member = await queryOne(
    'SELECT role FROM poll_members WHERE poll_id = $1 AND user_sub = $2',
    [pollId, userId]
  );
  if (!member) {
    return c.json({ error: 'Not a member of this poll' }, 403);
  }

  // Generate connection ID for tracking
  const connectionId = randomUUID();
  const channel = `poll:${pollId}:events`;

  // Track this connection
  await redis.sadd(`poll:${pollId}:connections`, connectionId);

  // Broadcast updated online count
  const onlineCount = await redis.scard(`poll:${pollId}:connections`);
  const totalMembers = await query(
    'SELECT COUNT(*) as count FROM poll_members WHERE poll_id = $1',
    [pollId]
  );
  await redis.publish(channel, JSON.stringify({
    event: 'member_count',
    data: { online: onlineCount, total: parseInt(totalMembers[0].count) },
  }));

  // Create a ReadableStream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial state
      (async () => {
        const state = await redis.hgetall(`poll:${pollId}:state`);
        const poll = await queryOne('SELECT status FROM polls WHERE id = $1', [pollId]);

        const initData = {
          status: state?.status || poll?.status || 'draft',
          currentQuestionIndex: state?.current_question != null
            ? parseInt(state.current_question) : null,
          questionMode: state?.question_mode || null,
          onlineCount,
          totalMembers: parseInt(totalMembers[0].count),
        };

        controller.enqueue(
          encoder.encode(`event: init\ndata: ${JSON.stringify(initData)}\n\n`)
        );
      })();

      // Subscribe to Redis channel
      const messageHandler = (ch: string, message: string) => {
        if (ch !== channel) return;
        try {
          const parsed = JSON.parse(message);
          const ssePayload = `event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`;
          controller.enqueue(encoder.encode(ssePayload));
        } catch (e) {
          console.error('SSE message parse error:', e);
        }
      };

      // Use a dedicated subscriber per connection
      // NOTE: ioredis supports multiple subscriptions on the same client
      redisSub.subscribe(channel);
      redisSub.on('message', messageHandler);

      // Heartbeat every 30 seconds
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup on close
      c.req.raw.signal.addEventListener('abort', async () => {
        clearInterval(heartbeat);
        redisSub.off('message', messageHandler);
        // Don't unsubscribe from channel — other connections may use it
        // Just remove this connection from tracking
        await redis.srem(`poll:${pollId}:connections`, connectionId);

        // Broadcast updated online count
        const newOnlineCount = await redis.scard(`poll:${pollId}:connections`);
        const totalMembersNow = await query(
          'SELECT COUNT(*) as count FROM poll_members WHERE poll_id = $1',
          [pollId]
        );
        await redis.publish(channel, JSON.stringify({
          event: 'member_count',
          data: {
            online: newOnlineCount,
            total: parseInt(totalMembersNow[0].count),
          },
        }));

        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',  // Disable nginx/traefik buffering
    },
  });
});

export default eventsRoutes;
```

### SSE Subscriber Scaling Note

The above implementation uses a single `redisSub` client shared across all SSE connections. ioredis supports multiple channel subscriptions on one client. The `message` event fires for all subscriptions, so each handler checks its channel.

**Important:** For many concurrent polls, a better approach is one subscriber per poll (lazy-created, ref-counted). But for MVP, the shared subscriber works fine for moderate scale.

### Improved approach (use if >50 concurrent polls expected):

```typescript
// services/sse.ts — Per-poll subscriber manager
const pollSubscribers = new Map<string, {
  refCount: number;
  handlers: Set<(message: string) => void>;
  subscriber: Redis;
}>();

export function subscribeToPoll(
  pollId: string,
  handler: (message: string) => void
): () => void {
  const channel = `poll:${pollId}:events`;
  let entry = pollSubscribers.get(pollId);

  if (!entry) {
    const subscriber = new Redis(process.env.REDIS_URL!);
    entry = { refCount: 0, handlers: new Set(), subscriber };
    subscriber.subscribe(channel);
    subscriber.on('message', (_ch: string, msg: string) => {
      for (const h of entry!.handlers) h(msg);
    });
    pollSubscribers.set(pollId, entry);
  }

  entry.refCount++;
  entry.handlers.add(handler);

  // Return unsubscribe function
  return () => {
    entry!.refCount--;
    entry!.handlers.delete(handler);
    if (entry!.refCount <= 0) {
      entry!.subscriber.unsubscribe(channel);
      entry!.subscriber.disconnect();
      pollSubscribers.delete(pollId);
    }
  };
}
```

---

## 7. Frontend Architecture

### 7.1 Component Tree

```
<AuthProvider>                           # OIDC context
  <I18nextProvider>                      # i18n context
    <BrowserRouter>
      <Routes>
        /callback → <CallbackPage />
        /join/:token → <RequireAuth><JoinPage /></RequireAuth>
        /* → <RequireAuth>
          <Layout>                       # Header + nav + language toggle
            / → <Dashboard />
            /polls/new → <CreatePoll />
            /polls/:id/edit → <EditPoll />
            /polls/:id/manage → <ManagePoll />
              <ControlTab />
              <ParticipantsTab />
              <InvitesTab />
            /polls/:id/vote → <VotePage />
            /polls/:id/results → <ResultsPage />
          </Layout>
        </RequireAuth>
      </Routes>
    </BrowserRouter>
  </I18nextProvider>
</AuthProvider>
```

### 7.2 Auth Setup (`frontend/src/auth/AuthProvider.tsx`)

Directly follows the file-share pattern:

```typescript
import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  handleCallback: () => Promise<User | null>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

const userManager = new UserManager({
  authority: import.meta.env.VITE_OIDC_ISSUER ||
    'https://auth.snir.sh/application/o/votes/',
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID ||
    'jPNKPrV3uouhNtJTyz8BzkTPSkSZ1xoTIZ81cK50',   // HARDCODED FALLBACK
  redirect_uri: `${window.location.origin}/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: 'code',
  scope: 'openid profile email',
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    userManager.getUser().then((u) => {
      if (u && !u.expired) {
        setUser(u);
      }
      setIsLoading(false);
    }).catch(() => {
      setIsLoading(false);
    });

    userManager.events.addUserLoaded((u) => setUser(u));
    userManager.events.addUserUnloaded(() => setUser(null));
    userManager.events.addSilentRenewError(() => setUser(null));
  }, []);

  const login = useCallback(async (returnTo?: string) => {
    // Save the intended destination so we can redirect after callback
    if (returnTo) {
      sessionStorage.setItem('auth_return_to', returnTo);
    }
    await userManager.signinRedirect();
  }, []);

  const logout = useCallback(async () => {
    await userManager.signoutRedirect();
  }, []);

  const handleCallback = useCallback(async () => {
    const u = await userManager.signinRedirectCallback();
    setUser(u);
    return u;
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user && !user.expired,
      isLoading,
      token: user?.access_token || null,
      login,
      logout,
      handleCallback,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
```

### 7.3 RequireAuth (`frontend/src/auth/RequireAuth.tsx`)

```typescript
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './useAuth';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, login } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    // Save current path and redirect to OIDC login
    login(location.pathname + location.search);
    return <LoadingSpinner />;
  }

  return <>{children}</>;
}
```

### 7.4 Callback Page (`frontend/src/auth/CallbackPage.tsx`)

```typescript
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from './useAuth';

export function CallbackPage() {
  const { handleCallback } = useAuth();
  const navigate = useNavigate();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    handleCallback()
      .then(() => {
        const returnTo = sessionStorage.getItem('auth_return_to') || '/';
        sessionStorage.removeItem('auth_return_to');
        navigate(returnTo, { replace: true });
      })
      .catch((err) => {
        console.error('OIDC callback error:', err);
        navigate('/', { replace: true });
      });
  }, []);

  return <LoadingSpinner />;
}
```

### 7.5 API Client (`frontend/src/api.ts`)

```typescript
let getToken: (() => string | null) | null = null;

export function setTokenGetter(fn: () => string | null) {
  getToken = fn;
}

const BASE_URL = '/api';

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken?.();

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
```

Initialize in `main.tsx`:
```typescript
import { setTokenGetter } from './api';
// After AuthProvider renders:
// useEffect: setTokenGetter(() => user?.access_token || null);
```

### 7.6 SSE Hook (`frontend/src/hooks/useSSE.ts`)

```typescript
import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuth } from '../auth/useAuth';

interface SSEEvent {
  event: string;
  data: any;
}

export function useSSE(
  pollId: string | undefined,
  onEvent: (event: SSEEvent) => void
) {
  const { token } = useAuth();
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!pollId || !token) return;

    // EventSource doesn't support custom headers, so pass token as query param
    // Backend must support ?token= as alternative to Authorization header for SSE
    const url = `/api/polls/${pollId}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    // Known event types
    const eventTypes = [
      'init', 'poll_started', 'question_changed', 'question_unlocked',
      'vote_update', 'member_joined', 'member_count', 'poll_finished',
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          onEventRef.current({ event: type, data });
        } catch (err) {
          console.error('SSE parse error:', err);
        }
      });
    }

    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setConnected(false);
    };
  }, [pollId, token]);

  return { connected };
}
```

**Backend SSE auth change required:** Since `EventSource` cannot send custom headers, the SSE endpoint must also accept `?token=` query parameter:

```typescript
// In events.ts, before requireAuth:
// Extract token from query string and set as header
eventsRoutes.get('/:id/events', async (c: any, next) => {
  const token = c.req.query('token');
  if (token && !c.req.header('Authorization')) {
    c.req.raw.headers.set('Authorization', `Bearer ${token}`);
  }
  return next();
}, requireAuth, async (c: any) => {
  // ... SSE handler
});
```

### 7.7 i18n Implementation (`frontend/src/i18n/`)

#### `frontend/src/i18n/index.ts`

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './he.json';
import en from './en.json';

const savedLang = localStorage.getItem('lang') || 'he';

i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    en: { translation: en },
  },
  lng: savedLang,
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
});

// Set document direction based on language
export function updateDirection(lang: string) {
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  document.documentElement.dir = dir;
  document.documentElement.lang = lang;
}

updateDirection(savedLang);

export default i18n;
```

#### `frontend/src/i18n/he.json` (Hebrew translations)

```json
{
  "app_title": "הצבעות",
  "new_poll": "+ הצבעה חדשה",
  "join_with_code": "הצטרף עם קוד",
  "join": "הצטרף",
  "my_polls": "ההצבעות שלי",
  "status_draft": "טיוטה",
  "status_active": "פעילה",
  "status_finished": "הסתיימה",
  "participants": "משתתפים",
  "created_at": "נוצר ב-",
  "enter": "כניסה",

  "create_poll_title": "הצבעה חדשה",
  "poll_name": "שם ההצבעה",
  "poll_description": "תיאור (אופציונלי)",
  "allow_stats": "לאפשר למשתתפים לראות סטטיסטיקות",
  "anonymous_voting": "הצבעה אנונימית",
  "questions": "שאלות",
  "add_question": "+ הוסף שאלה",
  "question_text": "טקסט השאלה",
  "single_choice": "בחירה אחת",
  "multi_choice": "בחירה מרובה",
  "option": "אופציה",
  "add_option": "+ הוסף אופציה",
  "save_draft": "שמור כטיוטה",
  "preview": "תצוגה מקדימה",

  "manage_poll": "ניהול הצבעה",
  "join_code": "קוד הצטרפות",
  "join_link": "לינק הצטרפות",
  "copy": "העתק",
  "copied": "הועתק!",
  "connected_now": "מחוברים כרגע",
  "tab_control": "בקרה",
  "tab_participants": "משתתפים",
  "tab_invites": "הזמנות",

  "start_poll": "▶ התחל הצבעה",
  "edit_poll": "✏️ ערוך",
  "unlock_voting": "🔓 פתח להצבעה",
  "skip_question": "⏭ דלג לשאלה הבאה",
  "next_question": "⏭ שאלה הבאה",
  "finish_poll": "🏁 סיים הצבעה",
  "show_results": "📊 הצג תוצאות",
  "export_csv": "📋 ייצא ל-CSV",
  "question_preview_msg": "השאלה מוצגת למשתתפים — ממתינים לאישור שלך לפתוח להצבעה",
  "x_of_y_voted": "{{x}} מתוך {{y}} הצביעו",

  "make_admin": "הפוך למנהל",
  "remove_admin": "הורד מנהל",
  "remove_member": "הסר",

  "invite_by_email": "הזמנה לפי מייל",
  "email": "מייל",
  "role": "תפקיד",
  "admin": "מנהל",
  "voter": "משתתף",
  "create_link": "צור לינק הזמנה",
  "single_use": "חד-פעמי",
  "unlimited": "ללא הגבלה",
  "expires": "תוקף",
  "hour": "שעה",
  "day": "יום",
  "week": "שבוע",
  "no_expiry": "ללא הגבלה",

  "waiting_for_start": "ההצבעה עוד לא התחילה. ממתינים למנהל...",
  "waiting_for_unlock": "ממתינים לאישור המנהל לפתוח את ההצבעה...",
  "submit_vote": "✓ שלח",
  "vote_recorded": "ההצבעה נרשמה ✓",
  "change_vote": "שנה הצבעה",
  "waiting_next": "תודה! ממתינים לשאלה הבאה...",
  "poll_ended": "ההצבעה הסתיימה. תודה על ההשתתפות!",
  "question_x_of_y": "שאלה {{x}} מתוך {{y}}",

  "results": "תוצאות",
  "current_question": "שאלה נוכחית",
  "all_questions": "כל השאלות",
  "fullscreen": "מסך מלא",
  "not_shown_yet": "טרם הוצגה",

  "logout": "התנתק",
  "loading": "טוען...",
  "error": "שגיאה",
  "confirm_delete": "האם למחוק?",
  "cancel": "ביטול",
  "confirm": "אישור",
  "save": "שמור",

  "invalid_invite": "ההזמנה לא תקינה או פגה",
  "already_member": "אתה כבר חבר בהצבעה זו",
  "joining": "מצטרף להצבעה..."
}
```

#### `frontend/src/i18n/en.json` (English translations)

```json
{
  "app_title": "Votes",
  "new_poll": "+ New Poll",
  "join_with_code": "Join with code",
  "join": "Join",
  "my_polls": "My Polls",
  "status_draft": "Draft",
  "status_active": "Active",
  "status_finished": "Finished",
  "participants": "Participants",
  "created_at": "Created",
  "enter": "Enter",

  "create_poll_title": "New Poll",
  "poll_name": "Poll name",
  "poll_description": "Description (optional)",
  "allow_stats": "Allow participants to see statistics",
  "anonymous_voting": "Anonymous voting",
  "questions": "Questions",
  "add_question": "+ Add Question",
  "question_text": "Question text",
  "single_choice": "Single choice",
  "multi_choice": "Multiple choice",
  "option": "Option",
  "add_option": "+ Add Option",
  "save_draft": "Save as Draft",
  "preview": "Preview",

  "manage_poll": "Manage Poll",
  "join_code": "Join Code",
  "join_link": "Join Link",
  "copy": "Copy",
  "copied": "Copied!",
  "connected_now": "Connected now",
  "tab_control": "Control",
  "tab_participants": "Participants",
  "tab_invites": "Invites",

  "start_poll": "▶ Start Poll",
  "edit_poll": "✏️ Edit",
  "unlock_voting": "🔓 Unlock Voting",
  "skip_question": "⏭ Skip to Next",
  "next_question": "⏭ Next Question",
  "finish_poll": "🏁 Finish Poll",
  "show_results": "📊 Show Results",
  "export_csv": "📋 Export CSV",
  "question_preview_msg": "Question is shown to participants — waiting for your approval to open voting",
  "x_of_y_voted": "{{x}} of {{y}} voted",

  "make_admin": "Make Admin",
  "remove_admin": "Remove Admin",
  "remove_member": "Remove",

  "invite_by_email": "Invite by email",
  "email": "Email",
  "role": "Role",
  "admin": "Admin",
  "voter": "Voter",
  "create_link": "Create Invite Link",
  "single_use": "Single use",
  "unlimited": "Unlimited",
  "expires": "Expires",
  "hour": "Hour",
  "day": "Day",
  "week": "Week",
  "no_expiry": "No expiry",

  "waiting_for_start": "The poll hasn't started yet. Waiting for the admin...",
  "waiting_for_unlock": "Waiting for the admin to open voting...",
  "submit_vote": "✓ Submit",
  "vote_recorded": "Vote recorded ✓",
  "change_vote": "Change Vote",
  "waiting_next": "Thank you! Waiting for the next question...",
  "poll_ended": "The poll has ended. Thank you for participating!",
  "question_x_of_y": "Question {{x}} of {{y}}",

  "results": "Results",
  "current_question": "Current Question",
  "all_questions": "All Questions",
  "fullscreen": "Fullscreen",
  "not_shown_yet": "Not shown yet",

  "logout": "Logout",
  "loading": "Loading...",
  "error": "Error",
  "confirm_delete": "Are you sure?",
  "cancel": "Cancel",
  "confirm": "Confirm",
  "save": "Save",

  "invalid_invite": "This invite is invalid or expired",
  "already_member": "You are already a member of this poll",
  "joining": "Joining poll..."
}
```

#### `frontend/src/i18n/LanguageToggle.tsx`

```typescript
import { useTranslation } from 'react-i18next';
import { updateDirection } from './index';

export function LanguageToggle() {
  const { i18n } = useTranslation();

  const toggle = () => {
    const newLang = i18n.language === 'he' ? 'en' : 'he';
    i18n.changeLanguage(newLang);
    localStorage.setItem('lang', newLang);
    updateDirection(newLang);
  };

  return (
    <button onClick={toggle} className="px-2 py-1 text-sm rounded border">
      {i18n.language === 'he' ? 'English' : 'עברית'}
    </button>
  );
}
```

### 7.8 State Management Approach

**No external state library.** Use:

1. **React Context** for auth (AuthProvider) and i18n (react-i18next built-in)
2. **`useState` / `useReducer`** for local page state
3. **SSE hook** for real-time state updates — the SSE `init` event provides current state on connect
4. **Fetch on mount** for initial data loads (polls list, poll details, results)
5. **Refetch after mutations** — after voting, creating, etc., re-fetch the relevant data

State flow for VotePage:
```
1. Mount → fetch GET /api/polls/:id (poll details, questions, options)
2. Mount → fetch GET /api/polls/:id/my-votes (what I've already voted)
3. Mount → connect SSE /api/polls/:id/events
4. SSE init → set pollState (status, currentQuestion, mode)
5. SSE question_unlocked → update mode to 'open', show options
6. User votes → POST /api/polls/:id/vote → update local "myVotes"
7. SSE vote_update → update counts in state
8. SSE question_changed → update currentQuestion, reset mode to 'preview'
9. SSE poll_finished → set status to 'finished'
```

### 7.9 Page Designs

#### Dashboard (`/`)
```
┌──────────────────────────────────────────┐
│ [🌐 Lang]  Votes / הצבעות     [Logout]  │
├──────────────────────────────────────────┤
│                                          │
│  [+ New Poll]                            │
│                                          │
│  ┌─────────────────────────────────┐     │
│  │ Join code: [______] [Join]      │     │
│  └─────────────────────────────────┘     │
│                                          │
│  My Polls                                │
│  ┌─────────────────────────────────┐     │
│  │ Poll Title        [Active] badge│     │
│  │ Created: Jan 15   3 participants│     │
│  │                        [Enter →]│     │
│  ├─────────────────────────────────┤     │
│  │ Poll Title 2       [Draft] badge│     │
│  │ Created: Jan 14   0 participants│     │
│  │                        [Enter →]│     │
│  └─────────────────────────────────┘     │
└──────────────────────────────────────────┘
```

#### VotePage (`/polls/:id/vote`) — Open Mode
```
┌──────────────────────────────────────────┐
│ Poll Title                    [Active]   │
│ Question 2 of 5                          │
├──────────────────────────────────────────┤
│                                          │
│  What is your preferred option?          │
│                                          │
│  ○ Option A                              │
│  ● Option B  ← selected                 │
│  ○ Option C                              │
│                                          │
│  [✓ Submit]                              │
│                                          │
│  ─── or after voting: ───                │
│                                          │
│  ✓ Vote recorded                         │
│  Your choice: Option B  [Change Vote]    │
│                                          │
│  Live results (if allowed):              │
│  Option A  ████████░░  40% (4)           │
│  Option B  ████████████ 50% (5)          │
│  Option C  ██░░░░░░░░  10% (1)           │
│                                          │
└──────────────────────────────────────────┘
```

#### ManagePoll — Control Tab (Active + Open)
```
┌──────────────────────────────────────────┐
│ Poll Title              [Active] badge   │
│ Code: ABC123 [📋]  Link: votes.sn... [📋]│
│ 5 connected now                          │
├──────────────────────────────────────────┤
│ [Control] [Participants] [Invites]       │
├──────────────────────────────────────────┤
│                                          │
│  Question 2 of 5                         │
│  "What is your preferred option?"        │
│                                          │
│  Results:                                │
│  Option A  ████████░░  40% (4)           │
│  Option B  ████████████ 50% (5)          │
│  Option C  ██░░░░░░░░  10% (1)           │
│                                          │
│  7 of 12 voted                           │
│                                          │
│  [⏭ Next Question]  [🏁 Finish Poll]    │
│                                          │
└──────────────────────────────────────────┘
```

### 7.10 RTL/LTR Styling

Using Tailwind CSS logical properties. In `index.css`:

```css
@import "tailwindcss";

/* Base direction is set on <html> via JS */
html[dir="rtl"] {
  direction: rtl;
}

html[dir="ltr"] {
  direction: ltr;
}
```

In components, use Tailwind's logical properties:
- `ms-4` / `me-4` instead of `ml-4` / `mr-4` (margin-inline-start/end)
- `ps-4` / `pe-4` instead of `pl-4` / `pr-4`
- `text-start` / `text-end` instead of `text-left` / `text-right`
- `start-0` / `end-0` instead of `left-0` / `right-0`
- `rtl:` and `ltr:` prefixes for exceptions

### 7.11 BarChart Component (`frontend/src/components/BarChart.tsx`)

Pure CSS horizontal bar chart — no chart library needed:

```typescript
interface BarChartProps {
  options: {
    label: string;
    count: number;
    percentage: number;
    highlighted?: boolean;  // user's choice
  }[];
  animated?: boolean;
}

export function BarChart({ options, animated = true }: BarChartProps) {
  return (
    <div className="space-y-3">
      {options.map((opt, i) => (
        <div key={i}>
          <div className="flex justify-between text-sm mb-1">
            <span className={opt.highlighted ? 'font-bold' : ''}>
              {opt.label}
            </span>
            <span>{opt.percentage}% ({opt.count})</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-6 dark:bg-gray-700">
            <div
              className={`h-6 rounded-full ${opt.highlighted ? 'bg-blue-600' : 'bg-blue-400'}`}
              style={{
                width: `${opt.percentage}%`,
                transition: animated ? 'width 0.5s ease-out' : 'none',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## 8. Docker Setup

### `Dockerfile`

```dockerfile
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:20-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS production
WORKDIR /app

COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/package.json ./
COPY --from=backend-build /app/backend/src/migrations ./dist/migrations
COPY --from=frontend-build /app/frontend/dist ./public

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### `docker-compose.yml`

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://votes:${POSTGRES_PASSWORD}@postgres:5432/votes
      - REDIS_URL=redis://redis:6379
      - OIDC_ISSUER=https://auth.snir.sh/application/o/votes/
      - OIDC_CLIENT_ID=jPNKPrV3uouhNtJTyz8BzkTPSkSZ1xoTIZ81cK50
      - APP_URL=https://votes.snir.sh
      - PORT=3000
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.votes.rule=Host(`votes.snir.sh`)"
      - "traefik.http.routers.votes.entrypoints=websecure"
      - "traefik.http.routers.votes.tls.certresolver=letsencrypt"
      - "traefik.http.services.votes.loadbalancer.server.port=3000"
      - "traefik.http.middlewares.votes-sse.headers.customresponseheaders.X-Accel-Buffering=no"
      - "traefik.http.routers.votes.middlewares=votes-sse"
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=votes
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=votes
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U votes"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

volumes:
  db-data:
  redis-data:
```

**Key points:**
- **No `ports:` on any service** — Traefik handles all routing via Docker labels
- **Redis persistence** via AOF (`--appendonly yes`) — survives restarts
- **Health checks** on both postgres and redis — app waits for them
- **X-Accel-Buffering: no** header via Traefik middleware — required for SSE to work through reverse proxy

### `.env.example`

```bash
POSTGRES_PASSWORD=change-me-in-production
```

### `backend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `frontend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

### `frontend/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
```

---

## 9. Build Order

### Phase 1: Project Scaffolding
1. Create directory structure (`backend/`, `frontend/`)
2. Create `backend/package.json`, `backend/tsconfig.json`
3. Create `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`
4. Run `npm install` in both directories
5. Create `docker-compose.yml`, `Dockerfile`, `.env.example`, `.gitignore`
6. Create `frontend/index.html` (minimal)

### Phase 2: Database + Backend Core
7. Create `backend/src/migrations/001_initial.sql` — all tables
8. Create `backend/src/db.ts` — PG pool
9. Create `backend/src/redis.ts` — Redis clients
10. Create `backend/src/migrate.ts` — migration runner
11. Create `backend/src/types.ts` — shared types
12. Create `backend/src/middleware/auth.ts` — JWT + userinfo auth
13. Create `backend/src/index.ts` — Hono app skeleton (mount CORS, placeholder routes)
14. **Test:** Start postgres + redis (docker compose up postgres redis), run backend locally, verify DB migration works

### Phase 3: Auth + Polls CRUD
15. Create `backend/src/routes/auth.ts` — GET /api/auth/me (with pending invite auto-join)
16. Create `backend/src/routes/polls.ts` — POST/GET/PUT/DELETE polls
17. **Test:** Use curl / Postman to create a poll, list polls, get poll by ID

### Phase 4: Frontend Shell + Auth
18. Create `frontend/src/main.tsx` — root with providers
19. Create `frontend/src/auth/AuthProvider.tsx` — OIDC
20. Create `frontend/src/auth/useAuth.ts` — hook
21. Create `frontend/src/auth/CallbackPage.tsx` — OIDC callback
22. Create `frontend/src/auth/RequireAuth.tsx` — route guard
23. Create `frontend/src/api.ts` — fetch wrapper
24. Create `frontend/src/i18n/index.ts`, `he.json`, `en.json`, `LanguageToggle.tsx`
25. Create `frontend/src/App.tsx` — routes
26. Create `frontend/src/components/Layout.tsx` — app shell
27. Create `frontend/src/index.css` — Tailwind + RTL
28. **Test:** Login via Authentik, see dashboard, toggle language

### Phase 5: Dashboard + Poll Creation
29. Create `frontend/src/pages/Dashboard.tsx` — list polls + join by code
30. Create `frontend/src/pages/CreatePoll.tsx` — multi-step form
31. Create `frontend/src/pages/EditPoll.tsx` — edit draft
32. **Test:** Create a poll, see it in dashboard, edit it

### Phase 6: Members + Invites (Backend)
33. Create `backend/src/routes/members.ts` — GET/PUT/DELETE members
34. Create `backend/src/routes/invites.ts` — POST/GET/DELETE invites + join endpoints
35. **Test:** Create invites, join with code, join with token

### Phase 7: SSE + Poll Control (Backend)
36. Create `backend/src/services/pollState.ts` — Redis state helpers
37. Create `backend/src/routes/events.ts` — SSE endpoint
38. Create `backend/src/routes/pollControl.ts` — start/unlock/advance/finish
39. **Test:** Start poll, connect SSE with curl, verify events flow

### Phase 8: Voting (Backend)
40. Create `backend/src/routes/voting.ts` — vote + my-votes
41. Create `backend/src/routes/results.ts` — results + CSV export
42. **Test:** Full voting flow via curl: start → unlock → vote → advance → finish

### Phase 9: Management UI (Frontend)
43. Create `frontend/src/pages/ManagePoll.tsx` — tab container
44. Create `frontend/src/pages/ManageTabs/ControlTab.tsx` — poll control
45. Create `frontend/src/pages/ManageTabs/ParticipantsTab.tsx` — members
46. Create `frontend/src/pages/ManageTabs/InvitesTab.tsx` — invites
47. Create `frontend/src/hooks/useSSE.ts` — SSE client hook
48. Create `frontend/src/hooks/usePollState.ts` — combines REST + SSE
49. **Test:** Full admin flow in browser

### Phase 10: Voter UI (Frontend)
50. Create `frontend/src/pages/VotePage.tsx` — full voter experience
51. Create `frontend/src/pages/JoinPage.tsx` — join via token/code
52. Create `frontend/src/components/BarChart.tsx` — results chart
53. **Test:** Full voter flow: join → wait → vote → see results

### Phase 11: Results UI (Frontend)
54. Create `frontend/src/pages/ResultsPage.tsx` — with current/all toggle + fullscreen
55. Create remaining shared components (PollStatusBadge, LoadingSpinner, ConfirmDialog)
56. **Test:** Results page with live updates

### Phase 12: Docker + Deploy
57. Build and test with `docker compose up`
58. Verify all flows work end-to-end in containerized environment
59. Push to GitHub, trigger Dokploy deploy
60. Test on https://votes.snir.sh

---

## 10. Known Gotchas

### 1. Hono TypeScript: Use `(c: any)` for route handlers

Hono's generic type system fights with route parameter inference. **Always** use `(c: any)` for handler functions:

```typescript
// CORRECT
pollRoutes.get('/:id', requireAuth, async (c: any) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  // ...
});

// WRONG — will cause TS errors
pollRoutes.get('/:id', requireAuth, async (c: Context<AppEnv>) => {
  // Type errors with param()
});
```

### 2. tsconfig: NodeNext/NodeNext for backend

The backend MUST use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`. Using `"bundler"` will cause runtime import failures.

All imports must have `.js` extensions:
```typescript
import { pool } from '../db.js';     // CORRECT
import { pool } from '../db';        // WRONG — fails at runtime
```

### 3. Authentik opaque tokens: userinfo fallback required

Authentik sends **opaque** access tokens, not JWTs. The auth middleware MUST:
1. Try `jwtVerify()` first
2. Catch the error (token is not a JWT)
3. Fall back to `GET ${OIDC_ISSUER}userinfo/` with `Authorization: Bearer {token}`
4. Extract `sub` from the userinfo response
5. Cache the result for 5 minutes (in-memory Map)

### 4. No `ports:` in docker-compose for web services

Traefik handles routing. Do NOT add `ports: - "3000:3000"` to the app service. Only internal port exposure via Traefik labels:
```yaml
labels:
  - "traefik.http.services.votes.loadbalancer.server.port=3000"
```

### 5. Frontend OIDC client_id: hardcode as fallback

Vite env vars (`VITE_*`) are embedded at build time. In Docker, the build stage doesn't have access to runtime env vars. **Always** hardcode the client_id as a fallback:

```typescript
client_id: import.meta.env.VITE_OIDC_CLIENT_ID ||
  'jPNKPrV3uouhNtJTyz8BzkTPSkSZ1xoTIZ81cK50',
```

### 6. SSE through Traefik requires buffering disabled

Add this header to prevent Traefik from buffering SSE responses:
```yaml
labels:
  - "traefik.http.middlewares.votes-sse.headers.customresponseheaders.X-Accel-Buffering=no"
```

And in the SSE response headers:
```typescript
'X-Accel-Buffering': 'no'
```

### 7. EventSource doesn't support custom headers

The browser's `EventSource` API cannot send `Authorization` headers. The SSE endpoint must accept the token as a query parameter `?token=`:
```typescript
const url = `/api/polls/${pollId}/events?token=${encodeURIComponent(token)}`;
```

Backend extracts it before auth middleware runs.

### 8. Redis pub/sub requires separate client

ioredis requires a dedicated client for subscriptions. The subscribing client cannot be used for regular commands. This is why `redis.ts` exports both `redis` (commands) and `redisSub` (subscriber).

### 9. `pg` module import in ESM

The `pg` package doesn't have proper ESM exports. Import like this:
```typescript
import pg from 'pg';
const { Pool } = pg;
```
Not: `import { Pool } from 'pg'` — this will fail.

### 10. Migration files must be copied in Dockerfile

The `tsc` build doesn't copy `.sql` files. The Dockerfile must explicitly copy migrations:
```dockerfile
COPY --from=backend-build /app/backend/src/migrations ./dist/migrations
```

### 11. Single-type questions: DELETE before INSERT

When a user changes their vote on a `single`-choice question, you must DELETE the old vote first, then INSERT the new one. The unique constraint is `(question_id, user_sub, option_id)`, so inserting a different option would succeed but leave the old one — creating a double vote. Always delete all existing votes for that user+question first.

### 12. Redis HINCRBY can go negative

When changing votes, decrementing removed options with HINCRBY -1 can temporarily show negative counts if there's a race. Mitigate by clamping to 0 in the results response, and using PG as source of truth for final counts.

### 13. CSS direction with Tailwind v4

Tailwind v4 supports RTL out of the box with logical properties (`ms-`, `me-`, `ps-`, `pe-`, `text-start`, `text-end`). No plugin needed. Set `dir="rtl"` on `<html>` and logical properties apply automatically.

### 14. `serveStatic` path for SPA

The catch-all route for SPA must use `path: 'index.html'` to serve the React app for all non-API routes:
```typescript
app.use('*', serveStatic({ root: './public' }));
app.get('*', serveStatic({ root: './public', path: 'index.html' }));
```
The first line serves static assets (JS, CSS). The second catches all other routes and returns `index.html` for client-side routing.

### 15. CORS in production

In production, the frontend is served from the same origin (same container), so CORS middleware is only needed for development. The CORS origin should include `http://localhost:5173` for Vite dev server. In production with same-origin serving, CORS headers aren't needed but won't hurt.
