import React, { useState, useEffect } from "react";
import { Plus, Lock } from "lucide-react";
import { useData } from "../context/DataContext";
import Toast from "./Toast";

export default function LoginScreen() {
  const { users, login, register, addToast } = useData();
  const [mode, setMode]           = useState<"select" | "login" | "register">("select");
  const [selectedName, setSelectedName] = useState("");
  const [pin,          setPin]          = useState("");
  const [newName,      setNewName]      = useState("");
  const [newPin,       setNewPin]       = useState("");
  const [loading,      setLoading]      = useState(false);

  // If no users exist yet, go straight to register
  useEffect(() => {
    if (users.length === 0) setMode("register");
    else setMode("select");
  }, [users.length]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await login(selectedName, pin);
    setLoading(false);
    if (!res.success) {
      addToast("error", res.error ?? "PIN incorreto.");
      setPin("");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length !== 4) { addToast("error", "PIN deve ter exatamente 4 dígitos."); return; }
    if (!newName.trim()) { addToast("error", "Digite seu nome."); return; }
    setLoading(true);
    const res = await register(newName.trim(), newPin);
    setLoading(false);
    if (!res.success) addToast("error", res.error ?? "Erro ao cadastrar.");
    else addToast("success", `Bem-vindo, ${newName.trim()}!`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-emerald-600 rounded-3xl shadow-2xl shadow-emerald-300 mb-5">
            <span className="text-4xl">💰</span>
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase">Despesas Integradas</h1>
          <p className="text-slate-500 text-sm font-medium mt-1">Controle financeiro familiar</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl p-8">

          {/* ── Select user ────────────────────────────────────────────────── */}
          {mode === "select" && (
            <>
              <h2 className="text-lg font-black uppercase tracking-tighter mb-5">Quem é você?</h2>
              <div className="space-y-2 mb-6">
                {users.map(u => (
                  <button
                    key={u.id}
                    onClick={() => { setSelectedName(u.name); setPin(""); setMode("login"); }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 border border-slate-100 transition-colors text-left group"
                  >
                    <div className="w-11 h-11 bg-emerald-100 rounded-full flex items-center justify-center shrink-0 group-hover:bg-emerald-200 transition-colors">
                      <span className="text-xl font-black text-emerald-700">
                        {u.name[0].toUpperCase()}
                      </span>
                    </div>
                    <span className="font-bold text-slate-800">{u.name}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setNewName(""); setNewPin(""); setMode("register"); }}
                className="w-full flex items-center justify-center gap-2 text-sm text-emerald-600 font-bold hover:underline py-2"
              >
                <Plus size={16} /> Adicionar novo membro da família
              </button>
            </>
          )}

          {/* ── Login (PIN entry) ───────────────────────────────────────────── */}
          {mode === "login" && (
            <>
              <button
                onClick={() => setMode("select")}
                className="text-slate-400 text-sm mb-4 hover:text-slate-600 transition-colors"
              >
                ← Voltar
              </button>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-2xl font-black text-emerald-700">
                    {selectedName[0]?.toUpperCase()}
                  </span>
                </div>
                <div>
                  <h2 className="text-lg font-black uppercase tracking-tighter">Olá, {selectedName}!</h2>
                  <p className="text-slate-400 text-xs font-medium">Digite seu PIN de 4 dígitos</p>
                </div>
              </div>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="relative">
                  <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="● ● ● ●"
                    className="input text-center text-2xl tracking-[0.5em] font-black pl-10"
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={pin.length !== 4 || loading}
                  className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold uppercase tracking-widest disabled:opacity-50 transition-colors hover:bg-emerald-700 active:scale-95"
                >
                  {loading ? "Entrando…" : "Entrar"}
                </button>
              </form>
            </>
          )}

          {/* ── Register ───────────────────────────────────────────────────── */}
          {mode === "register" && (
            <>
              {users.length > 0 && (
                <button
                  onClick={() => setMode("select")}
                  className="text-slate-400 text-sm mb-4 hover:text-slate-600 transition-colors"
                >
                  ← Voltar
                </button>
              )}
              <h2 className="text-lg font-black uppercase tracking-tighter mb-1">
                {users.length === 0 ? "Crie seu acesso" : "Novo membro"}
              </h2>
              <p className="text-slate-400 text-xs font-medium mb-5">
                {users.length === 0
                  ? "Configure o acesso inicial do app"
                  : "Adicione um membro da família"}
              </p>
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="label">Seu nome</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Ex: João, Maria, Pedro…"
                    required
                    className="input"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">Crie um PIN de 4 dígitos</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={newPin}
                      onChange={e => setNewPin(e.target.value.replace(/\D/g, ""))}
                      placeholder="● ● ● ●"
                      required
                      className="input text-center text-2xl tracking-[0.5em] font-black pl-10"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={!newName.trim() || newPin.length !== 4 || loading}
                  className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold uppercase tracking-widest disabled:opacity-50 hover:bg-emerald-700 active:scale-95 transition-all"
                >
                  {loading ? "Cadastrando…" : "Criar conta"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
      <Toast />
    </div>
  );
}
