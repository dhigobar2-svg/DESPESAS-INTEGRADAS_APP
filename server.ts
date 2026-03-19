import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("expenses.db");

db.exec("PRAGMA foreign_keys = ON;");

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

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    pin TEXT NOT NULL
  );

  INSERT OR IGNORE INTO categories (id, name, color) VALUES
    ('1', 'Alimentação', '#ef4444'),
    ('2', 'Transporte', '#3b82f6'),
    ('3', 'Lazer', '#10b981'),
    ('4', 'Moradia', '#f59e0b');

  INSERT OR IGNORE INTO user_profile (id, name) VALUES ('default', 'Usuário');
`);

// Migrations
const tryMigrate = (test: string, alter: string) => {
  try { db.prepare(test).get(); } catch { db.exec(alter); }
};
tryMigrate("SELECT description FROM expenses LIMIT 1",  "ALTER TABLE expenses ADD COLUMN description TEXT");
tryMigrate("SELECT notes FROM expenses LIMIT 1",         "ALTER TABLE expenses ADD COLUMN notes TEXT");
tryMigrate("SELECT created_by FROM expenses LIMIT 1",    "ALTER TABLE expenses ADD COLUMN created_by TEXT");

// Whitelist of allowed columns per table — prevents SQL injection via sync
const ALLOWED_COLUMNS: Record<string, string[]> = {
  expenses:            ["id", "category_id", "description", "date", "due_date", "value", "responsible_id", "paid", "notes", "created_by"],
  categories:          ["id", "name", "color"],
  responsibles:        ["id", "name", "photo"],
  budgets:             ["id", "category_id", "month", "limit_value"],
  recurring_expenses:  ["id", "category_id", "description", "value", "responsible_id", "day_of_month", "active"],
};

// Safe upsert: only uses whitelisted columns
function syncItems(table: string, items: unknown[]) {
  if (!items?.length) return;
  const allowed = ALLOWED_COLUMNS[table];
  if (!allowed) throw new Error(`Invalid table: ${table}`);

  const firstItem = items[0] as Record<string, unknown>;
  const cols = allowed.filter(col => Object.prototype.hasOwnProperty.call(firstItem, col));
  if (!cols.includes("id")) throw new Error("Missing id field");

  const placeholders = cols.map(() => "?").join(",");
  const stmt = db.prepare(`REPLACE INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`);

  db.transaction((data: unknown[]) => {
    for (const item of data) {
      const row = item as Record<string, unknown>;
      stmt.run(cols.map(col => row[col] ?? null));
    }
  })(items);
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: "*" } });

  app.use(express.json({ limit: "10mb" }));

  // GET all data
  app.get("/api/data", (_req, res) => {
    const expenses     = db.prepare("SELECT * FROM expenses ORDER BY due_date DESC").all();
    const categories   = db.prepare("SELECT * FROM categories ORDER BY name").all();
    const responsibles = db.prepare("SELECT * FROM responsibles ORDER BY name").all();
    const profile      = db.prepare("SELECT * FROM user_profile WHERE id = 'default'").get()
                         ?? { id: "default", name: "Usuário", photo: null };
    const budgets      = db.prepare("SELECT * FROM budgets").all();
    const recurring    = db.prepare("SELECT * FROM recurring_expenses ORDER BY description").all();
    const users        = db.prepare("SELECT id, name FROM users ORDER BY name").all();
    res.json({ expenses, categories, responsibles, profile, budgets, recurring, users });
  });

  // POST /api/sync — validated upsert of all client state
  app.post("/api/sync", (req, res) => {
    const { expenses, categories, responsibles, profile, budgets, recurring } = req.body;
    try {
      if (categories?.length)   syncItems("categories",         categories);
      if (responsibles?.length) syncItems("responsibles",       responsibles);
      if (expenses?.length)     syncItems("expenses",           expenses);
      if (budgets?.length)      syncItems("budgets",            budgets);
      if (recurring?.length)    syncItems("recurring_expenses", recurring);

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

  // DELETE /api/:table/:id
  app.delete("/api/:table/:id", (req, res) => {
    const { table, id } = req.params;
    const validTables = ["expenses", "categories", "responsibles", "budgets", "recurring_expenses"];
    if (!validTables.includes(table)) {
      return res.status(400).json({ error: "Tabela inválida." });
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
  });

  // POST /api/delete/:table/:id — fallback for environments that block HTTP DELETE
  app.post("/api/delete/:table/:id", (req, res) => {
    const { table, id } = req.params;
    const validTables = ["expenses", "categories", "responsibles", "budgets", "recurring_expenses"];
    if (!validTables.includes(table)) {
      return res.status(400).json({ error: "Tabela inválida." });
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
  });

  // PUT /api/categories/:id — inline editing
  app.put("/api/categories/:id", (req, res) => {
    const { id } = req.params;
    const { name, color } = req.body as { name?: string; color?: string };
    if (!name || !color) return res.status(400).json({ error: "Nome e cor são obrigatórios." });
    db.prepare("UPDATE categories SET name = ?, color = ? WHERE id = ?").run(name, color, id);
    io.emit("data_updated");
    res.json({ success: true });
  });

  // PUT /api/expenses/:id — full update
  app.put("/api/expenses/:id", (req, res) => {
    const { id } = req.params;
    const e = req.body as Record<string, unknown>;
    db.prepare(`
      UPDATE expenses
      SET category_id=?, description=?, date=?, due_date=?, value=?, responsible_id=?, paid=?, notes=?
      WHERE id=?
    `).run(e.category_id, e.description, e.date, e.due_date, e.value, e.responsible_id, e.paid, e.notes ?? null, id);
    io.emit("data_updated");
    res.json({ success: true });
  });

  // POST /api/users/register
  app.post("/api/users/register", (req, res) => {
    const { id, name, pin } = req.body as { id?: string; name?: string; pin?: string };
    if (!id || !name || !pin) return res.status(400).json({ error: "Dados inválidos." });
    const existing = db.prepare("SELECT id FROM users WHERE name = ?").get(name.trim());
    if (existing) return res.status(409).json({ error: "Já existe um usuário com esse nome." });
    db.prepare("INSERT INTO users (id, name, pin) VALUES (?, ?, ?)").run(id, name.trim(), pin);
    io.emit("data_updated");
    res.json({ success: true, user: { id, name: name.trim() } });
  });

  // POST /api/users/login
  app.post("/api/users/login", (req, res) => {
    const { name, pin } = req.body as { name?: string; pin?: string };
    if (!name || !pin) return res.status(400).json({ error: "Dados inválidos." });
    const user = db.prepare("SELECT id, name, pin FROM users WHERE name = ?").get(name.trim()) as any;
    if (!user || user.pin !== pin) return res.status(401).json({ error: "Nome ou PIN incorreto." });
    res.json({ success: true, user: { id: user.id, name: user.name } });
  });

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

  httpServer.listen(3000, "0.0.0.0", () => {
    console.log("Server running on http://localhost:3000");
  });
}

startServer();
