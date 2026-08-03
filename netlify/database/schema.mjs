// Esquema do banco em Postgres — fonte única, usada em dois lugares:
//   • netlify/functions/api.mts  (garante as tabelas na instância fria)
//   • scripts/check-db.mjs       (aplica e valida o banco durante o build)
// Toda instrução é idempotente, então rodar de novo nunca quebra nem apaga nada.

export const SCHEMA = [

  `CREATE TABLE IF NOT EXISTS categories (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS responsibles (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, photo TEXT)`,

  `CREATE TABLE IF NOT EXISTS expenses (
     id TEXT PRIMARY KEY,
     category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
     description TEXT,
     date TEXT NOT NULL,
     due_date TEXT NOT NULL,
     value DOUBLE PRECISION NOT NULL,
     responsible_id TEXT REFERENCES responsibles(id) ON DELETE SET NULL,
     paid INTEGER DEFAULT 0,
     notes TEXT,
     created_by TEXT,
     recurring_id TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW())`,

  `CREATE TABLE IF NOT EXISTS user_profile (
     id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Usuário', photo TEXT)`,

  `CREATE TABLE IF NOT EXISTS budgets (
     id TEXT PRIMARY KEY,
     category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
     month TEXT NOT NULL,
     limit_value DOUBLE PRECISION NOT NULL,
     UNIQUE (category_id, month))`,

  `CREATE TABLE IF NOT EXISTS recurring_expenses (
     id TEXT PRIMARY KEY,
     category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
     description TEXT NOT NULL,
     value DOUBLE PRECISION NOT NULL,
     responsible_id TEXT REFERENCES responsibles(id) ON DELETE SET NULL,
     day_of_month INTEGER NOT NULL,
     active INTEGER DEFAULT 1)`,

  `CREATE TABLE IF NOT EXISTS incomes (
     id TEXT PRIMARY KEY,
     description TEXT NOT NULL,
     value DOUBLE PRECISION NOT NULL,
     date TEXT NOT NULL,
     type TEXT DEFAULT 'outro',
     responsible_id TEXT REFERENCES responsibles(id) ON DELETE SET NULL,
     notes TEXT,
     recurring INTEGER DEFAULT 0,
     recurring_income_id TEXT)`,

  `CREATE TABLE IF NOT EXISTS income_types (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS recurring_incomes (
     id TEXT PRIMARY KEY,
     description TEXT NOT NULL,
     value DOUBLE PRECISION NOT NULL,
     type TEXT DEFAULT 'outro',
     responsible_id TEXT REFERENCES responsibles(id) ON DELETE SET NULL,
     day_of_month INTEGER NOT NULL,
     active INTEGER DEFAULT 1)`,

  `CREATE TABLE IF NOT EXISTS recurring_skips (
     id TEXT PRIMARY KEY, recurring_id TEXT NOT NULL, month TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS notes (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL DEFAULT '',
     content TEXT NOT NULL DEFAULT '',
     updated_at TEXT NOT NULL)`,

  // Recorrência além do mensal (colunas adicionadas depois).
  `ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS frequency TEXT`,
  `ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS interval_n INTEGER`,
  `ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS start_date TEXT`,
  `ALTER TABLE recurring_incomes  ADD COLUMN IF NOT EXISTS frequency TEXT`,
  `ALTER TABLE recurring_incomes  ADD COLUMN IF NOT EXISTS interval_n INTEGER`,
  `ALTER TABLE recurring_incomes  ADD COLUMN IF NOT EXISTS start_date TEXT`,

  // Compras parceladas (colunas adicionadas depois).
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS installment_id TEXT`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS installment_no INTEGER`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS installment_total INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_installment ON expenses (installment_id)`,

  // Coluna adicionada depois: quem lançou a entrada.
  `ALTER TABLE incomes ADD COLUMN IF NOT EXISTS created_by TEXT`,

  // Controle de edição simultânea: carimbo ISO (UTC) da última edição, gravado
  // pelo cliente. O sync recusa escrita mais antiga que a versão guardada.
  ...["expenses", "categories", "responsibles", "budgets", "recurring_expenses",
      "incomes", "income_types", "recurring_incomes", "user_profile"]
    .map((t) => `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS updated_at TEXT`),

  // Tentativas de senha por origem — sustenta o bloqueio contra força bruta.
  `CREATE TABLE IF NOT EXISTS auth_attempts (
     ip TEXT PRIMARY KEY,
     tries INTEGER NOT NULL DEFAULT 0,
     blocked_until TIMESTAMPTZ,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,

  // Índices das consultas que o app realmente faz.
  `CREATE INDEX IF NOT EXISTS idx_expenses_due_date      ON expenses (due_date)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_recurring     ON expenses (recurring_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_category      ON expenses (category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_responsible   ON expenses (responsible_id)`,
  `CREATE INDEX IF NOT EXISTS idx_incomes_date           ON incomes (date)`,
  `CREATE INDEX IF NOT EXISTS idx_incomes_recurring      ON incomes (recurring_income_id)`,
  `CREATE INDEX IF NOT EXISTS idx_budgets_month          ON budgets (month)`,
  `CREATE INDEX IF NOT EXISTS idx_recurring_skips_lookup ON recurring_skips (recurring_id, month)`,

  // Sementes padrão (mesmas do SQLite).
  `INSERT INTO categories (id, name, color) VALUES
     ('1','Alimentação','#ef4444'), ('2','Transporte','#3b82f6'),
     ('3','Lazer','#10b981'),       ('4','Moradia','#f59e0b')
   ON CONFLICT (id) DO NOTHING`,

  `INSERT INTO income_types (id, name, color) VALUES
     ('salario','Salário','#3b82f6'), ('renda_extra','Renda Extra','#10b981'),
     ('outro','Outro','#64748b')
   ON CONFLICT (id) DO NOTHING`,

  `INSERT INTO user_profile (id, name) VALUES ('default','Usuário')
   ON CONFLICT (id) DO NOTHING`,
];
