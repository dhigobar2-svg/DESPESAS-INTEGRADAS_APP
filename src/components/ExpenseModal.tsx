import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { format } from "date-fns";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { Expense } from "../types";
import { useData } from "../context/DataContext";
import CurrencyInput from "./CurrencyInput";
import { generateId } from "../lib/utils";

interface Props {
  open:          boolean;
  editing:       Expense | null;
  defaultValues?: Partial<Expense>;  // used when duplicating
  onClose:       () => void;
}

export default function ExpenseModal({ open, editing, defaultValues, onClose }: Props) {
  const {
    categories, responsibles, expenses, recurring,
    saveExpense, saveRecurring, addToast, deviceUser,
  } = useData();

  // The template this expense is currently linked to (if any).
  const linkedTemplate = editing?.recurring_id
    ? recurring.find(r => r.id === editing.recurring_id)
    : undefined;

  const [isRecurring,     setIsRecurring]     = useState(false);
  const [pendingExpense,  setPendingExpense]   = useState<Expense | null>(null);
  // O valor é controlado porque o campo de moeda interpreta o texto digitado.
  const [valorForm,       setValorForm]       = useState<number | undefined>(undefined);

  // Reflect the entry's current recurrence state whenever the modal (re)opens.
  useEffect(() => {
    if (open) {
      setIsRecurring(!!(linkedTemplate && linkedTemplate.active));
      setValorForm(editing?.value ?? defaultValues?.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  // ── Centralised save (called both on first submit and on duplicate-confirm) ──
  const doSave = (expense: Expense) => {
    const dayOfMonth = expense.due_date ? parseInt(expense.due_date.slice(8, 10), 10) : 1;
    const linked = expense.recurring_id ? recurring.find(r => r.id === expense.recurring_id) : undefined;

    if (isRecurring && expense.due_date) {
      if (linked) {
        // Already recurring: keep the link and update the template so future
        // months reflect any edits to value/description/day.
        saveExpense(expense, !!editing);
        saveRecurring({
          ...linked,
          category_id:    expense.category_id,
          description:    expense.description,
          value:          expense.value,
          responsible_id: expense.responsible_id,
          day_of_month:   dayOfMonth,
          active:         1,
        }, true);
      } else {
        // Becoming recurring: reuse a matching active template or create one.
        const existingRec = recurring.find(r =>
          r.active &&
          r.description.toLowerCase() === expense.description.toLowerCase() &&
          r.day_of_month === dayOfMonth &&
          Math.abs(r.value - expense.value) < 0.01,
        );
        const recId = existingRec?.id ?? generateId();
        saveExpense({ ...expense, recurring_id: recId }, !!editing);
        if (existingRec) {
          addToast("info", "Vinculada a uma recorrência já existente.");
        } else {
          saveRecurring({
            id:             recId,
            category_id:    expense.category_id,
            description:    expense.description,
            value:          expense.value,
            responsible_id: expense.responsible_id,
            day_of_month:   dayOfMonth,
            active:         1,
          }, false);
        }
      }
    } else {
      saveExpense(expense, !!editing);
      // Turned off: stop the recurrence (past entries are kept).
      if (linked && linked.active) {
        saveRecurring({ ...linked, active: 0 }, true);
        addToast("info", "Recorrência desativada — não será mais lançada nos próximos meses.");
      }
    }

    setPendingExpense(null);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd      = new FormData(e.currentTarget);
    const dueDate = fd.get("due_date") as string;

    // Valor inválido (campo vazio ou texto sem número) não vira lançamento zerado.
    const valor = Number(fd.get("value"));
    if (!Number.isFinite(valor) || valor <= 0) {
      addToast("error", "Informe um valor maior que zero.");
      return;
    }

    const expense: Expense = {
      id:             editing?.id ?? generateId(),
      category_id:    fd.get("category")    as string,
      // Trim: espaços extras burlavam o alerta de duplicidade e criavam
      // descrições visualmente idênticas porém distintas.
      description:    (fd.get("description") as string).trim(),
      date:           fd.get("date")        as string,
      due_date:       dueDate,
      value:          valor,
      responsible_id: fd.get("responsible") as string,
      paid:           fd.get("paid") === "on" ? 1 : 0,
      notes:          (fd.get("notes") as string) || undefined,
      // Quem lançou: preservado na edição, carimbado na criação.
      created_by:     editing?.created_by ?? (deviceUser || undefined),
      recurring_id:   editing?.recurring_id ?? defaultValues?.recurring_id,
    };

    // For new expenses: check if an identical one already exists
    if (!editing) {
      const isDup = expenses.some(ex =>
        ex.description.toLowerCase() === expense.description.toLowerCase() &&
        ex.due_date === expense.due_date &&
        Math.abs(ex.value - expense.value) < 0.01 &&
        ex.responsible_id === expense.responsible_id,
      );
      if (isDup) {
        setPendingExpense(expense);
        return; // wait for user confirmation
      }
    }

    doSave(expense);
  };

  const confirmDuplicate = () => {
    if (pendingExpense) doSave(pendingExpense);
  };

  const cancelDuplicate = () => setPendingExpense(null);

  const handleClose = () => {
    setPendingExpense(null);
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
            onClick={handleClose}
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
                  {/* required só quando há opções: um select obrigatório com lista
                      vazia bloqueia o envio do formulário sem feedback claro. */}
                  <select name="category" defaultValue={defCat} required={categories.length > 0} className="input">
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    {categories.length === 0 && <option value="">Sem categorias</option>}
                  </select>
                </div>

                {/* Datas — duas colunas iguais ocupando exatamente a largura do
                    campo Descrição. `min-w-0` é obrigatório: sem ele a célula do
                    grid assume a largura mínima do input de data e a dupla fica
                    mais larga que os demais campos. */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <label className="label">Lançamento</label>
                    <input type="date" name="date" required className="input"
                      defaultValue={defDate} />
                  </div>
                  <div className="min-w-0">
                    <label className="label">Vencimento</label>
                    <input type="date" name="due_date" required className="input"
                      defaultValue={defDue} />
                  </div>
                </div>

                {/* Valor */}
                <div>
                  <label className="label">Valor (R$)</label>
                  <CurrencyInput name="value" value={valorForm} onChange={setValorForm}
                    required className="font-black" />
                </div>

                {/* Responsável */}
                <div>
                  <label className="label">Responsável</label>
                  <select name="responsible" defaultValue={defResp} required={responsibles.length > 0} className="input">
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

                {/* Repetir todo mês — disponível ao criar e ao editar */}
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
                      Repetir todo mês
                    </p>
                    <p className={`text-[11px] mt-0.5 ${isRecurring ? "text-orange-500" : "text-slate-400"}`}>
                      {isRecurring
                        ? "Lançada automaticamente todo mês no mesmo dia do vencimento. Desligue para parar."
                        : editing && linkedTemplate
                        ? "Religue para voltar a lançar todo mês."
                        : "Marque para que ela se repita automaticamente todo mês."}
                    </p>
                  </div>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                    isRecurring ? "bg-orange-500 border-orange-500" : "border-slate-300"
                  }`}>
                    {isRecurring && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </div>
                </div>

                {/* ── Aviso de despesa duplicada ───────────────────────────────── */}
                <AnimatePresence>
                  {pendingExpense && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                      className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-xs font-bold text-amber-800 leading-relaxed">
                          Já existe uma despesa com a mesma descrição, valor, vencimento e responsável.
                          Deseja salvar mesmo assim?
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={cancelDuplicate}
                          className="flex-1 bg-white border border-slate-200 text-slate-600 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-colors">
                          Cancelar
                        </button>
                        <button type="button" onClick={confirmDuplicate}
                          className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-amber-600 transition-colors">
                          Salvar mesmo assim
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Ações — ocultas durante o aviso de duplicata */}
                {!pendingExpense && (
                  <div className="flex gap-3 pt-4">
                    <button type="button" onClick={handleClose}
                      className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors">
                      Cancelar
                    </button>
                    <button type="submit"
                      className="flex-1 bg-emerald-600 text-white py-4 rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 transition-colors">
                      Salvar
                    </button>
                  </div>
                )}
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
