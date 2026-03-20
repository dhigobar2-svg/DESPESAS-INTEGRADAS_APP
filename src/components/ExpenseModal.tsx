import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";
import { Expense } from "../types";
import { useData } from "../context/DataContext";
import { generateId } from "../lib/utils";

interface Props {
  open:          boolean;
  editing:       Expense | null;
  defaultValues?: Partial<Expense>;  // used when duplicating
  onClose:       () => void;
}

export default function ExpenseModal({ open, editing, defaultValues, onClose }: Props) {
  const { categories, responsibles, saveExpense, saveRecurring } = useData();
  const [isRecurring, setIsRecurring] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const dueDate = fd.get("due_date") as string;
    const expense: Expense = {
      id:             editing?.id ?? generateId(),
      category_id:    fd.get("category")    as string,
      description:    fd.get("description") as string,
      date:           fd.get("date")        as string,
      due_date:       dueDate,
      value:          parseFloat(fd.get("value") as string),
      responsible_id: fd.get("responsible") as string,
      paid:           fd.get("paid") === "on" ? 1 : 0,
      notes:          (fd.get("notes") as string) || undefined,
      created_by:     editing?.created_by,
    };
    saveExpense(expense, !!editing);

    // If marked as recurring and it's a new expense, also save as recurring
    if (!editing && isRecurring && dueDate) {
      const dayOfMonth = parseInt(dueDate.slice(8, 10), 10);
      saveRecurring({
        id:             generateId(),
        category_id:    expense.category_id,
        description:    expense.description,
        value:          expense.value,
        responsible_id: expense.responsible_id,
        day_of_month:   dayOfMonth,
        active:         1,
      }, false);
    }

    setIsRecurring(false);
    onClose();
  };

  const today = format(new Date(), "yyyy-MM-dd");

  // Resolve default values: editing > defaultValues > empty
  const defCat   = editing?.category_id    ?? defaultValues?.category_id    ?? categories[0]?.id ?? "";
  const defDesc  = editing?.description    ?? defaultValues?.description    ?? "";
  const defDate  = editing?.date           ?? defaultValues?.date           ?? today;
  const defDue   = editing?.due_date       ?? defaultValues?.due_date       ?? today;
  const defVal   = editing?.value          ?? defaultValues?.value;
  const defResp  = editing?.responsible_id ?? defaultValues?.responsible_id ?? responsibles[0]?.id ?? "";
  const defPaid  = editing?.paid === 1;
  const defNotes = editing?.notes          ?? defaultValues?.notes          ?? "";

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1,   y: 0  }}
            exit={{   opacity: 0, scale: 0.9,  y: 20 }}
            className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-y-auto max-h-[90vh]"
          >
            <div className="p-8">
              <h2 className="text-xl font-black tracking-tighter uppercase mb-6">
                {editing ? "Editar Despesa" : defaultValues ? "Duplicar Despesa" : "Nova Despesa"}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Descrição */}
                <div>
                  <label className="label">Descrição</label>
                  <input
                    type="text" name="description"
                    defaultValue={defDesc}
                    placeholder="Ex: Aluguel, Supermercado…"
                    required
                    className="input"
                  />
                </div>

                {/* Categoria */}
                <div>
                  <label className="label">Categoria</label>
                  <select name="category" defaultValue={defCat} required className="input">
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    {categories.length === 0 && <option value="">Sem categorias</option>}
                  </select>
                </div>

                {/* Datas */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Lançamento</label>
                    <input type="date" name="date" required className="input py-2 text-sm"
                      defaultValue={defDate} />
                  </div>
                  <div>
                    <label className="label">Vencimento</label>
                    <input type="date" name="due_date" required className="input py-2 text-sm"
                      defaultValue={defDue} />
                  </div>
                </div>

                {/* Valor */}
                <div>
                  <label className="label">Valor (R$)</label>
                  <input type="number" step="0.01" min="0.01" name="value"
                    defaultValue={defVal} placeholder="0,00" required className="input font-black" />
                </div>

                {/* Responsável */}
                <div>
                  <label className="label">Responsável</label>
                  <select name="responsible" defaultValue={defResp} required className="input">
                    {responsibles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    {responsibles.length === 0 && <option value="">Nenhum cadastrado</option>}
                  </select>
                </div>

                {/* Observações */}
                <div>
                  <label className="label">Observações (opcional)</label>
                  <textarea
                    name="notes"
                    rows={2}
                    placeholder="Notas adicionais, número de nota fiscal, etc."
                    defaultValue={defNotes}
                    className="input resize-none"
                  />
                </div>

                {/* Pago */}
                <div className="flex items-center gap-3 py-1">
                  <input type="checkbox" name="paid" id="paid"
                    defaultChecked={defPaid}
                    className="w-5 h-5 rounded accent-emerald-600" />
                  <label htmlFor="paid" className="text-sm font-bold text-slate-700">Já está pago?</label>
                </div>

                {/* Recorrente — somente para novas despesas */}
                {!editing && (
                  <div
                    onClick={() => setIsRecurring(v => !v)}
                    className={`flex items-center gap-3 py-3 px-4 rounded-2xl border-2 cursor-pointer transition-all ${
                      isRecurring
                        ? "border-orange-400 bg-orange-50"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <RefreshCw size={18} className={isRecurring ? "text-orange-500" : "text-slate-400"} />
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${isRecurring ? "text-orange-700" : "text-slate-600"}`}>
                        É uma despesa recorrente?
                      </p>
                      {isRecurring && (
                        <p className="text-[11px] text-orange-500 mt-0.5">
                          Será adicionada automaticamente às recorrentes todo mês no mesmo dia do vencimento.
                        </p>
                      )}
                    </div>
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                      isRecurring ? "bg-orange-500 border-orange-500" : "border-slate-300"
                    }`}>
                      {isRecurring && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </div>
                  </div>
                )}

                {/* Ações */}
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={onClose}
                    className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors">
                    Cancelar
                  </button>
                  <button type="submit"
                    className="flex-1 bg-emerald-600 text-white py-4 rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 transition-colors">
                    Salvar
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
