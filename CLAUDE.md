# CLAUDE.md — DESPESAS INTEGRADAS

Collaborative expense-tracking app with offline support and real-time sync across clients.
UI language is **Brazilian Portuguese (pt-BR)**.

---

## Architecture Overview

This is a **full-stack TypeScript monorepo** with a single entry point (`server.ts`) that
serves both the Express REST/WebSocket API and the React SPA via Vite middleware.

```
/
├── server.ts              # Express + Socket.IO backend, Vite dev middleware, SQLite setup
├── src/
│   ├── App.tsx            # Shell: header, menu, tab routing, connection/pending badges
│   ├── main.tsx           # React DOM entry point (StrictMode)
│   ├── index.css          # Global styles (Tailwind imports, .card/.input/.btn-* utilities)
│   ├── types.ts           # Shared entity interfaces (Expense, Income, Budget, …)
│   ├── context/
│   │   └── DataContext.tsx  # ALL state + sync logic: fetch, pending-sync queue,
│   │                        # offline reconciliation, recurring materialisation, CRUD
│   ├── components/
│   │   ├── Dashboard.tsx      # "Visão Geral": KPIs, insights, charts, budgets (Recharts)
│   │   ├── ExpenseList.tsx    # Expense table, filters, pagination, PDF/CSV/WhatsApp export
│   │   ├── ExpenseModal.tsx   # Add/edit expense + recurrence toggle + duplicate warning
│   │   ├── FutureExpenses.tsx # Overdue + upcoming view, virtual recurring occurrences
│   │   ├── Incomes.tsx        # Incomes list ("Entradas / Receitas")
│   │   ├── IncomeModal.tsx    # Add/edit income + recurrence toggle + duplicate warning
│   │   ├── Notes.tsx          # Synced notepad ("Bloco de Notas")
│   │   ├── Settings.tsx       # Profile, categories, responsibles, budgets, income types,
│   │   │                      # notifications, JSON backup export/restore
│   │   ├── FilterBar.tsx      # Shared filter controls
│   │   ├── ConfirmModal.tsx   # Confirm dialog (tone: "danger" | "primary")
│   │   └── Toast.tsx          # Toast notifications
│   └── lib/
│       └── utils.ts       # cn(), generateId(), formatCurrency(), recurringDueDate(),
│                          # isRecurringCovered(), compressImage(), …
├── public/
│   └── icons/             # PWA icons (generated — see scripts/generate-icons.mjs)
├── scripts/
│   ├── generate-icons.mjs # Regenerates public/icons/*.png (`npm run icons`)
│   └── railway-setup.sh   # One-shot Railway provisioning via CLI
├── index.html             # HTML shell + PWA meta tags (theme-color, apple-touch-icon…)
├── vite.config.ts         # Vite config (React, Tailwind v4, VitePWA, alias @/ → root)
├── package.json
├── tsconfig.json
└── metadata.json          # App metadata (name, description)
```

Tabs are lazy-loaded (`React.lazy`) to keep chart/PDF libraries out of the initial bundle.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, TailwindCSS v4 |
| Backend | Node.js, Express 4, Socket.IO 4 |
| Database | SQLite via `better-sqlite3` (file: `expenses.db`, overridable via `DATABASE_PATH`; WAL) |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`) — installable, opens offline |
| Build | Vite 6 |
| Dev runner | `tsx` (runs `server.ts` directly) |
| Charts | Recharts |
| Animations | Motion (motion/react) |
| Date handling | date-fns with `ptBR` locale |
| PDF export | jsPDF + jspdf-autotable (dynamically imported) |
| Icons | lucide-react |

---

## Development Commands

```bash
npm run dev       # Start dev server (tsx server.ts) — serves on http://localhost:3000
npm run build     # Vite production build → dist/
npm run preview   # Preview production build
npm run lint      # TypeScript type-check only (tsc --noEmit)
npm run clean     # Remove dist/
npm run icons     # Regenerate the PWA icons in public/icons/
```

**There is no separate `npm run test` command.** Validation is type-checking only.

---

## How the Server Works

`server.ts` is the single entry point for both development and production:

- **Development**: Mounts Vite as Express middleware (`createViteServer` with `middlewareMode: true`), enabling HMR. HMR can be disabled via `DISABLE_HMR=true` env var (used by AI Studio).
- **Production**: Serves the `dist/` static build (including the generated `sw.js` and
  `manifest.webmanifest` — the service worker must be served from the **root scope**).
- **Always**: Express REST API at `/api/*` + Socket.IO server on the same HTTP server instance.
- Listens on port **3000** (or `PORT`), bound to `0.0.0.0`.
- `GET /health` reports `{ status, database: { path, persistent, journal_mode, expenses } }`.
  `persistent: false` in production means `DATABASE_PATH` is **not** on the `/data` volume and
  the database will be wiped on the next deploy — the server also logs a loud warning at boot.
- `SIGTERM`/`SIGINT` close the database before exit so the WAL is checkpointed on redeploys.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/data` | Returns all data: `{ expenses, categories, responsibles, profile, budgets, recurring, incomes, incomeTypes, recurringIncomes, recurringSkips, notes }` |
| `POST` | `/api/sync` | Upserts (`REPLACE INTO`) any subset of tables; columns are whitelisted per table AND resolved **per item** (items in one batch may have different key sets). Emits `data_updated`. |
| `DELETE` | `/api/:table/:id` | Deletes a row (tables whitelisted; categories/responsibles in use by an expense are rejected with HTTP 400 + pt-BR message) |
| `POST` | `/api/delete/:table/:id` | Same as DELETE — fallback for environments that block the DELETE method (this is what the frontend uses) |

### Socket.IO Events

- **`data_updated`** (server → all clients): Emitted after any mutation (sync or delete).
  Clients re-fetch `/api/data` on receipt, **coalesced with a 300 ms debounce**.
- Client socket uses infinite reconnection (default backoff). Do not cap `reconnectionAttempts`.

---

## Database Schema

SQLite file: `expenses.db` (or `DATABASE_PATH`), created at server root on first run.

```sql
categories        (id TEXT PK, name, color)
responsibles      (id TEXT PK, name, photo)          -- photo = base64 data URL (compressed client-side)
expenses          (id TEXT PK, category_id FK→SET NULL, description, date, due_date,
                   value REAL, responsible_id FK→SET NULL, paid INTEGER 0/1,
                   notes, created_by, recurring_id, created_at)
user_profile      (id TEXT PK = 'default', name, photo)
budgets           (id TEXT PK, category_id FK→CASCADE, month 'yyyy-MM', limit_value,
                   UNIQUE(category_id, month))
recurring_expenses(id TEXT PK, category_id, description, value, responsible_id,
                   day_of_month, active INTEGER 0/1)
incomes           (id TEXT PK, description, value, date, type, responsible_id,
                   notes, recurring INTEGER (legacy), recurring_income_id)
income_types      (id TEXT PK, name, color)
recurring_incomes (id TEXT PK, description, value, type, responsible_id,
                   day_of_month, active INTEGER 0/1)
recurring_skips   (id TEXT PK = '<recurring_id>_<yyyy-MM>', recurring_id, month)
notes             (id TEXT PK, title, content, updated_at)
app_meta          (key TEXT PK, value)               -- one-time maintenance flags (e.g. dedup_v1)
```

- Foreign keys are enforced (`PRAGMA foreign_keys = ON`).
- `journal_mode = WAL` + `synchronous = NORMAL` + `busy_timeout = 5000`: readers don't block
  during a write (every client re-fetches `/api/data` on `data_updated`), with far fewer fsyncs.
- Indexes cover the queries the app actually issues: `expenses(due_date)`,
  `expenses(recurring_id)`, `expenses(category_id)`, `expenses(responsible_id)`,
  `incomes(date)`, `incomes(recurring_income_id)`, `budgets(month)`,
  `recurring_skips(recurring_id, month)`.
- Default seeds on first run: 4 categories (Alimentação, Transporte, Lazer, Moradia),
  3 income types (Salário, Renda Extra, Outro), the default profile.
- Runtime migrations (`tryMigrate`) add columns that older databases lack.
- `runDedupOnce()` performed a one-time cleanup of historic duplicate rows (flag `dedup_v1`).
- `dedupRecurringOccurrences()` runs on **every** start: deletes exact duplicate
  recurring occurrences (same `recurring_id`, due date, value, description,
  responsible), keeping the paid one, then the deterministic `rec_…` id, then the oldest.

---

## PWA / Offline shell

Offline support has **two independent layers** — both are required:

1. **Data** — `DataContext` (pending-sync queue + localStorage fallback). See below.
2. **Shell** — the service worker generated by `vite-plugin-pwa` (config in `vite.config.ts`).
   Without it the app simply *doesn't open* without a network, no matter how good the
   data layer is.

Rules to preserve:

- **The service worker must never cache `/api/*`, `/socket.io/*` or `/health`.** Only the
  build output is precached; data always comes from the network (online) or localStorage
  (offline). They're also in `navigateFallbackDenylist`.
- **`globPatterns` precaches every built chunk**, including the lazy tab chunks. Runtime-only
  caching would break the first offline visit to a tab the user had never opened.
- `registerType: 'autoUpdate'` + `skipWaiting`/`clientsClaim`: a Railway deploy reaches
  installed apps on the next open, without a manual "update available" prompt.
- `devOptions.enabled: false` — a service worker in dev fights Vite's HMR.
- Icons in `public/icons/` are **generated**, not hand-drawn: edit
  `scripts/generate-icons.mjs` and run `npm run icons`. `maskable` variants exist so
  Android doesn't crop the logo.
- After changing anything PWA-related, validate with a real build (`npm run build`) —
  `sw.js` and `manifest.webmanifest` only exist in `dist/`.

---

## Frontend Data Layer (`src/context/DataContext.tsx`)

All state and sync logic lives in `DataProvider`; components consume it via `useData()`.

### Sync rules (IMPORTANT — preserve these invariants)

1. **Every save goes through the pending queue** (`pendingSync` in localStorage) and
   then a flush attempt (`POST /api/sync`). If the request fails, rows stay queued and
   are retried (10 s timer on network error, 30 s on a non-JSON HTTP failure, socket
   reconnect, `online` event). When a whole batch fails without a JSON `{error}` body
   (proxy error, size limit…), the flush retries in chunks of 10 rows so one oversized
   row can't wedge the queue forever. **A save must never be silently lost because one
   request failed.** The header badge is a button: tapping it runs `forceSync()`
   (flush + refetch + toast with the outcome).
2. **`fetchData` flushes the queue BEFORE pulling** and then **overlays still-pending
   rows on top of the server response** (and drops rows with a queued offline delete),
   so a refetch can never clobber an unconfirmed local change.
3. **Deletions** can't go through `/api/sync` (upsert-only): offline deletes queue in
   `pendingDeletes` (localStorage) and are replayed on reconnect. Deleting a row also
   removes it from `pendingSync` so a later flush can't resurrect it.
4. **Never re-push the full local snapshot** on reconnect — that resurrects rows other
   devices deleted. Only the pending queue is flushed.
5. `pendingCount` (queue size incl. pending deletes) is exposed to the UI; the header
   shows an amber badge when > 0.
6. Sync payload keys map to server tables via `TABLE_FOR_PAYLOAD`
   (`recurring` → `recurring_expenses`, `incomeTypes` → `income_types`, …).

### Recurring expenses/incomes

- Templates live in `recurring_expenses` / `recurring_incomes`; each month `fetchData`
  materialises one real row per active template with a **deterministic id**
  (`rec_<templateId>_<yyyy-MM>` / `recinc_<templateId>_<yyyy-MM>`) so two devices
  generating the same month can't duplicate.
- Deleting a generated occurrence records a `recurring_skips` row so it isn't regenerated.
- `FutureExpenses` also renders **virtual** (not yet materialised) occurrences with
  ids `virtual-<recId>-<date>` — these are display-only. Marking a virtual occurrence
  as paid creates the real row **with the deterministic id** (never `generateId()`),
  so a repeated tap replaces the same row instead of duplicating it.
- **A paid occurrence counts as "covered"**: never pass `unpaidOnly: true` to
  `isRecurringCovered` when deciding whether to *show* a virtual row — that made paid
  months reappear and invited duplicate saves (real bug, fixed).
- Exact duplicate occurrences (same template/due date/value/description/responsible)
  are self-healed: the server dedups on every start (`dedupRecurringOccurrences`) and
  `fetchData` drops client-side copies via `findRecurringDuplicates()` + queued deletes.

### Other conventions in the data layer

- On mount and network failure, state falls back to localStorage (offline mode); when
  online but `/api/*` is unreachable (static hosting), the app runs in **local-only
  mode** (`serverReachable === false`) with a header banner.
- Optimistic updates with rollback snapshots for deletes; app-level server rejections
  (JSON `{error}`) roll back and toast, missing-backend responses switch to local-only.
- `restoreBackup(raw)` merges an exported JSON backup (upsert by id, never deletes)
  and queues everything for sync. Export/restore UI lives in Settings.
- Photos are compressed client-side (`compressImage`, max 300 px, JPEG 0.75) before
  being stored as base64. JSON body limit for sync is `10mb`.

---

## Key Conventions

1. **All UI text is in Brazilian Portuguese.** Keep new UI strings in pt-BR.
2. **Currency is BRL (R$).** Format values with `formatCurrency()` from `src/lib/utils.ts`.
3. **Dates are local-timezone ISO strings** (`yyyy-MM-dd`) in storage. Always derive
   "today" with `format(new Date(), "yyyy-MM-dd")` (date-fns, local) — **never
   `toISOString()`**, which is UTC and flips the date at 21:00 in Brazil (UTC-3).
   Display with `format(..., 'dd/MM/yyyy')`.
4. **`paid`/`active`/`recurring` are stored as `INTEGER` (0 or 1)**, not booleans.
5. **No test framework is configured.** Validate logic changes with `npm run lint`.
6. **State lives in `DataContext`, presentation in `src/components/`.** Don't add
   fetch/sync calls inside components — add a handler to the context instead.
7. **The `@/` path alias** resolves to the project root (not `src/`). Relative imports
   are the norm inside `src/`.
8. **Socket.IO client** is initialized once in `DataProvider`'s mount effect and
   disconnected on cleanup — mirror this pattern for any additional socket usage.
9. **`/api/sync` uses `REPLACE INTO`** (upsert by primary key) — re-sending rows is
   idempotent. Rows are replaced whole: always send full objects, never partial diffs.
10. **Do not add a separate frontend dev server** (`vite dev`). Always start via
    `npm run dev` (`tsx server.ts`) so the API and frontend run on the same port.
11. **New entity ids** come from `generateId()` (`src/lib/utils.ts`), except
    deterministic recurring ids (see above).
12. **Duplicate guards**: expense/income modals warn before saving an identical entry
    (description/value/date/responsible|type); Settings blocks duplicate names for
    categories, responsibles and income types. Trim user text before comparing.
13. **Navigation uses browser history** (no router): `App.tsx` pushes a `NavState`
    entry per screen and handles `popstate`, so the system/browser back button
    navigates menu ← tab ← notes editor instead of leaving the app. Full-screen
    overlays (Notes editor) push their own entry flagged `noteEditor: true` and must
    consume it (`history.back()`) when closed via UI buttons.

---

## Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_PATH` | `server.ts` | SQLite file location (persistent volume in production; defaults to `expenses.db`) |
| `GEMINI_API_KEY` | `vite.config.ts` | Exposed to frontend as `process.env.GEMINI_API_KEY` (available for future Gemini AI integration) |
| `DISABLE_HMR` | `vite.config.ts` | Set to `"true"` to disable Vite HMR (used by AI Studio environment) |
| `NODE_ENV` | `server.ts` | `"production"` switches to static file serving |

Create a `.env` file at the project root to set these locally.

---

## Deploy (Railway) — workflow

Production is hosted on **Railway**, which **auto-deploys on every push to `main`**
(SQLite on a persistent volume at `/data`; see `RAILWAY.md` and `railway.json`).

**Standing instruction from the repo owner:** every code change must be committed
and pushed **directly to `main`** — pushing to `main` is what ships the deploy.
Do not park changes on a separate feature branch and wait; land them on `main`
so Railway publishes them. (Still run `npm run lint` before pushing.)
