import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { format } from "date-fns";
import { RefreshCw, AlertTriangle, X, Check } from "lucide-react";
import { Income } from "../types";
import { useData } from "../context/DataContext";
import { generateId, cn } from "../lib/utils";

interface Props {
  open:    boolean;
  editing: Income | null;
  onClose: () => void;
}

const emptyForm = (): Partial<Income> => ({
  description: "",
  value: undefined,
  date: format(new Date(), "yyyy-MM-dd"),
  type: "salario",
  responsible_id: "",
  notes: "",
  recurring: 0,
});

export default function IncomeModal({ open, editing, onClose }: Props) {
  const {
    incomes, responsibles, incomeTypes, recurringIncomes,
    saveIncome, saveRecurringIncome,
  } = useData();

  const [form,          setForm]          = useState<Partial<Income>>(emptyForm());
  const [pendingIncome, setPendingIncome] = useState<Income | null>(null);

  // Initialise form whenever the modal (re)opens.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      const tpl = editing.recurring_income_id
        ? recurringIncomes.find(r => r.id === editing.recurring_income_id)
        : undefined;
      setForm({ ...editing, recurring: tpl && tpl.active ? 1 : 0 });
    } else {
      setForm({ ...emptyForm(), type: incomeTypes[0]?.id ?? "salario" });
    }
    setPendingIncome(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  // Recurrence is a property of the entry: the toggle creates, keeps or stops
  // the underlying template — no separate screen.
  const doSaveIncome = (income: Income) => {
    const day = parseInt(income.date.slice(8, 10) || "1", 10) || 1;
    const linked = income.recurring_income_id
      ? recurringIncomes.find(r => r.id === income.recurring_income_id)
      : undefined;

    if (income.recurring) {
      if (linked) {
        saveIncome({ ...income, recurring: 0 }, !!editing);
        saveRecurringIncome({
          ...linked,
          description: income.description, value: income.value, type: income.type,
          responsible_id: income.responsible_id, day_of_month: day, active: 1,
        }, true);
      } else {
        const tplId = generateId();
        saveIncome({ ...income, recurring: 0, recurring_income_id: tplId }, !!editing);
        saveRecurringIncome({
          id: tplId, description: income.description, value: income.value, type: income.type,
          responsible_id: income.responsible_id, day_of_month: day, active: 1,
        }, false);
      }
    } else {
      saveIncome({ ...income, recurring: 0 }, !!editing);
      if (linked && linked.active) saveRecurringIncome({ ...linked, active: 0 }, true);
    }
    setPendingIncome(null);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.description?.trim() || !form.value || !form.date || !form.type) return;

    const income: Income = {
      id:                  editing?.id ?? generateId(),
      description:         form.description.trim(),
      value:               Number(form.value),
      date:                form.date,
      type:                form.type,
      responsible_id:      form.responsible_id || undefined,
      notes:               form.notes?.trim() || undefined,
      recurring:           form.recurring ?? 0,
      recurring_income_id: form.recurring_income_id,
    };

    if (!editing) {
      const isDup = incomes.some(i =>
        i.description.toLowerCase() === income.description.toLowerCase() &&
        i.date === income.date &&
        Math.abs(i.value - income.value) < 0.01 &&
        i.type === income.type,
      );
      if (isDup) { setPendingIncome(income); return; }
    }

    doSaveIncome(income);
  };

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
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-black tracking-tighter uppercase">
                  {editing ? "Editar Entrada" : "Nova Entrada"}
                </h2>
                <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">Descrição</label>
                  <input
                    type="text" required placeholder="Ex: Salário março, Freela…"
                    value={form.description ?? ""}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="input"
                  />
                </div>

                {/* Data e Valor — duas colunas iguais cobrindo exatamente a
                    largura do campo Descrição. `min-w-0` impede que a largura
                    mínima nativa dos campos de data/número estufe a célula. */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <label className="label">Data</label>
                    <input
                      type="date" required
                      value={form.date ?? format(new Date(), "yyyy-MM-dd")}
                      onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                      className="input"
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="label">Valor (R$)</label>
                    <input
                      type="number" step="0.01" min="0.01" required placeholder="0,00"
                      value={form.value ?? ""}
                      onChange={e => setForm(f => ({ ...f, value: parseFloat(e.target.value) }))}
                      className="input font-black"
                    />
                  </div>
                </div>

                <div>
                  <label className="label">Tipo</label>
                  <select
                    value={form.type ?? (incomeTypes[0]?.id ?? "outro")}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="input"
                  >
                    {incomeTypes.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                    {incomeTypes.length === 0 && <option value="outro">Outro</option>}
                  </select>
                </div>

                <div>
                  <label className="label">Responsável</label>
                  <select
                    value={form.responsible_id ?? ""}
                    onChange={e => setForm(f => ({ ...f, responsible_id: e.target.value }))}
                    className="input"
                  >
                    <option value="">— nenhum —</option>
                    {responsibles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="label">Observações (opcional)</label>
                  <input
                    type="text" placeholder="Notas adicionais…"
                    value={form.notes ?? ""}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="input"
                  />
                </div>

                {/* Repetir todo mês */}
                <div
                  onClick={() => setForm(f => ({ ...f, recurring: f.recurring ? 0 : 1 }))}
                  className={cn(
                    "flex items-center gap-3 py-3 px-4 rounded-2xl border-2 cursor-pointer transition-all",
                    form.recurring ? "border-teal-400 bg-teal-50" : "border-slate-200 bg-slate-50 hover:border-slate-300",
                  )}
                >
                  <RefreshCw size={18} className={form.recurring ? "text-teal-500" : "text-slate-400"} />
                  <div className="flex-1">
                    <p className={cn("text-sm font-bold", form.recurring ? "text-teal-700" : "text-slate-600")}>
                      Repetir todo mês
                    </p>
                    <p className={cn("text-[11px] mt-0.5", form.recurring ? "text-teal-500" : "text-slate-400")}>
                      {form.recurring
                        ? "Lançada automaticamente todo mês no mesmo dia. Desligue para parar."
                        : "Marque para que esta entrada se repita automaticamente todo mês."}
                    </p>
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
                          Já existe uma entrada com a mesma descrição, valor, data e tipo. Deseja salvar mesmo assim?
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setPendingIncome(null)}
                          className="flex-1 bg-white border border-slate-200 text-slate-600 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-colors">
                          Cancelar
                        </button>
                        <button type="button" onClick={() => pendingIncome && doSaveIncome(pendingIncome)}
                          className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-amber-600 transition-colors">
                          Salvar mesmo assim
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {!pendingIncome && (
                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={onClose}
                      className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors">
                      Cancelar
                    </button>
                    <button type="submit"
                      className="flex-1 bg-emerald-600 text-white py-4 rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                      <Check size={14} /> Salvar
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
