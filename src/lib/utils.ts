import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Expense, RecurringExpense } from "../types";

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
  opts: { unpaidOnly?: boolean } = {},
): boolean {
  const month = dueDate.slice(0, 7);
  return expenses.some(e => {
    if (opts.unpaidOnly && e.paid) return false;
    if (e.recurring_id && e.recurring_id === rec.id && e.due_date?.slice(0, 7) === month) return true;
    return e.description === rec.description && e.due_date === dueDate && e.value === rec.value;
  });
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
