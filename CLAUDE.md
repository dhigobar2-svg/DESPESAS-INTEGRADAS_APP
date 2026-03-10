# CLAUDE.md — DESPESAS INTEGRADAS

Collaborative expense-tracking app with offline support and real-time sync across clients.
UI language is **Brazilian Portuguese (pt-BR)**.

---

## Architecture Overview

This is a **full-stack TypeScript monorepo** with a single entry point (`server.ts`) that
serves both the Express REST/WebSocket API and the React SPA via Vite middleware.

```
/
├── server.ts          # Express + Socket.IO backend, Vite dev middleware, SQLite setup
├── src/
│   ├── App.tsx        # Entire React frontend (single monolithic component)
│   ├── main.tsx       # React DOM entry point
│   ├── index.css      # Global styles (Tailwind imports)
│   └── lib/
│       └── utils.ts   # cn() helper (clsx + tailwind-merge)
├── index.html         # HTML shell
├── vite.config.ts     # Vite config (React plugin, Tailwind v4, path alias @/)
├── package.json
├── tsconfig.json
└── metadata.json      # App metadata (name, description)
```

There are **no sub-packages, no test files, and no separate component files** — all frontend
logic lives in `src/App.tsx`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, TailwindCSS v4 |
| Backend | Node.js, Express 4, Socket.IO 4 |
| Database | SQLite via `better-sqlite3` (file: `expenses.db`) |
| Build | Vite 6 |
| Dev runner | `tsx` (runs `server.ts` directly) |
| Charts | Recharts |
| Animations | Motion (motion/react) |
| Date handling | date-fns with `ptBR` locale |
| PDF export | jsPDF + jspdf-autotable |
| Icons | lucide-react |

---

## Development Commands

```bash
npm run dev       # Start dev server (tsx server.ts) — serves on http://localhost:3000
npm run build     # Vite production build → dist/
npm run preview   # Preview production build
npm run lint      # TypeScript type-check only (tsc --noEmit)
npm run clean     # Remove dist/
```

**There is no separate `npm run test` command.** Validation is type-checking only.

---

## How the Server Works

`server.ts` is the single entry point for both development and production:

- **Development**: Mounts Vite as Express middleware (`createViteServer` with `middlewareMode: true`), enabling HMR. HMR can be disabled via `DISABLE_HMR=true` env var (used by AI Studio).
- **Production**: Serves the `dist/` static build.
- **Always**: Express REST API at `/api/*` + Socket.IO server on the same HTTP server instance.
- Listens on port **3000**, bound to `0.0.0.0`.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/data` | Returns all `{ expenses, categories, responsibles }` |
| `POST` | `/api/sync` | Upserts (`REPLACE INTO`) all client-side data to SQLite; emits `data_updated` via Socket.IO |
| `DELETE` | `/api/:table/:id` | Deletes a row from `expenses`, `categories`, or `responsibles` |

### Socket.IO Events

- **`data_updated`** (server → all clients): Emitted after any mutation (sync or delete). All clients re-fetch `/api/data` on receipt.

---

## Database Schema

SQLite file: `expenses.db` (created at server root on first run).

```sql
categories   (id TEXT PK, name TEXT, color TEXT)
responsibles (id TEXT PK, name TEXT, photo TEXT)   -- photo stored as base64 data URL
expenses     (id TEXT PK, category_id TEXT FK, description TEXT,
              date TEXT, due_date TEXT, value REAL, responsible_id TEXT,
              paid INTEGER DEFAULT 0, created_at DATETIME)
```

- Foreign keys are enforced (`PRAGMA foreign_keys = ON`).
- Deleting a category/responsible with linked expenses returns HTTP 400 with a Portuguese error message.
- Default seed categories on first run: Alimentação, Transporte, Lazer, Moradia.
- A runtime migration adds the `description` column if it's missing (legacy support).

---

## Frontend Architecture (`src/App.tsx`)

The entire UI is a single React functional component with four "tabs" managed by `activeTab` state:

| Tab value | Description |
|---|---|
| `'menu'` | Home screen with summary cards and navigation |
| `'overview'` | Charts: pie (by category), bar (top 3 expenses), horizontal bar (by responsible) |
| `'expenses'` | Full expense table with edit/delete, PDF export, WhatsApp share |
| `'settings'` | User profile, categories CRUD, responsibles CRUD |

### Key State

```typescript
expenses: Expense[]
categories: Category[]
responsibles: Responsible[]
userProfile: UserProfile        // stored in React state only (not persisted to server)
activeTab: 'menu' | 'overview' | 'expenses' | 'settings'
showAddModal: boolean
editingExpense: Expense | null
isOnline: boolean
```

### Data Flow

1. On mount: fetch `/api/data`, store in state **and** `localStorage` (offline fallback).
2. On network failure: load from `localStorage`.
3. On reconnect (`window online` event): call `syncWithServer()` which POSTs localStorage data to `/api/sync`.
4. Socket.IO `data_updated` event triggers a full re-fetch.

### ID Generation

New entities use client-side IDs: `Date.now().toString(36) + Math.random().toString(36).substr(2, 5)`.

### Optimistic Updates

Deletes are applied locally first, then confirmed with the server. On server error the state is rolled back from saved snapshots.

### Photo Uploads

Photos (profile, responsibles) are read as base64 data URLs via `FileReader` and stored directly in SQLite as TEXT. The JSON limit for sync is `10mb`.

---

## Styling Conventions

- **TailwindCSS v4** (via `@tailwindcss/vite` plugin — no `tailwind.config.js` needed).
- `cn()` utility from `src/lib/utils.ts` used for conditional class merging.
- Design language: rounded cards (`rounded-2xl`, `rounded-3xl`), `slate-*` neutral palette, `emerald-600` as primary action color.
- Motion/React `AnimatePresence` + `motion.div` used for tab and modal transitions.

---

## Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `vite.config.ts` | Exposed to frontend as `process.env.GEMINI_API_KEY` (available for future Gemini AI integration) |
| `DISABLE_HMR` | `vite.config.ts` | Set to `"true"` to disable Vite HMR (used by AI Studio environment) |
| `NODE_ENV` | `server.ts` | `"production"` switches to static file serving |

Create a `.env` file at the project root to set these locally.

---

## Key Conventions

1. **All UI text is in Brazilian Portuguese.** Keep new UI strings in pt-BR.
2. **Currency is BRL (R$).** Format values with `.toFixed(2)` and `toLocaleString('pt-BR', ...)`.
3. **Dates are ISO strings** (`yyyy-MM-dd`) in storage; display with `date-fns` `format(..., 'dd/MM/yyyy')`.
4. **`paid` is stored as `INTEGER` (0 or 1)**, not a boolean.
5. **No test framework is configured.** Validate logic changes with `npm run lint`.
6. **Do not split `App.tsx` into sub-components** without a clear reason — the existing monolithic pattern is intentional for this project size.
7. **The `@/` path alias** resolves to the project root (not `src/`). Use `@/src/...` for imports from root.
8. **Socket.IO client** is initialized inside a `useEffect` on mount and disconnected on cleanup — always mirror this pattern for any additional socket usage.
9. **`/api/sync` uses `REPLACE INTO`** (upsert by primary key) — sending the full array is safe and idempotent.
10. **Do not add a separate frontend dev server** (`vite dev`). Always start via `npm run dev` (`tsx server.ts`) so the API and frontend run on the same port.
