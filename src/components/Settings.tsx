import React, { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion } from "motion/react";
import {
  User, Tag, Users, Camera, Trash2, Edit2, Check, X,
  DollarSign, Plus, TrendingUp,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { generateId, cn } from "../lib/utils";
import { Category, Responsible, Budget, IncomeType } from "../types";
import ConfirmModal from "./ConfirmModal";

type DeleteTarget = { table: string; id: string; label: string } | null;

export default function Settings() {
  const {
    categories, responsibles, profile, budgets, incomeTypes,
    saveProfile, saveCategory, saveResponsible, saveBudget, saveIncomeType,
    deleteItem, readPhoto, addToast,
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
    const name = editCatName.trim();
    const dup = categories.find(
      c => c.id !== editingCatId && c.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (dup) {
      addToast("error", `Já existe uma categoria chamada "${dup.name}".`);
      return;
    }
    saveCategory({ id: editingCatId, name, color: editCatColor }, true);
    setEditingCatId(null);
  };

  const handleAddCat = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd   = new FormData(e.currentTarget);
    const name = (fd.get("name") as string).trim();
    const dup  = categories.find(c => c.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) {
      addToast("error", `Já existe uma categoria chamada "${dup.name}".`);
      return;
    }
    saveCategory({ id: generateId(), name, color: fd.get("color") as string }, false);
    e.currentTarget.reset();
  };

  // ── Responsibles ──────────────────────────────────────────────────────────────
  const handleAddResp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd   = new FormData(e.currentTarget);
    const name = (fd.get("name") as string).trim();
    const dup  = responsibles.find(r => r.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) {
      addToast("error", `Já existe um responsável chamado "${dup.name}".`);
      return;
    }
    const fileInput = e.currentTarget.querySelector<HTMLInputElement>('input[type="file"]');
    const file = fileInput?.files?.[0];
    const photo = file ? await readPhoto(file) : undefined;
    saveResponsible({ id: generateId(), name, photo }, false);
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

  // ── Income Types ──────────────────────────────────────────────────────────────
  const [editingItId,  setEditingItId]  = useState<string | null>(null);
  const [editItName,   setEditItName]   = useState("");
  const [editItColor,  setEditItColor]  = useState("");

  const startEditIt = (it: IncomeType) => {
    setEditingItId(it.id);
    setEditItName(it.name);
    setEditItColor(it.color);
  };
  const saveEditIt = () => {
    if (!editingItId || !editItName.trim()) return;
    const name = editItName.trim();
    const dup = incomeTypes.find(
      it => it.id !== editingItId && it.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (dup) {
      addToast("error", `Já existe um tipo de entrada chamado "${dup.name}".`);
      return;
    }
    saveIncomeType({ id: editingItId, name, color: editItColor }, true);
    setEditingItId(null);
  };

  const handleAddIncomeType = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd   = new FormData(e.currentTarget);
    const name = (fd.get("name") as string).trim();
    const dup  = incomeTypes.find(it => it.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) {
      addToast("error", `Já existe um tipo de entrada chamado "${dup.name}".`);
      return;
    }
    saveIncomeType({ id: generateId(), name, color: fd.get("color") as string }, false);
    e.currentTarget.reset();
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

      {/* ── Income Types ──────────────────────────────────────────────────────── */}
      <section className="card p-6">
        <h3 className="section-title"><TrendingUp size={16} /> Tipos de Entrada/Receita</h3>
        <div className="space-y-2 mb-5">
          {incomeTypes.map(it => (
            <div key={it.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
              {editingItId === it.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input type="color" value={editItColor} onChange={e => setEditItColor(e.target.value)}
                    className="w-8 h-8 p-0.5 rounded-lg border border-slate-200 cursor-pointer" />
                  <input type="text" value={editItName} onChange={e => setEditItName(e.target.value)}
                    className="input flex-1 py-1.5 text-sm" autoFocus />
                  <button onClick={saveEditIt} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg">
                    <Check size={16} />
                  </button>
                  <button onClick={() => setEditingItId(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: it.color }} />
                    <span className="text-sm font-bold">{it.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEditIt(it)}
                      className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => setDeleteTarget({ table: "income_types", id: it.id, label: it.name })}
                      className="p-1.5 text-slate-400 hover:text-red-600 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {incomeTypes.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-3">Nenhum tipo cadastrado.</p>
          )}
        </div>
        <form onSubmit={handleAddIncomeType} className="flex gap-2">
          <input name="name" placeholder="Novo tipo de entrada…" required
            className="input flex-1 py-2 text-sm" />
          <input name="color" type="color" defaultValue="#10b981"
            className="w-10 h-10 p-1 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer" />
          <button type="submit" className="btn-primary py-2 px-3 flex items-center gap-1">
            <Plus size={14} /> Add
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
