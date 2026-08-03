// Backup automático diário do banco.
//
// Gera o mesmo JSON do "Exportar backup" das Configurações e guarda no Netlify
// Blobs, com retenção. O formato idêntico é de propósito: restaurar usa o
// caminho já existente e testado do app (mescla por id, nunca apaga nada).
//
// O Netlify DB já tira snapshots próprios a cada publicação; isto aqui é o
// backup que VOCÊ controla — dá para listar, baixar e restaurar pelo app.
import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";

export const STORE_BACKUPS = "backups-despesas";
const MANTER_DIAS = 30;

/** Lê o banco inteiro no formato do backup manual. */
export async function montarBackup(pool: {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
}) {
  const q = async (sql: string) => (await pool.query(sql)).rows;
  const [
    expenses, categories, responsibles, profileRows, budgets,
    recurring, incomes, incomeTypes, recurringIncomes, recurringSkips, notes, cards,
  ] = await Promise.all([
    q("SELECT * FROM expenses"), q("SELECT * FROM categories"), q("SELECT * FROM responsibles"),
    q("SELECT * FROM user_profile WHERE id = 'default'"), q("SELECT * FROM budgets"),
    q("SELECT * FROM recurring_expenses"), q("SELECT * FROM incomes"), q("SELECT * FROM income_types"),
    q("SELECT * FROM recurring_incomes"), q("SELECT * FROM recurring_skips"), q("SELECT * FROM notes"),
    q("SELECT * FROM cards"),
  ]);

  return {
    app: "despesas-integradas",
    version: 1,
    exported_at: new Date().toISOString(),
    origem: "backup-automatico",
    profile: profileRows[0] ?? { id: "default", name: "Usuário" },
    expenses, categories, responsibles, budgets, recurring,
    incomes, incomeTypes, recurringIncomes, recurringSkips, notes, cards,
  };
}

export default async () => {
  const db = getDatabase();
  const pool = db.pool as unknown as { query(text: string): Promise<{ rows: Record<string, unknown>[] }> };
  const store = getStore(STORE_BACKUPS);

  const backup = await montarBackup(pool);
  const chave = `backup-${new Date().toISOString().slice(0, 10)}.json`;
  await store.setJSON(chave, backup);

  // Retenção: mantém os últimos MANTER_DIAS e descarta o resto.
  const { blobs } = await store.list();
  const antigos = blobs
    .map(b => b.key)
    .filter(k => k.startsWith("backup-"))
    .sort()
    .slice(0, -MANTER_DIAS);
  for (const k of antigos) await store.delete(k);

  console.log(
    `[backup] ${chave} gravado — ${backup.expenses.length} despesas, ` +
    `${backup.incomes.length} entradas. ${antigos.length} antigo(s) removido(s).`,
  );
};

export const config: Config = {
  schedule: "@daily",
};
