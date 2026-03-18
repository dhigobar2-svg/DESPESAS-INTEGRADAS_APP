import React, { useMemo, useState } from "react";
import { format, parseISO, isAfter, startOfToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion } from "motion/react";
import { CheckCircle2, Clock, Plus, StickyNote, Edit2, Trash2 } from "lucide-react";
import { useData } from "../context/DataContext";
import { formatCurrency, cn } from "../lib/utils";
import { Expense } from "../types";
import ExpenseModal from "./ExpenseModal";
import ConfirmModal from "./ConfirmModal";

export default function FutureExpenses() {
  const { expenses, categories, responsibles, togglePaid, deleteItem } = useData();
  const [showModal,   setShowModal]   = useState(false);
  const [editingExp,  setEditingExp]  = useState<Expense | null>(null);
  const [confirmId,   setConfirmId]   = useState<string | null>(null);

  const today = startOfToday();

  // All future unpaid expenses sorted by due_date ascending
  const grouped = useMemo(() => {
    const future = expenses
      .filter(e => {
        try { return !e.paid && isAfter(parseISO(e.due_date), today); }
        catch { return false; }
      })
      .sort((a, b) => a.due_date.localeCompare(b.due_date));

    const groups: Record<string, Expense[]> = {};
    for (const e of future) {
      const month = e.due_date.slice(0, 7);
      if (!groups[month]) groups[month] = [];
      groups[month].push(e);
    }
    return groups;
  }, [expenses, today]);

  const totalFuture = useMemo(
    () => (Object.values(grouped) as Expense[][]).flat().reduce((s: number, e: Expense) => s + e.value, 0),
    [grouped],
  );

  const monthCount  = Object.keys(grouped).length;
  const expCount    = (Object.values(grouped) as Expense[][]).flat().length;

  const confirmLabel = expenses.find(e => e.id === confirmId)?.description ?? "";

  return (
    <motion.div
      key="futures"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="space-y-5 pb-20"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Despesas Futuras</h2>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Previsto</p>
          <p className="text-xl font-black text-red-500">R$ {formatCurrency(totalFuture)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Despesas</p>
          <p className="text-xl font-black text-slate-800">{expCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Meses</p>
          <p className="text-xl font-black text-slate-800">{monthCount}</p>
        </div>
      </div>

      {/* Empty state */}
      {monthCount === 0 ? (
        <div className="card p-12 text-center">
          <CheckCircle2 size={44} className="text-emerald-400 mx-auto mb-3" />
          <p className="text-slate-500 font-bold text-sm">Nenhuma despesa futura pendente!</p>
          <p className="text-slate-400 text-xs mt-1">Você está em dia com tudo.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([month, exps]: [string, Expense[]]) => {
          // Parse the month key as a local date to avoid UTC timezone shift
          const [yearStr, monthStr] = month.split("-");
          const monthDate  = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
          const monthTotal = exps.reduce((s, e) => s + e.value, 0);

          return (
            <div key={month} className="card overflow-hidden">
              {/* Month header */}
              <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-100 flex justify-between items-center">
                <span className="text-xs font-black uppercase tracking-widest text-slate-700">
                  {format(monthDate, "MMMM yyyy", { locale: ptBR })}
                </span>
                <span className="text-sm font-black text-red-500">
                  R$ {formatCurrency(monthTotal)}
                </span>
              </div>

              {/* Expense rows */}
              <div className="divide-y divide-slate-50">
                {exps.map(e => {
                  const cat        = categories.find(c => c.id === e.category_id);
                  const resp       = responsibles.find(r => r.id === e.responsible_id);
                  const dueDate    = parseISO(e.due_date);
                  const daysUntil  = Math.ceil((dueDate.getTime() - today.getTime()) / 86_400_000);
                  const isUrgent   = daysUntil <= 3;
                  const isWarning  = daysUntil <= 7;

                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors"
                    >
                      {/* Date badge */}
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex flex-col items-center justify-center text-white shrink-0",
                        isUrgent ? "bg-red-500" : isWarning ? "bg-amber-500" : "bg-slate-400",
                      )}>
                        <span className="text-base font-black leading-none">{dueDate.getDate()}</span>
                        <span className="text-[10px] opacity-80 font-bold">
                          {format(dueDate, "MMM", { locale: ptBR })}
                        </span>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{e.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat?.color ?? "#94a3b8" }} />
                          <p className="text-[10px] text-slate-500 uppercase font-medium">
                            {cat?.name ?? "—"} · {resp?.name ?? "—"}
                          </p>
                        </div>
                        {e.notes && (
                          <p className="text-[10px] text-slate-400 italic mt-0.5 flex items-center gap-1">
                            <StickyNote size={10} />
                            {e.notes}
                          </p>
                        )}
                        {isWarning && (
                          <p className={cn(
                            "text-[10px] font-bold mt-0.5 flex items-center gap-1",
                            isUrgent ? "text-red-500" : "text-amber-500",
                          )}>
                            <Clock size={10} />
                            {daysUntil === 0
                              ? "Vence hoje!"
                              : daysUntil === 1
                              ? "Vence amanhã!"
                              : `Vence em ${daysUntil} dias`}
                          </p>
                        )}
                      </div>

                      {/* Value + actions */}
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <p className="text-sm font-black text-slate-900">R$ {formatCurrency(e.value)}</p>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => togglePaid(e.id)}
                            className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-widest rounded-full hover:bg-emerald-100 transition-colors"
                          >
                            Pagar
                          </button>
                          <button
                            onClick={() => setEditingExp(e)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => setConfirmId(e.id)}
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
          );
        })
      )}

      {/* FAB */}
      <button
        onClick={() => setShowModal(true)}
        className="fixed bottom-6 right-6 bg-emerald-600 text-white p-4 rounded-full shadow-xl shadow-emerald-500/30 hover:bg-emerald-700 active:scale-95 transition-all z-40"
      >
        <Plus size={24} />
      </button>

      <ExpenseModal
        open={showModal || !!editingExp}
        editing={editingExp}
        onClose={() => { setShowModal(false); setEditingExp(null); }}
      />

      <ConfirmModal
        open={!!confirmId}
        message={`Excluir "${confirmLabel}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => {
          if (confirmId) deleteItem("expenses", confirmId);
          setConfirmId(null);
        }}
        onCancel={() => setConfirmId(null)}
      />
    </motion.div>
  );
}
