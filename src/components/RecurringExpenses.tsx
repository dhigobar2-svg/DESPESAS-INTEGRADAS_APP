import React, { useState } from "react";
import { motion } from "motion/react";
import { RefreshCw, Trash2, Plus, TrendingUp, Calendar, CheckCircle, XCircle } from "lucide-react";
import { useData } from "../context/DataContext";
import { generateId, cn, formatCurrency } from "../lib/utils";
import { Category, Responsible, RecurringExpense } from "../types";
import ConfirmModal from "./ConfirmModal";

type DeleteTarget = { table: string; id: string; label: string } | null;

function RecurringCard({
  rec, categories, responsibles, onToggle, onDelete,
}: {
  rec: RecurringExpense;
  categories: Category[];
  responsibles: Responsible[];
  onToggle: (rec: RecurringExpense) => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  const cat  = categories.find(c => c.id === rec.category_id);
  const resp = responsibles.find(r => r.id === rec.responsible_id);
  return (
    <div className={cn(
      "flex items-center gap-3 p-4 rounded-2xl border transition-all",
      rec.active
        ? "bg-white border-slate-200 shadow-sm"
        : "bg-slate-50 border-slate-100 opacity-60",
    )}>
      <div
        className="w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: cat?.color ?? "#94a3b8" }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate">{rec.description}</p>
        <p className="text-[11px] text-slate-500 font-medium mt-0.5">
          Dia {rec.day_of_month}
          {cat  && ` · ${cat.name}`}
          {resp && ` · ${resp.name}`}
        </p>
      </div>
      <span className="text-sm font-black text-slate-700 shrink-0">
        R$ {formatCurrency(rec.value)}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onToggle(rec)}
          title={rec.active ? "Desativar" : "Ativar"}
          className={cn(
            "p-1.5 rounded-lg transition-colors",
            rec.active
              ? "text-emerald-600 hover:bg-emerald-50"
              : "text-slate-400 hover:bg-slate-100",
          )}
        >
          {rec.active ? <CheckCircle size={16} /> : <XCircle size={16} />}
        </button>
        <button
          onClick={() => onDelete({ table: "recurring_expenses", id: rec.id, label: rec.description })}
          className="p-1.5 text-slate-400 hover:text-red-600 transition-colors rounded-lg"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

export default function RecurringExpensesView() {
  const {
    categories, responsibles, recurring,
    saveRecurring, deleteItem,
  } = useData();

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const activeList   = recurring.filter(r => r.active);
  const inactiveList = recurring.filter(r => !r.active);

  const totalMonthly = activeList.reduce((s, r) => s + r.value, 0);
  const totalYearly  = totalMonthly * 12;

  const toggleActive = (rec: RecurringExpense) => {
    saveRecurring({ ...rec, active: rec.active ? 0 : 1 }, true);
  };

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const rec: RecurringExpense = {
      id:             generateId(),
      category_id:    fd.get("category")    as string,
      description:    (fd.get("description") as string).trim(),
      value:          parseFloat(fd.get("value") as string),
      responsible_id: fd.get("responsible") as string,
      day_of_month:   parseInt(fd.get("day") as string, 10),
      active:         1,
    };
    saveRecurring(rec, false);
    e.currentTarget.reset();
  };

  return (
    <motion.div
      key="recurring"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="space-y-6 pb-16"
    >
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Despesas Recorrentes</h2>

      {/* ── Summary cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 text-center">
          <RefreshCw size={18} className="mx-auto mb-2 text-orange-500" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Ativas</p>
          <p className="text-2xl font-black">{activeList.length}</p>
        </div>
        <div className="card p-4 text-center">
          <TrendingUp size={18} className="mx-auto mb-2 text-orange-500" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Total/mês</p>
          <p className="text-lg font-black leading-tight">R$ {formatCurrency(totalMonthly)}</p>
        </div>
        <div className="card p-4 text-center">
          <Calendar size={18} className="mx-auto mb-2 text-orange-500" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Total/ano</p>
          <p className="text-lg font-black leading-tight">R$ {formatCurrency(totalYearly)}</p>
        </div>
      </div>

      {/* ── Active list ────────────────────────────────────────────────────────── */}
      <section className="card p-5">
        <h3 className="section-title"><CheckCircle size={16} className="text-emerald-500" /> Ativas</h3>
        {activeList.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">Nenhuma recorrente ativa.</p>
        ) : (
          <div className="space-y-2">
            {activeList
              .sort((a, b) => a.day_of_month - b.day_of_month)
              .map(rec => (
                <RecurringCard
                  key={rec.id} rec={rec}
                  categories={categories} responsibles={responsibles}
                  onToggle={toggleActive} onDelete={setDeleteTarget}
                />
              ))}
          </div>
        )}
      </section>

      {/* ── Inactive list ──────────────────────────────────────────────────────── */}
      {inactiveList.length > 0 && (
        <section className="card p-5">
          <h3 className="section-title"><XCircle size={16} className="text-slate-400" /> Inativas</h3>
          <div className="space-y-2">
            {inactiveList.map(rec => (
              <RecurringCard
                key={rec.id} rec={rec}
                categories={categories} responsibles={responsibles}
                onToggle={toggleActive} onDelete={setDeleteTarget}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Add form ───────────────────────────────────────────────────────────── */}
      <section className="card p-5">
        <h3 className="section-title"><Plus size={16} /> Nova Recorrente</h3>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">Descrição</label>
              <input name="description" placeholder="Ex: Aluguel, Netflix…" required className="input text-sm" />
            </div>
            <div>
              <label className="label">Categoria</label>
              <select name="category" required className="input text-sm py-2">
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Responsável</label>
              <select name="responsible" required className="input text-sm py-2">
                {responsibles.length === 0
                  ? <option value="">—</option>
                  : responsibles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Valor (R$)</label>
              <input
                type="number" step="0.01" min="0.01" name="value"
                placeholder="0,00" required className="input text-sm font-black"
              />
            </div>
            <div>
              <label className="label">Dia do mês</label>
              <input
                type="number" name="day" min="1" max="28"
                placeholder="1–28" required className="input text-sm"
              />
            </div>
          </div>
          <button type="submit" className="btn-primary w-full py-3 flex items-center justify-center gap-2">
            <Plus size={16} /> Adicionar Recorrente
          </button>
        </form>
      </section>

      <ConfirmModal
        open={!!deleteTarget}
        message={`Excluir "${deleteTarget?.label}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => {
          if (deleteTarget) deleteItem(deleteTarget.table, deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </motion.div>
  );
}
