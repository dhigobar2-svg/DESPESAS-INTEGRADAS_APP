import React, { useState } from "react";
import { AnimatePresence } from "motion/react";
import { BarChart3, ListOrdered, Settings as SettingsIcon, ChevronLeft, ChevronRight, Wifi, WifiOff } from "lucide-react";
import { DataProvider, useData } from "./context/DataContext";
import { cn, formatCurrency } from "./lib/utils";
import Toast from "./components/Toast";
import Dashboard from "./components/Dashboard";
import ExpenseList from "./components/ExpenseList";
import Settings from "./components/Settings";

type Tab = "menu" | "overview" | "expenses" | "settings";

// ─── Inner shell (has access to DataContext) ──────────────────────────────────

function Shell() {
  const { profile, isOnline, isConnected, expenses, categories } = useData();
  const [activeTab, setActiveTab] = useState<Tab>("menu");

  const totalMonth = (() => {
    const now = new Date();
    const mm  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return expenses
      .filter(e => e.due_date?.startsWith(mm))
      .reduce((s, e) => s + e.value, 0);
  })();

  const pendingMonth = (() => {
    const now = new Date();
    const mm  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return expenses
      .filter(e => e.due_date?.startsWith(mm) && !e.paid)
      .reduce((s, e) => s + e.value, 0);
  })();

  const MenuButton = ({
    icon: Icon, title, subtitle, onClick, colorClass,
  }: { icon: React.ElementType; title: string; subtitle: string; onClick: () => void; colorClass: string }) => (
    <button
      onClick={onClick}
      className="w-full bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex items-center gap-6 text-left group active:scale-[0.98]"
    >
      <div className={cn("p-4 rounded-2xl text-white shadow-lg transition-transform group-hover:scale-110", colorClass)}>
        <Icon size={32} />
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-black tracking-tighter uppercase">{title}</h3>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{subtitle}</p>
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
              <button onClick={() => setActiveTab("menu")}
                className="p-2 -ml-2 text-slate-400 hover:text-slate-900 transition-colors">
                <ChevronLeft size={24} />
              </button>
            )}
          </div>

          <h1 className="text-xl font-black tracking-tighter text-center uppercase">
            Despesas Integradas
          </h1>

          {/* Connection status */}
          <div className="flex items-center gap-2">
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
              <div className="bg-emerald-600 p-8 rounded-[2.5rem] text-white mb-8 shadow-2xl shadow-emerald-200 relative overflow-hidden">
                <div className="relative z-10">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80 mb-1">Bem-vindo de volta,</p>
                  <h2 className="text-3xl font-black tracking-tighter mb-5">{profile.name}</h2>
                  <div className="flex gap-3 flex-wrap">
                    <div className="bg-white/20 backdrop-blur-md p-3 rounded-2xl">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Total Mês</p>
                      <p className="text-xl font-black">R$ {formatCurrency(totalMonth)}</p>
                    </div>
                    <div className="bg-white/20 backdrop-blur-md p-3 rounded-2xl">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Pendentes</p>
                      <p className="text-xl font-black">R$ {formatCurrency(pendingMonth)}</p>
                    </div>
                  </div>
                </div>
                <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
              </div>

              <MenuButton icon={BarChart3}    title="Visão Geral"      subtitle="Gráficos e Estatísticas"
                onClick={() => setActiveTab("overview")}  colorClass="bg-blue-500" />
              <MenuButton icon={ListOrdered}  title="Minhas Despesas"  subtitle="Lista e Histórico"
                onClick={() => setActiveTab("expenses")}  colorClass="bg-emerald-500" />
              <MenuButton icon={SettingsIcon} title="Configurações"    subtitle="Ajustes e Perfil"
                onClick={() => setActiveTab("settings")}  colorClass="bg-slate-700" />
            </div>
          )}

          {activeTab === "overview"  && <Dashboard />}
          {activeTab === "expenses"  && <ExpenseList />}
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
