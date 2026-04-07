import React, { useState } from "react";
import { AnimatePresence } from "motion/react";
import {
  BarChart3, ListOrdered, Settings as SettingsIcon,
  ChevronLeft, ChevronRight, Wifi, WifiOff, CalendarClock,
  TrendingUp, NotebookPen,
} from "lucide-react";
import { DataProvider, useData } from "./context/DataContext";
import { cn, formatCurrency } from "./lib/utils";
import Toast from "./components/Toast";
import Dashboard from "./components/Dashboard";
import ExpenseList from "./components/ExpenseList";
import FutureExpenses from "./components/FutureExpenses";
import Incomes from "./components/Incomes";
import Notes from "./components/Notes";
import Settings from "./components/Settings";

type Tab = "menu" | "overview" | "expenses" | "futures" | "incomes" | "notes" | "settings";

// ─── Inner shell (has access to DataContext) ──────────────────────────────────

function Shell() {
  const { profile, isOnline, isConnected, expenses, recurring, incomes } = useData();
  const [activeTab, setActiveTab] = useState<Tab>("menu");

  const now = new Date();
  const mm  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const totalMonth = expenses
    .filter(e => e.due_date?.startsWith(mm))
    .reduce((s, e) => s + e.value, 0);

  // Pending = current month unpaid + any overdue from previous months
  const pendingMonth = expenses
    .filter(e => !e.paid && (e.due_date?.startsWith(mm) || (e.due_date && e.due_date < mm)))
    .reduce((s, e) => s + e.value, 0);

  const today   = now.toISOString().slice(0, 10);
  const in7days = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

  // Virtual future dates from active recurring expenses (not yet auto-created as real expenses)
  const virtualRecurringFutureDates: string[] = [];
  for (const rec of recurring.filter(r => r.active)) {
    for (let mo = 0; mo <= 2; mo++) {
      const d = new Date(now.getFullYear(), now.getMonth() + mo, rec.day_of_month);
      if (d.getDate() !== rec.day_of_month) continue; // overflow (e.g. Feb 31)
      const yr = String(d.getFullYear());
      const mn = String(d.getMonth() + 1).padStart(2, "0");
      const dy = String(d.getDate()).padStart(2, "0");
      const dateStr = `${yr}-${mn}-${dy}`;
      if (dateStr <= today) continue;
      const alreadyExists = expenses.some(
        e => !e.paid && e.description === rec.description && e.due_date === dateStr && e.value === rec.value,
      );
      if (!alreadyExists) virtualRecurringFutureDates.push(dateStr);
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

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    window.scrollTo(0, 0);
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
            {isOnline ? (
              <div className="flex items-center gap-1.5" title={isConnected ? "Conectado" : "Reconectando…"}>
                <Wifi size={14} className={cn(isConnected ? "text-emerald-500" : "text-amber-400")} />
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-400 animate-pulse",
                )} />
              </div>
            ) : (
              <div className="flex items-center gap-1.5" title="Offline">
                <WifiOff size={14} className="text-red-500" />
                <div className="w-2 h-2 rounded-full bg-red-500" />
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

      {/* Content */}
      <main className="max-w-4xl mx-auto p-4">
        <AnimatePresence mode="wait">
          {activeTab === "menu" && (
            <div className="space-y-4 pt-4">
              {/* Welcome card */}
              <div className="bg-emerald-600 p-6 rounded-[2.5rem] text-white mb-8 shadow-2xl shadow-emerald-200 relative overflow-hidden">
                <div className="relative z-10">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80 mb-1">Bem-vindo(a) novamente,</p>
                  <h2 className="text-2xl font-black tracking-tighter mb-4">{profile.name}</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Total Geral */}
                    <div className="bg-white/20 backdrop-blur-md p-3 rounded-2xl">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Total Geral</p>
                      <p className="text-base font-black truncate">R$ {formatCurrency(totalMonth)}</p>
                    </div>
                    {/* Pendente */}
                    <div className={cn(
                      "backdrop-blur-md p-3 rounded-2xl border",
                      pendingMonth > 0 ? "bg-red-500/40 border-red-300/40" : "bg-white/20 border-white/0",
                    )}>
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-90">
                        {pendingMonth > 0 ? "⚠ Pendente" : "Pendente"}
                      </p>
                      <p className="text-base font-black truncate">R$ {formatCurrency(pendingMonth)}</p>
                    </div>
                    {/* Entradas */}
                    <div className="bg-white/20 backdrop-blur-md p-3 rounded-2xl">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Entradas</p>
                      <p className="text-base font-black truncate">R$ {formatCurrency(incomeMonth)}</p>
                    </div>
                    {/* Saldo */}
                    <div className={cn(
                      "backdrop-blur-md p-3 rounded-2xl border",
                      balanceMonth >= 0 ? "bg-white/20 border-white/20" : "bg-red-500/40 border-red-300/40",
                    )}>
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Saldo</p>
                      <p className="text-base font-black truncate">
                        {balanceMonth >= 0 ? "+" : ""}R$ {formatCurrency(balanceMonth)}
                      </p>
                    </div>
                    {/* Vence em breve */}
                    <div className={cn(
                      "backdrop-blur-md p-3 rounded-2xl border",
                      urgentFutureCount > 0 ? "bg-amber-500/40 border-amber-300/40" : "bg-white/20 border-white/0",
                    )}>
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-90">
                        {urgentFutureCount > 0 ? "⚠ Vence em breve" : "Vence em breve"}
                      </p>
                      <p className="text-base font-black">
                        {urgentFutureCount > 0 ? urgentFutureCount : (futureCount > 0 ? futureCount : "—")}
                      </p>
                    </div>
                    {/* Recorrente/mês */}
                    <div className="bg-white/20 backdrop-blur-md p-3 rounded-2xl">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Recorrente/mês</p>
                      <p className="text-base font-black truncate">R$ {formatCurrency(recurringTotal)}</p>
                    </div>
                  </div>
                </div>
                <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
              </div>

              <MenuButton icon={BarChart3}     title="Visão Geral"       subtitle="Gráficos e Estatísticas"
                onClick={() => handleTabChange("overview")}  colorClass="bg-blue-500" />
              <MenuButton icon={ListOrdered}   title="Minhas Despesas"   subtitle="Lista e Histórico"
                onClick={() => handleTabChange("expenses")}  colorClass="bg-emerald-500" />
              <MenuButton icon={CalendarClock} title="Despesas Futuras"  subtitle="Próximos vencimentos"
                onClick={() => handleTabChange("futures")}   colorClass="bg-violet-500"
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

          {activeTab === "overview"  && <Dashboard />}
          {activeTab === "expenses"  && <ExpenseList />}
          {activeTab === "futures"   && <FutureExpenses />}
          {activeTab === "incomes"   && <Incomes />}
          {activeTab === "notes"     && <Notes />}
          {activeTab === "settings"  && <Settings />}
        </AnimatePresence>
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
