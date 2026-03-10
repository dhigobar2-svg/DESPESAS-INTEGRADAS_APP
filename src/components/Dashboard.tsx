import React, { useMemo, useState } from "react";
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, LabelList,
} from "recharts";
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO, subMonths, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, TrendingDown, TrendingUp, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { useData } from "../context/DataContext";
import { formatCurrency } from "../lib/utils";
import { cn } from "../lib/utils";
import ExpenseModal from "./ExpenseModal";

export default function Dashboard() {
  const { expenses, categories, responsibles, budgets } = useData();
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [showModal, setShowModal] = useState(false);

  const prevMonth = () => setSelectedMonth(m => subMonths(m, 1));
  const nextMonth = () => setSelectedMonth(m => addMonths(m, 1));
  const isCurrentMonth = format(selectedMonth, "yyyy-MM") === format(new Date(), "yyyy-MM");

  // ── Month stats ───────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end   = endOfMonth(selectedMonth);

    const monthExp = expenses.filter(e => {
      try { return isWithinInterval(parseISO(e.due_date), { start, end }); }
      catch { return false; }
    });

    const totalMonth   = monthExp.reduce((s, e) => s + e.value, 0);
    const pendingMonth = monthExp.filter(e => !e.paid).reduce((s, e) => s + e.value, 0);
    const paidMonth    = monthExp.filter(e =>  e.paid).reduce((s, e) => s + e.value, 0);

    const catData = categories.map(cat => ({
      name:  cat.name,
      value: monthExp.filter(e => e.category_id === cat.id).reduce((s, e) => s + e.value, 0),
      color: cat.color,
    })).filter(d => d.value > 0);

    const topExpenses = [...catData].sort((a, b) => b.value - a.value).slice(0, 5);

    const respData = responsibles.map(r => ({
      name:  r.name,
      value: monthExp.filter(e => e.responsible_id === r.id).reduce((s, e) => s + e.value, 0),
    })).filter(d => d.value > 0);

    return { totalMonth, pendingMonth, paidMonth, catData, topExpenses, respData };
  }, [expenses, categories, responsibles, selectedMonth]);

  // ── Annual history (last 12 months) ──────────────────────────────────────────
  const annualData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const month = subMonths(new Date(), 11 - i);
      const start = startOfMonth(month);
      const end   = endOfMonth(month);
      const total = expenses
        .filter(e => {
          try { return isWithinInterval(parseISO(e.due_date), { start, end }); }
          catch { return false; }
        })
        .reduce((s, e) => s + e.value, 0);
      return {
        name:  format(month, "MMM", { locale: ptBR }),
        total,
        isCurrent: format(month, "yyyy-MM") === format(new Date(), "yyyy-MM"),
      };
    });
  }, [expenses]);

  // ── Budget progress ────────────────────────────────────────────────────────────
  const monthKey = format(selectedMonth, "yyyy-MM");
  const monthBudgets = useMemo(() => {
    return budgets
      .filter(b => b.month === monthKey)
      .map(b => {
        const cat   = categories.find(c => c.id === b.category_id);
        const spent = stats.catData.find(d => d.name === cat?.name)?.value ?? 0;
        const pct   = b.limit_value > 0 ? (spent / b.limit_value) * 100 : 0;
        return { ...b, catName: cat?.name ?? "—", catColor: cat?.color ?? "#94a3b8", spent, pct };
      });
  }, [budgets, monthKey, categories, stats.catData]);

  const totalGeneral = useMemo(
    () => expenses.reduce((s, e) => s + e.value, 0),
    [expenses],
  );

  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-black uppercase tracking-widest w-32 text-center">
            {format(selectedMonth, "MMM yyyy", { locale: ptBR })}
          </span>
          <button
            onClick={nextMonth}
            disabled={isCurrentMonth}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-emerald-600 text-white p-2.5 rounded-full shadow-lg hover:bg-emerald-700 transition-transform active:scale-95"
        >
          <Plus size={22} />
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total do Mês",  value: stats.totalMonth,   color: "text-slate-900" },
          { label: "Pendente",      value: stats.pendingMonth, color: "text-red-500" },
          { label: "Pago",          value: stats.paidMonth,    color: "text-emerald-600" },
          { label: "Total Geral",   value: totalGeneral,       color: "text-blue-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-5">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
            <p className={cn("text-2xl font-black tracking-tighter", color)}>
              R$ {formatCurrency(value)}
            </p>
          </div>
        ))}
      </div>

      {/* Budget progress */}
      {monthBudgets.length > 0 && (
        <div className="card p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Orçamentos do Mês</h3>
          <div className="space-y-4">
            {monthBudgets.map(b => (
              <div key={b.id}>
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: b.catColor }} />
                    <span className="text-xs font-bold text-slate-700">{b.catName}</span>
                    {b.pct >= 100 && <AlertCircle size={14} className="text-red-500" />}
                  </div>
                  <span className={cn("text-xs font-black", b.pct >= 100 ? "text-red-600" : b.pct >= 80 ? "text-amber-600" : "text-slate-600")}>
                    R$ {formatCurrency(b.spent)} / R$ {formatCurrency(b.limit_value)}
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div
                    className={cn(
                      "h-2 rounded-full transition-all",
                      b.pct >= 100 ? "bg-red-500" : b.pct >= 80 ? "bg-amber-500" : "bg-emerald-500",
                    )}
                    style={{ width: `${Math.min(b.pct, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pie: Categories */}
        <div className="card p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6">Categorias do Mês</h3>
          {stats.catData.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-10">Sem despesas neste mês</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.catData} innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value"
                    label={({ value }) => `R$ ${formatCurrency(value)}`} labelLine={false}>
                    {stats.catData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Bar: Top expenses by category */}
        <div className="card p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6">Maiores Categorias</h3>
          {stats.topExpenses.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-10">Sem despesas neste mês</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.topExpenses} margin={{ top: 24, bottom: 24 }}>
                  <XAxis dataKey="name" fontSize={10} hide />
                  <YAxis fontSize={10} hide />
                  <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="value" position="top" fontSize={10} formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                    <LabelList dataKey="name" position="insideBottom" fontSize={9} offset={8} fill="#fff" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Horizontal bar: By responsible */}
        {stats.respData.length > 0 && (
          <div className="card p-6 md:col-span-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6">Por Responsável</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.respData} layout="vertical" margin={{ right: 80 }}>
                  <XAxis type="number" fontSize={10} hide />
                  <YAxis dataKey="name" type="category" fontSize={11} axisLine={false} tickLine={false} width={90} />
                  <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="value" position="right" fontSize={10} formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Annual history */}
        <div className="card p-6 md:col-span-2">
          <div className="flex items-center gap-2 mb-6">
            <TrendingDown size={16} className="text-slate-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Histórico dos Últimos 12 Meses</h3>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={annualData} margin={{ top: 16 }}>
                <XAxis dataKey="name" fontSize={11} axisLine={false} tickLine={false} />
                <YAxis fontSize={10} hide />
                <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {annualData.map((entry, i) => (
                    <Cell key={i} fill={entry.isCurrent ? "#10b981" : "#cbd5e1"} />
                  ))}
                  <LabelList
                    dataKey="total"
                    position="top"
                    fontSize={9}
                    formatter={(v: number) => v > 0 ? `R$ ${formatCurrency(v)}` : ""}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <ExpenseModal open={showModal} editing={null} onClose={() => setShowModal(false)} />
    </motion.div>
  );
}
