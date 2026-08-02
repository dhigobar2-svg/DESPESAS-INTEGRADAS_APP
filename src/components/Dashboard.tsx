import React, { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell,
  ResponsiveContainer, LabelList,
} from "recharts";
import {
  format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter,
  startOfYear, endOfYear, subMonths, subQuarters, subYears,
  addMonths, addQuarters, addYears, isWithinInterval, parseISO, getQuarter,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronLeft, ChevronRight, Plus, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, Minus, AlertCircle, CheckCircle2,
} from "lucide-react";
import { motion } from "motion/react";
import { useData } from "../context/DataContext";
import { formatCurrency, cn } from "../lib/utils";
import ExpenseModal from "./ExpenseModal";
import FilterBar from "./FilterBar";

type PeriodMode = "month" | "quarter" | "year" | "all";

const MODE_LABEL: Record<PeriodMode, string> = {
  month: "Mês", quarter: "Trimestre", year: "Ano", all: "Geral",
};

interface Range { start: Date; end: Date; label: string; }

function getPeriod(mode: PeriodMode, anchor: Date): Range {
  switch (mode) {
    case "month":   return { start: startOfMonth(anchor),   end: endOfMonth(anchor),   label: format(anchor, "MMMM yyyy", { locale: ptBR }) };
    case "quarter": return { start: startOfQuarter(anchor), end: endOfQuarter(anchor), label: `${getQuarter(anchor)}º trimestre ${format(anchor, "yyyy")}` };
    case "year":    return { start: startOfYear(anchor),    end: endOfYear(anchor),    label: format(anchor, "yyyy") };
    case "all":     return { start: new Date(2000, 0, 1),   end: endOfMonth(new Date()), label: "Acumulado geral" };
  }
}

function shift(mode: PeriodMode, anchor: Date, dir: number): Date {
  switch (mode) {
    case "month":   return dir < 0 ? subMonths(anchor, 1)   : addMonths(anchor, 1);
    case "quarter": return dir < 0 ? subQuarters(anchor, 1) : addQuarters(anchor, 1);
    case "year":    return dir < 0 ? subYears(anchor, 1)    : addYears(anchor, 1);
    case "all":     return anchor;
  }
}

function inRange(dateStr: string, r: Range): boolean {
  try { return isWithinInterval(parseISO(dateStr), { start: r.start, end: r.end }); }
  catch { return false; }
}

// Δ% with sign, null when there's no comparison base
function pct(curr: number, prev: number): number | null {
  if (prev <= 0) return null;
  return ((curr - prev) / prev) * 100;
}

export default function Dashboard() {
  const { expenses, categories, responsibles, budgets, incomes } = useData();

  const [mode,        setMode]        = useState<PeriodMode>("month");
  const [anchor,      setAnchor]      = useState(new Date());
  // Filtros de múltipla escolha: lista vazia = todos.
  const [filterCat,   setFilterCat]   = useState<string[]>([]);
  const [filterResp,  setFilterResp]  = useState<string[]>([]);
  const [showModal,   setShowModal]   = useState(false);

  const period     = useMemo(() => getPeriod(mode, anchor), [mode, anchor]);
  const prevPeriod = useMemo(() => mode === "all" ? null : getPeriod(mode, shift(mode, anchor, -1)), [mode, anchor]);

  // ── Filtered sums ───────────────────────────────────────────────────────────
  const expFilter = (e: typeof expenses[number]) =>
    (!filterCat.length  || filterCat.includes(e.category_id)) &&
    (!filterResp.length || filterResp.includes(e.responsible_id));
  const incFilter = (i: typeof incomes[number]) =>
    (!filterResp.length || filterResp.includes(i.responsible_id ?? ""));

  const sumExp = (r: Range) => expenses.filter(e => expFilter(e) && inRange(e.due_date, r)).reduce((s, e) => s + e.value, 0);
  const sumInc = (r: Range) => incomes.filter(i => incFilter(i)  && inRange(i.date, r)).reduce((s, i) => s + i.value, 0);

  const stats = useMemo(() => {
    const periodExp = expenses.filter(e => expFilter(e) && inRange(e.due_date, period));
    const saidas    = periodExp.reduce((s, e) => s + e.value, 0);
    const entradas  = sumInc(period);
    const pago      = periodExp.filter(e => e.paid).reduce((s, e) => s + e.value, 0);
    const pendente  = saidas - pago;
    const saldo     = entradas - saidas;
    const comprometimento = entradas > 0 ? (saidas / entradas) * 100 : 0;

    const prevSaidas   = prevPeriod ? sumExp(prevPeriod) : 0;
    const prevEntradas = prevPeriod ? sumInc(prevPeriod) : 0;
    const prevSaldo    = prevEntradas - prevSaidas;

    const byCat = categories.map(c => ({
      name:  c.name,
      value: periodExp.filter(e => e.category_id === c.id).reduce((s, e) => s + e.value, 0),
      color: c.color,
    })).filter(d => d.value > 0).sort((a, b) => b.value - a.value);

    const byResp = responsibles.map(r => ({
      name:  r.name,
      value: periodExp.filter(e => e.responsible_id === r.id).reduce((s, e) => s + e.value, 0),
    })).filter(d => d.value > 0).sort((a, b) => b.value - a.value);

    return {
      saidas, entradas, pago, pendente, saldo, comprometimento,
      prevSaidas, prevEntradas, prevSaldo, byCat, byResp, count: periodExp.length,
    };
  }, [expenses, incomes, categories, responsibles, period, prevPeriod, filterCat, filterResp]);

  // ── Trend buckets (adaptive to mode) ──────────────────────────────────────────
  const trend = useMemo(() => {
    const buckets: Range[] = [];
    if (mode === "month") {
      for (let i = 5; i >= 0; i--) { const d = subMonths(anchor, i); buckets.push({ start: startOfMonth(d), end: endOfMonth(d), label: format(d, "MMM/yy", { locale: ptBR }) }); }
    } else if (mode === "quarter") {
      for (let i = 3; i >= 0; i--) { const d = subQuarters(anchor, i); buckets.push({ start: startOfQuarter(d), end: endOfQuarter(d), label: `T${getQuarter(d)}/${format(d, "yy")}` }); }
    } else if (mode === "year") {
      for (let m = 0; m < 12; m++) { const d = new Date(anchor.getFullYear(), m, 1); buckets.push({ start: startOfMonth(d), end: endOfMonth(d), label: format(d, "MMM", { locale: ptBR }) }); }
    } else {
      const years = [
        ...expenses.map(e => e.due_date?.slice(0, 4)),
        ...incomes.map(i => i.date?.slice(0, 4)),
      ].filter(Boolean) as string[];
      const minY = years.length ? Math.min(...years.map(Number)) : new Date().getFullYear();
      const maxY = new Date().getFullYear();
      for (let y = minY; y <= maxY; y++) { const d = new Date(y, 0, 1); buckets.push({ start: startOfYear(d), end: endOfYear(d), label: String(y) }); }
    }
    return buckets.map(b => ({ name: b.label, Entradas: sumInc(b), Saídas: sumExp(b) }));
  }, [mode, anchor, expenses, incomes, filterCat, filterResp]);

  // ── Budgets (month mode only) ─────────────────────────────────────────────────
  const monthBudgets = useMemo(() => {
    if (mode !== "month") return [];
    const monthKey = format(anchor, "yyyy-MM");
    return budgets.filter(b => b.month === monthKey).map(b => {
      const cat   = categories.find(c => c.id === b.category_id);
      const spent = stats.byCat.find(d => d.name === cat?.name)?.value
        ?? expenses.filter(e => e.category_id === b.category_id && inRange(e.due_date, period)).reduce((s, e) => s + e.value, 0);
      const p = b.limit_value > 0 ? (spent / b.limit_value) * 100 : 0;
      return { ...b, catName: cat?.name ?? "—", catColor: cat?.color ?? "#94a3b8", spent, pct: p };
    }).sort((a, b) => b.pct - a.pct);
  }, [mode, anchor, budgets, categories, stats.byCat, expenses, period]);

  // ── Insights ──────────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const out: { tone: "good" | "bad" | "warn"; text: string }[] = [];
    const dExp = pct(stats.saidas, stats.prevSaidas);

    if (stats.entradas > 0 || stats.saidas > 0) {
      out.push(stats.saldo >= 0
        ? { tone: "good", text: `Saldo positivo de R$ ${formatCurrency(stats.saldo)} no período.` }
        : { tone: "bad",  text: `Saldo negativo de R$ ${formatCurrency(Math.abs(stats.saldo))} — gastos acima das entradas.` });
    }
    if (dExp !== null && Math.abs(dExp) >= 5) {
      out.push(dExp > 0
        ? { tone: "warn", text: `Gastos ${dExp.toFixed(0)}% maiores que o período anterior.` }
        : { tone: "good", text: `Gastos ${Math.abs(dExp).toFixed(0)}% menores que o período anterior.` });
    }
    if (stats.entradas > 0 && stats.comprometimento > 90) {
      out.push({ tone: "bad", text: `Renda quase toda comprometida (${stats.comprometimento.toFixed(0)}%).` });
    } else if (stats.entradas > 0 && stats.comprometimento <= 70 && stats.saidas > 0) {
      out.push({ tone: "good", text: `Comprometimento saudável da renda (${stats.comprometimento.toFixed(0)}%).` });
    }
    if (stats.byCat.length > 0) {
      const top = stats.byCat[0];
      const share = stats.saidas > 0 ? (top.value / stats.saidas) * 100 : 0;
      out.push({ tone: share > 40 ? "warn" : "good", text: `Maior gasto: ${top.name} — R$ ${formatCurrency(top.value)} (${share.toFixed(0)}% do total).` });
    }
    const exceeded = monthBudgets.filter(b => b.pct >= 100);
    if (exceeded.length) out.push({ tone: "bad", text: `Orçamento estourado: ${exceeded.map(b => b.catName).join(", ")}.` });
    if (stats.pendente > 0) out.push({ tone: "warn", text: `R$ ${formatCurrency(stats.pendente)} ainda pendentes de pagamento.` });

    return out;
  }, [stats, monthBudgets]);

  // ── KPI card ──────────────────────────────────────────────────────────────────
  const Delta = ({ value, goodWhenDown = false }: { value: number | null; goodWhenDown?: boolean }) => {
    if (value === null) return null;
    const up = value > 0;
    const neutral = Math.abs(value) < 0.5;
    const good = neutral ? false : goodWhenDown ? !up : up;
    const bad  = neutral ? false : goodWhenDown ? up : !up;
    return (
      <div className={cn("flex items-center gap-1 mt-1 text-[10px] font-bold",
        good ? "text-emerald-600" : bad ? "text-red-500" : "text-slate-400")}>
        {neutral ? <Minus size={11} /> : up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
        <span>{up ? "+" : ""}{value.toFixed(0)}% vs período anterior</span>
      </div>
    );
  };

  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="space-y-5 pb-10"
    >
      {/* ── Period selector ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-1.5 bg-slate-100 p-1 rounded-2xl">
        {(["month", "quarter", "year", "all"] as PeriodMode[]).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); setAnchor(new Date()); }}
            className={cn(
              "py-2 rounded-xl text-xs font-bold uppercase tracking-wide transition-all",
              mode === m ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
            )}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {/* ── Period nav + add ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {mode !== "all" && (
            <button onClick={() => setAnchor(a => shift(mode, a, -1))} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
              <ChevronLeft size={18} />
            </button>
          )}
          <span className="text-sm font-black uppercase tracking-wide text-center min-w-[8rem]">{period.label}</span>
          {mode !== "all" && (
            <button onClick={() => setAnchor(a => shift(mode, a, 1))} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
              <ChevronRight size={18} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-emerald-600 text-white p-2.5 rounded-full shadow-lg hover:bg-emerald-700 transition-transform active:scale-95"
          title="Nova despesa"
        >
          <Plus size={22} />
        </button>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────────── */}
      <FilterBar
        categories={categories}
        responsibles={responsibles}
        category={filterCat}     onCategory={setFilterCat}
        responsible={filterResp} onResponsible={setFilterResp}
      />

      {/* ── KPI cards ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Entradas</p>
          <p className="text-xl font-black tracking-tighter text-teal-600">R$ {formatCurrency(stats.entradas)}</p>
          <Delta value={pct(stats.entradas, stats.prevEntradas)} />
        </div>
        <div className="card p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Saídas</p>
          <p className="text-xl font-black tracking-tighter text-red-500">R$ {formatCurrency(stats.saidas)}</p>
          <Delta value={pct(stats.saidas, stats.prevSaidas)} goodWhenDown />
        </div>
        <div className={cn("card p-4", stats.saldo < 0 && "ring-1 ring-red-200")}>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Saldo</p>
          <p className={cn("text-xl font-black tracking-tighter", stats.saldo >= 0 ? "text-emerald-600" : "text-red-600")}>
            {stats.saldo >= 0 ? "+" : "−"}R$ {formatCurrency(Math.abs(stats.saldo))}
          </p>
          <Delta value={pct(stats.saldo, stats.prevSaldo)} />
        </div>
        <div className="card p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Renda comprometida</p>
          {stats.entradas > 0 ? (
            <>
              <p className={cn("text-xl font-black tracking-tighter",
                stats.comprometimento > 90 ? "text-red-500" : stats.comprometimento > 70 ? "text-amber-500" : "text-emerald-600")}>
                {stats.comprometimento.toFixed(0)}%
              </p>
              <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1.5">
                <div className={cn("h-1.5 rounded-full",
                  stats.comprometimento > 90 ? "bg-red-500" : stats.comprometimento > 70 ? "bg-amber-400" : "bg-emerald-500")}
                  style={{ width: `${Math.min(stats.comprometimento, 100)}%` }} />
              </div>
            </>
          ) : (
            <p className="text-sm font-bold text-slate-300 mt-1">Sem entradas no período</p>
          )}
        </div>
      </div>

      {/* ── Insights ────────────────────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <div className="card p-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Diagnóstico do período</h3>
          <div className="space-y-2">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-2.5">
                {ins.tone === "good"
                  ? <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                  : <AlertCircle size={15} className={cn("shrink-0 mt-0.5", ins.tone === "bad" ? "text-red-500" : "text-amber-500")} />}
                <p className={cn("text-xs font-medium leading-relaxed",
                  ins.tone === "good" ? "text-emerald-700" : ins.tone === "bad" ? "text-red-700" : "text-amber-700")}>
                  {ins.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Trend: Entradas vs Saídas ───────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-5">
          <TrendingUp size={15} className="text-teal-500" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Entradas vs Saídas</h3>
        </div>
        <div style={{ height: Math.max(220, trend.length * 46) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} layout="vertical" margin={{ top: 4, right: 90, left: 8, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" fontSize={11} fontWeight={600} axisLine={false} tickLine={false} width={56} />
              <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Entradas" fill="#14b8a6" radius={[0, 4, 4, 0]}>
                <LabelList dataKey="Entradas" position="right" fontSize={9} fontWeight={700} formatter={(v: number) => v > 0 ? formatCurrency(v) : ""} />
              </Bar>
              <Bar dataKey="Saídas" fill="#f87171" radius={[0, 4, 4, 0]}>
                <LabelList dataKey="Saídas" position="right" fontSize={9} fontWeight={700} formatter={(v: number) => v > 0 ? formatCurrency(v) : ""} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Gastos por categoria ────────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-5">
          <TrendingDown size={15} className="text-slate-400" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Para onde foi o dinheiro</h3>
        </div>
        {stats.byCat.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">Nenhuma despesa no período.</p>
        ) : (
          <div style={{ height: Math.max(180, stats.byCat.length * 46) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.byCat} layout="vertical" margin={{ top: 4, right: 100, left: 8, bottom: 4 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" fontSize={12} fontWeight={600} axisLine={false} tickLine={false} width={110} />
                <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {stats.byCat.map((d, i) => <Cell key={i} fill={d.color} />)}
                  <LabelList dataKey="value" position="right" fontSize={11} fontWeight={700} formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Por responsável (quando não filtrado) ───────────────────────────────── */}
      {!filterResp.length && stats.byResp.length > 0 && (
        <div className="card p-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-5">Gastos por responsável</h3>
          <div style={{ height: Math.max(160, stats.byResp.length * 46) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.byResp} layout="vertical" margin={{ top: 4, right: 100, left: 8, bottom: 4 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" fontSize={12} fontWeight={600} axisLine={false} tickLine={false} width={90} />
                <Tooltip formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                <Bar dataKey="value" fill="#6366f1" radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="value" position="right" fontSize={11} fontWeight={700} formatter={(v: number) => `R$ ${formatCurrency(v)}`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Orçamentos (modo mês) ───────────────────────────────────────────────── */}
      {monthBudgets.length > 0 && (
        <div className="card p-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Orçamentos do mês</h3>
          <div className="space-y-3">
            {monthBudgets.map(b => {
              const over = b.pct >= 100, warn = !over && b.pct >= 80;
              return (
                <div key={b.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: b.catColor }} />
                      <span className="text-xs font-bold text-slate-700">{b.catName}</span>
                      {over && <span className="text-[9px] font-black text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full uppercase">Estourado</span>}
                    </div>
                    <span className={cn("text-[10px] font-black", over ? "text-red-600" : warn ? "text-amber-600" : "text-slate-500")}>
                      R$ {formatCurrency(b.spent)} / {formatCurrency(b.limit_value)}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className={cn("h-2 rounded-full transition-all", over ? "bg-red-500" : warn ? "bg-amber-400" : "bg-emerald-500")}
                      style={{ width: `${Math.min(b.pct, 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ExpenseModal open={showModal} editing={null} onClose={() => setShowModal(false)} />
    </motion.div>
  );
}
