import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { createHash, timingSafeEqual } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATABASE_PATH lets the DB live on a persistent volume in production.
const DB_PATH = process.env.DATABASE_PATH || "expenses.db";
const db = new Database(DB_PATH);

db.exec("PRAGMA foreign_keys = ON;");
// WAL: leituras não travam durante uma escrita — o app faz um GET /api/data por
// cliente a cada data_updated, então concorrência de leitura importa. Combinado
// com synchronous=NORMAL dá durabilidade suficiente com bem menos fsync.
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
// Se outra escrita estiver em andamento, espera em vez de estourar SQLITE_BUSY.
db.pragma("busy_timeout = 5000");

// Aviso alto no boot quando o banco NÃO está num volume persistente: no Railway
// (e em qualquer container) o filesystem é efêmero e o .db some a cada deploy.
const dbAbsolute = path.resolve(DB_PATH);
const dbPersistent = dbAbsolute.startsWith("/data/");
console.log(`[db] SQLite em ${dbAbsolute} (journal: WAL)`);
if (process.env.NODE_ENV === "production" && !dbPersistent) {
  console.warn(
    "[db] ATENÇÃO: DATABASE_PATH não aponta para o volume persistente (/data). " +
    "Os dados serão perdidos no próximo deploy. Configure o volume em /data e " +
    "DATABASE_PATH=/data/expenses.db.",
  );
}

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS responsibles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    photo TEXT
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    category_id TEXT,
    description TEXT,
    date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    value REAL NOT NULL,
    responsible_id TEXT,
    paid INTEGER DEFAULT 0,
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY(responsible_id) REFERENCES responsibles(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS user_profile (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Usuário',
    photo TEXT
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    month TEXT NOT NULL,
    limit_value REAL NOT NULL,
    UNIQUE(category_id, month),
    FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recurring_expenses (
    id TEXT PRIMARY KEY,
    category_id TEXT,
    description TEXT NOT NULL,
    value REAL NOT NULL,
    responsible_id TEXT,
    day_of_month INTEGER NOT NULL,
    active INTEGER DEFAULT 1,
    FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY(responsible_id) REFERENCES responsibles(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incomes (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    value REAL NOT NULL,
    date TEXT NOT NULL,
    type TEXT DEFAULT 'outro',
    responsible_id TEXT,
    notes TEXT,
    recurring INTEGER DEFAULT 0,
    FOREIGN KEY(responsible_id) REFERENCES responsibles(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS income_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recurring_incomes (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    value REAL NOT NULL,
    type TEXT DEFAULT 'outro',
    responsible_id TEXT,
    day_of_month INTEGER NOT NULL,
    active INTEGER DEFAULT 1,
    FOREIGN KEY(responsible_id) REFERENCES responsibles(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS recurring_skips (
    id TEXT PRIMARY KEY,
    recurring_id TEXT NOT NULL,
    month TEXT NOT NULL
  );

  INSERT OR IGNORE INTO categories (id, name, color) VALUES
    ('1', 'Alimentação', '#ef4444'),
    ('2', 'Transporte', '#3b82f6'),
    ('3', 'Lazer', '#10b981'),
    ('4', 'Moradia', '#f59e0b');

  INSERT OR IGNORE INTO user_profile (id, name) VALUES ('default', 'Usuário');

  INSERT OR IGNORE INTO income_types (id, name, color) VALUES
    ('salario',    'Salário',     '#3b82f6'),
    ('renda_extra','Renda Extra', '#10b981'),
    ('outro',      'Outro',       '#64748b');
`);

// Migrations
const tryMigrate = (test: string, alter: string) => {
  try { db.prepare(test).get(); } catch { db.exec(alter); }
};
tryMigrate("SELECT description FROM expenses LIMIT 1",  "ALTER TABLE expenses ADD COLUMN description TEXT");
tryMigrate("SELECT notes FROM expenses LIMIT 1",         "ALTER TABLE expenses ADD COLUMN notes TEXT");
tryMigrate("SELECT created_by FROM expenses LIMIT 1",    "ALTER TABLE expenses ADD COLUMN created_by TEXT");
tryMigrate("SELECT recurring_id FROM expenses LIMIT 1",  "ALTER TABLE expenses ADD COLUMN recurring_id TEXT");
tryMigrate("SELECT recurring_income_id FROM incomes LIMIT 1", "ALTER TABLE incomes ADD COLUMN recurring_income_id TEXT");
tryMigrate("SELECT created_by FROM incomes LIMIT 1",          "ALTER TABLE incomes ADD COLUMN created_by TEXT");

// Key/value store for one-time maintenance flags.
db.exec("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);");

// Índices para as consultas que o app realmente faz: listagem por vencimento /
// data, os filtros por mês e as buscas por template de recorrência (usadas na
// materialização mensal e na deduplicação que roda a cada start).
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_expenses_due_date       ON expenses (due_date);
  CREATE INDEX IF NOT EXISTS idx_expenses_recurring      ON expenses (recurring_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_category       ON expenses (category_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_responsible    ON expenses (responsible_id);
  CREATE INDEX IF NOT EXISTS idx_incomes_date            ON incomes (date);
  CREATE INDEX IF NOT EXISTS idx_incomes_recurring       ON incomes (recurring_income_id);
  CREATE INDEX IF NOT EXISTS idx_budgets_month           ON budgets (month);
  CREATE INDEX IF NOT EXISTS idx_recurring_skips_lookup  ON recurring_skips (recurring_id, month);
`);

// One-time cleanup of duplicate rows. A duplicate = same description + due_date +
// value + responsible (expenses) / description + date + value + type (incomes).
// We keep one row per group, preferring the paid one, then the earliest.
function runDedupOnce() {
  const done = db.prepare("SELECT value FROM app_meta WHERE key = 'dedup_v1'").get();
  if (done) return;
  db.transaction(() => {
    db.exec(`
      DELETE FROM expenses WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY description, due_date, value, COALESCE(responsible_id, '')
            ORDER BY paid DESC, created_at ASC, rowid ASC
          ) AS rn FROM expenses
        ) WHERE rn > 1
      );
      DELETE FROM incomes WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY description, date, value, type
            ORDER BY rowid ASC
          ) AS rn FROM incomes
        ) WHERE rn > 1
      );
    `);
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('dedup_v1', datetime('now'))").run();
  })();
}
runDedupOnce();

// Remove exact duplicate recurring occurrences — same template, due date,
// value, description and responsible. A past frontend bug let the "mark as
// paid" button on the upcoming-expenses screen create such copies. Keeps the
// paid one, then the deterministic `rec_<template>_<month>` id, then the
// oldest. Runs on every start: it's cheap, idempotent, and old clients may
// still push queued copies after the one-time flag would have been consumed.
function dedupRecurringOccurrences() {
  db.exec(`
    DELETE FROM expenses WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY recurring_id, due_date, value,
                       COALESCE(description, ''), COALESCE(responsible_id, '')
          ORDER BY paid DESC,
                   (CASE WHEN id LIKE 'rec\\_%' ESCAPE '\\' THEN 0 ELSE 1 END),
                   created_at ASC, rowid ASC
        ) AS rn
        FROM expenses
        WHERE recurring_id IS NOT NULL AND recurring_id != ''
      ) WHERE rn > 1
    );
  `);
}
dedupRecurringOccurrences();


// Whitelist of allowed columns per table — prevents SQL injection via sync
const ALLOWED_COLUMNS: Record<string, string[]> = {
  expenses:            ["id", "category_id", "description", "date", "due_date", "value", "responsible_id", "paid", "notes", "created_by", "recurring_id"],
  categories:          ["id", "name", "color"],
  responsibles:        ["id", "name", "photo"],
  budgets:             ["id", "category_id", "month", "limit_value"],
  recurring_expenses:  ["id", "category_id", "description", "value", "responsible_id", "day_of_month", "active"],
  incomes:             ["id", "description", "value", "date", "type", "responsible_id", "notes", "recurring", "recurring_income_id", "created_by"],
  income_types:        ["id", "name", "color"],
  recurring_incomes:   ["id", "description", "value", "type", "responsible_id", "day_of_month", "active"],
  recurring_skips:     ["id", "recurring_id", "month"],
  notes:               ["id", "title", "content", "updated_at"],
};

// Safe upsert: only uses whitelisted columns.
// Columns are resolved PER ITEM: JSON omits undefined fields, so items in the
// same batch can have different key sets — deriving columns from the first item
// silently dropped fields (notes, recurring_id…) from every other row.
function syncItems(table: string, items: unknown[]) {
  if (!items?.length) return;
  const allowed = ALLOWED_COLUMNS[table];
  if (!allowed) throw new Error(`Invalid table: ${table}`);

  const stmtCache = new Map<string, ReturnType<typeof db.prepare>>();

  db.transaction((data: unknown[]) => {
    for (const item of data) {
      const row = item as Record<string, unknown>;
      const cols = allowed.filter(col => Object.prototype.hasOwnProperty.call(row, col));
      if (!cols.includes("id")) throw new Error("Missing id field");

      const key = cols.join(",");
      let stmt = stmtCache.get(key);
      if (!stmt) {
        const placeholders = cols.map(() => "?").join(",");
        stmt = db.prepare(`REPLACE INTO ${table} (${key}) VALUES (${placeholders})`);
        stmtCache.set(key, stmt);
      }

      stmt.run(cols.map(col => {
        const v = row[col] ?? null;
        // Empty foreign-key strings would violate FK constraints — store NULL.
        return (v === "" && col.endsWith("_id")) ? null : v;
      }));
    }
  })(items);
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: "*" } });

  app.use(express.json({ limit: "10mb" }));

  // ── Acesso por senha (opcional) ─────────────────────────────────────────────
  // Ativado apenas quando APP_PASSWORD está definida. Sem ela o app funciona
  // como sempre — é o que garante que ninguém fique trancado para fora por
  // engano. O aparelho manda o SHA-256 da senha, nunca a senha em si.
  const APP_PASSWORD = process.env.APP_PASSWORD?.trim();
  const expectedToken = APP_PASSWORD
    ? createHash("sha256").update(APP_PASSWORD).digest("hex")
    : null;

  if (expectedToken) {
    console.log("[auth] Acesso protegido por senha (APP_PASSWORD definida).");

    // Bloqueio contra força bruta: uma senha curta (um PIN, por exemplo) seria
    // testável por completo em minutos sem isto.
    const MAX_TENTATIVAS = 5;
    const BLOQUEIO_MS    = 15 * 60_000;
    const tentativas = new Map<string, { erros: number; ate: number }>();

    app.use("/api", (req, res, next) => {
      const ip = req.ip ?? "desconhecido";
      const reg = tentativas.get(ip);
      const agora = Date.now();

      if (reg && reg.ate > agora) {
        return res.status(429).json({ error: "Muitas tentativas. Tente de novo em 15 minutos." });
      }

      const token = String(req.header("x-app-token") ?? "");
      // timingSafeEqual exige o mesmo tamanho; o resumo tem tamanho fixo.
      const ok = token.length === expectedToken.length &&
        timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));

      if (!ok) {
        // Requisição SEM token é só "ainda não entrou" — é o que o app faz ao
        // abrir, para descobrir que existe senha. Contar isso como tentativa
        // bloquearia o usuário depois de algumas aberturas do app.
        if (token) {
          const erros = (reg && reg.ate > agora - BLOQUEIO_MS ? reg.erros : 0) + 1;
          tentativas.set(ip, { erros, ate: erros >= MAX_TENTATIVAS ? agora + BLOQUEIO_MS : agora });
        }
        return res.status(401).json({ error: "Senha necessária." });
      }

      tentativas.delete(ip);
      next();
    });
    io.use((socket, next) => {
      const token = String(socket.handshake.auth?.token ?? "");
      const ok = token.length === expectedToken.length &&
        timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
      next(ok ? undefined : new Error("unauthorized"));
    });
  } else {
    console.log("[auth] Sem senha configurada — acesso livre (defina APP_PASSWORD para proteger).");
  }

  // Lightweight health probe for Railway (and other PaaS) healthchecks.
  // Também informa onde o banco está e se ele é persistente — é assim que dá
  // para conferir, sem entrar no container, se o volume foi mesmo configurado.
  app.get("/health", (_req, res) => {
    let expenseCount: number | null = null;
    try {
      expenseCount = (db.prepare("SELECT COUNT(*) AS n FROM expenses").get() as { n: number }).n;
    } catch { /* banco indisponível — o status abaixo já denuncia */ }
    res.json({
      status: expenseCount === null ? "degraded" : "ok",
      database: {
        path: dbAbsolute,
        persistent: dbPersistent,
        journal_mode: String(db.pragma("journal_mode", { simple: true })),
        expenses: expenseCount,
      },
    });
  });

  // GET all data
  app.get("/api/data", (_req, res) => {
    const expenses     = db.prepare("SELECT * FROM expenses ORDER BY due_date DESC").all();
    const categories   = db.prepare("SELECT * FROM categories ORDER BY name").all();
    const responsibles = db.prepare("SELECT * FROM responsibles ORDER BY name").all();
    const profile      = db.prepare("SELECT * FROM user_profile WHERE id = 'default'").get()
                         ?? { id: "default", name: "Usuário", photo: null };
    const budgets      = db.prepare("SELECT * FROM budgets").all();
    const recurring    = db.prepare("SELECT * FROM recurring_expenses ORDER BY description").all();
    const incomes      = db.prepare("SELECT * FROM incomes ORDER BY date DESC").all();
    const incomeTypes  = db.prepare("SELECT * FROM income_types ORDER BY name").all();
    const recurringIncomes = db.prepare("SELECT * FROM recurring_incomes ORDER BY description").all();
    const recurringSkips = db.prepare("SELECT * FROM recurring_skips").all();
    const notes        = db.prepare("SELECT * FROM notes ORDER BY updated_at DESC").all();
    res.json({
      expenses, categories, responsibles, profile, budgets, recurring,
      incomes, incomeTypes, recurringIncomes, recurringSkips, notes,
      // Aqui existe Socket.IO: o cliente escuta `data_updated` em vez de fazer
      // polling (o backend serverless da Netlify responde `realtime: false`).
      meta: { realtime: true, storage: "sqlite" },
    });
  });

  // POST /api/sync — validated upsert of all client state
  app.post("/api/sync", (req, res) => {
    const { expenses, categories, responsibles, profile, budgets, recurring, incomes, incomeTypes, recurringIncomes, recurringSkips, notes } = req.body;
    try {
      if (categories?.length)       syncItems("categories",         categories);
      if (responsibles?.length)     syncItems("responsibles",       responsibles);
      if (expenses?.length)         syncItems("expenses",           expenses);
      if (budgets?.length)          syncItems("budgets",            budgets);
      if (recurring?.length)        syncItems("recurring_expenses", recurring);
      if (incomes?.length)          syncItems("incomes",            incomes);
      if (incomeTypes?.length)      syncItems("income_types",       incomeTypes);
      if (recurringIncomes?.length) syncItems("recurring_incomes",  recurringIncomes);
      if (recurringSkips?.length)   syncItems("recurring_skips",    recurringSkips);
      if (notes?.length)            syncItems("notes",              notes);

      if (profile && typeof profile === "object") {
        const p = profile as Record<string, unknown>;
        db.prepare("REPLACE INTO user_profile (id, name, photo) VALUES ('default', ?, ?)")
          .run(p.name ?? "Usuário", p.photo ?? null);
      }

      io.emit("data_updated");
      res.json({ success: true });
    } catch (err) {
      console.error("Sync error:", err);
      res.status(500).json({ error: "Erro ao sincronizar dados." });
    }
  });

  // Shared delete logic with referential-integrity guard.
  const VALID_DELETE_TABLES = ["expenses", "categories", "responsibles", "budgets", "recurring_expenses", "incomes", "income_types", "recurring_incomes", "notes"];

  function handleDelete(table: string, id: string, res: any) {
    if (!VALID_DELETE_TABLES.includes(table)) {
      return res.status(400).json({ error: "Tabela inválida." });
    }

    // Block deleting a category/responsible still referenced by an expense,
    // so the user is never left with silently orphaned data.
    if (table === "categories" || table === "responsibles") {
      const column = table === "categories" ? "category_id" : "responsible_id";
      const inUse = db.prepare(`SELECT 1 FROM expenses WHERE ${column} = ? LIMIT 1`).get(id);
      if (inUse) {
        const msg = table === "categories"
          ? "Não é possível excluir: categoria está sendo usada em uma despesa."
          : "Não é possível excluir: responsável está sendo usado em uma despesa.";
        return res.status(400).json({ error: msg });
      }
    }

    try {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      io.emit("data_updated");
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        res.status(400).json({ error: "Não é possível excluir: item está sendo usado em uma despesa." });
      } else {
        res.status(500).json({ error: "Erro ao excluir item." });
      }
    }
  }

  // DELETE /api/:table/:id
  app.delete("/api/:table/:id", (req, res) => handleDelete(req.params.table, req.params.id, res));

  // POST /api/delete/:table/:id — fallback for environments that block HTTP DELETE
  app.post("/api/delete/:table/:id", (req, res) => handleDelete(req.params.table, req.params.id, res));

  // Vite / static
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  // Railway (and most PaaS) inject the port to bind on via PORT.
  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  // Encerramento limpo: o Railway manda SIGTERM a cada novo deploy. Fechar o
  // banco faz o checkpoint do WAL antes de o container morrer.
  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} recebido — fechando banco.`);
    try { db.close(); } catch { /* já fechado */ }
    httpServer.close(() => process.exit(0));
    // Não deixa um socket pendurado segurar o processo indefinidamente.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

startServer();
