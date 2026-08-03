import React, { useEffect, useState } from "react";
import { cn, formatCurrency, parseCurrency } from "../lib/utils";

interface Props {
  value:       number | undefined;
  onChange?:   (v: number | undefined) => void;
  /** Quando informado, um campo oculto com o número normalizado entra no FormData. */
  name?:       string;
  placeholder?: string;
  className?:  string;
  required?:   boolean;
  autoFocus?:  boolean;
}

/**
 * Campo de dinheiro em pt-BR.
 *
 * É `type="text"` de propósito: o `type="number"` do navegador descarta a
 * vírgula, e quem digitava "1234,56" acabava gravando R$ 123.456,00. Aqui o
 * texto é interpretado por `parseCurrency` (vírgula decimal, ponto de milhar) e
 * reformatado ao sair do campo. `inputMode="decimal"` mantém o teclado numérico
 * do celular.
 */
export default function CurrencyInput({
  value, onChange, name, placeholder = "0,00", className, required, autoFocus,
}: Props) {
  const [text, setText]        = useState(value === undefined ? "" : formatCurrency(value));
  const [focused, setFocused]  = useState(false);

  // Reflete mudanças vindas de fora (abrir o modal para editar, por exemplo),
  // sem atrapalhar quem está digitando.
  useEffect(() => {
    if (focused) return;
    setText(value === undefined || Number.isNaN(value) ? "" : formatCurrency(value));
  }, [value, focused]);

  const parsed = parseCurrency(text);

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        placeholder={placeholder}
        value={text}
        required={required}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onChange={e => {
          setText(e.target.value);
          onChange?.(parseCurrency(e.target.value));
        }}
        onBlur={() => {
          setFocused(false);
          const v = parseCurrency(text);
          setText(v === undefined ? "" : formatCurrency(v));
          onChange?.(v);
        }}
        className={cn("input", className)}
      />
      {/* O formulário de despesas lê os campos via FormData; este espelho leva o
          número já normalizado (ponto decimal) para o submit. */}
      {name && <input type="hidden" name={name} value={parsed === undefined ? "" : String(parsed)} />}
    </>
  );
}
