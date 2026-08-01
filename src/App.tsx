import React, { useState, useEffect, lazy, Suspense } from "react";
import { format } from "date-fns";
import {
  BarChart3, ListOrdered, Settings as SettingsIcon,
  ChevronLeft, ChevronRight, Wifi, WifiOff, HardDrive,
  TrendingUp, NotebookPen, Loader2, UploadCloud,
} from "lucide-react";
import { DataProvider, useData } from "./context/DataContext";
import { cn, formatCurrency, isRecurringCovered, recurringDueDate, buildSkipSet } from "./lib/utils";
import Toast from "./components/Toast";

// Lazy-loaded tabs keep the heavy chart/PDF libraries out of the initial bundle.
const Dashboard         = lazy(() => import("./components/Dashboard"));
const ExpenseList       = lazy(() => import("./components/ExpenseList"));
const Incomes           = lazy(() => import("./components/Incomes"));
const Notes             = lazy(() => import("./components/Notes"));
const Settings          = lazy(() => import("./components/Settings"));

type Tab = "menu" | "overview" | "expenses" | "incomes" | "notes" | "settings";
type FutureFilter = "upcoming" | "pending" | "recurring" | undefined;

// State stored in browser history entries so the system/browser back button
// navigates inside the app instead of leaving it.
interface NavState {
  despTab?: Tab;
  view?: "list" | "futures";
  filter?: FutureFilter;
  dateRange?: { from: string; to: string } | null;
  noteEditor?: boolean; // entry owned by the Notes full-screen editor
}

// ─── Inner shell (has access to DataContext) ──────────────────────────────────

function Shell() {
  const { profile, isOnline, isConnected, realtime, serverReachable, pendingCount, forceSync, expenses, recurring, recurringSkips, incomes } = useData();
  const skipSet = buildSkipSet(recurringSkips);
  const [activeTab, setActiveTab] = useState<Tab>("menu");
  // Drives the "Minhas Despesas" sub-tab (full list vs. próximos vencimentos).
  const [expensesView,   setExpensesView]   = useState<"list" | "futures">("list");
  const [futuresFilter,  setFuturesFilter]  = useState<FutureFilter>(undefined);
  const [expensesDateRange, setExpensesDateRange] = useState<{ from: string; to: string } | null>(null);
  const [expensesNonce,  setExpensesNonce]  = useState(0);

  const now = new Date();
  const mm  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const totalMonth = expenses
    .filter(e => e.due_date?.startsWith(mm))
    .reduce((s, e) => s + e.value, 0);

  // Pending = current month unpaid + any overdue from previous months
  const pendingMonth = expenses
    .filter(e => !e.paid && (e.due_date?.startsWith(mm) || (e.due_date && e.due_date < mm)))
    .reduce((s, e) => s + e.value, 0);

  // Local (não UTC): em UTC-3 o dia "virava" às 21h e os contadores de
  // vencidas / vence em breve ficavam errados até a meia-noite.
  const today   = format(now, "yyyy-MM-dd");
  const in7days = format(new Date(now.getTime() + 7 * 86_400_000), "yyyy-MM-dd");

  // Virtual future dates from active recurring expenses (not yet auto-created
  // as real expenses). A paid occurrence counts as covered — otherwise the
  // badges keep counting months the user already settled.
  const virtualRecurringFutureDates: string[] = [];
  for (const rec of recurring.filter(r => r.active)) {
    for (let mo = 0; mo <= 2; mo++) {
      const base = new Date(now.getFullYear(), now.getMonth() + mo, 1);
      const dateStr = recurringDueDate(base.getFullYear(), base.getMonth() + 1, rec.day_of_month);
      if (dateStr <= today) continue;
      if (!isRecurringCovered(expenses, rec, dateStr, { skips: skipSet })) {
        virtualRecurringFutureDates.push(dateStr);
      }
    }
  }

  const futureCount = expenses.filter(e => {
    try { return !e.paid && e.due_date > today; }
    catch { return false; }
  }).length + virtualRecurringFutureDates.length;

  // Expenses due within the next 7 days (urgent alert)
  const urgentFutureCount = expenses.filter(e => {
    try { return !e.paid && e.due_date > today && e.due_date <= in7days; }
    catch { return false; }
  }).length + virtualRecurringFutureDates.filter(d => d <= in7days).length;


  const recurringTotal = recurring
    .filter(r => r.active)
    .reduce((s, r) => s + r.value, 0);

  const recurringCount = recurring.filter(r => r.active).length;

  // Income for current month
  const incomeMonth = incomes
    .filter(i => i.date?.startsWith(mm))
    .reduce((s, i) => s + i.value, 0);

  const balanceMonth = incomeMonth - totalMonth;

  // Apply a navigation state to the UI (used by both in-app navigation and the
  // browser/system back button via popstate).
  const applyNav = (st: NavState | null) => {
    setActiveTab(st?.despTab ?? "menu");
    setExpensesView(st?.view ?? "list");
    setFuturesFilter(st?.filter);
    setExpensesDateRange(st?.dateRange ?? null);
    setExpensesNonce(n => n + 1);
    window.scrollTo(0, 0);
  };

  // Browser-history integration: every screen gets its own history entry, so
  // the system/browser back button navigates inside the app (menu ← tab ←
  // editor) instead of leaving the page.
  useEffect(() => {
    try { history.replaceState({ despTab: "menu" } as NavState, ""); } catch { /* ignore */ }
    const onPop = (ev: PopStateEvent) => {
      const st = ev.state as NavState | null;
      if (st?.noteEditor) return; // that entry belongs to the notes editor
      applyNav(st);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = (st: NavState) => {
    try { history.pushState(st, ""); } catch { /* ignore */ }
    applyNav(st);
  };

  const handleTabChange = (tab: Tab) => {
    if (tab === "menu") {
      // Going back to the menu consumes the history entry pushed when the tab
      // was opened, keeping the in-app arrow and the system back in sync.
      const cur = history.state as NavState | null;
      if (cur?.despTab && cur.despTab !== "menu") { history.back(); return; }
      applyNav({ despTab: "menu" });
      return;
    }
    navigate({ despTab: tab });
  };

  // Open "Minhas Despesas" already on the upcoming/overdue sub-tab with a filter.
  const goToFutures = (filter?: FutureFilter) => navigate({ despTab: "expenses", view: "futures", filter });

  const goToIncomes = () => navigate({ despTab: "incomes" });

  // Open the full expense list filtered to the current month (Total Geral tile).
  const goToMonthExpenses = () => {
    const from = `${mm}-01`;
    const to   = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd");
    navigate({ despTab: "expenses", view: "list", dateRange: { from, to } });
  };

  const MenuButton = ({
    icon: Icon, title, subtitle, onClick, colorClass, badge, badgeUrgent, urgentCount,
  }: {
    icon: React.ElementType; title: string; subtitle: string;
    onClick: () => void; colorClass: string;
    badge?: number; badgeUrgent?: boolean; urgentCount?: number;
  }) => (
    <button
      onClick={onClick}
      className="w-full bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex items-center gap-6 text-left group active:scale-[0.98]"
    >
      <div className={cn("p-4 rounded-2xl text-white shadow-lg transition-transform group-hover:scale-110 relative", colorClass)}>
        <Icon size={32} />
        {/* Numeric badge — amber when urgent, red otherwise */}
        {badge !== undefined && badge > 0 && (
          <span className={cn(
            "absolute -top-1.5 -right-1.5 w-5 h-5 text-white text-[10px] font-black rounded-full flex items-center justify-center",
            badgeUrgent ? "bg-amber-500" : "bg-red-500",
          )}>
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-black tracking-tighter uppercase">{title}</h3>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{subtitle}</p>
        {badgeUrgent && urgentCount !== undefined && urgentCount > 0 && (
          <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mt-0.5">
            ⚠ {urgentCount} vence{urgentCount > 1 ? "m" : ""} em até 7 dias
          </p>
        )}
      </div>
      <ChevronRight className="text-slate-300 group-hover:text-slate-600 transition-colors" />
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="w-10">
            {activeTab !== "menu" && (
              <button onClick={() => handleTabChange("menu")}
                className="p-2 -ml-2 text-slate-400 hover:text-slate-900 transition-colors">
                <ChevronLeft size={24} />
              </button>
            )}
          </div>

          <h1 className="text-xl font-black tracking-tighter text-center uppercase">
            Despesas Integradas
          </h1>

          {/* Connection status */}
          <div className="flex items-center gap-1.5">
            {/* Alterações ainda não confirmadas pelo servidor (fila de envio) */}
            {pendingCount > 0 && (
              <button
                onClick={forceSync}
                className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 hover:bg-amber-100 active:scale-95 transition-all"
                title={`${pendingCount} alteraç${pendingCount > 1 ? "ões" : "ão"} aguardando envio — toque para sincronizar agora`}
              >
                <UploadCloud size={12} className="text-amber-500" />
                <span className="text-[10px] font-black text-amber-600">{pendingCount}</span>
              </button>
            )}
            {!isOnline ? (
              <div className="flex items-center gap-1.5" title="Offline">
                <WifiOff size={14} className="text-red-500" />
                <div className="w-2 h-2 rounded-full bg-red-500" />
              </div>
            ) : !serverReachable ? (
              <div className="flex items-center gap-1.5" title="Modo local — sem servidor">
                <HardDrive size={14} className="text-slate-400" />
                <div className="w-2 h-2 rounded-full bg-slate-300" />
              </div>
            ) : (
              // Sem Socket.IO (backend serverless) "conectado" é o estado normal:
              // os dados vão para o banco do mesmo jeito, só sem push em tempo real.
              <div className="flex items-center gap-1.5" title={isConnected || !realtime ? "Conectado ao servidor" : "Reconectando…"}>
                <Wifi size={14} className={cn(isConnected || !realtime ? "text-emerald-500" : "text-amber-400")} />
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  isConnected || !realtime ? "bg-emerald-500 animate-pulse" : "bg-amber-400 animate-pulse",
                )} />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-widest">
            Modo offline — alterações serão sincronizadas ao reconectar
          </p>
        </div>
      )}

      {/* Local-only banner — online but no backend reachable (e.g. static host) */}
      {isOnline && !serverReachable && (
        <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-center">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
            Modo local — sem servidor; os dados ficam apenas neste dispositivo
          </p>
        </div>
      )}

      {/* Content */}
      <main className="max-w-4xl mx-auto p-4">
        <>
          {activeTab === "menu" && (
            <div className="space-y-4 pt-4">
              {/* Welcome card */}
              <div className="bg-emerald-600 p-6 rounded-[2.5rem] text-white mb-8 shadow-2xl shadow-emerald-200 relative overflow-hidden">
                <div className="relative z-10">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80 mb-1">Bem-vindo(a) novamente,</p>
                  <h2 className="text-2xl font-black tracking-tighter mb-4">{profile.name}</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Total Geral → lista de despesas do mês */}
                    <button
                      onClick={goToMonthExpenses}
                      className="bg-white/20 backdrop-blur-md p-3 rounded-2xl text-left w-full transition-all active:scale-95"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Total Geral</p>
                      <p className="text-base font-black truncate">R$ {formatCurrency(totalMonth)}</p>
                    </button>
                    {/* Pendente */}
                    <button
                      onClick={() => goToFutures("pending")}
                      className={cn(
                        "backdrop-blur-md p-3 rounded-2xl border text-left w-full transition-all active:scale-95",
                        pendingMonth > 0 ? "bg-red-500/40 border-red-300/40" : "bg-white/20 border-white/0",
                      )}
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-90">
                        {pendingMonth > 0 ? "⚠ Pendente" : "Pendente"}
                      </p>
                      <p className="text-base font-black truncate">R$ {formatCurrency(pendingMonth)}</p>
                    </button>
                    {/* Entradas */}
                    <button
                      onClick={goToIncomes}
                      className="bg-white/20 backdrop-blur-md p-3 rounded-2xl text-left w-full transition-all active:scale-95"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Entradas</p>
                      <p className="text-base font-black truncate">R$ {formatCurrency(incomeMonth)}</p>
                    </button>
                    {/* Saldo → visão geral (entradas × saídas do mês) */}
                    <button
                      onClick={() => handleTabChange("overview")}
                      className={cn(
                        "backdrop-blur-md p-3 rounded-2xl border text-left w-full transition-all active:scale-95",
                        balanceMonth >= 0 ? "bg-white/20 border-white/20" : "bg-red-500/40 border-red-300/40",
                      )}
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Saldo</p>
                      <p className="text-base font-black truncate">
                        {balanceMonth >= 0 ? "+" : ""}R$ {formatCurrency(balanceMonth)}
                      </p>
                    </button>
                    {/* Vence em breve */}
                    <button
                      onClick={() => goToFutures("upcoming")}
                      className={cn(
                        "backdrop-blur-md p-3 rounded-2xl border text-left w-full transition-all active:scale-95",
                        urgentFutureCount > 0 ? "bg-amber-500/40 border-amber-300/40" : "bg-white/20 border-white/0",
                      )}
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-90">Vence em breve</p>
                      <p className="text-base font-black">
                        {urgentFutureCount > 0 ? urgentFutureCount : (futureCount > 0 ? futureCount : "—")}
                      </p>
                    </button>
                    {/* Recorrente/mês */}
                    <button
                      onClick={() => goToFutures("recurring")}
                      className="bg-white/20 backdrop-blur-md p-3 rounded-2xl text-left w-full transition-all active:scale-95"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Recorrente/mês</p>
                      <p className="text-base font-black truncate">R$ {formatCurrency(recurringTotal)}</p>
                    </button>
                  </div>
                </div>
                <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
              </div>

              <MenuButton icon={BarChart3}     title="Visão Geral"       subtitle="Gráficos e Estatísticas"
                onClick={() => handleTabChange("overview")}  colorClass="bg-blue-500" />
              <MenuButton icon={ListOrdered}   title="Minhas Despesas"   subtitle="Lançamentos e vencimentos"
                onClick={() => handleTabChange("expenses")}  colorClass="bg-emerald-500"
                badge={urgentFutureCount > 0 ? urgentFutureCount : futureCount}
                badgeUrgent={urgentFutureCount > 0}
                urgentCount={urgentFutureCount}
              />
              <MenuButton icon={TrendingUp}    title="Entradas / Receitas" subtitle="Salário e rendas"
                onClick={() => handleTabChange("incomes")}   colorClass="bg-teal-500" />
              <MenuButton icon={NotebookPen}   title="Bloco de Notas"    subtitle="Anotações e lembretes"
                onClick={() => handleTabChange("notes")}     colorClass="bg-amber-500" />
              <MenuButton icon={SettingsIcon}  title="Configurações"     subtitle="Ajustes e Perfil"
                onClick={() => handleTabChange("settings")}  colorClass="bg-slate-700" />
            </div>
          )}

          <Suspense fallback={
            <div className="flex items-center justify-center py-24">
              <Loader2 className="animate-spin text-emerald-500" size={32} />
            </div>
          }>
            {activeTab === "overview"  && <Dashboard />}
            {activeTab === "expenses"  && (
              <ExpenseList
                key={`exp-${expensesNonce}`}
                initialView={expensesView}
                initialFutureFilter={futuresFilter}
                initialDateFrom={expensesDateRange?.from}
                initialDateTo={expensesDateRange?.to}
              />
            )}
            {activeTab === "incomes"   && <Incomes />}
            {activeTab === "notes"     && <Notes />}
            {activeTab === "settings"  && <Settings />}
          </Suspense>
        </>
      </main>

      <Toast />
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}
