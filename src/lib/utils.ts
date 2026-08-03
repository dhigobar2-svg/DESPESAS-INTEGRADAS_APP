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
  const month = dueDate.slice(0, 7);
  // A user-deleted occurrence is treated as covered so it isn't regenerated.
  if (opts.skips?.has(`${rec.id}_${month}`)) return true;
  return expenses.some(e => {
    if (opts.unpaidOnly && e.paid) return false;
    if (e.recurring_id && e.recurring_id === rec.id && e.due_date?.slice(0, 7) === month) return true;
    return e.description === rec.description && e.due_date === dueDate && e.value === rec.value;
  });
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
  const month = date.slice(0, 7);
  return incomes.some(i => {
    if (i.recurring_income_id && i.recurring_income_id === rec.id && i.date?.slice(0, 7) === month) return true;
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
