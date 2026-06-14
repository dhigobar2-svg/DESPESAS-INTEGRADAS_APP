import React, { useState, useMemo } from "react";
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval, subMonths, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion } from "motion/react";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Edit2,
  TrendingUp, StickyNote, RefreshCw,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { formatCurrency, cn } from "../lib/utils";
import { Income } from "../types";
import ConfirmModal from "./ConfirmModal";
import IncomeModal from "./IncomeModal";

export default function Incomes() {
  const { incomes, expenses, responsibles, incomeTypes, recurringIncomes, deleteItem } = useData();

  const [selectedMonth,  setSelectedMonth]  = useState(new Date());
  const [showModal,      setShowModal]      = useState(false);
  const [editingIncome,  setEditingIncome]  = useState<Income | null>(null);
  const [confirmId,      setConfirmId]      = useState<string | null>(null);

  const activeRecurringIncomeIds = new Set(recurringIncomes.filter(r => r.active).map(r => r.id));

  const prevMonth = () => setSelectedMonth(m => subMonths(m, 1));
  const nextMonth = () => setSelectedMonth(m => addMonths(m, 1));

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

  const totalIncome = monthIncomes.reduce((s, i) => s + i.value, 0);
  const balance     = totalIncome - monthExpenses;

  const openAdd  = () => { setEditingIncome(null); setShowModal(true); };
  const openEdit = (inc: Income) => { setEditingIncome(inc); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditingIncome(null); };

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

      {/* Balanço do mês */}
      <div className="card p-5">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Balanço do mês</p>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-emerald-600 font-bold w-16">Entradas</span>
          <div className="flex-1 bg-slate-100 rounded-full h-2.5">
            <div className="h-2.5 bg-emerald-500 rounded-full transition-all"
              style={{ width: `${totalIncome > 0 ? Math.min((totalIncome / Math.max(totalIncome, monthExpenses)) * 100, 100) : 0}%` }} />
          </div>
          <span className="text-[10px] font-black text-emerald-600 w-24 text-right">R$ {formatCurrency(totalIncome)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-red-500 font-bold w-16">Despesas</span>
          <div className="flex-1 bg-slate-100 rounded-full h-2.5">
            <div className="h-2.5 bg-red-400 rounded-full transition-all"
              style={{ width: `${monthExpenses > 0 ? Math.min((monthExpenses / Math.max(totalIncome, monthExpenses)) * 100, 100) : 0}%` }} />
          </div>
          <span className="text-[10px] font-black text-red-500 w-24 text-right">R$ {formatCurrency(monthExpenses)}</span>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center">
          <span className="text-xs font-bold text-slate-600">Saldo líquido</span>
          <span className={cn("text-base font-black", balance >= 0 ? "text-emerald-600" : "text-red-600")}>
            {balance >= 0 ? "+" : ""}R$ {formatCurrency(balance)}
          </span>
        </div>
      </div>

      {/* Empty state / list */}
      {monthIncomes.length === 0 ? (
        <div className="card p-12 text-center">
          <TrendingUp size={44} className="text-emerald-300 mx-auto mb-3" />
          <p className="text-slate-500 font-bold text-sm">Nenhuma entrada em {format(selectedMonth, "MMMM yyyy", { locale: ptBR })}</p>
          <p className="text-slate-400 text-xs mt-1">Toque no botão + para adicionar uma receita.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-100 flex justify-between items-center">
            <span className="text-xs font-black uppercase tracking-widest text-slate-700">
              {format(selectedMonth, "MMMM yyyy", { locale: ptBR })}
            </span>
            <span className="text-sm font-black text-emerald-600">R$ {formatCurrency(totalIncome)}</span>
          </div>

          <div className="divide-y divide-slate-50">
            {monthIncomes.map(inc => {
              const resp = responsibles.find(r => r.id === inc.responsible_id);
              const [yearStr, monthStr, dayStr] = inc.date.split("-");
              const dateObj = new Date(parseInt(yearStr), parseInt(monthStr) - 1, parseInt(dayStr));
              const it = incomeTypes.find(t => t.id === inc.type);
              return (
                <div key={inc.id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors">
                  {/* Date badge */}
                  <div className="w-12 h-12 rounded-xl bg-emerald-500 flex flex-col items-center justify-center text-white shrink-0">
                    <span className="text-base font-black leading-none">{dateObj.getDate()}</span>
                    <span className="text-[10px] opacity-80 font-bold">{format(dateObj, "MMM", { locale: ptBR })}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold text-slate-900 truncate">{inc.description}</p>
                      {inc.recurring_income_id && activeRecurringIncomeIds.has(inc.recurring_income_id) && (
                        <span title="Repete todo mês" className="shrink-0 flex items-center gap-0.5 text-[8px] font-bold text-teal-600 bg-teal-100 px-1.5 py-0.5 rounded-full uppercase tracking-widest">
                          <RefreshCw size={8} /> Mês
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      <span
                        className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest"
                        style={it ? { backgroundColor: it.color + "22", color: it.color } : { backgroundColor: "#64748b22", color: "#64748b" }}
                      >
                        {it?.name ?? inc.type}
                      </span>
                      {resp && <p className="text-[10px] text-slate-500 uppercase font-medium">{resp.name}</p>}
                    </div>
                    {inc.notes && (
                      <p className="text-[10px] text-slate-400 italic mt-0.5 flex items-center gap-1">
                        <StickyNote size={10} /> {inc.notes}
                      </p>
                    )}
                  </div>

                  {/* Value + actions */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <p className="text-sm font-black text-emerald-600">R$ {formatCurrency(inc.value)}</p>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(inc)} title="Editar"
                        className="p-2.5 text-slate-500 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded-lg transition-colors">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => setConfirmId(inc.id)} title="Excluir"
                        className="p-2.5 text-slate-500 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={openAdd}
        className="fixed bottom-6 right-6 bg-emerald-600 text-white p-4 rounded-full shadow-xl shadow-emerald-500/30 hover:bg-emerald-700 active:scale-95 transition-all z-40"
      >
        <Plus size={24} />
      </button>

      <IncomeModal open={showModal} editing={editingIncome} onClose={closeModal} />

      <ConfirmModal
        open={!!confirmId}
        message={`Excluir "${confirmLabel}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => { if (confirmId) deleteItem("incomes", confirmId); setConfirmId(null); }}
        onCancel={() => setConfirmId(null)}
      />
    </motion.div>
  );
}
