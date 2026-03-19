import React, {
  createContext, useContext, useState, useEffect, useCallback,
  useRef, ReactNode,
} from "react";
import { io, Socket } from "socket.io-client";
import { format } from "date-fns";
import {
  Category, Responsible, Expense, UserProfile,
  Budget, RecurringExpense, ToastMessage,
} from "../types";
import { generateId, compressImage } from "../lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DataContextValue {
  // State
  expenses:     Expense[];
  categories:   Category[];
  responsibles: Responsible[];
  profile:      UserProfile;
  budgets:      Budget[];
  recurring:    RecurringExpense[];
  isOnline:     boolean;
  isConnected:  boolean;
  toasts:       ToastMessage[];

  // Handlers
  saveExpense:      (expense: Expense, isEdit: boolean) => void;
  deleteItem:       (table: string, id: string) => Promise<void>;
  togglePaid:       (id: string) => void;
  saveProfile:      (p: UserProfile) => Promise<void>;
  saveCategory:     (cat: Category, isEdit: boolean) => void;
  saveResponsible:  (resp: Responsible, isEdit: boolean) => void;
  saveBudget:       (budget: Budget) => void;
  saveRecurring:    (rec: RecurringExpense, isEdit: boolean) => void;
  readPhoto:        (file: File) => Promise<string>;
  addToast:         (type: ToastMessage["type"], message: string) => void;
  dismissToast:     (id: string) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside DataProvider");
  return ctx;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DataProvider({ children }: { children: ReactNode }) {
  const [expenses,     setExpenses]     = useState<Expense[]>([]);
  const [categories,   setCategories]   = useState<Category[]>([]);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [profile,      setProfile]      = useState<UserProfile>({ name: "Família" });
  const [budgets,      setBudgets]      = useState<Budget[]>([]);
  const [recurring,    setRecurring]    = useState<RecurringExpense[]>([]);
  const [isOnline,     setIsOnline]     = useState(navigator.onLine);
  const [isConnected,  setIsConnected]  = useState(false);
  const [toasts,       setToasts]       = useState<ToastMessage[]>([]);

  const socketRef        = useRef<Socket | null>(null);
  const recurringApplied = useRef(false);

  // ── Toast ────────────────────────────────────────────────────────────────────

  const addToast = useCallback((type: ToastMessage["type"], message: string) => {
    const id = generateId();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Sync ─────────────────────────────────────────────────────────────────────

  const syncWithServer = useCallback(async (data: {
    expenses?: Expense[];
    categories?: Category[];
    responsibles?: Responsible[];
    profile?: UserProfile;
    budgets?: Budget[];
    recurring?: RecurringExpense[];
  }) => {
    if (!navigator.onLine) return;
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch (err) {
      console.error("Sync failed", err);
    }
  }, []);

  // ── Auto-apply recurring expenses for current month ──────────────────────────

  const applyRecurring = useCallback((
    currentExpenses: Expense[],
    currentRecurring: RecurringExpense[],
  ): Expense[] => {
    const now = new Date();
    const monthStr = format(now, "yyyy-MM");
    const generated: Expense[] = [];

    for (const rec of currentRecurring) {
      if (!rec.active) continue;
      const dayPadded = String(rec.day_of_month).padStart(2, "0");
      const dueDate = `${monthStr}-${dayPadded}`;
      const alreadyExists = currentExpenses.some(
        e => e.description === rec.description && e.due_date === dueDate && e.value === rec.value,
      );
      if (!alreadyExists) {
        generated.push({
          id:             generateId(),
          category_id:    rec.category_id,
          description:    rec.description,
          date:           format(now, "yyyy-MM-dd"),
          due_date:       dueDate,
          value:          rec.value,
          responsible_id: rec.responsible_id,
          paid:           0,
        });
      }
    }
    return generated;
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/data");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      let exps: Expense[] = data.expenses ?? [];

      // Auto-apply recurring once per session
      if (!recurringApplied.current && data.recurring?.length) {
        recurringApplied.current = true;
        const newOnes = applyRecurring(exps, data.recurring);
        if (newOnes.length) {
          exps = [...exps, ...newOnes];
          syncWithServer({ expenses: exps });
        }
      }

      setExpenses(exps);
      setCategories(data.categories ?? []);
      setResponsibles(data.responsibles ?? []);
      if (data.profile) setProfile(data.profile);
      setBudgets(data.budgets ?? []);
      setRecurring(data.recurring ?? []);

      // Persist to localStorage for offline use
      lsSet("expenses",     exps);
      lsSet("categories",   data.categories);
      lsSet("responsibles", data.responsibles);
      lsSet("profile",      data.profile);
      lsSet("budgets",      data.budgets);
      lsSet("recurring",    data.recurring);
    } catch (err) {
      console.error("Fetch failed, using local data", err);
      setExpenses(    lsGet("expenses",     []));
      setCategories(  lsGet("categories",   []));
      setResponsibles(lsGet("responsibles", []));
      const p = lsGet<UserProfile | null>("profile", null);
      if (p) setProfile(p);
      setBudgets( lsGet("budgets",  []));
      setRecurring(lsGet("recurring", []));
    }
  }, [applyRecurring, syncWithServer]);

  // ── Socket + lifecycle ────────────────────────────────────────────────────────

  useEffect(() => {
    fetchData();

    const s = io({ reconnectionAttempts: 10 });
    socketRef.current = s;
    s.on("connect",      () => setIsConnected(true));
    s.on("disconnect",   () => setIsConnected(false));
    s.on("data_updated", fetchData);

    const onOnline  = () => { setIsOnline(true);  fetchData(); };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      s.disconnect();
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Photo helper ─────────────────────────────────────────────────────────────

  const readPhoto = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const compressed = await compressImage(reader.result as string, 300, 0.75);
        resolve(compressed);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  // ── CRUD handlers ─────────────────────────────────────────────────────────────

  const saveExpense = useCallback((expense: Expense, isEdit: boolean) => {
    setExpenses(prev => {
      const updated = isEdit
        ? prev.map(e => e.id === expense.id ? expense : e)
        : [...prev, expense];
      lsSet("expenses", updated);
      syncWithServer({ expenses: updated });
      return updated;
    });
    addToast("success", isEdit ? "Despesa atualizada!" : "Despesa adicionada!");
  }, [syncWithServer, addToast]);

  const deleteItem = useCallback(async (table: string, id: string) => {
    const snap = {
      expenses:     expenses,
      categories:   categories,
      responsibles: responsibles,
      budgets:      budgets,
      recurring:    recurring,
    };

    // Optimistic local removal
    if (table === "expenses") {
      setExpenses(p => { const u = p.filter(e => e.id !== id); lsSet("expenses", u); return u; });
    } else if (table === "categories") {
      setCategories(p => { const u = p.filter(c => c.id !== id); lsSet("categories", u); return u; });
    } else if (table === "responsibles") {
      setResponsibles(p => { const u = p.filter(r => r.id !== id); lsSet("responsibles", u); return u; });
    } else if (table === "budgets") {
      setBudgets(p => { const u = p.filter(b => b.id !== id); lsSet("budgets", u); return u; });
    } else if (table === "recurring_expenses") {
      setRecurring(p => { const u = p.filter(r => r.id !== id); lsSet("recurring", u); return u; });
    }

    if (!navigator.onLine) {
      addToast("info", "Exclusão salva localmente. Será sincronizada ao reconectar.");
      return;
    }

    try {
      const res = await fetch(`/api/delete/${table}/${id}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setExpenses(snap.expenses);
        setCategories(snap.categories);
        setResponsibles(snap.responsibles);
        setBudgets(snap.budgets);
        setRecurring(snap.recurring);
        addToast("error", data.error ?? "Erro ao excluir.");
      } else {
        addToast("success", "Item excluído.");
      }
    } catch {
      addToast("error", "Erro de conexão ao excluir.");
    }
  }, [expenses, categories, responsibles, budgets, recurring, addToast]);

  const togglePaid = useCallback((id: string) => {
    setExpenses(prev => {
      const updated = prev.map(e => e.id === id ? { ...e, paid: e.paid ? 0 : 1 } : e);
      lsSet("expenses", updated);
      syncWithServer({ expenses: updated });
      return updated;
    });
  }, [syncWithServer]);

  const saveProfile = useCallback(async (p: UserProfile) => {
    setProfile(p);
    lsSet("profile", p);
    await syncWithServer({ profile: p });
    addToast("success", "Perfil atualizado!");
  }, [syncWithServer, addToast]);

  const saveCategory = useCallback((cat: Category, isEdit: boolean) => {
    setCategories(prev => {
      const updated = isEdit
        ? prev.map(c => c.id === cat.id ? cat : c)
        : [...prev, cat];
      lsSet("categories", updated);
      syncWithServer({ categories: updated });
      return updated;
    });
    addToast("success", isEdit ? "Categoria atualizada!" : "Categoria adicionada!");
  }, [syncWithServer, addToast]);

  const saveResponsible = useCallback((resp: Responsible, isEdit: boolean) => {
    setResponsibles(prev => {
      const updated = isEdit
        ? prev.map(r => r.id === resp.id ? resp : r)
        : [...prev, resp];
      lsSet("responsibles", updated);
      syncWithServer({ responsibles: updated });
      return updated;
    });
    addToast("success", isEdit ? "Responsável atualizado!" : "Responsável adicionado!");
  }, [syncWithServer, addToast]);

  const saveBudget = useCallback((budget: Budget) => {
    setBudgets(prev => {
      const exists = prev.some(b => b.id === budget.id);
      const updated = exists ? prev.map(b => b.id === budget.id ? budget : b) : [...prev, budget];
      lsSet("budgets", updated);
      syncWithServer({ budgets: updated });
      return updated;
    });
    addToast("success", "Orçamento salvo!");
  }, [syncWithServer, addToast]);

  const saveRecurring = useCallback((rec: RecurringExpense, isEdit: boolean) => {
    setRecurring(prev => {
      const updated = isEdit
        ? prev.map(r => r.id === rec.id ? rec : r)
        : [...prev, rec];
      lsSet("recurring", updated);
      syncWithServer({ recurring: updated });
      return updated;
    });
    addToast("success", isEdit ? "Recorrente atualizado!" : "Recorrente adicionado!");
  }, [syncWithServer, addToast]);

  const value: DataContextValue = {
    expenses, categories, responsibles, profile, budgets, recurring,
    isOnline, isConnected, toasts,
    saveExpense, deleteItem, togglePaid, saveProfile,
    saveCategory, saveResponsible, saveBudget, saveRecurring,
    readPhoto, addToast, dismissToast,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
