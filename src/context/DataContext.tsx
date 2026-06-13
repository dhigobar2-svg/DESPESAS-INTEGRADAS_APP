import React, {
  createContext, useContext, useState, useEffect, useCallback,
  useRef, ReactNode,
} from "react";
import { io, Socket } from "socket.io-client";
import { format } from "date-fns";
import {
  Category, Responsible, Expense, UserProfile,
  Budget, RecurringExpense, Income, IncomeType, ToastMessage, Note,
} from "../types";
import { generateId, compressImage, isRecurringCovered } from "../lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DataContextValue {
  // State
  expenses:     Expense[];
  categories:   Category[];
  responsibles: Responsible[];
  profile:      UserProfile;
  budgets:      Budget[];
  recurring:    RecurringExpense[];
  incomes:      Income[];
  incomeTypes:  IncomeType[];
  notes:        Note[];
  isOnline:     boolean;
  isConnected:  boolean;
  notificationsEnabled: boolean;
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
  saveIncome:       (inc: Income, isEdit: boolean) => void;
  saveIncomeType:   (it: IncomeType, isEdit: boolean) => void;
  saveNote:         (note: Note) => void;
  readPhoto:        (file: File) => Promise<string>;
  requestNotificationPermission: () => Promise<boolean>;
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
  const [incomes,      setIncomes]      = useState<Income[]>([]);
  const [incomeTypes,  setIncomeTypes]  = useState<IncomeType[]>([]);
  const [notes,        setNotes]        = useState<Note[]>([]);
  const [isOnline,     setIsOnline]     = useState(navigator.onLine);
  const [isConnected,  setIsConnected]  = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted",
  );
  const [toasts,       setToasts]       = useState<ToastMessage[]>([]);

  const socketRef             = useRef<Socket | null>(null);
  const recurringApplied      = useRef(false);
  const recurringIncomeApplied = useRef(false);
  const notifiedRef           = useRef(false);
  const firstSocketConnect    = useRef(true);

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
    incomes?: Income[];
    incomeTypes?: IncomeType[];
    notes?: Note[];
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

  // ── Offline reconciliation ────────────────────────────────────────────────────
  // Deletions can't go through /api/sync (which only upserts), so offline deletes
  // are queued and replayed on reconnect.

  const enqueueDelete = useCallback((table: string, id: string) => {
    const queue = lsGet<{ table: string; id: string }[]>("pendingDeletes", []);
    if (!queue.some(q => q.table === table && q.id === id)) {
      queue.push({ table, id });
      lsSet("pendingDeletes", queue);
    }
  }, []);

  const flushPendingDeletes = useCallback(async () => {
    const queue = lsGet<{ table: string; id: string }[]>("pendingDeletes", []);
    if (!queue.length) return;
    const remaining: { table: string; id: string }[] = [];
    for (const item of queue) {
      try {
        const res = await fetch(`/api/delete/${item.table}/${item.id}`, { method: "POST" });
        // Keep retrying only on server (5xx) errors; 2xx and 4xx are terminal.
        if (res.status >= 500) remaining.push(item);
      } catch {
        remaining.push(item); // network still down — retry next time
      }
    }
    lsSet("pendingDeletes", remaining);
  }, []);

  // Push everything we hold locally (idempotent upserts) so offline adds/edits
  // reach the server before we re-pull and reconcile.
  const pushLocalState = useCallback(async () => {
    await syncWithServer({
      expenses:     lsGet("expenses",     []),
      categories:   lsGet("categories",   []),
      responsibles: lsGet("responsibles", []),
      profile:      lsGet<UserProfile | undefined>("profile", undefined),
      budgets:      lsGet("budgets",      []),
      recurring:    lsGet("recurring",    []),
      incomes:      lsGet("incomes",      []),
      incomeTypes:  lsGet("incomeTypes",  []),
      notes:        lsGet("notes",        []),
    });
  }, [syncWithServer]);

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
      if (!isRecurringCovered(currentExpenses, rec, dueDate)) {
        generated.push({
          id:             generateId(),
          category_id:    rec.category_id,
          description:    rec.description,
          date:           format(now, "yyyy-MM-dd"),
          due_date:       dueDate,
          value:          rec.value,
          responsible_id: rec.responsible_id,
          paid:           0,
          recurring_id:   rec.id,
        });
      }
    }
    return generated;
  }, []);

  // ── Auto-apply recurring incomes for current month ───────────────────────────
  // An income flagged `recurring` acts as a template; each month a copy is
  // materialised (recurring=0) if one isn't already present.

  const applyRecurringIncomes = useCallback((current: Income[]): Income[] => {
    const monthStr = format(new Date(), "yyyy-MM");
    const generated: Income[] = [];

    for (const tpl of current) {
      if (!tpl.recurring) continue;
      const day = Math.min(parseInt(tpl.date?.slice(8, 10) || "1", 10) || 1, 28);
      const date = `${monthStr}-${String(day).padStart(2, "0")}`;

      const matches = (i: Income) =>
        i.date?.slice(0, 7) === monthStr &&
        i.description.toLowerCase() === tpl.description.toLowerCase() &&
        i.type === tpl.type;

      if (current.some(matches) || generated.some(matches)) continue;

      generated.push({
        id:             generateId(),
        description:    tpl.description,
        value:          tpl.value,
        date,
        type:           tpl.type,
        responsible_id: tpl.responsible_id,
        notes:          tpl.notes,
        recurring:      0,
      });
    }
    return generated;
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async (onSuccess?: () => void) => {
    try {
      const res = await fetch("/api/data");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      let exps: Expense[] = data.expenses ?? [];
      let incs: Income[]  = data.incomes ?? [];

      // Auto-apply recurring expenses once per session (sync only the new rows)
      if (!recurringApplied.current && data.recurring?.length) {
        recurringApplied.current = true;
        const newOnes = applyRecurring(exps, data.recurring);
        if (newOnes.length) {
          exps = [...exps, ...newOnes];
          syncWithServer({ expenses: newOnes });
        }
      }

      // Auto-apply recurring incomes once per session
      if (!recurringIncomeApplied.current && incs.some(i => i.recurring)) {
        recurringIncomeApplied.current = true;
        const newIncs = applyRecurringIncomes(incs);
        if (newIncs.length) {
          incs = [...incs, ...newIncs];
          syncWithServer({ incomes: newIncs });
        }
      }

      setExpenses(exps);
      setCategories(data.categories ?? []);
      setResponsibles(data.responsibles ?? []);
      if (data.profile) setProfile(data.profile);
      setBudgets(data.budgets ?? []);
      setRecurring(data.recurring ?? []);
      setIncomes(incs);
      setIncomeTypes(data.incomeTypes ?? []);
      setNotes(data.notes ?? []);

      // Persist to localStorage for offline use
      lsSet("expenses",     exps);
      lsSet("categories",   data.categories);
      lsSet("responsibles", data.responsibles);
      lsSet("profile",      data.profile);
      lsSet("budgets",      data.budgets);
      lsSet("recurring",    data.recurring);
      lsSet("incomes",      incs);
      lsSet("incomeTypes",  data.incomeTypes);
      lsSet("notes",        data.notes ?? []);

      onSuccess?.();
    } catch (err) {
      console.error("Fetch failed, using local data", err);
      setExpenses(    lsGet("expenses",     []));
      setCategories(  lsGet("categories",   []));
      setResponsibles(lsGet("responsibles", []));
      const p = lsGet<UserProfile | null>("profile", null);
      if (p) setProfile(p);
      setBudgets( lsGet("budgets",  []));
      setRecurring(lsGet("recurring", []));
      setIncomes(  lsGet("incomes",  []));
      setIncomeTypes(lsGet("incomeTypes", []));
      setNotes(    lsGet("notes",    []));
    }
  }, [applyRecurring, applyRecurringIncomes, syncWithServer]);

  // ── Browser notifications for upcoming/overdue expenses ──────────────────────

  useEffect(() => {
    if (notifiedRef.current || !expenses.length) return;
    // Never auto-prompt: only notify when the user has already granted permission
    // (requesting without a user gesture is blocked by Safari and others).
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    notifiedRef.current = true;

    const today  = new Date().toISOString().slice(0, 10);
    const in7    = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const overdue  = expenses.filter(e => !e.paid && e.due_date < today).length;
    const upcoming = expenses.filter(e => !e.paid && e.due_date >= today && e.due_date <= in7).length;

    if (overdue === 0 && upcoming === 0) return;

    const parts: string[] = [];
    if (overdue  > 0) parts.push(`${overdue} vencida${overdue  > 1 ? "s" : ""}`);
    if (upcoming > 0) parts.push(`${upcoming} vencem em até 7 dias`);

    try {
      new Notification("Despesas Integradas", {
        body: parts.join(" · "),
        icon: "/vite.svg",
        tag:  "despesas-alerta",
      });
    } catch { /* ignore */ }
  }, [expenses]);

  // Requested from a user gesture (Settings button), as browsers require.
  const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
    if (!("Notification" in window)) {
      addToast("error", "Seu navegador não suporta notificações.");
      return false;
    }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    const granted = perm === "granted";
    setNotificationsEnabled(granted);
    if (granted) {
      notifiedRef.current = false; // allow the next render to surface a summary
      addToast("success", "Notificações ativadas!");
    } else {
      addToast("info", "Permissão de notificações não concedida.");
    }
    return granted;
  }, [addToast]);

  // One-time migration of device-local notes (legacy "despesas_notes") to the
  // synced server store, so existing notes aren't lost.
  const migrateLegacyNotes = useCallback(() => {
    if (localStorage.getItem("notes_migrated")) return;
    localStorage.setItem("notes_migrated", "1");
    const legacy = lsGet<{ id?: string; title?: string; content?: string; updatedAt?: string }[]>("despesas_notes", []);
    if (!Array.isArray(legacy) || !legacy.length) return;
    const mapped: Note[] = legacy.map(n => ({
      id:         n.id ?? generateId(),
      title:      n.title ?? "",
      content:    n.content ?? "",
      updated_at: n.updatedAt ?? new Date().toISOString(),
    }));
    setNotes(prev => {
      const merged = [...mapped, ...prev.filter(p => !mapped.some(m => m.id === p.id))];
      lsSet("notes", merged);
      syncWithServer({ notes: merged });
      return merged;
    });
  }, [syncWithServer]);

  // ── Socket + lifecycle ────────────────────────────────────────────────────────

  useEffect(() => {
    fetchData(migrateLegacyNotes);

    const s = io({ reconnectionAttempts: 10 });
    socketRef.current = s;

    s.on("connect", () => {
      setIsConnected(true);
      if (!firstSocketConnect.current) {
        addToast("success", "Reconectado ao servidor.");
      }
      firstSocketConnect.current = false;
    });
    s.on("disconnect",   () => setIsConnected(false));
    s.on("data_updated", () => fetchData());

    // On reconnect: push local (offline adds/edits) and replay queued deletes
    // BEFORE re-pulling, otherwise the server snapshot would clobber them.
    const onOnline = async () => {
      setIsOnline(true);
      const hadPending = lsGet<unknown[]>("pendingDeletes", []).length > 0;
      await pushLocalState();
      await flushPendingDeletes();
      await fetchData();
      addToast("success", hadPending ? "Alterações offline sincronizadas!" : "Reconectado — dados sincronizados.");
    };
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
      return updated;
    });
    // Sync only the changed row so concurrent edits by other clients aren't clobbered.
    syncWithServer({ expenses: [expense] });
    addToast("success", isEdit ? "Despesa atualizada!" : "Despesa adicionada!");
  }, [syncWithServer, addToast]);

  const deleteItem = useCallback(async (table: string, id: string) => {
    const snap = {
      expenses:     expenses,
      categories:   categories,
      responsibles: responsibles,
      budgets:      budgets,
      recurring:    recurring,
      incomes:      incomes,
      incomeTypes:  incomeTypes,
      notes:        notes,
    };
    const rollback = () => {
      setExpenses(snap.expenses);
      setCategories(snap.categories);
      setResponsibles(snap.responsibles);
      setBudgets(snap.budgets);
      setRecurring(snap.recurring);
      setIncomes(snap.incomes);
      setIncomeTypes(snap.incomeTypes);
      setNotes(snap.notes);
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
    } else if (table === "incomes") {
      setIncomes(p => { const u = p.filter(i => i.id !== id); lsSet("incomes", u); return u; });
    } else if (table === "income_types") {
      setIncomeTypes(p => { const u = p.filter(it => it.id !== id); lsSet("incomeTypes", u); return u; });
    } else if (table === "notes") {
      setNotes(p => { const u = p.filter(n => n.id !== id); lsSet("notes", u); return u; });
    }

    if (!navigator.onLine) {
      enqueueDelete(table, id);
      addToast("info", "Exclusão salva localmente. Será sincronizada ao reconectar.");
      return;
    }

    try {
      const res = await fetch(`/api/delete/${table}/${id}`, { method: "POST" });
      if (!res.ok) {
        // Server reachable but refused (e.g. category in use) — roll back.
        const data = await res.json().catch(() => ({}));
        rollback();
        addToast("error", data.error ?? "Erro ao excluir.");
      } else {
        addToast("success", "Item excluído.");
      }
    } catch {
      // Network error: the request may or may not have reached the server.
      // Queue it for retry on reconnect (re-deleting is idempotent) and keep the
      // optimistic removal so the UI stays consistent with the user's intent.
      enqueueDelete(table, id);
    }
  }, [expenses, categories, responsibles, budgets, recurring, incomes, incomeTypes, notes, enqueueDelete, addToast]);

  const togglePaid = useCallback((id: string) => {
    setExpenses(prev => {
      const updated = prev.map(e => e.id === id ? { ...e, paid: e.paid ? 0 : 1 } : e);
      lsSet("expenses", updated);
      const changed = updated.find(e => e.id === id);
      if (changed) syncWithServer({ expenses: [changed] });
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
      return updated;
    });
    syncWithServer({ categories: [cat] });
    addToast("success", isEdit ? "Categoria atualizada!" : "Categoria adicionada!");
  }, [syncWithServer, addToast]);

  const saveResponsible = useCallback((resp: Responsible, isEdit: boolean) => {
    setResponsibles(prev => {
      const updated = isEdit
        ? prev.map(r => r.id === resp.id ? resp : r)
        : [...prev, resp];
      lsSet("responsibles", updated);
      return updated;
    });
    syncWithServer({ responsibles: [resp] });
    addToast("success", isEdit ? "Responsável atualizado!" : "Responsável adicionado!");
  }, [syncWithServer, addToast]);

  const saveBudget = useCallback((budget: Budget) => {
    setBudgets(prev => {
      const exists = prev.some(b => b.id === budget.id);
      const updated = exists ? prev.map(b => b.id === budget.id ? budget : b) : [...prev, budget];
      lsSet("budgets", updated);
      return updated;
    });
    syncWithServer({ budgets: [budget] });
    addToast("success", "Orçamento salvo!");
  }, [syncWithServer, addToast]);

  const saveRecurring = useCallback((rec: RecurringExpense, isEdit: boolean) => {
    setRecurring(prev => {
      const updated = isEdit
        ? prev.map(r => r.id === rec.id ? rec : r)
        : [...prev, rec];
      lsSet("recurring", updated);
      return updated;
    });
    syncWithServer({ recurring: [rec] });
    addToast("success", isEdit ? "Recorrente atualizado!" : "Recorrente adicionado!");
  }, [syncWithServer, addToast]);

  const saveIncome = useCallback((inc: Income, isEdit: boolean) => {
    setIncomes(prev => {
      const updated = isEdit
        ? prev.map(i => i.id === inc.id ? inc : i)
        : [...prev, inc];
      lsSet("incomes", updated);
      return updated;
    });
    syncWithServer({ incomes: [inc] });
    addToast("success", isEdit ? "Entrada atualizada!" : "Entrada adicionada!");
  }, [syncWithServer, addToast]);

  const saveIncomeType = useCallback((it: IncomeType, isEdit: boolean) => {
    setIncomeTypes(prev => {
      const updated = isEdit
        ? prev.map(t => t.id === it.id ? it : t)
        : [...prev, it];
      lsSet("incomeTypes", updated);
      return updated;
    });
    syncWithServer({ incomeTypes: [it] });
    addToast("success", isEdit ? "Tipo atualizado!" : "Tipo adicionado!");
  }, [syncWithServer, addToast]);

  const saveNote = useCallback((note: Note) => {
    setNotes(prev => {
      const exists = prev.some(n => n.id === note.id);
      const updated = exists ? prev.map(n => n.id === note.id ? note : n) : [note, ...prev];
      lsSet("notes", updated);
      return updated;
    });
    syncWithServer({ notes: [note] });
  }, [syncWithServer]);

  const value: DataContextValue = {
    expenses, categories, responsibles, profile, budgets, recurring, incomes, incomeTypes, notes,
    isOnline, isConnected, notificationsEnabled, toasts,
    saveExpense, deleteItem, togglePaid, saveProfile,
    saveCategory, saveResponsible, saveBudget, saveRecurring, saveIncome, saveIncomeType, saveNote,
    readPhoto, requestNotificationPermission, addToast, dismissToast,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
