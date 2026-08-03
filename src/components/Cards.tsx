import React, { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  ChevronLeft, ChevronRight, CreditCard, CheckCircle2, Wallet,
} from "lucide-react";
import { useData } from "../context/DataContext";
import {
  formatCurrency, cn, faturaDaCompra, vencimentoDaFatura, rotuloMes,
} from "../lib/utils";
import ConfirmModal from "./ConfirmModal";

// Soma o mês seguinte/anterior de uma chave `yyyy-MM`.
const somarMes = (mes: string, n: number) => {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(ano, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const hojeMes = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * "Cartões e Faturas": uma fatura por cartão e por mês, montada a partir das
 * despesas com `card_id` — a fatura não é uma tabela, é a soma das compras que
 * caem naquele fechamento, então ela nunca fica fora de sincronia com a lista.
 */
export default function Cards() {
  const { cards, expenses, categories, marcarPagas } = useData();

  const [mes, setMes] = useState(hojeMes());
  const [confirmarPagamento, setConfirmarPagamento] = useState<string | null>(null);

  const ativos = cards.filter(c => c.active);

  // Compras de cada cartão agrupadas pela fatura em que caem.
  const faturas = useMemo(() => {
    return ativos.map(cartao => {
      const compras = expenses
        .filter(e => e.card_id === cartao.id && faturaDaCompra(e.date, cartao.closing_day) === mes)
        .sort((a, b) => a.date.localeCompare(b.date));
      const total = compras.reduce((s, e) => s + e.value, 0);
      return {
        cartao,
        compras,
        total,
        vencimento: vencimentoDaFatura(mes, cartao.due_day),
        paga: compras.length > 0 && compras.every(e => e.paid === 1),
      };
    });
  }, [ativos, expenses, mes]);

  const totalGeral = faturas.reduce((s, f) => s + f.total, 0);

  const nomeCategoria = (id?: string) => categories.find(c => c.id === id)?.name ?? "—";

  // Pagar a fatura = marcar todas as compras dela como pagas. Não cria
  // lançamento novo: a fatura já É o conjunto dessas despesas.
  const pagarFatura = (cartaoId: string) => {
    const f = faturas.find(x => x.cartao.id === cartaoId);
    if (!f || !f.compras.length) return;
    marcarPagas(f.compras.map(c => c.id), `Fatura de ${rotuloMes(mes)} marcada como paga.`);
    setConfirmarPagamento(null);
  };

  if (!ativos.length) {
    return (
      <div className="space-y-4 pt-2">
        <h2 className="text-2xl font-black tracking-tighter uppercase">Cartões e Faturas</h2>
        <div className="card p-8 text-center space-y-3">
          <CreditCard size={40} className="mx-auto text-slate-300" />
          <p className="text-sm font-bold text-slate-500">Nenhum cartão cadastrado ainda.</p>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            Cadastre seus cartões em <span className="font-bold">Configurações → Cartões de crédito</span>,
            com o dia em que a fatura fecha e o dia em que ela vence. Depois é só escolher o cartão
            ao lançar uma despesa: ela entra sozinha na fatura certa.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      <h2 className="text-2xl font-black tracking-tighter uppercase">Cartões e Faturas</h2>

      {/* Navegação de mês */}
      <div className="card p-3 flex items-center justify-between">
        <button onClick={() => setMes(m => somarMes(m, -1))}
          aria-label="Mês anterior"
          className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 active:scale-95 transition-all">
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Fatura de</p>
          <p className="text-base font-black tracking-tighter uppercase">{rotuloMes(mes)}</p>
        </div>
        <button onClick={() => setMes(m => somarMes(m, 1))}
          aria-label="Próximo mês"
          className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 active:scale-95 transition-all">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Total do mês somando todos os cartões */}
      <div className="card p-4 flex items-center gap-3">
        <div className="p-2.5 rounded-2xl bg-indigo-500 text-white shadow-lg">
          <Wallet size={20} />
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Total nas faturas de {rotuloMes(mes)}
          </p>
          <p className="text-xl font-black tracking-tighter">R$ {formatCurrency(totalGeral)}</p>
        </div>
      </div>

      {faturas.map(({ cartao, compras, total, vencimento, paga }) => (
        <motion.div
          key={cartao.id}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="card overflow-hidden"
        >
          <div className="p-4 flex items-center gap-3 border-b border-slate-100">
            <div className="p-2.5 rounded-2xl text-white shadow-lg shrink-0"
              style={{ backgroundColor: cartao.color }}>
              <CreditCard size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black tracking-tight uppercase truncate">{cartao.name}</p>
              <p className="text-[11px] font-bold text-slate-400">
                Fecha dia {cartao.closing_day} · vence em {vencimento.split("-").reverse().join("/")}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-black tracking-tighter">R$ {formatCurrency(total)}</p>
              {paga && (
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">
                  Paga
                </span>
              )}
            </div>
          </div>

          {compras.length === 0 ? (
            <p className="p-4 text-xs text-slate-400 text-center">
              Nenhuma compra nesta fatura.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-slate-100">
                {compras.map(compra => (
                  <li key={compra.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold truncate">
                        {compra.description}
                        {compra.installment_total && compra.installment_total > 1 && (
                          <span className="text-slate-400 font-medium">
                            {` ${compra.installment_no}/${compra.installment_total}`}
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {compra.date.split("-").reverse().join("/")} · {nomeCategoria(compra.category_id)}
                      </p>
                    </div>
                    <p className={cn("text-[13px] font-black shrink-0",
                      compra.paid ? "text-emerald-600" : "text-slate-700")}>
                      R$ {formatCurrency(compra.value)}
                    </p>
                  </li>
                ))}
              </ul>

              {!paga && (
                <div className="p-3 border-t border-slate-100">
                  <button
                    onClick={() => setConfirmarPagamento(cartao.id)}
                    className="w-full py-2.5 rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase tracking-widest active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={16} /> Marcar fatura como paga
                  </button>
                </div>
              )}
            </>
          )}
        </motion.div>
      ))}

      <p className="text-[11px] text-slate-400 text-center px-6 pb-2">
        Para lançar uma compra no cartão, escolha o cartão na tela de nova despesa.
      </p>

      <ConfirmModal
        open={!!confirmarPagamento}
        title="Marcar fatura como paga?"
        message={`Todas as compras da fatura de ${rotuloMes(mes)} ficarão marcadas como pagas.`}
        confirmLabel="Marcar como paga"
        tone="primary"
        onConfirm={() => confirmarPagamento && pagarFatura(confirmarPagamento)}
        onCancel={() => setConfirmarPagamento(null)}
      />
    </div>
  );
}
