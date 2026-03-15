import React, { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion } from "motion/react";
import {
  User, Tag, Users, Camera, Trash2, Edit2, Check, X,
  RefreshCw, DollarSign, Plus,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { generateId, cn } from "../lib/utils";
import { Category, Responsible, Budget, RecurringExpense } from "../types";
import ConfirmModal from "./ConfirmModal";

type DeleteTarget = { table: string; id: string; label: string } | null;

export default function Settings() {
  const {
    categories, responsibles, profile, budgets, recurring,
    saveProfile, saveCategory, saveResponsible, saveBudget, saveRecurring,
    deleteItem, readPhoto,
  } = useData();

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  // ── Profile ───────────────────────────────────────────────────────────────────
  const [profileName, setProfileName] = useState(profile.name);
  const profilePhotoRef = useRef<HTMLInputElement>(null);

  // Sync when profile loads from server
  useEffect(() => { setProfileName(profile.name); }, [profile.name]);

  const handleProfilePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const photo = await readPhoto(file);
    await saveProfile({ ...profile, name: profileName, photo });
  };

  // ── Categories ────────────────────────────────────────────────────────────────
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName,  setEditCatName]  = useState("");
  const [editCatColor, setEditCatColor] = useState("");

  const startEditCat = (cat: Category) => {
    setEditingCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatColor(cat.color);
  };
  const saveEditCat = () => {
    if (!editingCatId || !editCatName.trim()) return;
    saveCategory({ id: editingCatId, name: editCatName.trim(), color: editCatColor }, true);
    setEditingCatId(null);
  };

  const handleAddCat = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    saveCategory({
      id:    generateId(),
      name:  (fd.get("name") as string).trim(),
      color: fd.get("color") as string,
    }, false);
    e.currentTarget.reset();
  };

  // ── Responsibles ──────────────────────────────────────────────────────────────
  const handleAddResp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const fileInput = e.currentTarget.querySelector<HTMLInputElement>('input[type="file"]');
    const file = fileInput?.files?.[0];
    const photo = file ? await readPhoto(file) : undefined;
    saveResponsible({ id: generateId(), name: (fd.get("name") as string).trim(), photo }, false);
    e.currentTarget.reset();
  };

  // ── Budgets ───────────────────────────────────────────────────────────────────
  const currentMonth = format(new Date(), "yyyy-MM");
  const [budgetMonth, setBudgetMonth] = useState(currentMonth);

  const monthBudgets = budgets.filter(b => b.month === budgetMonth);
  const getBudgetForCat = (catId: string) =>
    monthBudgets.find(b => b.category_id === catId);

  const handleBudgetChange = (catId: string, value: string) => {
    const limit = parseFloat(value);
    if (isNaN(limit) || limit <= 0) return;
    const existing = getBudgetForCat(catId);
    saveBudget({
      id:          existing?.id ?? generateId(),
      category_id: catId,
      month:       budgetMonth,
      limit_value: limit,
    });
  };

  // ── Recurring ─────────────────────────────────────────────────────────────────
  const handleAddRecurring = (e: React.FormEvent<HTMLFormElement>) => {
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

  const toggleRecurringActive = (rec: RecurringExpense) => {
    saveRecurring({ ...rec, active: rec.active ? 0 : 1 }, true);
  };

  // ── Available months for budget selector ──────────────────────────────────────
  const monthOptions = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() + i - 2);
    return format(d, "yyyy-MM");
  });

  return (
    <motion.div
      key="settings"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="space-y-8 pb-16"
    >
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Configurações</h2>

      {/* ── Profile ───────────────────────────────────────────────────────────── */}
      <section className="card p-6">
        <h3 className="section-title"><User size={16} /> Meu Perfil</h3>
        <div className="flex items-center gap-6">
          <div className="relative shrink-0">
            <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border-2 border-slate-200">
              {profile.photo
                ? <img src={profile.photo} alt="Perfil" className="w-full h-full object-cover" />
                : <User size={32} className="text-slate-300" />}
            </div>
            <label className="absolute bottom-0 right-0 bg-emerald-600 text-white p-1.5 rounded-full shadow-lg cursor-pointer hover:bg-emerald-700">
              <Camera size={12} />
              <input ref={profilePhotoRef} type="file" accept="image/*" className="hidden" onChange={handleProfilePhoto} />
            </label>
          </div>
          <div className="flex-1 flex gap-2">
            <input
              type="text" value={profileName}
              onChange={e => setProfileName(e.target.value)}
              className="input flex-1"
              placeholder="Seu nome"
            />
            <button
              onClick={() => saveProfile({ ...profile, name: profileName })}
              className="btn-primary px-4 py-2"
            >
              Salvar
            </button>
          </div>
        </div>
      </section>

      {/* ── Categories ────────────────────────────────────────────────────────── */}
      <section className="card p-6">
        <h3 className="section-title"><Tag size={16} /> Categorias</h3>
        <div className="space-y-2 mb-5">
          {categories.map(cat => (
            <div key={cat.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
              {editingCatId === cat.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input type="color" value={editCatColor} onChange={e => setEditCatColor(e.target.value)}
                    className="w-8 h-8 p-0.5 rounded-lg border border-slate-200 cursor-pointer" />
                  <input type="text" value={editCatName} onChange={e => setEditCatName(e.target.value)}
                    className="input flex-1 py-1.5 text-sm" autoFocus />
                  <button onClick={saveEditCat} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg">
                    <Check size={16} />
                  </button>
                  <button onClick={() => setEditingCatId(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-sm font-bold">{cat.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEditCat(cat)}
                      className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => setDeleteTarget({ table: "categories", id: cat.id, label: cat.name })}
                      className="p-1.5 text-slate-400 hover:text-red-600 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        <form onSubmit={handleAddCat} className="flex gap-2">
          <input name="name" placeholder="Nova categoria…" required
            className="input flex-1 py-2 text-sm" />
          <input name="color" type="color" defaultValue="#10b981"
            className="w-10 h-10 p-1 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer" />
          <button type="submit" className="btn-primary py-2 px-3 flex items-center gap-1">
            <Plus size={14} /> Add
          </button>
        </form>
      </section>

      {/* ── Responsibles ──────────────────────────────────────────────────────── */}
      <section className="card p-6">
        <h3 className="section-title"><Users size={16} /> Responsáveis</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
          {responsibles.map(resp => (
            <div key={resp.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                  {resp.photo
                    ? <img src={resp.photo} className="w-full h-full object-cover" alt={resp.name} />
                    : <User size={16} className="text-slate-400" />}
                </div>
                <span className="text-sm font-bold">{resp.name}</span>
              </div>
              <button onClick={() => setDeleteTarget({ table: "responsibles", id: resp.id, label: resp.name })}
                className="p-1.5 text-slate-400 hover:text-red-600 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <form onSubmit={handleAddResp} className="space-y-2">
          <div className="flex gap-2">
            <input name="name" placeholder="Nome do responsável…" required className="input flex-1 py-2 text-sm" />
            <label className="bg-slate-100 text-slate-600 p-2 rounded-xl cursor-pointer hover:bg-slate-200 transition-colors flex items-center">
              <Camera size={18} />
              <input type="file" accept="image/*" className="hidden" />
            </label>
          </div>
          <button type="submit" className="btn-primary w-full py-3">Cadastrar Responsável</button>
        </form>
      </section>

      {/* ── Budgets ───────────────────────────────────────────────────────────── */}
      <section className="card p-6">
        <h3 className="section-title"><DollarSign size={16} /> Orçamentos por Categoria</h3>
        <div className="mb-4">
          <label className="label">Mês de referência</label>
          <select value={budgetMonth} onChange={e => setBudgetMonth(e.target.value)} className="input py-2 text-sm">
            {monthOptions.map(m => (
              <option key={m} value={m}>
                {format(new Date(m + "-01"), "MMMM yyyy", { locale: ptBR })}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-3">
          {categories.map(cat => {
            const existing = getBudgetForCat(cat.id);
            return (
              <div key={cat.id} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="text-sm font-bold w-32 truncate">{cat.name}</span>
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-bold">R$</span>
                  <input
                    type="number" step="0.01" min="0.01" placeholder="Sem limite"
                    defaultValue={existing?.limit_value ?? ""}
                    key={`${cat.id}-${budgetMonth}`}
                    onBlur={e => { if (e.target.value) handleBudgetChange(cat.id, e.target.value); }}
                    className="input pl-9 py-2 text-sm"
                  />
                </div>
                {existing && (
                  <button onClick={() => setDeleteTarget({ table: "budgets", id: existing.id, label: `orçamento de ${cat.name}` })}
                    className="p-1.5 text-slate-400 hover:text-red-600 transition-colors">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Recurring expenses ────────────────────────────────────────────────── */}
      <section className="card p-6">
        <h3 className="section-title"><RefreshCw size={16} /> Despesas Recorrentes</h3>
        {recurring.length > 0 && (() => {
          const activeRec = recurring.filter(r => r.active);
          const totalMonthly = activeRec.reduce((s, r) => s + r.value, 0);
          return (
            <div className="flex gap-2 mb-4">
              <div className="flex-1 bg-orange-50 border border-orange-100 rounded-xl p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-400 mb-0.5">Ativas</p>
                <p className="text-lg font-black text-orange-700">{activeRec.length}</p>
              </div>
              <div className="flex-1 bg-orange-50 border border-orange-100 rounded-xl p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-400 mb-0.5">Total/mês</p>
                <p className="text-lg font-black text-orange-700">R$ {totalMonthly.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div className="flex-1 bg-orange-50 border border-orange-100 rounded-xl p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-400 mb-0.5">Total/ano</p>
                <p className="text-lg font-black text-orange-700">R$ {(totalMonthly * 12).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            </div>
          );
        })()}
        <p className="text-xs text-slate-500 mb-4">
          São lançadas automaticamente todo mês no dia configurado.
        </p>
        <div className="space-y-2 mb-5">
          {recurring.map(rec => {
            const cat  = categories.find(c => c.id === rec.category_id);
            const resp = responsibles.find(r => r.id === rec.responsible_id);
            return (
              <div key={rec.id} className={cn(
                "flex items-center justify-between p-3 rounded-xl border",
                rec.active ? "bg-slate-50 border-slate-100" : "bg-slate-50/50 border-slate-100 opacity-60",
              )}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{rec.description}</p>
                  <p className="text-[10px] text-slate-500 uppercase font-medium">
                    Dia {rec.day_of_month} · {cat?.name ?? "—"} · {resp?.name ?? "—"} · R$ {rec.value.toFixed(2)}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  <button
                    onClick={() => toggleRecurringActive(rec)}
                    className={cn(
                      "px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-colors",
                      rec.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500",
                    )}
                  >
                    {rec.active ? "Ativo" : "Inativo"}
                  </button>
                  <button onClick={() => setDeleteTarget({ table: "recurring_expenses", id: rec.id, label: rec.description })}
                    className="p-1.5 text-slate-400 hover:text-red-600 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          {recurring.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">Nenhuma despesa recorrente cadastrada.</p>
          )}
        </div>

        {/* Add recurring form */}
        <form onSubmit={handleAddRecurring} className="space-y-3 border-t border-slate-100 pt-5">
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
                {responsibles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                {responsibles.length === 0 && <option value="">—</option>}
              </select>
            </div>
            <div>
              <label className="label">Valor (R$)</label>
              <input type="number" step="0.01" min="0.01" name="value" placeholder="0,00" required className="input text-sm font-black" />
            </div>
            <div>
              <label className="label">Dia do mês</label>
              <input type="number" name="day" min="1" max="28" placeholder="1–28" required className="input text-sm" />
            </div>
          </div>
          <button type="submit" className="btn-primary w-full py-3">
            Adicionar Recorrente
          </button>
        </form>
      </section>

      {/* Confirm delete */}
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
