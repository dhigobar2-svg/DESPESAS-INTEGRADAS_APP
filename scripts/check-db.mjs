#!/usr/bin/env node
// Aplica o esquema no Postgres e confirma que ele responde — roda como parte do
// build na Netlify.
//
// Serve a dois propósitos:
//   1. Deixar as tabelas prontas antes da primeira requisição de verdade.
//   2. Transformar "banco fora do ar" em falha de build, visível no painel, em
//      vez de virar um erro silencioso que o usuário só descobre como
//      "modo local — os dados ficam apenas neste dispositivo".
//
// Fora da Netlify (dev local, Railway) não há Netlify DB: o script apenas sai.

import { getDatabase } from "@netlify/database";
import { SCHEMA } from "../netlify/database/schema.mjs";

const onNetlify = process.env.NETLIFY === "true";
const hasDatabaseUrl = Boolean(
  process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED,
);

if (!hasDatabaseUrl) {
  if (onNetlify) {
    console.error(
      "[db] ERRO: build na Netlify sem banco provisionado (NETLIFY_DATABASE_URL ausente).\n" +
      "     O app subiria sem servidor e os dados ficariam presos no aparelho.",
    );
    process.exit(1);
  }
  console.log("[db] Sem Netlify DB neste ambiente — usando SQLite via server.ts. Nada a fazer.");
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
  console.error("[db] ERRO ao preparar o banco:", err);
  process.exit(1);
}
