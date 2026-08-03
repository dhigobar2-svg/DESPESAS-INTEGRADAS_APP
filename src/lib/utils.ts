import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Expense, RecurringExpense, Income, RecurringIncome } from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Whether a recurring template is already materialised by a real expense for a
 * given month. Prefers the stable `recurring_id` link (robust to the user later
 * editing the generated expense's value/description), and falls back to the
 * legacy description+due_date+value heuristic for pre-existing rows.
 */
export function isRecurringCovered(
  expenses: Expense[],
  rec: RecurringExpense,
  dueDate: string,
  opts: { unpaidOnly?: boolean; skips?: Set<string> } = {},
): boolean {
  // Semanal tem várias ocorrências no mesmo mês, então a comparação precisa ser
  // pela data exata. Mensal e anual seguem comparando por mês — é o que faz os
  // lançamentos antigos (e os editados à mão pelo usuário) continuarem valendo.
  const chave = chaveOcorrencia(rec, dueDate);
  const porData = (rec.frequency ?? "monthly") === "weekly";

  // A user-deleted occurrence is treated as covered so it isn't regenerated.
  if (opts.skips?.has(`${rec.id}_${chave}`)) return true;
  return expenses.some(e => {
    if (opts.unpaidOnly && e.paid) return false;
    if (e.recurring_id && e.recurring_id === rec.id) {
      if (porData ? e.due_date === dueDate : e.due_date?.slice(0, 7) === chave) return true;
    }
    return e.description === rec.description && e.due_date === dueDate && e.value === rec.value;
  });
}

// ─── Motor de recorrência ─────────────────────────────────────────────────────
// Até aqui só existia "todo mês no dia X". Agora a regra pode ser semanal,
// mensal ou anual, a cada N períodos — o que cobre feira semanal, conta
// bimestral e IPVA/IPTU/seguro anuais.

/** Regra de repetição — o que os templates de despesa e de entrada têm em comum. */
export interface RegraRecorrencia {
  id: string;
  day_of_month: number;
  frequency?: "weekly" | "monthly" | "yearly";
  interval_n?: number;
  start_date?: string;
}

const emDias = (d: Date, dias: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias);

const paraISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const doISO = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
};

/**
 * Todas as datas em que a regra cai dentro de um mês.
 *
 * Mensal e anual dão no máximo uma data; semanal pode dar quatro ou cinco.
 * Sem `frequency` o comportamento é o de sempre (mensal, todo mês), para os
 * cadastros antigos continuarem funcionando exatamente igual.
 */
export function ocorrenciasNoMes(rec: RegraRecorrencia, ano: number, mes1: number): string[] {
  const freq = rec.frequency ?? "monthly";
  const n    = Math.max(1, rec.interval_n ?? 1);

  if (freq === "weekly") {
    if (!rec.start_date) return [];
    const passo    = 7 * n;
    const inicio   = new Date(ano, mes1 - 1, 1);
    const fim      = new Date(ano, mes1, 0);
    let d          = doISO(rec.start_date);
    // Salta direto para perto do mês em vez de somar semana a semana.
    const faltam = Math.floor((inicio.getTime() - d.getTime()) / 86_400_000);
    if (faltam > 0) d = emDias(d, Math.floor(faltam / passo) * passo);
    while (d < inicio) d = emDias(d, passo);

    const datas: string[] = [];
    while (d <= fim) { datas.push(paraISO(d)); d = emDias(d, passo); }
    return datas;
  }

  if (freq === "yearly") {
    const mesAlvo = rec.start_date ? Number(rec.start_date.slice(5, 7)) : mes1;
    if (mesAlvo !== mes1) return [];
    if (rec.start_date) {
      const anoInicio = Number(rec.start_date.slice(0, 4));
      if (ano < anoInicio || (ano - anoInicio) % n !== 0) return [];
    }
    return [recurringDueDate(ano, mes1, rec.day_of_month)];
  }

  // Mensal: com intervalo > 1 (bimestral, trimestral…) só nos meses do ciclo.
  if (n > 1 && rec.start_date) {
    const anoInicio = Number(rec.start_date.slice(0, 4));
    const mesInicio = Number(rec.start_date.slice(5, 7));
    const passados  = (ano - anoInicio) * 12 + (mes1 - mesInicio);
    if (passados < 0 || passados % n !== 0) return [];
  }
  return [recurringDueDate(ano, mes1, rec.day_of_month)];
}

/**
 * Chave que identifica UMA ocorrência (usada no id gerado, nos "pulos" e na
 * checagem de cobertura). Semanal precisa da data inteira porque há várias no
 * mesmo mês; nos demais casos continua sendo o mês — assim os lançamentos já
 * existentes seguem sendo reconhecidos.
 */
export function chaveOcorrencia(rec: RegraRecorrencia, dataISO: string): string {
  return (rec.frequency ?? "monthly") === "weekly" ? dataISO : dataISO.slice(0, 7);
}

/** Rótulo curto da frequência, para a interface. */
export function rotuloFrequencia(rec: RegraRecorrencia): string {
  const n = Math.max(1, rec.interval_n ?? 1);
  switch (rec.frequency ?? "monthly") {
    case "weekly": return n === 1 ? "Semanal" : n === 2 ? "Quinzenal" : `A cada ${n} semanas`;
    case "yearly": return n === 1 ? "Anual" : `A cada ${n} anos`;
    default:       return n === 1 ? "Mensal"
                        : n === 2 ? "Bimestral"
                        : n === 3 ? "Trimestral"
                        : n === 6 ? "Semestral"
                        : `A cada ${n} meses`;
  }
}

/** Set of skipped "recurring_id_month" keys, for fast lookup. */
export function buildSkipSet(skips: { recurring_id: string; month: string }[]): Set<string> {
  return new Set(skips.map(s => `${s.recurring_id}_${s.month}`));
}

/**
 * Ids of exact duplicate recurring occurrences (same template, due date, value,
 * description and responsible). Keeps one row per group — preferring the paid
 * one, then the deterministic `rec_<template>_<month>` id, then the oldest —
 * and returns the ids of the redundant copies so they can be deleted.
 */
export function findRecurringDuplicates(expenses: Expense[]): Set<string> {
  const groups = new Map<string, Expense[]>();
  for (const e of expenses) {
    if (!e.recurring_id) continue;
    const key = [e.recurring_id, e.due_date, e.value, e.description ?? "", e.responsible_id ?? ""].join("|");
    const list = groups.get(key);
    if (list) list.push(e); else groups.set(key, [e]);
  }
  const dupes = new Set<string>();
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) =>
      (b.paid ? 1 : 0) - (a.paid ? 1 : 0) ||
      Number(!a.id.startsWith("rec_")) - Number(!b.id.startsWith("rec_")) ||
      (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
      a.id.localeCompare(b.id));
    for (const extra of sorted.slice(1)) dupes.add(extra.id);
  }
  return dupes;
}

/** Whether a recurring income template already has an instance in a given month. */
export function isRecurringIncomeCovered(
  incomes: Income[],
  rec: RecurringIncome,
  date: string,
): boolean {
  const porData = (rec.frequency ?? "monthly") === "weekly";
  const month   = date.slice(0, 7);
  return incomes.some(i => {
    if (i.recurring_income_id && i.recurring_income_id === rec.id) {
      if (porData ? i.date === date : i.date?.slice(0, 7) === month) return true;
    }
    // Semanal não usa o atalho por descrição: várias entradas iguais no mesmo
    // mês são o comportamento esperado, não duplicata.
    if (porData) return i.date === date &&
      i.description.toLowerCase() === rec.description.toLowerCase() && i.type === rec.type;
    return i.date?.slice(0, 7) === month &&
      i.description.toLowerCase() === rec.description.toLowerCase() &&
      i.type === rec.type;
  });
}

/** Number of days in a given month (`month1` is 1-based: 1 = January). */
export function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/**
 * Valid `yyyy-MM-dd` due date for a recurring `dayOfMonth` in a target month,
 * clamping days past the month's length to the last day (e.g. day 31 → 28 in
 * February, → 30 in April). This keeps end-of-month recurrences from silently
 * disappearing or producing invalid dates when the month rolls over.
 */
export function recurringDueDate(year: number, month1: number, dayOfMonth: number): string {
  const day = Math.min(Math.max(dayOfMonth, 1), lastDayOfMonth(year, month1));
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Rótulo curto de um mês `yyyy-MM` — "ago/2026". */
export function rotuloMes(mes: string): string {
  const NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const [ano, m] = mes.split("-").map(Number);
  return ano && m ? `${NOMES[m - 1]}/${ano}` : mes;
}

/**
 * SHA-256 em hexadecimal. Usado no acesso por senha: o aparelho guarda apenas
 * este resumo, nunca a senha em si, e é ele que viaja no cabeçalho das
 * requisições. O servidor compara com o resumo da senha configurada.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash  = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Divide um total em N parcelas sem perder centavos.
 *
 * R$ 100,00 em 3× não dá 33,33 três vezes (daria 99,99). As parcelas ficam
 * iguais e a diferença vai para a ÚLTIMA: 33,33 + 33,33 + 33,34.
 */
export function dividirParcelas(total: number, n: number): number[] {
  const centavos = Math.round(total * 100);
  const base     = Math.floor(centavos / n);
  const sobra    = centavos - base * n;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? base + sobra : base) / 100);
}

/**
 * Mesma data em meses seguintes, respeitando meses curtos: uma compra no dia 31
 * cai no dia 28/30 nos meses que não têm dia 31, em vez de virar o mês seguinte.
 */
export function somarMeses(dataISO: string, meses: number): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const alvo = new Date(ano, mes - 1 + meses, 1);
  return recurringDueDate(alvo.getFullYear(), alvo.getMonth() + 1, dia);
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Converte o que o usuário digitou em número, entendendo o jeito brasileiro.
 *
 * O campo antigo era `type="number"`, que só aceita ponto como separador
 * decimal: digitar "1234,56" fazia o navegador descartar a vírgula e gravar
 * 123456 — cem vezes o valor pretendido. Aqui a vírgula é o separador decimal
 * esperado, o ponto é aceito como decimal ou como milhar conforme a forma:
 *
 *   "1234,56"    → 1234.56
 *   "1.234,56"   → 1234.56   (ponto = milhar)
 *   "1.234"      → 1234      (padrão de milhar)
 *   "1.5"        → 1.5       (ponto = decimal)
 *   "R$ 89,90"   → 89.9
 *   ""           → undefined
 */
export function parseCurrency(raw: string): number | undefined {
  if (typeof raw !== "string") return undefined;
  let s = raw.replace(/[^\d.,-]/g, "").trim();
  if (!s || s === "-") return undefined;

  const hasComma = s.includes(",");
  const hasDot   = s.includes(".");

  if (hasComma && hasDot) {
    s = s.replace(/\./g, "").replace(",", ".");   // 1.234,56
  } else if (hasComma) {
    s = s.replace(",", ".");                       // 1234,56
  } else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");                      // 1.234 / 1.234.567
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100) / 100;
}

/** Compresses an image data URL to reduce storage size. */
export function compressImage(dataUrl: string, maxDim = 300, quality = 0.75): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
