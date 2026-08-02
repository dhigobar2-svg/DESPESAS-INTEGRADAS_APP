import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "../lib/utils";

export interface MultiOption {
  id:     string;
  name:   string;
  color?: string;
}

interface Props {
  /** Texto quando nada está selecionado — também é o rótulo do filtro. */
  allLabel: string;
  options:  MultiOption[];
  /** Ids marcados. Vazio = sem filtro (todos). */
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Palavra usada no resumo: "3 categorias", "2 responsáveis"… */
  countLabel?: string;
  emptyMessage?: string;
}

/**
 * Filtro de múltipla escolha. Substitui os <select> de opção única: dá para
 * marcar várias categorias/responsáveis/status ao mesmo tempo, e nenhuma marcada
 * significa "todos" (sem filtro).
 */
export default function MultiSelect({
  allLabel, options, selected, onChange, countLabel, emptyMessage,
}: Props) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Fecha ao tocar fora ou apertar Esc — no celular não há "clicar fora" óbvio,
  // então o toque em qualquer outro ponto da tela precisa fechar o painel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (ev: PointerEvent) => {
      if (!boxRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  const summary =
    selected.length === 0 ? allLabel
    : selected.length === 1 ? (options.find(o => o.id === selected[0])?.name ?? allLabel)
    : `${selected.length} ${countLabel ?? "selecionados"}`;

  return (
    <div className="relative min-w-0" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected.length > 1
          ? options.filter(o => selected.includes(o.id)).map(o => o.name).join(", ")
          : summary}
        className={cn(
          "input py-2 text-xs flex items-center justify-between gap-1 text-left",
          selected.length > 0 && "border-emerald-400 bg-emerald-50/60 text-emerald-700",
        )}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={14} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute z-30 mt-1 w-full min-w-[11rem] max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl py-1"
        >
          {/* "Todos" limpa a seleção — equivalente a não filtrar. */}
          <button
            type="button"
            onClick={() => { onChange([]); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-50 active:bg-slate-100 transition-colors"
          >
            <X size={13} className="shrink-0" />
            <span className="truncate">{allLabel}</span>
          </button>

          {options.length === 0 && (
            <p className="px-3 py-2.5 text-xs text-slate-400">{emptyMessage ?? "Nada cadastrado"}</p>
          )}

          {options.map(opt => {
            const checked = selected.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggle(opt.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-left transition-colors",
                  checked ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:bg-slate-50 active:bg-slate-100",
                )}
              >
                <span className={cn(
                  "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                  checked ? "bg-emerald-500 border-emerald-500" : "border-slate-300",
                )}>
                  {checked && <Check size={11} className="text-white" strokeWidth={3.5} />}
                </span>
                {opt.color && (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                )}
                <span className="truncate">{opt.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
