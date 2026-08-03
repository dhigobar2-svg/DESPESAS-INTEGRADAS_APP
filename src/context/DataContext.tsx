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
  findRecurringDuplicates, sha256Hex, ocorrenciasNoMes, chaveOcorrencia,
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
  realtime:     boolean;
  serverReachable: boolean;
  /** true quando o servidor exige senha e este aparelho ainda não entrou. */
  needsAuth:    boolean;
  /** true quando este aparelho tem senha guardada (permite bloquear). */
  authEnabled:  boolean;
  /** Nome de quem usa ESTE aparelho — carimbado em cada lançamento. */
  deviceUser:   string;
  setDeviceUser: (nome: string) => void;
  notificationsEnabled: boolean;
  pendingCount: number;
  toasts:       ToastMessage[];

  // Handlers
  saveExpense:      (expense: Expense, isEdit: boolean, toastMsg?: string) => void;
  deleteItem:       (table: string, id: string) => Promise<void>;
  togglePaid:       (id: string) => void;
  /** Marca várias despesas como pagas de uma vez (seleção em lote). */
  marcarPagas:      (ids: string[], mensagem: string) => void;
  forceSync:        () => Promise<void>;
  signIn:           (senha: string) => Promise<boolean>;
  signOut:          () => void;
  saveProfile:      (p: UserProfile) => Promise<void>;
  saveCategory:     (cat: Category, isEdit: boolean) => void;
  saveResponsible:  (resp: Responsible, isEdit: boolean) => void;
  saveBudget:       (budget: Budget) => void;
  saveRecurring:    (rec: RecurringExpense, isEdit: boolean) => void;
  saveIncome:       (inc: Income, isEdit: boolean) => void;
  saveIncomeType:   (it: IncomeType, isEdit: boolean) => void;
  saveRecurringIncome: (rec: RecurringIncome, isEdit: boolean) => void;
  saveNote:         (note: Note) => void;
  restoreBackup:    (raw: unknown) => number;
  readPhoto:        (file: File) => Promise<string>;
  requestNotificationPermission: () => Promise<boolean>;
  addToast:         (type: ToastMessage["type"], message: string, action?: ToastMessage["action"]) => void;
  dismissToast:     (id: string) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside DataProvider");
  return ctx;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Acesso por senha ─────────────────────────────────────────────────────────
// Só entra em cena quando o servidor exige (variável APP_PASSWORD definida).
// Sem senha configurada nada muda — é o que evita ficar trancado para fora.
const AUTH_KEY = "app_auth_token";
const getAuthToken = () => { try { return localStorage.getItem(AUTH_KEY) ?? ""; } catch { return ""; } };

// Sinaliza para o provider que o servidor recusou o acesso (HTTP 401).
let onUnauthorized: (() => void) | null = null;

/** fetch para a API, sempre com o resumo da senha (quando houver). */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("x-app-token", token);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) onUnauthorized?.();
  return res;
}

function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// ─── Pending-sync queue ───────────────────────────────────────────────────────
// Rows that still need to reach the server, keyed by payload table then row id.
// Persisted in localStorage so a failed save survives reloads and is retried —
// a save must never be silently lost just because one request failed.

interface SyncData {
  expenses?:         Expense[];
  categories?:       Category[];
  responsibles?:     Responsible[];
  profile?:          UserProfile;
  budgets?:          Budget[];
  recurring?:        RecurringExpense[];
  incomes?:          Income[];
  incomeTypes?:      IncomeType[];
  recurringIncomes?: RecurringIncome[];
  recurringSkips?:   RecurringSkip[];
  notes?:            Note[];
}

const PAYLOAD_TABLES = [
  "expenses", "categories", "responsibles", "budgets", "recurring",
  "incomes", "incomeTypes", "recurringIncomes", "recurringSkips", "notes",
] as const;
type PayloadTable = typeof PAYLOAD_TABLES[number];

// Payload key → server table name (the delete queue uses server table names).
const TABLE_FOR_PAYLOAD: Record<PayloadTable, string> = {
  expenses: "expenses", categories: "categories", responsibles: "responsibles",
  budgets: "budgets", recurring: "recurring_expenses", incomes: "incomes",
  incomeTypes: "income_types", recurringIncomes: "recurring_incomes",
  recurringSkips: "recurring_skips", notes: "notes",
};
const PAYLOAD_FOR_TABLE = Object.fromEntries(
  Object.entries(TABLE_FOR_PAYLOAD).map(([k, v]) => [v, k]),
) as Record<string, PayloadTable>;

interface PendingStore {
  rows: Partial<Record<PayloadTable, Record<string, unknown>>>;
  profile?: UserProfile;
}

const getPending = (): PendingStore => lsGet<PendingStore>("pendingSync", { rows: {} });

// The provider registers a listener here so the header badge ("alterações
// aguardando envio") reflects the queue without polling.
let pendingNotify: (() => void) | null = null;

const setPending = (p: PendingStore) => {
  lsSet("pendingSync", p);
  pendingNotify?.();
};

function countPendingChanges(): number {
  const store = getPending();
  let n = store.profile ? 1 : 0;
  for (const t of PAYLOAD_TABLES) n += Object.keys(store.rows[t] ?? {}).length;
  n += lsGet<unknown[]>("pendingDeletes", []).length;
  return n;
}

// Ponto único onde a alteração ganha o carimbo de "editado agora" (ISO UTC).
// É esse carimbo que o servidor compara para recusar uma escrita mais antiga
// que a versão já guardada — inclusive a que ficou dias parada na fila offline.
// `recurringSkips` fica de fora: marcador imutável, nunca conflita.
const carimbar = <T extends object>(row: T, agora: string): T =>
  ({ ...row, updated_at: agora });

function queuePending(data: SyncData) {
  const store = getPending();
  const agora = new Date().toISOString();
  for (const t of PAYLOAD_TABLES) {
    const rows = data[t] as { id: string }[] | undefined;
    if (!rows?.length) continue;
    const bucket = store.rows[t] ?? (store.rows[t] = {});
    for (const r of rows) bucket[r.id] = t === "recurringSkips" ? r : carimbar(r, agora);
  }
  if (data.profile) store.profile = carimbar(data.profile, agora);
  setPending(store);
}

function pendingIsEmpty(store: PendingStore): boolean {
  return !store.profile &&
    PAYLOAD_TABLES.every(t => !store.rows[t] || Object.keys(store.rows[t]!).length === 0);
}

function pendingToPayload(store: PendingStore): SyncData {
  const out: SyncData = {};
  for (const t of PAYLOAD_TABLES) {
    const bucket = store.rows[t];
    if (bucket && Object.keys(bucket).length) {
      (out as Record<string, unknown>)[t] = Object.values(bucket);
    }
  }
  if (store.profile) out.profile = store.profile;
  return out;
}

// Remove sent rows from the queue — unless re-edited while the request was in flight.
function clearSentPending(sent: SyncData) {
  const store = getPending();
  for (const t of PAYLOAD_TABLES) {
    const rows = sent[t] as { id: string }[] | undefined;
    const bucket = store.rows[t];
    if (!rows || !bucket) continue;
    for (const r of rows) {
      if (JSON.stringify(bucket[r.id]) === JSON.stringify(r)) delete bucket[r.id];
    }
  }
  if (sent.profile && JSON.stringify(store.profile) === JSON.stringify(sent.profile)) {
    delete store.profile;
  }
  setPending(store);
}

// A row created offline and then deleted must leave the queue, or it would resurrect.
function removePendingRow(payloadTable: PayloadTable, id: string) {
  const store = getPending();
  const bucket = store.rows[payloadTable];
  if (bucket && id in bucket) {
    delete bucket[id];
    setPending(store);
  }
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
  // false = backend sem Socket.IO (serverless): atualizamos por polling, e a
  // ausência de socket não deve aparecer como "reconectando" no cabeçalho.
  const [realtime,     setRealtime]     = useState(true);
  // false when online but the API isn't reachable (e.g. deployed to a static
  // host with no backend) — the app then runs in local-only mode.
  const [serverReachable, setServerReachable] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted",
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [needsAuth,    setNeedsAuth]    = useState(false);
  const [authEnabled,  setAuthEnabled]  = useState(() => !!getAuthToken());
  // Guardado por aparelho (não sincroniza): o perfil é da família, então não
  // serve para distinguir quem lançou. Escolhido em Configurações.
  const [deviceUser,   setDeviceUserState] = useState<string>(() => lsGet<string>("device_user", ""));
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

  const addToast = useCallback((
    type: ToastMessage["type"], message: string, action?: ToastMessage["action"],
  ) => {
    const id = generateId();
    setToasts(prev => [...prev, { id, type, message, action }]);
    // Aviso com ação fica mais tempo: "Desfazer" precisa dar tempo de ler e tocar.
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), action ? 9000 : 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Sync ─────────────────────────────────────────────────────────────────────
  // Every save goes through the pending queue first, then a flush attempt. A
  // failed flush keeps the rows queued and schedules a retry, so nothing is
  // lost when the server is briefly unreachable.

  const flushInFlight  = useRef(false);
  const conflitosRef   = useRef(0);
  const flushTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingRef = useRef<() => Promise<boolean>>(async () => true);

  const scheduleFlush = useCallback((delayMs: number) => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => { flushPendingRef.current(); }, delayMs);
  }, []);

  // POSTs one payload. "rejected" = the app itself refused it (JSON {error}) —
  // terminal, the rows must leave the queue; "failed" = no usable backend
  // answer (proxy error, size limit, blocked method…) — keep the rows queued.
  const postSync = useCallback(async (payload: SyncData): Promise<"ok" | "rejected" | "failed"> => {
    const res = await apiFetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      // Um 200 não basta: em hospedagem estática o fallback do SPA responde 200
      // com o index.html, e tratar isso como sucesso descartava a fila de envio
      // — o save sumia sem nunca ter chegado a um banco. Só confirmamos quando a
      // resposta é realmente JSON da nossa API.
      try {
        const body = await res.json();
        if (body && typeof body === "object" && !("error" in body)) {
          // Linhas recusadas por já existir versão mais nova no servidor: a
          // cópia local está velha, o flush conta quantas foram e recarrega.
          const conflitos = (body as { conflicts?: unknown[] }).conflicts;
          if (Array.isArray(conflitos) && conflitos.length) {
            conflitosRef.current += conflitos.length;
          }
          return "ok";
        }
      } catch { /* HTML/vazio: não existe backend nesta URL */ }
      return "failed";
    }
    let serverError: string | null = null;
    try { serverError = (await res.json())?.error ?? null; } catch { /* non-JSON body */ }
    if (serverError) {
      addToast("error", serverError);
      return "rejected";
    }
    return "failed";
  }, [addToast]);

  // Alguma linha enviada era mais velha que a versão no servidor: a versão mais
  // nova (do outro aparelho) foi mantida. Recarrega e avisa — a alteração local
  // não some em silêncio, o usuário sabe que a tela mudou por causa disso.
  const avisarConflitos = useCallback(() => {
    const n = conflitosRef.current;
    if (!n) return;
    conflitosRef.current = 0;
    fetchDataRef.current();
    addToast("info", n === 1
      ? "Uma alteração sua era mais antiga que a versão em outro aparelho — mantivemos a mais recente."
      : `${n} alterações suas eram mais antigas que as de outro aparelho — mantivemos as mais recentes.`);
  }, [addToast]);

  const flushPending = useCallback(async (): Promise<boolean> => {
    if (flushInFlight.current) return false;
    const store = getPending();
    if (pendingIsEmpty(store)) return true;
    if (!navigator.onLine) return false;

    flushInFlight.current = true;
    try {
      const payload = pendingToPayload(store);
      const result = await postSync(payload);
      if (result !== "failed") {
        clearSentPending(payload);
        setServerReachable(true);
        avisarConflitos();
        if (result === "rejected") fetchDataRef.current(); // resync after an app-level rejection
        // Rows queued while this request was in flight: flush again shortly.
        if (!pendingIsEmpty(getPending())) scheduleFlush(500);
        return result === "ok";
      }

      // The whole batch failed without a JSON error (no backend here, or the
      // request was blocked/too large along the way). Retry in small chunks so
      // one oversized row can't wedge the entire queue forever — this is what
      // made the header counter climb without ever going down.
      let anyOk = false;
      let anyRejected = false;
      const rowCount = PAYLOAD_TABLES.reduce(
        (s, t) => s + ((payload[t] as unknown[] | undefined)?.length ?? 0), 0,
      ) + (payload.profile ? 1 : 0);
      if (rowCount > 1) {
        const CHUNK = 10;
        for (const t of PAYLOAD_TABLES) {
          const rows = payload[t] as { id: string }[] | undefined;
          if (!rows?.length) continue;
          for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = { [t]: rows.slice(i, i + CHUNK) } as SyncData;
            const r = await postSync(chunk);
            if (r !== "failed") { clearSentPending(chunk); anyOk = anyOk || r === "ok"; anyRejected = anyRejected || r === "rejected"; }
          }
        }
        if (payload.profile) {
          const r = await postSync({ profile: payload.profile });
          if (r !== "failed") { clearSentPending({ profile: payload.profile }); anyOk = anyOk || r === "ok"; anyRejected = anyRejected || r === "rejected"; }
        }
      }

      setServerReachable(anyOk || anyRejected);
      avisarConflitos();
      if (anyRejected) fetchDataRef.current();
      // Keep retrying on our own — without this, a failed queue was only
      // re-sent on the next user action and the badge never went down.
      if (!pendingIsEmpty(getPending())) scheduleFlush(30_000);
      return pendingIsEmpty(getPending());
    } catch (err) {
      console.error("Sync falhou — alterações mantidas na fila para reenvio", err);
      scheduleFlush(10_000);
      return false;
    } finally {
      flushInFlight.current = false;
    }
  }, [postSync, scheduleFlush, avisarConflitos]);
  flushPendingRef.current = flushPending;

  const syncWithServer = useCallback(async (data: SyncData) => {
    queuePending(data);
    await flushPending();
  }, [flushPending]);

  // ── Offline reconciliation ────────────────────────────────────────────────────
  // Deletions can't go through /api/sync (which only upserts), so offline deletes
  // are queued and replayed on reconnect.

  const enqueueDelete = useCallback((table: string, id: string) => {
    const queue = lsGet<{ table: string; id: string }[]>("pendingDeletes", []);
    if (!queue.some(q => q.table === table && q.id === id)) {
      queue.push({ table, id });
      lsSet("pendingDeletes", queue);
      pendingNotify?.();
    }
  }, []);

  const flushPendingDeletes = useCallback(async () => {
    const queue = lsGet<{ table: string; id: string }[]>("pendingDeletes", []);
    if (!queue.length) return;
    const remaining: { table: string; id: string }[] = [];
    for (const item of queue) {
      try {
        const res = await apiFetch(`/api/delete/${item.table}/${item.id}`, { method: "POST" });
        // Keep retrying only on server (5xx) errors; 2xx and 4xx are terminal.
        if (res.status >= 500) remaining.push(item);
      } catch {
        remaining.push(item); // network still down — retry next time
      }
    }
    lsSet("pendingDeletes", remaining);
    pendingNotify?.();
  }, []);

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
      // Semanal pode cair várias vezes no mesmo mês; mensal/anual, no máximo uma.
      for (const dueDate of ocorrenciasNoMes(rec, year, month1)) {
        if (isRecurringCovered(currentExpenses, rec, dueDate, { skips: skipSet })) continue;
        generated.push({
          // Id determinístico (template + ocorrência) para dois aparelhos
          // gerarem a mesma chave em vez de duplicar. A chave é o mês nas
          // recorrências mensais/anuais — mantendo os ids já existentes — e a
          // data inteira nas semanais.
          id:             `rec_${rec.id}_${chaveOcorrencia(rec, dueDate)}`,
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
    skipSet: Set<string>,
  ): Income[] => {
    const now = new Date();
    const year = now.getFullYear();
    const month1 = now.getMonth() + 1;
    const monthKey = `${year}-${String(month1).padStart(2, "0")}`;
    const generated: Income[] = [];

    for (const tpl of currentTemplates) {
      if (!tpl.active) continue;
      for (const date of ocorrenciasNoMes(tpl, year, month1)) {
        const chave = chaveOcorrencia(tpl, date);
        // Ocorrência que o usuário apagou não pode voltar na próxima abertura —
        // é o mesmo registro de "pulo" que as despesas recorrentes já usavam.
        if (skipSet.has(`${tpl.id}_${chave}`)) continue;
        if (isRecurringIncomeCovered(currentIncomes, tpl, date)) continue;
        if (generated.some(i => i.recurring_income_id === tpl.id && i.date === date)) continue;

        generated.push({
          id:                  `recinc_${tpl.id}_${chave}`,
          description:         tpl.description,
          value:               tpl.value,
          date,
          type:                tpl.type,
          responsible_id:      tpl.responsible_id,
          recurring:           0,
          recurring_income_id: tpl.id,
        });
      }
    }
    return generated;
  }, []);

  // ── Modo de atualização: tempo real ou polling ───────────────────────────────
  // Com Express + Socket.IO (local/Railway) o servidor avisa cada cliente por
  // `data_updated`. Em serverless (Netlify) não há conexão persistente, então
  // `/api/data` responde `meta.realtime: false` e passamos a buscar de tempos
  // em tempos — sem isso o socket ficaria tentando reconectar para sempre.
  const POLL_INTERVAL_MS = 25_000;
  const pollTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeRef = useRef<boolean | null>(null);

  const configureRealtime = useCallback((realtime: boolean) => {
    if (realtimeRef.current === realtime) return;
    realtimeRef.current = realtime;
    setRealtime(realtime);

    if (realtime) {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
      if (!socketRef.current?.connected) socketRef.current?.connect();
      return;
    }

    socketRef.current?.disconnect();
    setIsConnected(false);
    if (!pollTimer.current) {
      pollTimer.current = setInterval(() => {
        // Só busca com a tela à vista: economiza bateria e dados do celular.
        if (document.visibilityState === "visible" && navigator.onLine) fetchDataRef.current();
      }, POLL_INTERVAL_MS);
    }
  }, []);

  // ── Adoção dos dados locais ──────────────────────────────────────────────────
  // Quem usou o app sem backend (hospedagem estática) tem tudo só no aparelho.
  // No primeiro contato com um servidor vazio, mandamos esses dados para cima em
  // vez de deixar o snapshot vazio do servidor apagar a tela do usuário.
  const adoptLocalData = useCallback((data: Record<string, unknown>): boolean => {
    if (localStorage.getItem("local_data_adopted")) return false;

    const serverHasData = ["expenses", "incomes", "notes", "responsibles", "budgets", "recurring", "recurringIncomes"]
      .some(k => Array.isArray(data[k]) && (data[k] as unknown[]).length > 0);
    if (serverHasData) {
      localStorage.setItem("local_data_adopted", "1"); // servidor já é a fonte da verdade
      return false;
    }

    const local: SyncData = {
      expenses:         lsGet<Expense[]>("expenses", []),
      categories:       lsGet<Category[]>("categories", []),
      responsibles:     lsGet<Responsible[]>("responsibles", []),
      budgets:          lsGet<Budget[]>("budgets", []),
      recurring:        lsGet<RecurringExpense[]>("recurring", []),
      incomes:          lsGet<Income[]>("incomes", []),
      incomeTypes:      lsGet<IncomeType[]>("incomeTypes", []),
      recurringIncomes: lsGet<RecurringIncome[]>("recurringIncomes", []),
      recurringSkips:   lsGet<RecurringSkip[]>("recurringSkips", []),
      notes:            lsGet<Note[]>("notes", []),
    };
    const total = PAYLOAD_TABLES.reduce((s, t) => s + ((local[t] as unknown[] | undefined)?.length ?? 0), 0);
    const localProfile = lsGet<UserProfile | null>("profile", null);
    if (!total && !localProfile) return false;

    if (localProfile) local.profile = localProfile;
    queuePending(local);
    localStorage.setItem("local_data_adopted", "1");
    return true;
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async (onSuccess?: () => void) => {
    try {
      // Push pending local changes (and replay queued deletes) BEFORE pulling,
      // so the server snapshot we apply already contains them and can't
      // clobber an unsent save.
      await flushPendingDeletes();
      await flushPending();

      const res = await apiFetch("/api/data");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      setServerReachable(true);

      // Este backend empurra atualizações (Socket.IO) ou precisamos de polling?
      configureRealtime((data as { meta?: { realtime?: boolean } }).meta?.realtime !== false);

      // Primeiro contato com um servidor vazio: sobe o que só existia neste
      // aparelho, senão o snapshot vazio apagaria os dados do usuário.
      const adopted = adoptLocalData(data);

      // Overlay any still-pending rows on top of the server data (flush may have
      // failed) and drop rows with a queued offline deletion — the UI must keep
      // reflecting the user's intent until the server confirms.
      const pendingStore   = getPending();
      const pendingDeletes = lsGet<{ table: string; id: string }[]>("pendingDeletes", []);
      const overlay = <T extends { id: string }>(t: PayloadTable, rows: T[]): T[] => {
        const bucket  = pendingStore.rows[t] ?? {};
        const deleted = new Set(pendingDeletes.filter(d => d.table === TABLE_FOR_PAYLOAD[t]).map(d => d.id));
        const out = rows.filter(r => !deleted.has(r.id)).map(r => (bucket[r.id] as T) ?? r);
        for (const [id, row] of Object.entries(bucket)) {
          if (!deleted.has(id) && !rows.some(r => r.id === id)) out.push(row as T);
        }
        return out;
      };

      let exps: Expense[] = overlay("expenses", data.expenses ?? []);
      let incs: Income[]  = overlay("incomes",  data.incomes ?? []);
      let recIncomes: RecurringIncome[] = overlay("recurringIncomes", data.recurringIncomes ?? []);
      const recSkips: RecurringSkip[]   = overlay("recurringSkips",   data.recurringSkips ?? []);
      const cats     = overlay("categories",   (data.categories ?? []) as Category[]);
      const resps    = overlay("responsibles", (data.responsibles ?? []) as Responsible[]);
      const buds     = overlay("budgets",      (data.budgets ?? []) as Budget[]);
      const recs     = overlay("recurring",    (data.recurring ?? []) as RecurringExpense[]);
      const incTypes = overlay("incomeTypes",  (data.incomeTypes ?? []) as IncomeType[]);
      const nts      = overlay("notes",        (data.notes ?? []) as Note[]);
      const prof: UserProfile | undefined = pendingStore.profile ?? data.profile;
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
      if (recurringAppliedMonth.current !== monthNow && recs.length) {
        recurringAppliedMonth.current = monthNow;
        const newOnes = applyRecurring(exps, recs, skipSet);
        if (newOnes.length) {
          exps = [...exps, ...newOnes];
          syncWithServer({ expenses: newOnes });
        }
      }

      // Materialise recurring incomes for the current month
      if (recurringIncomeAppliedMonth.current !== monthNow && recIncomes.length) {
        recurringIncomeAppliedMonth.current = monthNow;
        const newIncs = applyRecurringIncomes(incs, recIncomes, skipSet);
        if (newIncs.length) {
          incs = [...incs, ...newIncs];
          syncWithServer({ incomes: newIncs });
        }
      }

      // Self-heal exact duplicate recurring occurrences (a past bug let the
      // "mark as paid" button create copies). One row per template/month is
      // kept; redundant copies are removed here and deleted on the server.
      const dupeIds = findRecurringDuplicates(exps);
      if (dupeIds.size) {
        exps = exps.filter(e => !dupeIds.has(e.id));
        for (const id of dupeIds) {
          removePendingRow("expenses", id); // a queued copy must not resurrect
          enqueueDelete("expenses", id);
        }
        flushPendingDeletes();
      }

      setExpenses(exps);
      setCategories(cats);
      setResponsibles(resps);
      if (prof) setProfile(prof);
      setBudgets(buds);
      setRecurring(recs);
      setIncomes(incs);
      setIncomeTypes(incTypes);
      setRecurringIncomes(recIncomes);
      setRecurringSkips(recSkips);
      setNotes(nts);

      // Persist to localStorage for offline use
      lsSet("expenses",         exps);
      lsSet("categories",       cats);
      lsSet("responsibles",     resps);
      lsSet("profile",          prof);
      lsSet("budgets",          buds);
      lsSet("recurring",        recs);
      lsSet("incomes",          incs);
      lsSet("incomeTypes",      incTypes);
      lsSet("recurringIncomes", recIncomes);
      lsSet("recurringSkips",   recSkips);
      lsSet("notes",            nts);

      onSuccess?.();

      // Envia agora o que acabou de ser adotado (a fila já está refletida na tela).
      if (adopted) {
        addToast("success", "Dados deste aparelho enviados para o servidor.");
        flushPending();
      }
    } catch (err) {
      console.error("Fetch failed, using local data", err);
      // Online but the API didn't respond → no backend here (local-only mode).
      if (navigator.onLine) setServerReachable(false);
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

      // Local-only first run (no backend, no cached data): seed the defaults the
      // server normally provides so the app is usable straight away.
      if (lsGet<Category[]>("categories", []).length === 0) {
        const cats: Category[] = [
          { id: "1", name: "Alimentação", color: "#ef4444" },
          { id: "2", name: "Transporte",  color: "#3b82f6" },
          { id: "3", name: "Lazer",       color: "#10b981" },
          { id: "4", name: "Moradia",     color: "#f59e0b" },
        ];
        setCategories(cats); lsSet("categories", cats);
      }
      if (lsGet<IncomeType[]>("incomeTypes", []).length === 0) {
        const its: IncomeType[] = [
          { id: "salario",     name: "Salário",     color: "#3b82f6" },
          { id: "renda_extra", name: "Renda Extra", color: "#10b981" },
          { id: "outro",       name: "Outro",       color: "#64748b" },
        ];
        setIncomeTypes(its); lsSet("incomeTypes", its);
      }
    }
  }, [applyRecurring, applyRecurringIncomes, syncWithServer, flushPending, flushPendingDeletes,
      enqueueDelete, configureRealtime, adoptLocalData, addToast]);

  // Keep a ref so syncWithServer (defined earlier) can reconcile after a failure.
  fetchDataRef.current = fetchData;

  // Manual "sync now" — triggered by tapping the pending badge in the header,
  // so the user can drain the queue (or learn why it isn't draining).
  const forceSync = useCallback(async () => {
    if (!navigator.onLine) {
      addToast("info", "Sem conexão — as alterações serão enviadas ao reconectar.");
      return;
    }
    await flushPendingDeletes();
    await flushPending();
    await fetchData();
    const remaining = countPendingChanges();
    if (remaining === 0) {
      addToast("success", "Tudo sincronizado!");
    } else {
      addToast("error", `${remaining} alteraç${remaining > 1 ? "ões" : "ão"} ainda aguardando envio ao servidor.`);
    }
  }, [flushPendingDeletes, flushPending, fetchData, addToast]);

  // ── Browser notifications for upcoming/overdue expenses ──────────────────────

  useEffect(() => {
    if (notifiedRef.current || !expenses.length) return;
    // Never auto-prompt: only notify when the user has already granted permission
    // (requesting without a user gesture is blocked by Safari and others).
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    notifiedRef.current = true;

    // Local (não UTC): em UTC-3 o dia "virava" às 21h e contas do dia
    // apareciam como vencidas antes da hora.
    const today  = format(new Date(), "yyyy-MM-dd");
    const in7    = format(new Date(Date.now() + 7 * 86_400_000), "yyyy-MM-dd");
    const overdue  = expenses.filter(e => !e.paid && e.due_date < today).length;
    const upcoming = expenses.filter(e => !e.paid && e.due_date >= today && e.due_date <= in7).length;

    if (overdue === 0 && upcoming === 0) return;

    const parts: string[] = [];
    if (overdue  > 0) parts.push(`${overdue} vencida${overdue  > 1 ? "s" : ""}`);
    if (upcoming > 0) parts.push(`${upcoming} vencem em até 7 dias`);

    try {
      new Notification("Despesas Integradas", {
        body: parts.join(" · "),
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
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
    // Servidor recusou o acesso: pede a senha em vez de cair no modo offline.
    onUnauthorized = () => setNeedsAuth(true);

    // Badge de pendências: reflete a fila de envio sem polling.
    pendingNotify = () => setPendingCount(countPendingChanges());
    pendingNotify();

    // Default reconnection = infinite with backoff. A capped attempt count made
    // real-time updates stop for good after ~10 failures until a full reload.
    // `autoConnect: false`: só conectamos depois que /api/data confirmar que
    // este backend tem Socket.IO — em serverless a conexão nunca completaria.
    // O socket também leva o resumo da senha, quando houver.
    const s = io({ autoConnect: false, auth: { token: getAuthToken() } });
    socketRef.current = s;

    fetchData(migrateLegacyNotes);

    s.on("connect", () => {
      setIsConnected(true);
      if (!firstSocketConnect.current) {
        addToast("success", "Reconectado ao servidor.");
        // The socket coming back is also a "server is reachable again" signal:
        // replay anything that queued up while it was away.
        flushPendingRef.current();
        flushPendingDeletes();
      }
      firstSocketConnect.current = false;
    });
    s.on("disconnect",   () => setIsConnected(false));

    // Coalesce refetches: a single save can emit several data_updated events
    // (expense + recurring template), and overlapping full refetches can race
    // with edits still in flight.
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    s.on("data_updated", () => {
      if (refetchTimer) clearTimeout(refetchTimer);
      refetchTimer = setTimeout(() => fetchDataRef.current(), 300);
    });

    // On reconnect: push queued local changes and replay queued deletes BEFORE
    // re-pulling, otherwise the server snapshot would clobber them.
    const onOnline = async () => {
      setIsOnline(true);
      const hadPending = lsGet<unknown[]>("pendingDeletes", []).length > 0
        || !pendingIsEmpty(getPending());
      await flushPendingRef.current();
      await flushPendingDeletes();
      await fetchData();
      addToast("success", hadPending ? "Alterações offline sincronizadas!" : "Reconectado — dados sincronizados.");
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);

    // Another tab flushing/queueing changes must update this tab's badge too.
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === "pendingSync" || ev.key === "pendingDeletes") pendingNotify?.();
    };
    window.addEventListener("storage", onStorage);

    // Re-pull (and re-materialise recurrences) when the app is brought back to
    // the foreground — covers PWAs/tabs left open across a month boundary.
    const onVisible = () => { if (document.visibilityState === "visible") fetchData(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      pendingNotify = null;
      onUnauthorized = null;
      s.disconnect();
      if (refetchTimer) clearTimeout(refetchTimer);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
      realtimeRef.current = null;
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Acesso por senha ─────────────────────────────────────────────────────────
  // O aparelho guarda só o resumo (SHA-256) da senha; a senha em si nunca é
  // gravada. Enquanto o servidor não exigir, nada disso aparece para o usuário.

  const signIn = useCallback(async (senha: string): Promise<boolean> => {
    const token = await sha256Hex(senha.trim());
    const res = await fetch("/api/data", { headers: { "x-app-token": token } });
    if (res.status === 401) {
      addToast("error", "Senha incorreta.");
      return false;
    }
    if (!res.ok) {
      addToast("error", "Não consegui falar com o servidor. Tente de novo.");
      return false;
    }
    try { localStorage.setItem(AUTH_KEY, token); } catch { /* quota */ }
    setAuthEnabled(true);
    setNeedsAuth(false);
    await fetchDataRef.current();
    addToast("success", "Bem-vindo de volta!");
    return true;
  }, [addToast]);

  const setDeviceUser = useCallback((nome: string) => {
    setDeviceUserState(nome);
    lsSet("device_user", nome);
  }, []);

  const signOut = useCallback(() => {
    try { localStorage.removeItem(AUTH_KEY); } catch { /* ignore */ }
    setAuthEnabled(false);
    setNeedsAuth(true);
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

  const saveExpense = useCallback((expense: Expense, isEdit: boolean, toastMsg?: string) => {
    setExpenses(prev => {
      // Upsert by id (the primary key) regardless of isEdit — appending a row
      // whose id already exists would show a duplicate the server doesn't have.
      const exists = prev.some(e => e.id === expense.id);
      const updated = exists
        ? prev.map(e => e.id === expense.id ? expense : e)
        : [...prev, expense];
      lsSet("expenses", updated);
      return updated;
    });
    // Sync only the changed row so concurrent edits by other clients aren't clobbered.
    syncWithServer({ expenses: [expense] });
    addToast("success", toastMsg ?? (isEdit ? "Despesa atualizada!" : "Despesa adicionada!"));
  }, [syncWithServer, addToast]);

  // Refs para o "Desfazer" do aviso de exclusão: `deleteItem` é declarado antes
  // de `saveIncome`, então a chamada passa por aqui em vez de por dependência.
  const saveExpenseRef = useRef<(e: Expense, isEdit: boolean, msg?: string) => void>(() => {});
  const saveIncomeRef  = useRef<(i: Income, isEdit: boolean) => void>(() => {});

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

    // A row still waiting to be synced must leave the queue when deleted,
    // otherwise the next flush would resurrect it.
    const payloadKey = PAYLOAD_FOR_TABLE[table];
    if (payloadKey) removePendingRow(payloadKey, id);

    // Guarda a linha para o "Desfazer" do aviso: recriar é só regravá-la com o
    // mesmo id (o sync é upsert por chave primária).
    const despesaApagada = table === "expenses" ? expenses.find(e => e.id === id) : undefined;
    const entradaApagada = table === "incomes"  ? incomes.find(i => i.id === id)  : undefined;

    // Optimistic local removal
    if (table === "expenses") {
      // If this is a recurrence occurrence, record a skip so it isn't regenerated.
      const target = expenses.find(e => e.id === id);
      if (target?.recurring_id && target.due_date) {
        const tpl = recurring.find(r => r.id === target.recurring_id);
        addRecurringSkip(target.recurring_id,
          tpl ? chaveOcorrencia(tpl, target.due_date) : target.due_date.slice(0, 7));
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
      // Igual às despesas: apagar uma ocorrência de recorrência registra o pulo
      // do mês, senão ela seria gerada de novo na próxima abertura do app.
      const alvo = incomes.find(i => i.id === id);
      if (alvo?.recurring_income_id && alvo.date) {
        const tpl = recurringIncomes.find(r => r.id === alvo.recurring_income_id);
        addRecurringSkip(alvo.recurring_income_id,
          tpl ? chaveOcorrencia(tpl, alvo.date) : alvo.date.slice(0, 7));
      }
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
      const res = await apiFetch(`/api/delete/${table}/${id}`, { method: "POST" });
      // Como no envio: um 200 com HTML é o fallback do SPA, não uma exclusão.
      let body: { error?: string } | null = null;
      try { body = await res.json(); } catch { /* non-JSON */ }

      if (res.ok && body && typeof body === "object" && !body.error) {
        setServerReachable(true);
        const desfazer = despesaApagada
          ? { label: "Desfazer", run: () => saveExpenseRef.current(despesaApagada, false, "Exclusão desfeita.") }
          : entradaApagada
          ? { label: "Desfazer", run: () => saveIncomeRef.current(entradaApagada, false) }
          : undefined;
        addToast("success", "Item excluído.", desfazer);
      } else if (body?.error) {
        // Rejeição real da aplicação (ex.: categoria em uso) → desfaz.
        setServerReachable(true);
        rollback();
        addToast("error", body.error);
      } else {
        // Sem resposta útil da API → não há backend nesta URL (modo local):
        // mantém a exclusão local em vez de falhar na cara do usuário.
        setServerReachable(false);
      }
    } catch {
      // Network error: the request may or may not have reached the server.
      // Queue it for retry on reconnect (re-deleting is idempotent) and keep the
      // optimistic removal so the UI stays consistent with the user's intent.
      enqueueDelete(table, id);
    }
  }, [expenses, categories, responsibles, budgets, recurring, incomes, incomeTypes, recurringIncomes, notes, enqueueDelete, addRecurringSkip, addToast]);

  const togglePaid = useCallback((id: string) => {
    // Compute the toggled row outside the updater: side effects inside a state
    // updater run twice under StrictMode and are unsafe with concurrent React.
    const target = expenses.find(e => e.id === id);
    if (!target) return;
    const changed: Expense = { ...target, paid: target.paid ? 0 : 1 };
    setExpenses(prev => {
      const updated = prev.map(e => e.id === id ? changed : e);
      lsSet("expenses", updated);
      return updated;
    });
    syncWithServer({ expenses: [changed] });
    addToast("success", changed.paid ? "Pagamento registrado!" : "Despesa marcada como pendente.");
  }, [expenses, syncWithServer, addToast]);

  // Marcar várias de uma vez manda um único envio, em vez de um POST por linha
  // (a fila continua sendo por linha, mas o flush sai junto).
  const marcarPagas = useCallback((ids: string[], mensagem: string) => {
    const alvo = new Set(ids);
    const alterados = expenses.filter(e => alvo.has(e.id) && e.paid !== 1)
      .map(e => ({ ...e, paid: 1 }));
    if (!alterados.length) return;
    const porId = new Map(alterados.map(e => [e.id, e]));
    setExpenses(prev => {
      const updated = prev.map(e => porId.get(e.id) ?? e);
      lsSet("expenses", updated);
      return updated;
    });
    syncWithServer({ expenses: alterados });
    if (mensagem) addToast("success", mensagem);
  }, [expenses, syncWithServer, addToast]);

  saveExpenseRef.current = saveExpense;

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

  saveIncomeRef.current = saveIncome;

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

  // ── Backup restore ────────────────────────────────────────────────────────────
  // Merges a previously exported JSON backup into the current data (upsert by
  // id — nothing is deleted) and queues everything for sync with the server.
  // Returns how many rows were imported; -1 means the file is not a backup.
  const restoreBackup = useCallback((raw: unknown): number => {
    if (!raw || typeof raw !== "object") return -1;
    const data = raw as Record<string, unknown>;
    const cleanList = <T extends { id: string }>(v: unknown): T[] =>
      Array.isArray(v)
        ? v.filter((i): i is T => !!i && typeof i === "object" && typeof (i as { id?: unknown }).id === "string")
        : [];

    const payload: SyncData = {
      expenses:         cleanList<Expense>(data.expenses),
      categories:       cleanList<Category>(data.categories),
      responsibles:     cleanList<Responsible>(data.responsibles),
      budgets:          cleanList<Budget>(data.budgets),
      recurring:        cleanList<RecurringExpense>(data.recurring),
      incomes:          cleanList<Income>(data.incomes),
      incomeTypes:      cleanList<IncomeType>(data.incomeTypes),
      recurringIncomes: cleanList<RecurringIncome>(data.recurringIncomes),
      recurringSkips:   cleanList<RecurringSkip>(data.recurringSkips),
      notes:            cleanList<Note>(data.notes),
    };
    const prof = data.profile as UserProfile | undefined;
    const hasProfile = !!prof && typeof prof === "object" && typeof prof.name === "string";

    const total = PAYLOAD_TABLES.reduce((s, t) => s + ((payload[t] as unknown[])?.length ?? 0), 0);
    if (total === 0 && !hasProfile) return 0;

    const merge = <T extends { id: string }>(prev: T[], incoming: T[]): T[] => {
      if (!incoming.length) return prev;
      const map = new Map(prev.map(i => [i.id, i] as const));
      for (const item of incoming) map.set(item.id, item);
      return [...map.values()];
    };

    setExpenses(p =>         { const u = merge(p, payload.expenses!);         lsSet("expenses", u);         return u; });
    setCategories(p =>       { const u = merge(p, payload.categories!);       lsSet("categories", u);       return u; });
    setResponsibles(p =>     { const u = merge(p, payload.responsibles!);     lsSet("responsibles", u);     return u; });
    setBudgets(p =>          { const u = merge(p, payload.budgets!);          lsSet("budgets", u);          return u; });
    setRecurring(p =>        { const u = merge(p, payload.recurring!);        lsSet("recurring", u);        return u; });
    setIncomes(p =>          { const u = merge(p, payload.incomes!);          lsSet("incomes", u);          return u; });
    setIncomeTypes(p =>      { const u = merge(p, payload.incomeTypes!);      lsSet("incomeTypes", u);      return u; });
    setRecurringIncomes(p => { const u = merge(p, payload.recurringIncomes!); lsSet("recurringIncomes", u); return u; });
    setRecurringSkips(p =>   { const u = merge(p, payload.recurringSkips!);   lsSet("recurringSkips", u);   return u; });
    setNotes(p =>            { const u = merge(p, payload.notes!);            lsSet("notes", u);            return u; });
    if (hasProfile) {
      payload.profile = prof;
      setProfile(prof!);
      lsSet("profile", prof);
    }

    syncWithServer(payload);
    return total;
  }, [syncWithServer]);

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
    isOnline, isConnected, realtime, serverReachable, needsAuth, authEnabled,
    deviceUser, setDeviceUser,
    notificationsEnabled, pendingCount, toasts,
    saveExpense, deleteItem, togglePaid, marcarPagas, forceSync, signIn, signOut, saveProfile,
    saveCategory, saveResponsible, saveBudget, saveRecurring,
    saveIncome, saveIncomeType, saveRecurringIncome, saveNote, restoreBackup,
    readPhoto, requestNotificationPermission, addToast, dismissToast,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
