import React, { useState } from "react";
import { motion } from "motion/react";
import { Lock, Loader2, Eye, EyeOff } from "lucide-react";
import { useData } from "../context/DataContext";

/**
 * Pedida apenas quando o servidor exige senha (variável APP_PASSWORD definida)
 * e este aparelho ainda não entrou. Sem senha configurada esta tela nunca
 * aparece — é o que garante que ninguém fique trancado para fora.
 */
export default function LockScreen() {
  const { signIn } = useData();
  const [senha,     setSenha]     = useState("");
  const [enviando,  setEnviando]  = useState(false);
  // A senha da casa é numérica, então o teclado abre no modo número. O botão
  // abaixo alterna para o teclado completo caso a senha vire alfanumérica.
  const [tecladoNumerico, setTecladoNumerico] = useState(true);
  const [mostrarSenha,    setMostrarSenha]    = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senha.trim() || enviando) return;
    setEnviando(true);
    const ok = await signIn(senha);
    setEnviando(false);
    if (ok) setSenha("");
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-3xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25 mb-4">
            <Lock size={28} className="text-white" />
          </div>
          <h1 className="text-xl font-black tracking-tighter uppercase text-center">
            Despesas Integradas
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1 text-center">
            Digite a senha da família para acessar
          </p>
        </div>

        <form onSubmit={entrar} className="card p-6 space-y-4">
          <div>
            <label className="label" htmlFor="senha">Senha</label>
            {/* O olho é nosso, não do navegador: no computador o Chrome oferece
                um botão nativo para revelar a senha, mas no celular não existe —
                e sem ele não dá para conferir o que foi digitado. */}
            <div className="relative">
              <input
                id="senha"
                type={mostrarSenha ? "text" : "password"}
                autoComplete="current-password"
                inputMode={tecladoNumerico ? "numeric" : "text"}
                value={senha}
                onChange={e => setSenha(e.target.value)}
                placeholder="••••••"
                autoFocus
                className="input text-center tracking-[0.4em] text-lg pr-12"
              />
              <button
                type="button"
                onClick={() => setMostrarSenha(m => !m)}
                aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                title={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-3 text-slate-400 hover:text-emerald-600 active:scale-95 transition-all"
              >
                {mostrarSenha ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setTecladoNumerico(t => !t)}
              className="mt-2 text-[11px] font-bold text-slate-400 hover:text-emerald-600 transition-colors"
            >
              {tecladoNumerico ? "Usar teclado completo (letras)" : "Usar teclado numérico"}
            </button>
          </div>
          <button type="submit" disabled={enviando || !senha.trim()} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
            {enviando ? <><Loader2 size={14} className="animate-spin" /> Entrando…</> : "Entrar"}
          </button>
        </form>

        <p className="text-[11px] text-slate-400 text-center mt-5 leading-relaxed">
          A senha fica guardada neste aparelho — você só precisa digitar uma vez.
        </p>
      </motion.div>
    </div>
  );
}
