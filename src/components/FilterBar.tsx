import React from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Category, Responsible } from "../types";

interface Props {
  categories:   Category[];
  responsibles: Responsible[];

  category:      string;
  onCategory:    (v: string) => void;
  responsible:   string;
  onResponsible: (v: string) => void;

  // Optional controls — only rendered when the matching handler is provided.
  search?:     string;  onSearch?:     (v: string) => void;
  dateFrom?:   string;  onDateFrom?:   (v: string) => void;
  dateTo?:     string;  onDateTo?:     (v: string) => void;
  status?:     string;  onStatus?:     (v: string) => void;  // "" | "1" | "0"

  resultSummary?: React.ReactNode;
}

/** Reusable, standardised filter controls shared across screens. */
export default function FilterBar({
  categories, responsibles,
  category, onCategory, responsible, onResponsible,
  search, onSearch, dateFrom, onDateFrom, dateTo, onDateTo, status, onStatus,
  resultSummary,
}: Props) {
  const hasFilter = !!(search || dateFrom || dateTo || category || responsible || (status && status !== ""));

  const clearAll = () => {
    onSearch?.(""); onDateFrom?.(""); onDateTo?.("");
    onCategory(""); onResponsible(""); onStatus?.("");
  };

  return (
    <div className="card p-4 space-y-3">
      {onSearch && (
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" placeholder="Buscar por descrição, categoria ou notas…"
            value={search ?? ""} onChange={e => onSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
          />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {onDateFrom && (
          <div className="flex gap-2 col-span-2">
            <div className="flex-1 flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500/30 focus-within:border-emerald-400 transition-colors">
              <span className="pl-3 pr-1.5 text-sm font-medium text-slate-400 shrink-0 select-none">De</span>
              <input type="date" value={dateFrom ?? ""} onChange={e => onDateFrom(e.target.value)}
                className="flex-1 py-2.5 pr-3 bg-transparent text-sm text-slate-700 outline-none min-w-0" />
            </div>
            <div className="flex-1 flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500/30 focus-within:border-emerald-400 transition-colors">
              <span className="pl-3 pr-1.5 text-sm font-medium text-slate-400 shrink-0 select-none">Até</span>
              <input type="date" value={dateTo ?? ""} onChange={e => onDateTo?.(e.target.value)}
                className="flex-1 py-2.5 pr-3 bg-transparent text-sm text-slate-700 outline-none min-w-0" />
            </div>
          </div>
        )}

        <select value={category} onChange={e => onCategory(e.target.value)} className="input py-2 text-xs">
          <option value="">Todas categorias</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select value={responsible} onChange={e => onResponsible(e.target.value)} className="input py-2 text-xs">
          <option value="">Todos responsáveis</option>
          {responsibles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>

        {onStatus && (
          <select value={status ?? ""} onChange={e => onStatus(e.target.value)} className="input py-2 text-xs">
            <option value="">Todos status</option>
            <option value="1">Pago</option>
            <option value="0">Pendente</option>
          </select>
        )}
      </div>

      {(resultSummary || hasFilter) && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500 font-medium">{resultSummary}</span>
          {hasFilter && (
            <button onClick={clearAll} className="text-xs text-emerald-600 font-bold hover:underline shrink-0">
              Limpar filtros
            </button>
          )}
        </div>
      )}
    </div>
  );
}
