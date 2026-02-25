import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("expenses.db");

// Enable foreign keys
db.exec("PRAGMA foreign_keys = ON;");

// Initialize Database
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY(responsible_id) REFERENCES responsibles(id) ON DELETE SET NULL
  );

  -- Insert default categories if empty
  INSERT OR IGNORE INTO categories (id, name, color) VALUES 
    ('1', 'Alimentação', '#ef4444'),
    ('2', 'Transporte', '#3b82f6'),
    ('3', 'Lazer', '#10b981'),
    ('4', 'Moradia', '#f59e0b');
`);

// Migration: Add description column if it doesn't exist
try {
  db.prepare("SELECT description FROM expenses LIMIT 1").get();
} catch (e) {
  console.log("Adding description column to expenses table...");
  db.exec("ALTER TABLE expenses ADD COLUMN description TEXT");
}


async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get("/api/data", (req, res) => {
    const expenses = db.prepare("SELECT * FROM expenses ORDER BY due_date DESC").all();
    const categories = db.prepare("SELECT * FROM categories").all();
    const responsibles = db.prepare("SELECT * FROM responsibles").all();
    res.json({ expenses, categories, responsibles });
  });

  app.post("/api/sync", (req, res) => {
    const { expenses, categories, responsibles } = req.body;

    const syncItems = (table: string, items: any[]) => {
      if (!items) return;
      const insert = db.prepare(`REPLACE INTO ${table} (${Object.keys(items[0]).join(',')}) VALUES (${Object.keys(items[0]).map(() => '?').join(',')})`);
      const transaction = db.transaction((data) => {
        for (const item of data) insert.run(Object.values(item));
      });
      transaction(items);
    };

    if (categories?.length) syncItems('categories', categories);
    if (responsibles?.length) syncItems('responsibles', responsibles);
    if (expenses?.length) syncItems('expenses', expenses);

    io.emit("data_updated");
    res.json({ success: true });
  });

  app.delete("/api/:table/:id", (req, res) => {
    const { table, id } = req.params;
    if (['expenses', 'categories', 'responsibles'].includes(table)) {
      try {
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        io.emit("data_updated");
        res.json({ success: true });
      } catch (err: any) {
        if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
          res.status(400).json({ error: "Não é possível excluir este item pois ele está sendo usado em uma despesa." });
        } else {
          res.status(500).json({ error: "Erro ao excluir item." });
        }
      }
    } else {
      res.status(400).json({ error: "Invalid table" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
