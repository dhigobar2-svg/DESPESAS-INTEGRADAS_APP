import React, { useState } from "react";
import { motion } from "motion/react";
import { UserCheck } from "lucide-react";
import { useData } from "../context/DataContext";
import { cn } from "../lib/utils";

/**
 * Perguntada UMA vez, logo depois da senha, para o app saber quem está usando
 * este aparelho e carimbar "lançado por" em cada despesa/entrada.
 *
 * A escolha fica só neste aparelho (localStorage, chave `device_user`) e nunca
 * é sincronizada — no celular de cada pessoa a resposta é outra. Responder é
 * opcional: "agora não" segue direto e a pergunta não volta (a mesma escolha
 * continua disponível em Configurações → Quem usa este aparelho).
 */
export default function QuemUsa({ onPronto }: { onPronto: () => void }) {
  const { responsibles, setDeviceUser } = useData();
  const [nome, setNome] = useState("");

  const confirmar = (valor: string) => {
    const limpo = valor.trim();
    if (limpo) setDeviceUser(limpo);
    onPronto();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center mb-7">
          <div className="w-16 h-16 rounded-3xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25 mb-4">
            <UserCheck size={28} className="text-white" />
          </div>
          <h1 className="text-xl font-black tracking-tighter uppercase text-center">
            Quem usa este aparelho?
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-2 text-center leading-relaxed">
            Cada lançamento passa a mostrar quem fez. Fica guardado só neste
            aparelho e você pode mudar depois em Configurações.
          </p>
        </div>

        <form
          onSubmit={e => { e.preventDefault(); confirmar(nome); }}
          className="card p-6 space-y-4"
        >
          {responsibles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {responsibles.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setNome(r.name)}
                  className={cn(
                    "px-3 py-2 rounded-xl text-sm font-bold border transition-all active:scale-95",
                    nome === r.name
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300",
                  )}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}

          <div>
            <label className="label" htmlFor="quem-usa">Nome</label>
            <input
              id="quem-usa"
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder={responsibles.length ? "Ou escreva outro nome…" : "Ex: Dhigo"}
              className="input"
              autoComplete="name"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => confirmar("")}
              className="flex-1 bg-slate-100 text-slate-600 py-3.5 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors"
            >
              Agora não
            </button>
            <button
              type="submit"
              disabled={!nome.trim()}
              className="flex-1 btn-primary py-3.5 disabled:opacity-40"
            >
              Confirmar
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
