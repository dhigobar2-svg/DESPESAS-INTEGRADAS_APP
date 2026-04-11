import React, { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell,
  ResponsiveContainer, LabelList, ReferenceLine,
} from "recharts";
import {
  format, startOfMonth, endOfMonth, isWithinInterval,
  parseISO, subMonths, addMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronLeft, ChevronRight, Plus, TrendingDown, TrendingUp,
  AlertCircle, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { motion } from "motion/react";
import { useData } from "../context/DataContext";
import { formatCurrency, cn } from "../lib/utils";
import ExpenseModal from "./ExpenseModal";

export default function Dashboard() {
  const { expenses, categories, responsibles, budgets, recurring, incomes } = useData();
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [showModal,     setShowModal]     = useState(false);

  const prevMonth = () => setSelectedMonth(m => subMonths(m, 1));
  const nextMonth = () => setSelectedMonth(m => addMonths(m, 1));

  // ── Month stats ───────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const start    = startOfMonth(selectedMonth);
    const end      = endOfMonth(selectedMonth);
    const monthKey = format(selectedMonth, "yyyy-MM");
    const nowKey   = format(new Date(), "yyyy-MM");
    const isFuture = monthKey > nowKey;

    const monthExp = expenses.filter(e => {
      try { return isWithinInterval(parseISO(e.due_date), { start, end }); }
      catch { return false; }
    });

    // For future months, project recurring expenses not yet generated
    if (isFuture) {
      for (const rec of recurring) {
        if (!rec.active) continue;
        const dayPadded = String(rec.day_of_month).padStart(2, "0");
        const dueDate = `${monthKey}-${dayPadded}`;
        const alreadyExists = monthExp.some(
          e => e.description === rec.description && e.due_date === dueDate && e.value === rec.value,
        );
        if (!alreadyExists) {
          monthExp.push({
            id:             `proj-${rec.id}-${monthKey}`,
            category_id:    rec.category_id,
            description:    rec.description,
            date:           dueDate,
            due_date:       dueDate,
            value:          rec.value,
            responsible_id: rec.responsible_id,
            paid:           0,
          });
        }
      }
    }

    const totalMonth   = monthExp.reduce((s, e) => s + e.value, 0);
    const pendingMonth = monthExp.filter(e => !e.paid).reduce((s, e) => s + e.value, 0);
    const paidMonth    = monthExp.filter(e =>  e.paid).reduce((s, e) => s + e.value, 0);
    const paidPct      = totalMonth > 0 ? (paidMonth / totalMonth) * 100 : 0;
    const ticketMedio  = monthExp.length > 0 ? totalMonth / monthExp.length : 0;

    const catData = categories.map(cat => ({
      name:  cat.name,
      value: monthExp.filter(e => e.category_id === cat.id).reduce((s, e) => s + e.value, 0),
      color: cat.color,
    })).filter(d => d.value > 0);

    // All registered categories (including zero-value) for the Categorias chart
    const allCatData = categories.map(cat => ({
      name:  cat.name,
      value: monthExp.filter(e => e.category_id === cat.id).reduce((s, e) => s + e.value, 0),
      color: cat.color,
    }));

    const topCategories = [...catData].sort((a, b) => b.value - a.value).slice(0, 5);

    const respData = responsibles.map(r => ({
      id:    r.id,
      name:  r.name,
      value: monthExp.filter(e => e.responsible_id === r.id).reduce((s, e) => s + e.value, 0),
    })).filter(d => d.value > 0).sort((a, b) => b.value - a.value);

    const top5Individual = [...monthExp]
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map(e => ({
        name:  (e.description || "Sem descrição").slice(0, 24),
        value: e.value,
        color: categories.find(c => c.id === e.category_id)?.color ?? "#94a3b8",
      }));

    return {
      totalMonth, pendingMonth, paidMonth, paidPct, ticketMedio,
      catData, allCatData, topCategories, respData, top5Individual,
      count: monthExp.length,
    };
  }, [expenses, categories, responsibles, selectedMonth]);

  // ── Previous month comparison ─────────────────────────────────────────────────
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

  const annualAvg = useMemo(() => {
    const nonZero = annualData.filter(d => d.total > 0);
    return nonZero.length > 1
      ? nonZero.reduce((s, d) => s + d.total, 0) / nonZero.length
      : 0;
  }, [annualData]);

  // ── Cashflow: paid vs pending per day ─────────────────────────────────────────
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

  // ── Income for selected month ─────────────────────────────────────────────────
  const monthIncomeTotal = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end   = endOfMonth(selectedMonth);
    return incomes
      .filter(i => {
        try { return isWithinInterval(parseISO(i.date), { start, end }); }
        catch { return false; }
      })
      .reduce((s, i) => s + i.value, 0);
  }, [incomes, selectedMonth]);

  const monthBalance = monthIncomeTotal - stats.totalMonth;

  // ── Income vs Expenses — last 6 months ───────────────────────────────────────
  const incomeVsExpenses = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const month = subMonths(new Date(), 5 - i);
      const start = startOfMonth(month);
      const end   = endOfMonth(month);
      const exp = expenses
        .filter(e => {
          try { return isWithinInterval(parseISO(e.due_date), { start, end }); }
          catch { return false; }
        })
        .reduce((s, e) => s + e.value, 0);
      const inc = incomes
        .filter(inc => {
          try { return isWithinInterval(parseISO(inc.date), { start, end }); }
          catch { return false; }
        })
        .reduce((s, inc) => s + inc.value, 0);
      return {
        name:    format(month, "MMM/yy", { locale: ptBR }),
        Entradas: inc,
        Saídas:   exp,
      };
    });
  }, [expenses, incomes]);

  // ── Category trend: top 4 cats, last 6 months ────────────────────────────────
  const categoryTrend = useMemo(() => {
    const topCats = categories
      .map(cat => ({
        id:    cat.id,
        name:  cat.name,
        color: cat.color,
        total: expenses.filter(e => e.category_id === cat.id).reduce((s, e) => s + e.value, 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 4)
      .filter(c => c.total > 0);

    const data = Array.from({ length: 6 }, (_, i) => {
      const month = subMonths(new Date(), 5 - i);
      const start = startOfMonth(month);
      const end   = endOfMonth(month);
      const monthExp = expenses.filter(e => {
        try { return isWithinInterval(parseISO(e.due_date), { start, end }); }
        catch { return false; }
      });
      const row: Record<string, string | number> = {
        name: format(month, "MMM/yy", { locale: ptBR }),
      };
      for (const cat of topCats) {
        row[cat.name] = monthExp
          .filter(e => e.category_id === cat.id)
          .reduce((s, e) => s + e.value, 0);
      }
      return row;
    });

    return { data, topCats };
  }, [expenses, categories]);

  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="space-y-6 pb-8"
    >

      {/* ── Month nav + add ───────────────────────────────────────────────────── */}
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

      {/* ── Stats cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

        {/* Total do mês + comparativo + % pago */}
        <div className="card p-5 col-span-2">
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
          {/* Barra de progresso de pagamento */}
          {stats.totalMonth > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1.5">
                <span>{stats.paidPct.toFixed(0)}% pago</span>
                <span>R$ {formatCurrency(stats.paidMonth)} / R$ {formatCurrency(stats.totalMonth)}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div
                  className={cn(
                    "h-2 rounded-full transition-all",
                    stats.paidPct >= 100 ? "bg-emerald-500" : stats.paidPct >= 50 ? "bg-blue-500" : "bg-amber-400",
                  )}
                  style={{ width: `${Math.min(stats.paidPct, 100)}%` }}
                />
              </div>
            </div>
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

        {/* Ticket médio */}
        {stats.count > 0 && (
          <div className="card p-5 col-span-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Ticket Médio</p>
            <p className="text-2xl font-black tracking-tighter text-violet-600">
              R$ {formatCurrency(stats.ticketMedio)}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              {stats.count} despesa{stats.count !== 1 ? "s" : ""} no mês
            </p>
          </div>
        )}

        {/* Entradas do mês */}
        {monthIncomeTotal > 0 && (
          <div className="card p-5 col-span-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Entradas do Mês</p>
            <p className="text-2xl font-black tracking-tighter text-teal-600">
              R$ {formatCurrency(monthIncomeTotal)}
            </p>
            <div className={`flex items-center gap-1 mt-1 text-[10px] font-bold ${monthBalance >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              <span>
                Saldo: {monthBalance >= 0 ? "+" : ""}R$ {formatCurrency(monthBalance)}
              </span>
            </div>
            {stats.totalMonth > 0 && monthIncomeTotal > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1.5">
                  <span>Comprometimento</span>
                  <span>{Math.min((stats.totalMonth / monthIncomeTotal) * 100, 999).toFixed(0)}% da renda</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      stats.totalMonth / monthIncomeTotal > 0.9 ? "bg-red-500"
                      : stats.totalMonth / monthIncomeTotal > 0.7 ? "bg-amber-400"
                      : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min((stats.totalMonth / monthIncomeTotal) * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Budget progress ────────────────────────────────────────────────────── */}
      {monthBudgets.length > 0 && (() => {
        const exceeded = monthBudgets.filter(b => b.pct >= 100);
        const warned   = monthBudgets.filter(b => b.pct >= 80 && b.pct < 100);
        return (
          <div className="card p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Orçamentos do Mês</h3>
              {exceeded.length > 0 && (
                <span className="text-[10px] font-black text-red-600 bg-red-100 px-2 py-0.5 rounded-full uppercase tracking-widest">
                  {exceeded.length} estourado{exceeded.length > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Alert banner for exceeded categories */}
            {exceeded.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-start gap-2.5">
                <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs font-bold text-red-700">
                  Orçamento estourado em {format(selectedMonth, "MMMM", { locale: ptBR })}:{" "}
                  {exceeded.map(b => b.catName).join(", ")}.
                </p>
              </div>
            )}

            {/* Warning banner for categories approaching limit */}
            {warned.length > 0 && exceeded.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2.5">
                <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs font-bold text-amber-700">
                  Próximo do limite: {warned.map(b => `${b.catName} (${b.pct.toFixed(0)}%)`).join(", ")}.
                </p>
              </div>
            )}

            <div className="space-y-3">
              {monthBudgets.map(b => {
                const isOver    = b.pct >= 100;
                const isWarn    = !isOver && b.pct >= 80;
                const remaining = b.limit_value - b.spent;
                const excess    = b.spent - b.limit_value;
                return (
                  <div
                    key={b.id}
                    className={cn(
                      "rounded-xl p-3 border",
                      isOver ? "bg-red-50 border-red-200" : isWarn ? "bg-amber-50 border-amber-100" : "bg-slate-50 border-slate-100",
                    )}
                  >
                    {/* Row 1: name + badges + percentage */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: b.catColor }} />
                        <span className="text-xs font-bold text-slate-700">{b.catName}</span>
                        {isOver && (
                          <span className="text-[9px] font-black text-red-600 bg-red-200 px-1.5 py-0.5 rounded-full uppercase tracking-widest">
                            ESTOURADO
                          </span>
                        )}
                        {isWarn && (
                          <span className="text-[9px] font-black text-amber-700 bg-amber-200 px-1.5 py-0.5 rounded-full uppercase tracking-widest">
                            ATENÇÃO
                          </span>
                        )}
                      </div>
                      <span className={cn(
                        "text-[10px] font-black shrink-0",
                        isOver ? "text-red-600" : isWarn ? "text-amber-600" : "text-slate-500",
                      )}>
                        {b.pct.toFixed(0)}%
                      </span>
                    </div>

                    {/* Row 2: spent / limit */}
                    <div className="flex justify-between text-[10px] font-medium mb-1.5">
                      <span className="text-slate-600 font-bold">R$ {formatCurrency(b.spent)} usado</span>
                      <span className="text-slate-400">limite R$ {formatCurrency(b.limit_value)}</span>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full bg-white rounded-full h-2.5 overflow-hidden border border-slate-200">
                      <div
                        className={cn(
                          "h-2.5 rounded-full transition-all",
                          isOver ? "bg-red-500" : isWarn ? "bg-amber-500" : "bg-emerald-500",
                        )}
                        style={{ width: `${Math.min(b.pct, 100)}%` }}
                      />
                    </div>

                    {/* Row 3: remaining / excess */}
                    {isOver ? (
                      <p className="text-[10px] font-bold text-red-600 mt-1">
                        ⚠ Excedeu R$ {formatCurrency(excess)} do limite
                      </p>
                    ) : (
                      <p className="text-[10px] text-slate-400 mt-1">
                        Restam R$ {formatCurrency(remaining)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Charts ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Horizontal bar: todas as categorias em ordem decrescente */}
        <div className="card p-6 md:col-span-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6">Categorias</h3>
          {stats.allCatData.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-10">Nenhuma categoria cadastrada</p>
          ) : (
            <div style={{ height: Math.max(200, stats.allCatData.length * 52) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...stats.allCatData].sort((a, b) => b.value - a.value)}
                  layout="vertical"
                  margin={{ top: 4, right: 110, left: 8, bottom: 4 }}
                >
                  <XAxis type="number" fontSize={10} hide />
                  <YAxis
                    dataKey="name" type="category" fontSize={12} fontWeight={600}
                    axisLine={false} tickLine={false} width={120}
                  />
                  <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {[...stats.allCatData]
                      .sort((a, b) => b.value - a.value)
                      .map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    <LabelList
                      dataKey="value"
                      position="right"
                      fontSize={11}
                      fontWeight={700}
                      formatter={(v: number) => `R$ ${formatCurrency(v)}`}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Horizontal bar: top 5 despesas individuais */}
        {stats.top5Individual.length > 0 && (
          <div className="card p-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6">
              Top 5 Maiores Despesas do Mês
            </h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.top5Individual} layout="vertical" margin={{ right: 90, left: 4 }}>
                  <XAxis type="number" fontSize={10} hide />
                  <YAxis dataKey="name" type="category" fontSize={10}
                    axisLine={false} tickLine={false} width={110} />
                  <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {stats.top5Individual.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    <LabelList dataKey="value" position="right" fontSize={10} fontWeight={700}
                      formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Horizontal bar: por responsável */}
        {stats.respData.length > 0 && (
          <div className="card p-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6">Por Responsável</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.respData} layout="vertical" margin={{ right: 80 }}>
                  <XAxis type="number" fontSize={10} hide />
                  <YAxis dataKey="name" type="category" fontSize={11}
                    axisLine={false} tickLine={false} width={90} />
                  <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="value" position="right" fontSize={10} fontWeight={700}
                      formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Cashflow: pago vs pendente por dia — horizontal, ordem decrescente */}
        {cashflowData.length > 0 && (() => {
          const sorted = [...cashflowData]
            .map(d => ({ ...d, total: d.Pago + d.Pendente }))
            .sort((a, b) => b.total - a.total);
          return (
            <div className="card p-6 md:col-span-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6">
                Fluxo de Caixa — {format(selectedMonth, "MMMM yyyy", { locale: ptBR })}
              </h3>
              <div style={{ height: Math.max(200, sorted.length * 56) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 100, left: 8, bottom: 4 }}>
                    <XAxis type="number" fontSize={10} hide />
                    <YAxis
                      dataKey="dia" type="category" fontSize={12} fontWeight={600}
                      axisLine={false} tickLine={false} width={40}
                      tickFormatter={(v: string) => `Dia ${v}`}
                    />
                    <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Pago" fill="#10b981" radius={[0, 4, 4, 0]}>
                      <LabelList dataKey="Pago" position="right" fontSize={10} fontWeight={700}
                        formatter={(v: number) => v > 0 ? `R$ ${formatCurrency(v)}` : ""} />
                    </Bar>
                    <Bar dataKey="Pendente" fill="#f87171" radius={[0, 4, 4, 0]}>
                      <LabelList dataKey="Pendente" position="right" fontSize={10} fontWeight={700}
                        formatter={(v: number) => v > 0 ? `R$ ${formatCurrency(v)}` : ""} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })()}

        {/* Tendência por categoria — últimos 6 meses — horizontal, ordem decrescente */}
        {categoryTrend.topCats.length > 0 && (() => {
          const trendBars = categoryTrend.topCats
            .map(cat => ({
              name:  cat.name,
              color: cat.color,
              value: categoryTrend.data.reduce(
                (s, month) => s + ((month[cat.name] as number) ?? 0), 0,
              ),
            }))
            .sort((a, b) => b.value - a.value);
          return (
            <div className="card p-6 md:col-span-2">
              <div className="flex items-center gap-2 mb-6">
                <TrendingUp size={16} className="text-slate-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Tendência por Categoria — Últimos 6 Meses
                </h3>
              </div>
              <div style={{ height: Math.max(200, trendBars.length * 56) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendBars} layout="vertical" margin={{ top: 4, right: 110, left: 8, bottom: 4 }}>
                    <XAxis type="number" fontSize={10} hide />
                    <YAxis
                      dataKey="name" type="category" fontSize={12} fontWeight={600}
                      axisLine={false} tickLine={false} width={120}
                    />
                    <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {trendBars.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      <LabelList
                        dataKey="value"
                        position="right"
                        fontSize={11}
                        fontWeight={700}
                        formatter={(v: number) => `R$ ${formatCurrency(v)}`}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })()}

        {/* Entradas vs Saídas — últimos 6 meses */}
        <div className="card p-6 md:col-span-2">
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp size={16} className="text-teal-500" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Entradas vs Saídas — Últimos 6 Meses
            </h3>
          </div>
          <div style={{ height: Math.max(260, incomeVsExpenses.length * 60) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={incomeVsExpenses} layout="vertical" margin={{ top: 4, right: 100, left: 8, bottom: 4 }}>
                <XAxis type="number" fontSize={10} hide />
                <YAxis dataKey="name" type="category" fontSize={11} fontWeight={600}
                  axisLine={false} tickLine={false} width={55} />
                <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Entradas" fill="#10b981" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="Entradas" position="right" fontSize={9} fontWeight={700}
                    formatter={(v: number) => v > 0 ? `R$ ${formatCurrency(v)}` : ""} />
                </Bar>
                <Bar dataKey="Saídas" fill="#f87171" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="Saídas" position="right" fontSize={9} fontWeight={700}
                    formatter={(v: number) => v > 0 ? `R$ ${formatCurrency(v)}` : ""} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Histórico 12 meses com linha de média */}
        <div className="card p-6 md:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <TrendingDown size={16} className="text-slate-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Histórico Despesas — Últimos 12 Meses
              </h3>
            </div>
            {annualAvg > 0 && (
              <span className="text-[10px] text-slate-400 font-bold">
                Média: R$ {formatCurrency(annualAvg)}
              </span>
            )}
          </div>
          <div style={{ height: Math.max(320, annualData.length * 44) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={annualData} layout="vertical" margin={{ top: 4, right: 110, left: 8, bottom: 4 }}>
                <XAxis type="number" fontSize={10} hide />
                <YAxis dataKey="name" type="category" fontSize={11} fontWeight={600}
                  axisLine={false} tickLine={false} width={38} />
                <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                {annualAvg > 0 && (
                  <ReferenceLine
                    x={annualAvg}
                    stroke="#94a3b8"
                    strokeDasharray="5 3"
                    label={{ value: "Média", position: "top", fontSize: 9, fill: "#94a3b8" }}
                  />
                )}
                <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                  {annualData.map((entry, i) => (
                    <Cell key={i} fill={entry.isCurrent ? "#10b981" : "#f87171"} />
                  ))}
                  <LabelList
                    dataKey="total"
                    position="right"
                    fontSize={10}
                    fontWeight={700}
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
