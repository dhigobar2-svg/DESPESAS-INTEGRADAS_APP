import React, { useState, useMemo, useEffect } from "react";
import { format, parseISO, startOfMonth, endOfMonth, subMonths, getYear } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Plus, FileText, Share2, Search, Trash2, Edit2,
  ChevronLeft, ChevronRight, CheckCircle2, Download, StickyNote,
} from "lucide-react";
import { motion } from "motion/react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { useData } from "../context/DataContext";
import { formatCurrency, cn } from "../lib/utils";
import ExpenseModal from "./ExpenseModal";
import ConfirmModal from "./ConfirmModal";
import { Expense } from "../types";

const PAGE_SIZE = 10;

interface Props {
  initialResponsibleFilter?: string;
}

export default function ExpenseList({ initialResponsibleFilter = "" }: Props) {
  const { expenses, categories, responsibles, togglePaid, deleteItem } = useData();

  const [showModal,        setShowModal]        = useState(false);
  const [editingExp,       setEditingExp]        = useState<Expense | null>(null);
  const [confirmId,        setConfirmId]        = useState<string | null>(null);
  const [page,             setPage]             = useState(1);
  const [search,           setSearch]           = useState("");
  const [filterDateFrom,   setFilterDateFrom]   = useState("");
  const [filterDateTo,     setFilterDateTo]     = useState("");
  const [filterCat,        setFilterCat]        = useState("");
  const [filterResp,       setFilterResp]       = useState(initialResponsibleFilter);
  const [filterPaid,       setFilterPaid]       = useState("");

  // Sync external drill-down filter
  useEffect(() => {
    if (initialResponsibleFilter) {
      setFilterResp(initialResponsibleFilter);
      setPage(1);
    }
  }, [initialResponsibleFilter]);

  // ── Filtering ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...expenses].sort((a, b) => b.due_date.localeCompare(a.due_date));

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        (e.description ?? "").toLowerCase().includes(q) ||
        (categories.find(c => c.id === e.category_id)?.name ?? "").toLowerCase().includes(q) ||
        (e.notes ?? "").toLowerCase().includes(q),
      );
    }
    if (filterDateFrom) list = list.filter(e => e.due_date >= filterDateFrom);
    if (filterDateTo)   list = list.filter(e => e.due_date <= filterDateTo);
    if (filterCat)      list = list.filter(e => e.category_id === filterCat);
    if (filterResp)     list = list.filter(e => e.responsible_id === filterResp);
    if (filterPaid !== "") list = list.filter(e => String(e.paid) === filterPaid);

    return list;
  }, [expenses, search, filterDateFrom, filterDateTo, filterCat, filterResp, filterPaid, categories]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filteredTotal = filtered.reduce((s, e) => s + e.value, 0);

  const resetPage = () => setPage(1);

  // ── Quick period shortcuts ─────────────────────────────────────────────────────
  const setQuickPeriod = (preset: "thisMonth" | "lastMonth" | "thisYear") => {
    const now = new Date();
    if (preset === "thisMonth") {
      setFilterDateFrom(format(startOfMonth(now), "yyyy-MM-dd"));
      setFilterDateTo(format(endOfMonth(now), "yyyy-MM-dd"));
    } else if (preset === "lastMonth") {
      const prev = subMonths(now, 1);
      setFilterDateFrom(format(startOfMonth(prev), "yyyy-MM-dd"));
      setFilterDateTo(format(endOfMonth(prev), "yyyy-MM-dd"));
    } else if (preset === "thisYear") {
      setFilterDateFrom(`${getYear(now)}-01-01`);
      setFilterDateTo(`${getYear(now)}-12-31`);
    }
    resetPage();
  };

  // ── Export PDF ────────────────────────────────────────────────────────────────
  const generatePDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("Relatório de Despesas — DESPESAS INTEGRADAS", 14, 15);
    const filterLabel = filterResp
      ? `Responsável: ${responsibles.find(r => r.id === filterResp)?.name ?? ""}`
      : filterDateFrom || filterDateTo
      ? `Período: ${filterDateFrom ? format(parseISO(filterDateFrom), "dd/MM/yyyy") : "início"} até ${filterDateTo ? format(parseISO(filterDateTo), "dd/MM/yyyy") : "hoje"}`
      : "Todas as despesas";
    doc.setFontSize(9);
    doc.text(filterLabel, 14, 22);
    autoTable(doc, {
      head: [["Vencimento", "Descrição", "Categoria", "Valor", "Responsável", "Status", "Notas"]],
      body: filtered.map(e => [
        e.due_date ? format(parseISO(e.due_date), "dd/MM/yyyy") : "—",
        e.description || "—",
        categories.find(c => c.id === e.category_id)?.name ?? "—",
        `R$ ${formatCurrency(e.value)}`,
        responsibles.find(r => r.id === e.responsible_id)?.name ?? "—",
        e.paid ? "Pago" : "Pendente",
        e.notes || "—",
      ]),
      startY: 28,
      foot: [["", "", "TOTAL", `R$ ${formatCurrency(filteredTotal)}`, "", "", ""]],
    });
    doc.save("relatorio-despesas.pdf");
  };

  // ── Export CSV ────────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const header = ["Vencimento", "Descrição", "Categoria", "Valor", "Responsável", "Status", "Notas"];
    const rows = filtered.map(e => [
      e.due_date ? format(parseISO(e.due_date), "dd/MM/yyyy") : "",
      `"${(e.description || "").replace(/"/g, '""')}"`,
      categories.find(c => c.id === e.category_id)?.name ?? "",
      e.value.toFixed(2).replace(".", ","),
      responsibles.find(r => r.id === e.responsible_id)?.name ?? "",
      e.paid ? "Pago" : "Pendente",
      `"${(e.notes || "").replace(/"/g, '""')}"`,
    ]);
    const csv = [header, ...rows].map(r => r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "despesas.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── WhatsApp ──────────────────────────────────────────────────────────────────
  const shareWhatsApp = () => {
    const lines = filtered.map(e =>
      `*${e.due_date ? format(parseISO(e.due_date), "dd/MM/yyyy") : "—"}* ` +
      `- ${e.description || "Sem desc."} ` +
      `(${categories.find(c => c.id === e.category_id)?.name ?? "—"}): ` +
      `R$ ${formatCurrency(e.value)} ` +
      `(${e.paid ? "Pago" : "Pendente"})`,
    ).join("\n");
    const total = `\n\n*Total: R$ ${formatCurrency(filteredTotal)}*`;
    window.open(`https://wa.me/?text=${encodeURIComponent("Relatório de Despesas:\n\n" + lines + total)}`, "_blank");
  };

  // ── Modal helpers ─────────────────────────────────────────────────────────────
  const openEdit = (e: Expense) => {
    setEditingExp(e);
    setShowModal(true);
  };

  const openAdd = () => {
    setEditingExp(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingExp(null);
  };


  return (
    <motion.div
      key="expenses"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Minhas Despesas</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={generatePDF}
            className="flex items-center gap-1.5 bg-white border border-slate-200 px-3 py-2 rounded-xl text-xs font-bold hover:bg-slate-50 transition-colors">
            <FileText size={14} /> PDF
          </button>
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 bg-white border border-slate-200 px-3 py-2 rounded-xl text-xs font-bold hover:bg-slate-50 transition-colors">
            <Download size={14} /> CSV
          </button>
          <button onClick={shareWhatsApp}
            className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-3 py-2 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-colors">
            <Share2 size={14} /> WhatsApp
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" placeholder="Buscar por descrição, categoria ou notas…"
            value={search} onChange={e => { setSearch(e.target.value); resetPage(); }}
            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
          />
        </div>

        {/* Quick period shortcuts */}
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "Este mês",   preset: "thisMonth"  as const },
            { label: "Mês ant.",   preset: "lastMonth"  as const },
            { label: "Este ano",   preset: "thisYear"   as const },
          ].map(({ label, preset }) => (
            <button
              key={preset}
              onClick={() => setQuickPeriod(preset)}
              className="px-3 py-1.5 bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-emerald-100 hover:text-emerald-700 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="flex items-center gap-1.5 col-span-2 md:col-span-2">
            <div className="relative flex-1">
              <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">De</label>
              <input
                type="date" value={filterDateFrom}
                onChange={e => { setFilterDateFrom(e.target.value); resetPage(); }}
                className="input py-2 text-xs w-full"
              />
            </div>
            <span className="text-slate-300 font-bold shrink-0">→</span>
            <div className="relative flex-1">
              <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Até</label>
              <input
                type="date" value={filterDateTo}
                onChange={e => { setFilterDateTo(e.target.value); resetPage(); }}
                className="input py-2 text-xs w-full"
              />
            </div>
          </div>

          <select value={filterCat} onChange={e => { setFilterCat(e.target.value); resetPage(); }}
            className="input py-2 text-xs">
            <option value="">Todas as categorias</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <select value={filterResp} onChange={e => { setFilterResp(e.target.value); resetPage(); }}
            className="input py-2 text-xs">
            <option value="">Todos os responsáveis</option>
            {responsibles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>

          <select value={filterPaid} onChange={e => { setFilterPaid(e.target.value); resetPage(); }}
            className="input py-2 text-xs">
            <option value="">Todos os status</option>
            <option value="1">Pago</option>
            <option value="0">Pendente</option>
          </select>
        </div>

        {(search || filterDateFrom || filterDateTo || filterCat || filterResp || filterPaid !== "") && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">
              {filtered.length} resultado{filtered.length !== 1 ? "s" : ""} · Total: R$ {formatCurrency(filteredTotal)}
            </span>
            <button
              onClick={() => { setSearch(""); setFilterDateFrom(""); setFilterDateTo(""); setFilterCat(""); setFilterResp(""); setFilterPaid(""); resetPage(); }}
              className="text-xs text-emerald-600 font-bold hover:underline"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {["Vencimento", "Despesa", "Valor", "Status", ""].map(h => (
                  <th key={h} className="px-5 py-3.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 last:text-right">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.map(expense => {
                const cat  = categories.find(c => c.id === expense.category_id);
                const resp = responsibles.find(r => r.id === expense.responsible_id);
                return (
                  <tr key={expense.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="text-sm font-bold">
                        {expense.due_date ? format(parseISO(expense.due_date), "dd/MM/yyyy") : "—"}
                      </p>
                      <p className="text-[10px] text-slate-400 uppercase font-medium">{resp?.name ?? "—"}</p>
                    </td>
                    <td className="px-5 py-4 max-w-[200px]">
                      <p className="text-sm font-bold text-slate-900 truncate">{expense.description || "—"}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat?.color ?? "#cbd5e1" }} />
                        <p className="text-[10px] font-medium text-slate-500 uppercase truncate">{cat?.name ?? "Outros"}</p>
                      </div>
                      {expense.notes && (
                        <p className="text-[10px] text-slate-400 italic mt-0.5 flex items-center gap-1 truncate">
                          <StickyNote size={9} className="shrink-0" />
                          {expense.notes}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm font-black">R$ {formatCurrency(expense.value)}</p>
                    </td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => togglePaid(expense.id)}
                        className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all",
                          expense.paid ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
                        )}
                      >
                        {expense.paid ? "Pago" : "Pendente"}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => togglePaid(expense.id)}
                          title={expense.paid ? "Marcar como pendente" : "Marcar como pago"}
                          className={cn(
                            "p-2 transition-colors bg-slate-50 rounded-lg",
                            expense.paid
                              ? "text-emerald-600 hover:text-amber-500"
                              : "text-slate-400 hover:text-emerald-600",
                          )}
                        >
                          <CheckCircle2 size={14} />
                        </button>
                        <button onClick={() => openEdit(expense)}
                          title="Editar"
                          className="p-2 text-slate-400 hover:text-blue-600 transition-colors bg-slate-50 rounded-lg">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => setConfirmId(expense.id)}
                          title="Excluir"
                          className="p-2 text-slate-400 hover:text-red-600 transition-colors bg-slate-50 rounded-lg">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <p className="text-slate-400 text-sm font-medium">Nenhuma despesa encontrada.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">
              Página {page} de {totalPages} · {filtered.length} registros
            </span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={openAdd}
        className="fixed bottom-6 right-6 bg-emerald-600 text-white p-4 rounded-full shadow-xl shadow-emerald-500/30 hover:bg-emerald-700 active:scale-95 transition-all z-40"
      >
        <Plus size={24} />
      </button>

      <ExpenseModal
        open={showModal}
        editing={editingExp}

        onClose={closeModal}
      />

      <ConfirmModal
        open={!!confirmId}
        message="Esta ação não pode ser desfeita."
        onConfirm={() => { if (confirmId) deleteItem("expenses", confirmId); setConfirmId(null); }}
        onCancel={() => setConfirmId(null)}
      />
    </motion.div>
  );
}
