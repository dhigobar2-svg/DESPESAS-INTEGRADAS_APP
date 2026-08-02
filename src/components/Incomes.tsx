import React, { useState, useMemo } from "react";
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval, subMonths, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion } from "motion/react";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Edit2,
  TrendingUp, StickyNote, RefreshCw,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { formatCurrency, cn, recurringDueDate, isRecurringIncomeCovered } from "../lib/utils";
import { Income } from "../types";
import ConfirmModal from "./ConfirmModal";
import IncomeModal from "./IncomeModal";

// Uma ocorrência ainda não criada de uma entrada que se repete. Existe só para
// exibição: o lançamento real nasce sozinho quando o mês chega.
type IncomeRow = Income & { isVirtual?: boolean };

export default function Incomes() {
  const {
    incomes, expenses, responsibles, incomeTypes, recurringIncomes,
    deleteItem, saveRecurringIncome,
  } = useData();

  const [selectedMonth,  setSelectedMonth]  = useState(new Date());
  const [showModal,      setShowModal]      = useState(false);
  const [editingIncome,  setEditingIncome]  = useState<Income | null>(null);
  const [confirmId,      setConfirmId]      = useState<string | null>(null);
  const [virtualConfirmId, setVirtualConfirmId] = useState<string | null>(null);

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

  // Ocorrências previstas das entradas que se repetem.
  // O app materializa a recorrência do mês corrente ao abrir; para os meses
  // seguintes ela ainda não existe como lançamento. Sem esta projeção o mês que
  // vem aparecia vazio, dava a impressão de que a recorrência não funcionava e
  // levava a lançar tudo de novo na mão (o lançamento manual então "cobria" o
  // mês e a automática nunca aparecia).
  const virtualIncomes = useMemo<IncomeRow[]>(() => {
    const monthKey   = format(selectedMonth, "yyyy-MM");
    const currentKey = format(new Date(), "yyyy-MM");
    if (monthKey <= currentKey) return []; // passado/mês atual já são reais

    const year   = selectedMonth.getFullYear();
    const month1 = selectedMonth.getMonth() + 1;

    return recurringIncomes
      .filter(tpl => tpl.active)
      .map(tpl => {
        const date = recurringDueDate(year, month1, tpl.day_of_month);
        if (isRecurringIncomeCovered(incomes, tpl, date)) return null;
        return {
          id:                  `virtual-inc-${tpl.id}-${date}`,
          description:         tpl.description,
          value:               tpl.value,
          date,
          type:                tpl.type,
          responsible_id:      tpl.responsible_id,
          recurring:           0,
          recurring_income_id: tpl.id,
          isVirtual:           true,
        } as IncomeRow;
      })
      .filter((i): i is IncomeRow => i !== null);
  }, [selectedMonth, recurringIncomes, incomes]);

  // Lista exibida = lançamentos reais do mês + previstos das recorrências.
  const displayedIncomes = useMemo<IncomeRow[]>(
    () => [...monthIncomes, ...virtualIncomes].sort((a, b) => b.date.localeCompare(a.date)),
    [monthIncomes, virtualIncomes],
  );

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

  const totalIncome = displayedIncomes.reduce((s, i) => s + i.value, 0);
  const balance     = totalIncome - monthExpenses;

  const openAdd  = () => { setEditingIncome(null); setShowModal(true); };

  // Editar uma ocorrência prevista não precisa esperar a virada do mês: ela é
  // aberta com o id determinístico que o app usaria ao gerá-la, então salvar
  // cria a linha real daquele mês (nunca duplicada) e, com "repetir todo mês"
  // ligado, atualiza o template — o novo valor vale para os meses seguintes.
  const openEdit = (inc: IncomeRow) => {
    if (inc.isVirtual) {
      const { isVirtual: _ignored, ...base } = inc;
      setEditingIncome({
        ...base,
        id: `recinc_${inc.recurring_income_id}_${inc.date.slice(0, 7)}`,
      });
    } else {
      setEditingIncome(inc);
    }
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingIncome(null); };

  const confirmLabel = incomes.find(i => i.id === confirmId)?.description ?? "";

  // Excluir uma ocorrência prevista = parar a recorrência (a linha ainda não
  // existe para ser apagada). Mesmo comportamento da tela de vencimentos.
  const virtualToStop = virtualIncomes.find(i => i.id === virtualConfirmId);
  const stopRecurring = () => {
    const tpl = recurringIncomes.find(r => r.id === virtualToStop?.recurring_income_id);
    if (tpl) saveRecurringIncome({ ...tpl, active: 0 }, true);
    setVirtualConfirmId(null);
  };

  return (
    <motion.div
      key="incomes"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="space-y-5 pb-20"
    >
      {/* Month nav — o título encolhe e a navegação nunca quebra de linha:
          em telas estreitas "Entradas e Receitas" ocupava duas linhas e
          espremia as setas de mês. */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 truncate">
          Entradas e Receitas
        </h2>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={prevMonth} aria-label="Mês anterior"
            className="p-2 rounded-xl hover:bg-slate-100 active:scale-95 transition-all">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-black uppercase tracking-widest w-24 text-center">
            {format(selectedMonth, "MMM yyyy", { locale: ptBR })}
          </span>
          <button onClick={nextMonth} aria-label="Próximo mês"
            className="p-2 rounded-xl hover:bg-slate-100 active:scale-95 transition-all">
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
      {displayedIncomes.length === 0 ? (
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
            {displayedIncomes.map(inc => {
              const resp = responsibles.find(r => r.id === inc.responsible_id);
              const [yearStr, monthStr, dayStr] = inc.date.split("-");
              const dateObj = new Date(parseInt(yearStr), parseInt(monthStr) - 1, parseInt(dayStr));
              const it = incomeTypes.find(t => t.id === inc.type);
              return (
                <div key={inc.id} className={cn(
                  "flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors",
                  inc.isVirtual && "bg-violet-50/40",
                )}>
                  {/* Date badge */}
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex flex-col items-center justify-center text-white shrink-0",
                    inc.isVirtual ? "bg-violet-400" : "bg-emerald-500",
                  )}>
                    <span className="text-base font-black leading-none">{dateObj.getDate()}</span>
                    <span className="text-[10px] opacity-80 font-bold">{format(dateObj, "MMM", { locale: ptBR })}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    {/* O título fica sozinho na linha para não ser truncado cedo
                        demais; os marcadores vão para a linha dos chips abaixo. */}
                    <p className="text-sm font-bold text-slate-900 truncate">{inc.description}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest"
                        style={it ? { backgroundColor: it.color + "22", color: it.color } : { backgroundColor: "#64748b22", color: "#64748b" }}
                      >
                        {it?.name ?? inc.type}
                      </span>
                      {inc.isVirtual && (
                        <span title="Ainda não lançado — será criado sozinho quando o mês chegar"
                          className="shrink-0 flex items-center gap-0.5 text-[9px] font-bold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full uppercase tracking-widest">
                          Previsto
                        </span>
                      )}
                      {!inc.isVirtual && inc.recurring_income_id && activeRecurringIncomeIds.has(inc.recurring_income_id) && (
                        <span title="Repete todo mês"
                          className="shrink-0 flex items-center gap-0.5 text-[9px] font-bold text-teal-600 bg-teal-100 px-2 py-0.5 rounded-full uppercase tracking-widest">
                          <RefreshCw size={9} /> Mês
                        </span>
                      )}
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
                    <p className={cn("text-sm font-black", inc.isVirtual ? "text-violet-500" : "text-emerald-600")}>
                      R$ {formatCurrency(inc.value)}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(inc)}
                        title={inc.isVirtual ? "Editar esta entrada futura" : "Editar"}
                        className="p-2.5 text-slate-500 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded-lg transition-colors">
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => inc.isVirtual ? setVirtualConfirmId(inc.id) : setConfirmId(inc.id)}
                        title={inc.isVirtual ? "Parar de repetir" : "Excluir"}
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

      {/* Explica a linha roxa: não há nada a fazer, o lançamento nasce sozinho. */}
      {virtualIncomes.length > 0 && (
        <p className="text-[11px] text-violet-500 font-medium px-1 flex items-start gap-1.5">
          <RefreshCw size={12} className="mt-0.5 shrink-0" />
          <span>
            As entradas marcadas como <strong>previsto</strong> se repetem todo mês e são
            lançadas automaticamente quando o mês chega — não precisa lançar de novo.
            Dá para editar o valor ou parar a repetição por aqui mesmo, sem esperar a virada do mês.
          </span>
        </p>
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
        open={!!virtualConfirmId}
        message={`"${virtualToStop?.description ?? ""}" deixará de ser lançada automaticamente nos próximos meses. Os lançamentos já feitos não são afetados.`}
        onConfirm={stopRecurring}
        onCancel={() => setVirtualConfirmId(null)}
      />

      <ConfirmModal
        open={!!confirmId}
        message={`Excluir "${confirmLabel}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => { if (confirmId) deleteItem("incomes", confirmId); setConfirmId(null); }}
        onCancel={() => setConfirmId(null)}
      />
    </motion.div>
  );
}
