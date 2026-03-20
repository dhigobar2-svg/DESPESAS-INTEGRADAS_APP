import React, { useState, useMemo } from "react";
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval, subMonths, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Edit2, Check, X,
  TrendingUp, Wallet, ArrowDownRight, StickyNote,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { generateId, formatCurrency, cn } from "../lib/utils";
import { Income } from "../types";
import ConfirmModal from "./ConfirmModal";

const INCOME_TYPE_LABELS: Record<string, string> = {
  salario:     "Salário",
  renda_extra: "Renda Extra",
  outro:       "Outro",
};

const INCOME_TYPE_COLORS: Record<string, string> = {
  salario:     "bg-blue-100 text-blue-700",
  renda_extra: "bg-emerald-100 text-emerald-700",
  outro:       "bg-slate-100 text-slate-700",
};

const emptyForm = (): Partial<Income> => ({
  description: "",
  value: undefined,
  date: format(new Date(), "yyyy-MM-dd"),
  type: "salario",
  responsible_id: "",
  notes: "",
  recurring: 0,
});

export default function Incomes() {
  const { incomes, expenses, responsibles, saveIncome, deleteItem } = useData();

  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [showForm,      setShowForm]      = useState(false);
  const [editingId,     setEditingId]     = useState<string | null>(null);
  const [form,          setForm]          = useState<Partial<Income>>(emptyForm());
  const [confirmId,     setConfirmId]     = useState<string | null>(null);

  const prevMonth = () => setSelectedMonth(m => subMonths(m, 1));
  const nextMonth = () => setSelectedMonth(m => addMonths(m, 1));

  const monthKey = format(selectedMonth, "yyyy-MM");

  // Incomes of selected month
  const monthIncomes = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end   = endOfMonth(selectedMonth);
    return incomes
      .filter(i => {
        try { return isWithinInterval(parseISO(i.date), { start, end }); }
        catch { return false; }
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [incomes, selectedMonth]);

  // Expenses total of selected month (for balance)
  const monthExpenses = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end   = endOfMonth(selectedMonth);
    return expenses
      .filter(e => {
        try { return isWithinInterval(parseISO(e.due_date), { start, end }); }
        catch { return false; }
      })
      .reduce((s, e) => s + e.value, 0);
  }, [expenses, selectedMonth]);

  const totalIncome  = monthIncomes.reduce((s, i) => s + i.value, 0);
  const balance      = totalIncome - monthExpenses;

  // ── Form helpers ──────────────────────────────────────────────────────────────

  const openAdd = () => {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (inc: Income) => {
    setForm({ ...inc });
    setEditingId(inc.id);
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.description?.trim() || !form.value || !form.date || !form.type) return;

    const income: Income = {
      id:             editingId ?? generateId(),
      description:    form.description.trim(),
      value:          Number(form.value),
      date:           form.date,
      type:           form.type,
      responsible_id: form.responsible_id || undefined,
      notes:          form.notes?.trim() || undefined,
      recurring:      form.recurring ?? 0,
    };

    saveIncome(income, !!editingId);
    cancelForm();
  };

  const confirmLabel = incomes.find(i => i.id === confirmId)?.description ?? "";

  return (
    <motion.div
      key="incomes"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="space-y-5 pb-20"
    >
      {/* Month nav */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Entradas e Receitas</h2>
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-black uppercase tracking-widest w-32 text-center">
            {format(selectedMonth, "MMM yyyy", { locale: ptBR })}
          </span>
          <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={12} className="text-emerald-500" />
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Entradas</p>
          </div>
          <p className="text-xl font-black text-emerald-600">R$ {formatCurrency(totalIncome)}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <ArrowDownRight size={12} className="text-red-500" />
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Despesas</p>
          </div>
          <p className="text-xl font-black text-red-500">R$ {formatCurrency(monthExpenses)}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Wallet size={12} className={balance >= 0 ? "text-emerald-600" : "text-red-500"} />
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Saldo</p>
          </div>
          <p className={cn("text-xl font-black", balance >= 0 ? "text-emerald-600" : "text-red-500")}>
            {balance >= 0 ? "" : "-"}R$ {formatCurrency(Math.abs(balance))}
          </p>
        </div>
      </div>

      {/* Add / Edit form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="card p-5 border-2 border-emerald-200"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-emerald-700">
                {editingId ? "Editar Entrada" : "Nova Entrada"}
              </h3>
              <button onClick={cancelForm} className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Descrição</label>
                  <input
                    type="text" required placeholder="Ex: Salário março, Freela…"
                    value={form.description ?? ""}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="input text-sm"
                  />
                </div>

                <div>
                  <label className="label">Tipo</label>
                  <select
                    value={form.type ?? "salario"}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="input text-sm py-2"
                  >
                    <option value="salario">Salário</option>
                    <option value="renda_extra">Renda Extra</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>

                <div>
                  <label className="label">Data</label>
                  <input
                    type="date" required
                    value={form.date ?? format(new Date(), "yyyy-MM-dd")}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="input text-sm py-2"
                  />
                </div>

                <div>
                  <label className="label">Valor (R$)</label>
                  <input
                    type="number" step="0.01" min="0.01" required placeholder="0,00"
                    value={form.value ?? ""}
                    onChange={e => setForm(f => ({ ...f, value: parseFloat(e.target.value) }))}
                    className="input text-sm font-black"
                  />
                </div>

                <div>
                  <label className="label">Responsável</label>
                  <select
                    value={form.responsible_id ?? ""}
                    onChange={e => setForm(f => ({ ...f, responsible_id: e.target.value }))}
                    className="input text-sm py-2"
                  >
                    <option value="">— nenhum —</option>
                    {responsibles.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="label">Observações (opcional)</label>
                  <input
                    type="text" placeholder="Notas adicionais…"
                    value={form.notes ?? ""}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="input text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={cancelForm}
                  className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors">
                  Cancelar
                </button>
                <button type="submit"
                  className="flex-1 bg-emerald-600 text-white py-3 rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                  <Check size={14} /> Salvar
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {monthIncomes.length === 0 && !showForm ? (
        <div className="card p-12 text-center">
          <TrendingUp size={44} className="text-emerald-300 mx-auto mb-3" />
          <p className="text-slate-500 font-bold text-sm">Nenhuma entrada em {format(selectedMonth, "MMMM yyyy", { locale: ptBR })}</p>
          <p className="text-slate-400 text-xs mt-1">Toque no botão + para adicionar uma receita.</p>
        </div>
      ) : (
        /* Income list */
        monthIncomes.length > 0 && (
          <div className="card overflow-hidden">
            {/* Month header */}
            <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-100 flex justify-between items-center">
              <span className="text-xs font-black uppercase tracking-widest text-slate-700">
                {format(selectedMonth, "MMMM yyyy", { locale: ptBR })}
              </span>
              <span className="text-sm font-black text-emerald-600">
                R$ {formatCurrency(totalIncome)}
              </span>
            </div>

            <div className="divide-y divide-slate-50">
              {monthIncomes.map(inc => {
                const resp = responsibles.find(r => r.id === inc.responsible_id);
                const [yearStr, monthStr, dayStr] = inc.date.split("-");
                const dateObj = new Date(parseInt(yearStr), parseInt(monthStr) - 1, parseInt(dayStr));
                return (
                  <div key={inc.id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors">
                    {/* Date badge */}
                    <div className="w-12 h-12 rounded-xl bg-emerald-500 flex flex-col items-center justify-center text-white shrink-0">
                      <span className="text-base font-black leading-none">{dateObj.getDate()}</span>
                      <span className="text-[10px] opacity-80 font-bold">
                        {format(dateObj, "MMM", { locale: ptBR })}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{inc.description}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest",
                          INCOME_TYPE_COLORS[inc.type] ?? INCOME_TYPE_COLORS.outro,
                        )}>
                          {INCOME_TYPE_LABELS[inc.type] ?? inc.type}
                        </span>
                        {resp && (
                          <p className="text-[10px] text-slate-500 uppercase font-medium">{resp.name}</p>
                        )}
                      </div>
                      {inc.notes && (
                        <p className="text-[10px] text-slate-400 italic mt-0.5 flex items-center gap-1">
                          <StickyNote size={10} />
                          {inc.notes}
                        </p>
                      )}
                    </div>

                    {/* Value + actions */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <p className="text-sm font-black text-emerald-600">R$ {formatCurrency(inc.value)}</p>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(inc)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => setConfirmId(inc.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

      {/* Balance bar — shows only when there's data */}
      {(totalIncome > 0 || monthExpenses > 0) && (
        <div className="card p-5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Balanço do mês</p>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] text-emerald-600 font-bold w-16">Entradas</span>
            <div className="flex-1 bg-slate-100 rounded-full h-2.5">
              <div
                className="h-2.5 bg-emerald-500 rounded-full transition-all"
                style={{ width: `${totalIncome > 0 ? Math.min((totalIncome / Math.max(totalIncome, monthExpenses)) * 100, 100) : 0}%` }}
              />
            </div>
            <span className="text-[10px] font-black text-emerald-600 w-24 text-right">R$ {formatCurrency(totalIncome)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-red-500 font-bold w-16">Despesas</span>
            <div className="flex-1 bg-slate-100 rounded-full h-2.5">
              <div
                className="h-2.5 bg-red-400 rounded-full transition-all"
                style={{ width: `${monthExpenses > 0 ? Math.min((monthExpenses / Math.max(totalIncome, monthExpenses)) * 100, 100) : 0}%` }}
              />
            </div>
            <span className="text-[10px] font-black text-red-500 w-24 text-right">R$ {formatCurrency(monthExpenses)}</span>
          </div>
          <div className={cn(
            "mt-3 pt-3 border-t border-slate-100 flex justify-between items-center",
          )}>
            <span className="text-xs font-bold text-slate-600">Saldo líquido</span>
            <span className={cn(
              "text-base font-black",
              balance >= 0 ? "text-emerald-600" : "text-red-600",
            )}>
              {balance >= 0 ? "+" : ""}R$ {formatCurrency(balance)}
            </span>
          </div>
        </div>
      )}

      {/* FAB */}
      {!showForm && (
        <button
          onClick={openAdd}
          className="fixed bottom-6 right-6 bg-emerald-600 text-white p-4 rounded-full shadow-xl shadow-emerald-500/30 hover:bg-emerald-700 active:scale-95 transition-all z-40"
        >
          <Plus size={24} />
        </button>
      )}

      <ConfirmModal
        open={!!confirmId}
        message={`Excluir "${confirmLabel}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => {
          if (confirmId) deleteItem("incomes", confirmId);
          setConfirmId(null);
        }}
        onCancel={() => setConfirmId(null)}
      />
    </motion.div>
  );
}
