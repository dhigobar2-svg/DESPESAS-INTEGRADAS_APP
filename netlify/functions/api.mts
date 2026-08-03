// API do app rodando como função serverless na Netlify, com Postgres
// (Netlify DB) no lugar do SQLite. Espelha exatamente os endpoints de
// `server.ts` — `/api/data`, `/api/sync`, `/api/delete/:tabela/:id` e
// `/health` — para o frontend funcionar nos dois ambientes sem saber onde está.
//
// Diferença única: aqui não existe Socket.IO (serverless não mantém conexão
// aberta), então `/api/data` responde `meta.realtime: false` e o cliente passa
// a atualizar por polling em vez de escutar `data_updated`.
import { getDatabase } from "@netlify/database";
import { SCHEMA } from "../database/schema.mjs";

// Interface mínima de `pg` que usamos. Declarada aqui (em vez de importar os
// tipos do driver) para o roteamento poder ser testado com qualquer Postgres.
export interface DbClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(): void;
}
export interface DbPool {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  connect(): Promise<DbClient>;
}

// ─── Esquema ──────────────────────────────────────────────────────────────────
// Mesmo modelo do SQLite, definido em netlify/database/schema.mjs (o mesmo
// arquivo que o passo de build usa para validar o banco). Criado sob demanda
// aqui também, então a API funciona mesmo num deploy que pule o build.


// Colunas permitidas por tabela — a mesma whitelist do server.ts, e a única
// coisa que impede injeção de SQL via nomes de coluna vindos do cliente.
const ALLOWED_COLUMNS: Record<string, string[]> = {
  expenses:           ["id", "category_id", "description", "date", "due_date", "value", "responsible_id", "paid", "notes", "created_by", "recurring_id"],
  categories:         ["id", "name", "color"],
  responsibles:       ["id", "name", "photo"],
  budgets:            ["id", "category_id", "month", "limit_value"],
  recurring_expenses: ["id", "category_id", "description", "value", "responsible_id", "day_of_month", "active"],
  incomes:            ["id", "description", "value", "date", "type", "responsible_id", "notes", "recurring", "recurring_income_id", "created_by"],
  income_types:       ["id", "name", "color"],
  recurring_incomes:  ["id", "description", "value", "type", "responsible_id", "day_of_month", "active"],
  recurring_skips:    ["id", "recurring_id", "month"],
  notes:              ["id", "title", "content", "updated_at"],
};

const VALID_DELETE_TABLES = [
  "expenses", "categories", "responsibles", "budgets", "recurring_expenses",
  "incomes", "income_types", "recurring_incomes", "notes",
];

// Chave do payload de /api/sync → tabela no banco.
const TABLE_FOR_PAYLOAD: Record<string, string> = {
  categories: "categories", responsibles: "responsibles", expenses: "expenses",
  budgets: "budgets", recurring: "recurring_expenses", incomes: "incomes",
  incomeTypes: "income_types", recurringIncomes: "recurring_incomes",
  recurringSkips: "recurring_skips", notes: "notes",
};

// ─── Infra ────────────────────────────────────────────────────────────────────

let schemaReady: Promise<void> | null = null;

// Roda uma vez por instância fria da função.
export function ensureSchema(p: DbPool): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await p.connect();
      try {
        for (const stmt of SCHEMA) await client.query(stmt);
      } finally {
        client.release();
      }
    })().catch((err) => {
      schemaReady = null; // permite nova tentativa na próxima requisição
      throw err;
    });
  }
  return schemaReady;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

// ─── Upsert ───────────────────────────────────────────────────────────────────
// As colunas são resolvidas POR ITEM: o JSON omite campos indefinidos, então
// itens do mesmo lote podem ter conjuntos de chaves diferentes.

async function syncItems(client: DbClient, table: string, items: unknown[]) {
  if (!Array.isArray(items) || !items.length) return;
  const allowed = ALLOWED_COLUMNS[table];
  if (!allowed) throw new Error(`Tabela inválida: ${table}`);

  for (const item of items) {
    const row = item as Record<string, unknown>;
    const cols = allowed.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
    if (!cols.includes("id")) throw new Error("Item sem id");

    const values = cols.map((col) => {
      const v = row[col] ?? null;
      // Chave estrangeira vazia violaria a FK — guarda NULL.
      if (v === "" && col.endsWith("_id")) return null;
      // paid/active/recurring são INTEGER 0/1; um booleano quebraria no Postgres.
      if (typeof v === "boolean") return v ? 1 : 0;
      return v;
    });

    // budgets tem UNIQUE(category_id, month) e o app gera um id novo ao copiar
    // orçamentos de um mês para outro. O SQLite (REPLACE) trocava a linha; aqui
    // limpamos a linha conflitante antes para manter o mesmo comportamento.
    if (table === "budgets" && row.category_id && row.month) {
      await client.query(
        "DELETE FROM budgets WHERE category_id = $1 AND month = $2 AND id <> $3",
        [row.category_id, row.month, row.id],
      );
    }

    const quoted = cols.map((c) => `"${c}"`).join(", ");
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const updates = cols.filter((c) => c !== "id").map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
    await client.query(
      `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) ` +
      (updates ? `ON CONFLICT (id) DO UPDATE SET ${updates}` : "ON CONFLICT (id) DO NOTHING"),
      values,
    );
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function getData(p: DbPool) {
  const [
    expenses, categories, responsibles, profileRows, budgets,
    recurring, incomes, incomeTypes, recurringIncomes, recurringSkips, notes,
  ] = await Promise.all([
    p.query("SELECT * FROM expenses ORDER BY due_date DESC"),
    p.query("SELECT * FROM categories ORDER BY name"),
    p.query("SELECT * FROM responsibles ORDER BY name"),
    p.query("SELECT * FROM user_profile WHERE id = 'default'"),
    p.query("SELECT * FROM budgets"),
    p.query("SELECT * FROM recurring_expenses ORDER BY description"),
    p.query("SELECT * FROM incomes ORDER BY date DESC"),
    p.query("SELECT * FROM income_types ORDER BY name"),
    p.query("SELECT * FROM recurring_incomes ORDER BY description"),
    p.query("SELECT * FROM recurring_skips"),
    p.query("SELECT * FROM notes ORDER BY updated_at DESC"),
  ]);

  return json({
    expenses: expenses.rows,
    categories: categories.rows,
    responsibles: responsibles.rows,
    profile: profileRows.rows[0] ?? { id: "default", name: "Usuário", photo: null },
    budgets: budgets.rows,
    recurring: recurring.rows,
    incomes: incomes.rows,
    incomeTypes: incomeTypes.rows,
    recurringIncomes: recurringIncomes.rows,
    recurringSkips: recurringSkips.rows,
    notes: notes.rows,
    // Sem Socket.IO aqui: o cliente cai para polling.
    meta: { realtime: false, storage: "postgres" },
  });
}

async function postSync(p: DbPool, req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    // Categorias e responsáveis primeiro: despesas apontam para eles.
    for (const key of ["categories", "responsibles", "expenses", "budgets", "recurring",
                       "incomes", "incomeTypes", "recurringIncomes", "recurringSkips", "notes"]) {
      const items = body[key];
      if (Array.isArray(items) && items.length) {
        await syncItems(client, TABLE_FOR_PAYLOAD[key], items);
      }
    }

    const profile = body.profile as Record<string, unknown> | undefined;
    if (profile && typeof profile === "object") {
      await client.query(
        `INSERT INTO user_profile (id, name, photo) VALUES ('default', $1, $2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, photo = EXCLUDED.photo`,
        [profile.name ?? "Usuário", profile.photo ?? null],
      );
    }

    await client.query("COMMIT");
    return json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Sync error:", err);
    return json({ error: "Erro ao sincronizar dados." }, 500);
  } finally {
    client.release();
  }
}

async function handleDelete(p: DbPool, table: string, id: string) {
  if (!VALID_DELETE_TABLES.includes(table)) {
    return json({ error: "Tabela inválida." }, 400);
  }

  // Não deixa excluir categoria/responsável ainda usado por uma despesa — o
  // usuário não pode ficar com dados órfãos sem perceber.
  if (table === "categories" || table === "responsibles") {
    const column = table === "categories" ? "category_id" : "responsible_id";
    // `rows.length` e não `rowCount`: nem todo driver preenche o contador, e um
    // undefined aqui deixaria passar uma exclusão que devia ser bloqueada.
    const inUse = await p.query(`SELECT 1 FROM expenses WHERE ${column} = $1 LIMIT 1`, [id]);
    if (inUse.rows.length) {
      return json({
        error: table === "categories"
          ? "Não é possível excluir: categoria está sendo usada em uma despesa."
          : "Não é possível excluir: responsável está sendo usado em uma despesa.",
      }, 400);
    }
  }

  try {
    await p.query(`DELETE FROM "${table}" WHERE id = $1`, [id]);
    return json({ success: true });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23503") {
      return json({ error: "Não é possível excluir: item está sendo usado em uma despesa." }, 400);
    }
    console.error("Delete error:", err);
    return json({ error: "Erro ao excluir item." }, 500);
  }
}

async function getHealth(p: DbPool) {
  try {
    const { rows } = await p.query("SELECT COUNT(*)::int AS n FROM expenses");
    return json({
      status: "ok",
      database: { engine: "postgres", provider: "netlify-db", persistent: true, expenses: rows[0].n },
    });
  } catch (err) {
    console.error("Health error:", err);
    return json({ status: "degraded", database: { engine: "postgres", persistent: true, expenses: null } }, 503);
  }
}

// ─── Roteamento ───────────────────────────────────────────────────────────────

// Exportado para poder ser exercitado contra um Postgres de teste.
/**
 * Acesso por senha, ativado só quando APP_PASSWORD existe nas variáveis do
 * projeto. Sem ela nada muda. O aparelho envia o SHA-256 da senha no cabeçalho
 * `x-app-token` — a senha em si nunca sai do dispositivo nem fica gravada nele.
 */
const MAX_TENTATIVAS   = 5;
const BLOQUEIO_MINUTOS = 15;

/** Quem já errou demais fica de castigo — um PIN de 6 dígitos não sobrevive a
 *  força bruta sem isso. Registrado no banco porque cada requisição serverless
 *  pode cair numa instância diferente. */
async function bloqueado(p: DbPool, ip: string): Promise<boolean> {
  const { rows } = await p.query(
    "SELECT blocked_until FROM auth_attempts WHERE ip = $1 AND blocked_until > NOW()", [ip],
  );
  return rows.length > 0;
}

async function registrarFalha(p: DbPool, ip: string): Promise<void> {
  await p.query(
    `INSERT INTO auth_attempts (ip, tries, updated_at) VALUES ($1, 1, NOW())
     ON CONFLICT (ip) DO UPDATE SET
       tries = CASE WHEN auth_attempts.updated_at < NOW() - INTERVAL '${BLOQUEIO_MINUTOS} minutes'
                    THEN 1 ELSE auth_attempts.tries + 1 END,
       blocked_until = CASE WHEN auth_attempts.tries + 1 >= ${MAX_TENTATIVAS}
                    THEN NOW() + INTERVAL '${BLOQUEIO_MINUTOS} minutes' ELSE NULL END,
       updated_at = NOW()`,
    [ip],
  );
}

async function limparFalhas(p: DbPool, ip: string): Promise<void> {
  await p.query("DELETE FROM auth_attempts WHERE ip = $1", [ip]);
}

async function checkAuth(req: Request): Promise<boolean> {
  const senha = (globalThis as { Netlify?: { env: { get(k: string): string | undefined } } })
    .Netlify?.env.get("APP_PASSWORD")?.trim();
  if (!senha) return true; // sem senha configurada: acesso livre

  const bytes = new TextEncoder().encode(senha);
  const hash  = await crypto.subtle.digest("SHA-256", bytes);
  const esperado = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  const recebido = req.headers.get("x-app-token") ?? "";
  if (recebido.length !== esperado.length) return false;
  // Comparação de tempo constante.
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

export async function handleRequest(p: DbPool, req: Request): Promise<Response> {
  // A requisição chega redirecionada (/api/x → /.netlify/functions/api/x); os
  // dois prefixos são aceitos para a função também responder quando chamada direto.
  const path = new URL(req.url).pathname
    .replace(/^\/\.netlify\/functions\/api/, "")
    .replace(/^\/api/, "")
    .replace(/\/$/, "") || "/";

  try {
    await ensureSchema(p);

    // /health continua público (é usado como sonda de disponibilidade).
    const publico = path === "/health" || path === "/";
    if (!publico) {
      const ip = req.headers.get("x-nf-client-connection-ip")
        ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        ?? "desconhecido";

      if (await bloqueado(p, ip)) {
        return json({ error: `Muitas tentativas. Tente de novo em ${BLOQUEIO_MINUTOS} minutos.` }, 429);
      }
      if (!(await checkAuth(req))) {
        // Só penaliza quem apresentou um token ERRADO. Requisição sem token
        // nenhum é o app perguntando se existe senha — não é tentativa.
        if (req.headers.get("x-app-token")) await registrarFalha(p, ip);
        return json({ error: "Senha necessária." }, 401);
      }
      await limparFalhas(p, ip);
    }

    if (req.method === "GET" && path === "/data") return await getData(p);
    if (req.method === "GET" && (path === "/health" || path === "/")) return await getHealth(p);
    if (req.method === "POST" && path === "/sync") return await postSync(p, req);

    // POST /delete/:tabela/:id (usado pelo frontend) e DELETE /:tabela/:id.
    const del = path.match(/^\/delete\/([^/]+)\/(.+)$/);
    if (req.method === "POST" && del) return await handleDelete(p, del[1], decodeURIComponent(del[2]));

    const direct = path.match(/^\/([^/]+)\/(.+)$/);
    if (req.method === "DELETE" && direct) return await handleDelete(p, direct[1], decodeURIComponent(direct[2]));

    return json({ error: "Rota não encontrada." }, 404);
  } catch (err) {
    console.error("Erro na API:", err);
    return json({ error: "Erro interno no servidor." }, 500);
  }
}

export default async (req: Request) => {
  const p = getDatabase().pool as unknown as DbPool;
  return handleRequest(p, req);
};

// Sem `config.path` de propósito: a função fica no endpoint padrão
// (/.netlify/functions/api/*) e o roteamento público vem dos redirects do
// netlify.toml, que preservam /api/* e /health e mandam o resto para o SPA.
// Declarar um path fixo aqui faria os subcaminhos (/data, /sync…) deixarem de casar.
