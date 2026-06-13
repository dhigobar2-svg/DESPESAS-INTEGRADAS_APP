import React, { useState, useMemo } from "react";
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval, subMonths, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Edit2, Check, X,
  TrendingUp, StickyNote, AlertTriangle, RefreshCw,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { generateId, formatCurrency, cn } from "../lib/utils";
import { Income } from "../types";
import ConfirmModal from "./ConfirmModal";


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
  const {
    incomes, expenses, responsibles, incomeTypes, recurringIncomes,
    saveIncome, saveRecurringIncome, deleteItem,
  } = useData();

  const [selectedMonth,  setSelectedMonth]  = useState(new Date());
  const [showForm,       setShowForm]       = useState(false);
  const [editingId,      setEditingId]      = useState<string | null>(null);
  const [pendingIncome,  setPendingIncome]  = useState<Income | null>(null);
  const [form,          setForm]          = useState<Partial<Income>>(emptyForm());
  const [confirmId,     setConfirmId]     = useState<string | null>(null);
  const [recConfirmId,  setRecConfirmId]  = useState<string | null>(null);

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

  const doSaveIncome = (income: Income) => {
    // For a new income marked recurring, create a template and link this income
    // as its first instance, so it is regenerated automatically every month.
    if (!editingId && income.recurring) {
      const tplId = generateId();
      const day = parseInt(income.date.slice(8, 10) || "1", 10) || 1;
      saveRecurringIncome({
        id:             tplId,
        description:    income.description,
        value:          income.value,
        type:           income.type,
        responsible_id: income.responsible_id,
        day_of_month:   day,
        active:         1,
      }, false);
      saveIncome({ ...income, recurring: 0, recurring_income_id: tplId }, false);
    } else {
      saveIncome(income, !!editingId);
    }
    setPendingIncome(null);
    cancelForm();
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
      recurring_income_id: form.recurring_income_id,  // preserve link when editing an instance
    };

    // For new incomes: check for identical entry
    if (!editingId) {
      const isDup = incomes.some(i =>
        i.description.toLowerCase() === income.description.toLowerCase() &&
        i.date === income.date &&
        Math.abs(i.value - income.value) < 0.01 &&
        i.type === income.type,
      );
      if (isDup) {
        setPendingIncome(income);
        return; // wait for user confirmation
      }
    }

    doSaveIncome(income);
  };

  const confirmIncomeDuplicate = () => {
    if (pendingIncome) doSaveIncome(pendingIncome);
  };

  const cancelIncomeDuplicate = () => setPendingIncome(null);

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

      {/* Balanço do mês — sempre visível no topo */}
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
        <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center">
          <span className="text-xs font-bold text-slate-600">Saldo líquido</span>
          <span className={cn(
            "text-base font-black",
            balance >= 0 ? "text-emerald-600" : "text-red-600",
          )}>
            {balance >= 0 ? "+" : ""}R$ {formatCurrency(balance)}
          </span>
        </div>
      </div>

      {/* Recurring incomes management */}
      {recurringIncomes.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
              <RefreshCw size={14} className="text-teal-500" /> Entradas Recorrentes
            </h3>
            <span className="text-[10px] font-black text-teal-600">
              R$ {formatCurrency(recurringIncomes.filter(r => r.active).reduce((s, r) => s + r.value, 0))}/mês
            </span>
          </div>
          <div className="space-y-2">
            {[...recurringIncomes].sort((a, b) => a.day_of_month - b.day_of_month).map(rec => {
              const it = incomeTypes.find(t => t.id === rec.type);
              return (
                <div key={rec.id} className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border transition-all",
                  rec.active ? "bg-white border-slate-200" : "bg-slate-50 border-slate-100 opacity-60",
                )}>
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: it?.color ?? "#64748b" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{rec.description}</p>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Dia {rec.day_of_month}{it && ` · ${it.name}`}
                    </p>
                  </div>
                  <span className="text-sm font-black text-teal-600 shrink-0">R$ {formatCurrency(rec.value)}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => saveRecurringIncome({ ...rec, active: rec.active ? 0 : 1 }, true)}
                      title={rec.active ? "Desativar" : "Ativar"}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        rec.active ? "text-emerald-600 hover:bg-emerald-50" : "text-slate-400 hover:bg-slate-100",
                      )}
                    >
                      {rec.active ? <Check size={16} /> : <X size={16} />}
                    </button>
                    <button
                      onClick={() => setRecConfirmId(rec.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 transition-colors rounded-lg"
                      title="Excluir"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 mt-3">
            Marque "entrada recorrente" ao adicionar uma entrada para criar uma recorrência. Desativá-la interrompe os próximos meses; lançamentos já feitos são mantidos.
          </p>
        </div>
      )}

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

                <div className="col-span-2">
                  <label className="label">Data</label>
                  <input
                    type="date" required
                    value={form.date ?? format(new Date(), "yyyy-MM-dd")}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="input text-sm py-2"
                  />
                </div>

                <div>
                  <label className="label">Tipo</label>
                  <select
                    value={form.type ?? (incomeTypes[0]?.id ?? "outro")}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="input text-sm py-2"
                  >
                    {incomeTypes.map(it => (
                      <option key={it.id} value={it.id}>{it.name}</option>
                    ))}
                    {incomeTypes.length === 0 && <option value="outro">Outro</option>}
                  </select>
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

                <div className="col-span-2">
                  <label className="label">Responsável</label>
                  <select
                    value={form.responsible_id ?? ""}
                    onChange={e => setForm(f => ({ ...f, responsible_id: e.target.value }))}
                    className="input py-3 text-sm"
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

                {!editingId && (
                <div
                  onClick={() => setForm(f => ({ ...f, recurring: f.recurring ? 0 : 1 }))}
                  className={cn(
                    "col-span-2 flex items-center gap-3 py-3 px-4 rounded-2xl border-2 cursor-pointer transition-all",
                    form.recurring
                      ? "border-teal-400 bg-teal-50"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300",
                  )}
                >
                  <RefreshCw size={18} className={form.recurring ? "text-teal-500" : "text-slate-400"} />
                  <div className="flex-1">
                    <p className={cn("text-sm font-bold", form.recurring ? "text-teal-700" : "text-slate-600")}>
                      É uma entrada recorrente?
                    </p>
                    {!!form.recurring && (
                      <p className="text-[11px] text-teal-500 mt-0.5">
                        Será lançada automaticamente todo mês no mesmo dia.
                      </p>
                    )}
                  </div>
                  <div className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
                    form.recurring ? "bg-teal-500 border-teal-500" : "border-slate-300",
                  )}>
                    {!!form.recurring && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
                )}
              </div>

              {/* Aviso de entrada duplicada */}
              <AnimatePresence>
                {pendingIncome && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                    className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs font-bold text-amber-800 leading-relaxed">
                        Já existe uma entrada com a mesma descrição, valor, data e tipo.
                        Deseja salvar mesmo assim?
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={cancelIncomeDuplicate}
                        className="flex-1 bg-white border border-slate-200 text-slate-600 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-colors">
                        Cancelar
                      </button>
                      <button type="button" onClick={confirmIncomeDuplicate}
                        className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-amber-600 transition-colors">
                        Salvar mesmo assim
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!pendingIncome && (
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
              )}
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
                      <div className="mt-0.5 space-y-0.5">
                        {(() => {
                          const it = incomeTypes.find(t => t.id === inc.type);
                          return (
                            <span
                              className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest"
                              style={it
                                ? { backgroundColor: it.color + "22", color: it.color }
                                : { backgroundColor: "#64748b22", color: "#64748b" }}
                            >
                              {it?.name ?? inc.type}
                            </span>
                          );
                        })()}
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

      <ConfirmModal
        open={!!recConfirmId}
        message={`Excluir a entrada recorrente "${recurringIncomes.find(r => r.id === recConfirmId)?.description ?? ""}"? Os lançamentos já feitos são mantidos; apenas os próximos meses deixam de ser gerados.`}
        onConfirm={() => {
          if (recConfirmId) deleteItem("recurring_incomes", recConfirmId);
          setRecConfirmId(null);
        }}
        onCancel={() => setRecConfirmId(null)}
      />
    </motion.div>
  );
}
