#!/usr/bin/env node
// Aplica o esquema no Postgres e confirma que ele responde — roda como parte do
// build na Netlify.
//
// Deixa as tabelas prontas antes da primeira requisição e registra no log do
// build se o Postgres está respondendo.
//
// **Nunca derruba o build de propósito.** A função também cria o esquema sob
// demanda (`ensureSchema`), então um problema aqui não impede o app de
// funcionar — e um portão que bloqueia todo deploy futuro sairia mais caro que
// o problema que detecta. O estado real do banco fica visível em /health.
//
// Fora da Netlify (dev local, Railway) não há Netlify DB: o script apenas sai.

import { getDatabase } from "@netlify/database";
import { SCHEMA } from "../netlify/database/schema.mjs";

const hasDatabaseUrl = Boolean(
  process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED,
);

if (!hasDatabaseUrl) {
  console.log(
    "[db] Sem NETLIFY_DATABASE_URL neste ambiente. " +
    "Em dev local/Railway isso é o esperado (SQLite via server.ts); " +
    "na Netlify, a função cria o esquema na primeira requisição.",
  );
  process.exit(0);
}

try {
  const db = getDatabase();
  const client = await db.pool.connect();
  try {
    for (const stmt of SCHEMA) await client.query(stmt);

    const { rows } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM categories)::int   AS categorias,
        (SELECT COUNT(*) FROM expenses)::int     AS despesas,
        (SELECT COUNT(*) FROM incomes)::int      AS entradas,
        (SELECT COUNT(*) FROM notes)::int        AS notas
    `);
    const r = rows[0];
    console.log(
      `[db] Postgres respondendo. Esquema aplicado. ` +
      `categorias=${r.categorias} despesas=${r.despesas} entradas=${r.entradas} notas=${r.notas}`,
    );
  } finally {
    client.release();
  }
  await db.pool.end?.();
} catch (err) {
  // Só registra: a função recria o esquema sob demanda, e falhar aqui deixaria
  // o site preso na versão anterior sem que ninguém veja o motivo.
  console.warn("[db] AVISO: não consegui preparar o banco durante o build:", err);
}
