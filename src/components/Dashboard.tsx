import React, { useMemo, useState } from "react";
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, LabelList,
} from "recharts";
import {
  format, startOfMonth, endOfMonth, isWithinInterval,
  parseISO, subMonths, addMonths, isAfter, startOfToday, differenceInDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronLeft, ChevronRight, Plus, TrendingDown, TrendingUp,
  AlertCircle, Bell, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { motion } from "motion/react";
import { useData } from "../context/DataContext";
import { formatCurrency, cn } from "../lib/utils";
import ExpenseModal from "./ExpenseModal";

interface Props {
  onDrillResponsible?: (respId: string) => void;
}

export default function Dashboard({ onDrillResponsible }: Props) {
  const { expenses, categories, responsibles, budgets } = useData();
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [showModal,     setShowModal]     = useState(false);

  const prevMonth = () => setSelectedMonth(m => subMonths(m, 1));
  const nextMonth = () => setSelectedMonth(m => addMonths(m, 1));

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
      id:    r.id,
      name:  r.name,
      value: monthExp.filter(e => e.responsible_id === r.id).reduce((s, e) => s + e.value, 0),
    })).filter(d => d.value > 0);

    return { totalMonth, pendingMonth, paidMonth, catData, topExpenses, respData };
  }, [expenses, categories, responsibles, selectedMonth]);

  // ── Previous month stats (for comparison) ────────────────────────────────────
  const prevMonthTotal = useMemo(() => {
    const prev  = subMonths(selectedMonth, 1);
    const start = startOfMonth(prev);
    const end   = endOfMonth(prev);
    return expenses
      .filter(e => {
        try { return isWithinInterval(parseISO(e.due_date), { start, end }); }
        catch { return false; }
      })
      .reduce((s, e) => s + e.value, 0);
  }, [expenses, selectedMonth]);

  const monthDelta = prevMonthTotal > 0
    ? ((stats.totalMonth - prevMonthTotal) / prevMonthTotal) * 100
    : null;

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
        name:      format(month, "MMM", { locale: ptBR }),
        total,
        isCurrent: format(month, "yyyy-MM") === format(new Date(), "yyyy-MM"),
      };
    });
  }, [expenses]);

  // ── Cashflow: paid vs pending per day in selected month ───────────────────────
  const cashflowData = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end   = endOfMonth(selectedMonth);
    const monthExp = expenses.filter(e => {
      try { return isWithinInterval(parseISO(e.due_date), { start, end }); }
      catch { return false; }
    });

    const days: Record<string, { dia: string; Pago: number; Pendente: number }> = {};
    for (const e of monthExp) {
      const day = e.due_date.slice(8, 10);
      if (!days[day]) days[day] = { dia: `${parseInt(day)}`, Pago: 0, Pendente: 0 };
      if (e.paid) days[day].Pago     += e.value;
      else        days[day].Pendente += e.value;
    }
    return Object.values(days).sort((a, b) => parseInt(a.dia) - parseInt(b.dia));
  }, [expenses, selectedMonth]);

  // ── Budget progress ────────────────────────────────────────────────────────────
  const monthKey     = format(selectedMonth, "yyyy-MM");
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

  // ── Upcoming due dates (next 7 days, unpaid) ──────────────────────────────────
  const upcoming = useMemo(() => {
    const today   = startOfToday();
    const in7days = new Date(today.getTime() + 7 * 86_400_000);
    return expenses
      .filter(e => {
        if (e.paid) return false;
        try {
          const d = parseISO(e.due_date);
          return d >= today && d <= in7days;
        } catch { return false; }
      })
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [expenses]);

  const totalGeneral = useMemo(
    () => expenses.reduce((s, e) => s + e.value, 0),
    [expenses],
  );

  // ── Responsible bar click → drill-down ────────────────────────────────────────
  const handleRespBarClick = (data: { id?: string; name: string }) => {
    if (!onDrillResponsible) return;
    const resp = responsibles.find(r => r.name === data.name);
    if (resp) onDrillResponsible(resp.id);
  };

  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      {/* ── Upcoming alerts ──────────────────────────────────────────────────── */}
      {upcoming.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bell size={14} className="text-amber-600" />
            <h3 className="text-xs font-black uppercase tracking-widest text-amber-700">
              Vencimentos nos Próximos 7 Dias
            </h3>
          </div>
          <div className="space-y-2">
            {upcoming.map(e => {
              const cat      = categories.find(c => c.id === e.category_id);
              const resp     = responsibles.find(r => r.id === e.responsible_id);
              const dueDate  = parseISO(e.due_date);
              const days     = differenceInDays(dueDate, startOfToday());
              return (
                <div key={e.id} className="flex items-center justify-between gap-2 bg-white/60 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn(
                      "w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-black shrink-0",
                      days === 0 ? "bg-red-500" : days <= 2 ? "bg-orange-500" : "bg-amber-500",
                    )}>
                      {dueDate.getDate()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{e.description}</p>
                      <p className="text-[10px] text-slate-500">{cat?.name} · {resp?.name}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-black text-slate-800">R$ {formatCurrency(e.value)}</p>
                    <p className={cn(
                      "text-[10px] font-bold",
                      days === 0 ? "text-red-600" : "text-amber-600",
                    )}>
                      {days === 0 ? "Hoje!" : days === 1 ? "Amanhã" : `Em ${days} dias`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Month nav + add button ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-black uppercase tracking-widest w-32 text-center">
            {format(selectedMonth, "MMM yyyy", { locale: ptBR })}
          </span>
          <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
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

      {/* ── Stats cards with month comparison ────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Total do mês with comparison */}
        <div className="card p-5 md:col-span-2">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total do Mês</p>
          <p className="text-2xl font-black tracking-tighter text-slate-900">
            R$ {formatCurrency(stats.totalMonth)}
          </p>
          {monthDelta !== null && (
            <div className={cn(
              "flex items-center gap-1 mt-1 text-[10px] font-bold",
              monthDelta > 0 ? "text-red-500" : monthDelta < 0 ? "text-emerald-600" : "text-slate-400",
            )}>
              {monthDelta > 0
                ? <ArrowUpRight size={12} />
                : monthDelta < 0
                ? <ArrowDownRight size={12} />
                : <Minus size={12} />}
              <span>
                {monthDelta > 0 ? "+" : ""}{monthDelta.toFixed(1)}% vs mês anterior
                {" "}(R$ {formatCurrency(prevMonthTotal)})
              </span>
            </div>
          )}
          {monthDelta === null && prevMonthTotal === 0 && stats.totalMonth > 0 && (
            <p className="text-[10px] text-slate-400 mt-1">Sem dados do mês anterior</p>
          )}
        </div>

        <div className="card p-5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pendente</p>
          <p className="text-2xl font-black tracking-tighter text-red-500">
            R$ {formatCurrency(stats.pendingMonth)}
          </p>
        </div>

        <div className="card p-5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pago</p>
          <p className="text-2xl font-black tracking-tighter text-emerald-600">
            R$ {formatCurrency(stats.paidMonth)}
          </p>
        </div>
      </div>

      {/* ── Budget progress ────────────────────────────────────────────────────── */}
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

      {/* ── Charts row 1 ─────────────────────────────────────────────────────── */}
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

        {/* Bar: Top categories */}
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

        {/* Horizontal bar: By responsible — CLICKABLE */}
        {stats.respData.length > 0 && (
          <div className="card p-6 md:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Por Responsável</h3>
              {onDrillResponsible && (
                <p className="text-[10px] text-slate-400 font-medium">Clique na barra para ver detalhes</p>
              )}
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.respData} layout="vertical" margin={{ right: 80 }}>
                  <XAxis type="number" fontSize={10} hide />
                  <YAxis dataKey="name" type="category" fontSize={11} axisLine={false} tickLine={false} width={90} />
                  <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  <Bar
                    dataKey="value"
                    fill="#3b82f6"
                    radius={[0, 4, 4, 0]}
                    style={{ cursor: onDrillResponsible ? "pointer" : "default" }}
                    onClick={handleRespBarClick}
                  >
                    <LabelList dataKey="value" position="right" fontSize={10} formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Cashflow: paid vs pending by day ─────────────────────────────────── */}
        {cashflowData.length > 0 && (
          <div className="card p-6 md:col-span-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6">
              Fluxo de Caixa — {format(selectedMonth, "MMMM yyyy", { locale: ptBR })}
            </h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashflowData} margin={{ top: 10, right: 10 }}>
                  <XAxis dataKey="dia" fontSize={10} axisLine={false} tickLine={false}
                    label={{ value: "Dia", position: "insideBottom", offset: -2, fontSize: 10 }} />
                  <YAxis fontSize={10} hide />
                  <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Pago"     fill="#10b981" radius={[4, 4, 0, 0]} stackId="a" />
                  <Bar dataKey="Pendente" fill="#f87171" radius={[4, 4, 0, 0]} stackId="a" />
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
