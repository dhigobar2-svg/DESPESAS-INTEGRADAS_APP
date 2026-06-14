import React, {
  createContext, useContext, useState, useEffect, useCallback,
  useRef, ReactNode,
} from "react";
import { io, Socket } from "socket.io-client";
import { format } from "date-fns";
import {
  Category, Responsible, Expense, UserProfile,
  Budget, RecurringExpense, Income, IncomeType, RecurringIncome, RecurringSkip, ToastMessage, Note,
} from "../types";
import {
  generateId, compressImage, isRecurringCovered, isRecurringIncomeCovered, recurringDueDate, buildSkipSet,
} from "../lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DataContextValue {
  // State
  expenses:     Expense[];
  categories:   Category[];
  responsibles: Responsible[];
  profile:      UserProfile;
  budgets:      Budget[];
  recurring:    RecurringExpense[];
  incomes:          Income[];
  incomeTypes:      IncomeType[];
  recurringIncomes: RecurringIncome[];
  recurringSkips:   RecurringSkip[];
  notes:            Note[];
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
  saveRecurringIncome: (rec: RecurringIncome, isEdit: boolean) => void;
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
  const [incomes,         setIncomes]         = useState<Income[]>([]);
  const [incomeTypes,     setIncomeTypes]     = useState<IncomeType[]>([]);
  const [recurringIncomes, setRecurringIncomes] = useState<RecurringIncome[]>([]);
  const [recurringSkips,  setRecurringSkips]  = useState<RecurringSkip[]>([]);
  const [notes,           setNotes]           = useState<Note[]>([]);
  const [isOnline,     setIsOnline]     = useState(navigator.onLine);
  const [isConnected,  setIsConnected]  = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted",
  );
  const [toasts,       setToasts]       = useState<ToastMessage[]>([]);

  const socketRef             = useRef<Socket | null>(null);
  // Track the month each generator last ran for, so it re-materialises when the
  // month rolls over (e.g. the app was left open / backgrounded across midnight).
  const recurringAppliedMonth       = useRef<string>("");
  const recurringIncomeAppliedMonth = useRef<string>("");
  const notifiedRef           = useRef(false);
  const firstSocketConnect    = useRef(true);
  const fetchDataRef          = useRef<() => void>(() => {});

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
    recurringIncomes?: RecurringIncome[];
    recurringSkips?: RecurringSkip[];
    notes?: Note[];
  }) => {
    if (!navigator.onLine) return;
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        // Server reachable but rejected the save — surface it and reconcile,
        // so the user isn't left thinking an unsaved change persisted.
        let msg = "Não foi possível salvar no servidor.";
        try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
        addToast("error", msg);
        fetchDataRef.current();
      }
    } catch (err) {
      console.error("Sync failed", err);
    }
  }, [addToast]);

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
      incomes:          lsGet("incomes",          []),
      incomeTypes:      lsGet("incomeTypes",      []),
      recurringIncomes: lsGet("recurringIncomes", []),
      notes:            lsGet("notes",            []),
      recurringSkips:   lsGet("recurringSkips",   []),
    });
  }, [syncWithServer]);

  // Record that a recurrence occurrence was deleted so it isn't regenerated.
  const addRecurringSkip = useCallback((recurring_id: string, month: string) => {
    const skip: RecurringSkip = { id: `${recurring_id}_${month}`, recurring_id, month };
    setRecurringSkips(prev => {
      if (prev.some(s => s.id === skip.id)) return prev;
      const updated = [...prev, skip];
      lsSet("recurringSkips", updated);
      return updated;
    });
    syncWithServer({ recurringSkips: [skip] });
  }, [syncWithServer]);

  // ── Auto-apply recurring expenses for current month ──────────────────────────

  const applyRecurring = useCallback((
    currentExpenses: Expense[],
    currentRecurring: RecurringExpense[],
    skipSet: Set<string>,
  ): Expense[] => {
    const now = new Date();
    const year = now.getFullYear();
    const month1 = now.getMonth() + 1;
    const monthKey = `${year}-${String(month1).padStart(2, "0")}`;
    const generated: Expense[] = [];

    for (const rec of currentRecurring) {
      if (!rec.active) continue;
      const dueDate = recurringDueDate(year, month1, rec.day_of_month);
      if (!isRecurringCovered(currentExpenses, rec, dueDate, { skips: skipSet })) {
        generated.push({
          // Deterministic id (template + month) so two devices generating the
          // same month produce the same primary key instead of duplicating.
          id:             `rec_${rec.id}_${monthKey}`,
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
  // Mirrors recurring expenses: each active template in `recurring_incomes`
  // materialises one income per month, linked back via recurring_income_id.

  const applyRecurringIncomes = useCallback((
    currentIncomes: Income[],
    currentTemplates: RecurringIncome[],
  ): Income[] => {
    const now = new Date();
    const year = now.getFullYear();
    const month1 = now.getMonth() + 1;
    const monthKey = `${year}-${String(month1).padStart(2, "0")}`;
    const generated: Income[] = [];

    for (const tpl of currentTemplates) {
      if (!tpl.active) continue;
      const date = recurringDueDate(year, month1, tpl.day_of_month);
      if (isRecurringIncomeCovered(currentIncomes, tpl, date)) continue;
      if (generated.some(i => i.recurring_income_id === tpl.id)) continue;

      generated.push({
        id:                  `recinc_${tpl.id}_${monthKey}`,
        description:         tpl.description,
        value:               tpl.value,
        date,
        type:                tpl.type,
        responsible_id:      tpl.responsible_id,
        recurring:           0,
        recurring_income_id: tpl.id,
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
      let recIncomes: RecurringIncome[] = data.recurringIncomes ?? [];
      const recSkips: RecurringSkip[] = data.recurringSkips ?? [];
      const skipSet = buildSkipSet(recSkips);
      const monthNow = format(new Date(), "yyyy-MM");

      // One-time migration: convert legacy recurring incomes (a boolean flag on
      // the income) into proper templates so they keep generating each month.
      if (!localStorage.getItem("rec_incomes_migrated")) {
        localStorage.setItem("rec_incomes_migrated", "1");
        const legacyIds = new Set(incs.filter(i => i.recurring && !i.recurring_income_id).map(i => i.id));
        if (legacyIds.size) {
          const newTemplates: RecurringIncome[] = [];
          incs = incs.map(i => {
            if (!legacyIds.has(i.id)) return i;
            const tplId = generateId();
            newTemplates.push({
              id: tplId, description: i.description, value: i.value, type: i.type,
              responsible_id: i.responsible_id,
              day_of_month: parseInt(i.date?.slice(8, 10) || "1", 10) || 1,
              active: 1,
            });
            return { ...i, recurring: 0, recurring_income_id: tplId };
          });
          recIncomes = [...recIncomes, ...newTemplates];
          syncWithServer({ recurringIncomes: newTemplates, incomes: incs.filter(i => legacyIds.has(i.id)) });
        }
      }

      // Materialise recurring expenses for the current month (re-runs when the
      // month changes; idempotent — already-covered months are skipped).
      if (recurringAppliedMonth.current !== monthNow && data.recurring?.length) {
        recurringAppliedMonth.current = monthNow;
        const newOnes = applyRecurring(exps, data.recurring, skipSet);
        if (newOnes.length) {
          exps = [...exps, ...newOnes];
          syncWithServer({ expenses: newOnes });
        }
      }

      // Materialise recurring incomes for the current month
      if (recurringIncomeAppliedMonth.current !== monthNow && recIncomes.length) {
        recurringIncomeAppliedMonth.current = monthNow;
        const newIncs = applyRecurringIncomes(incs, recIncomes);
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
      setRecurringIncomes(recIncomes);
      setRecurringSkips(recSkips);
      setNotes(data.notes ?? []);

      // Persist to localStorage for offline use
      lsSet("expenses",         exps);
      lsSet("categories",       data.categories);
      lsSet("responsibles",     data.responsibles);
      lsSet("profile",          data.profile);
      lsSet("budgets",          data.budgets);
      lsSet("recurring",        data.recurring);
      lsSet("incomes",          incs);
      lsSet("incomeTypes",      data.incomeTypes);
      lsSet("recurringIncomes", recIncomes);
      lsSet("recurringSkips",   recSkips);
      lsSet("notes",            data.notes ?? []);

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
      setRecurringIncomes(lsGet("recurringIncomes", []));
      setRecurringSkips(lsGet("recurringSkips", []));
      setNotes(    lsGet("notes",    []));
    }
  }, [applyRecurring, applyRecurringIncomes, syncWithServer]);

  // Keep a ref so syncWithServer (defined earlier) can reconcile after a failure.
  fetchDataRef.current = fetchData;

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

    // Re-pull (and re-materialise recurrences) when the app is brought back to
    // the foreground — covers PWAs/tabs left open across a month boundary.
    const onVisible = () => { if (document.visibilityState === "visible") fetchData(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      s.disconnect();
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
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
      recurringIncomes: recurringIncomes,
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
      setRecurringIncomes(snap.recurringIncomes);
      setNotes(snap.notes);
    };

    // Optimistic local removal
    if (table === "expenses") {
      // If this is a recurrence occurrence, record a skip so it isn't regenerated.
      const target = expenses.find(e => e.id === id);
      if (target?.recurring_id && target.due_date) {
        addRecurringSkip(target.recurring_id, target.due_date.slice(0, 7));
      }
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
    } else if (table === "recurring_incomes") {
      setRecurringIncomes(p => { const u = p.filter(r => r.id !== id); lsSet("recurringIncomes", u); return u; });
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
  }, [expenses, categories, responsibles, budgets, recurring, incomes, incomeTypes, recurringIncomes, notes, enqueueDelete, addRecurringSkip, addToast]);

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

  const saveRecurringIncome = useCallback((rec: RecurringIncome, isEdit: boolean) => {
    setRecurringIncomes(prev => {
      const updated = isEdit
        ? prev.map(r => r.id === rec.id ? rec : r)
        : [...prev, rec];
      lsSet("recurringIncomes", updated);
      return updated;
    });
    syncWithServer({ recurringIncomes: [rec] });
    addToast("success", isEdit ? "Entrada recorrente atualizada!" : "Entrada recorrente adicionada!");
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
    expenses, categories, responsibles, profile, budgets, recurring,
    incomes, incomeTypes, recurringIncomes, recurringSkips, notes,
    isOnline, isConnected, notificationsEnabled, toasts,
    saveExpense, deleteItem, togglePaid, saveProfile,
    saveCategory, saveResponsible, saveBudget, saveRecurring,
    saveIncome, saveIncomeType, saveRecurringIncome, saveNote,
    readPhoto, requestNotificationPermission, addToast, dismissToast,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
