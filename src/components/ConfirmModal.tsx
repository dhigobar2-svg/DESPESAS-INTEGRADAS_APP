import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle } from "lucide-react";

interface Props {
  open:          boolean;
  title?:        string;
  message:       string;
  confirmLabel?: string;
  // "danger" (padrão) para exclusões; "primary" para ações construtivas
  // como restaurar um backup.
  tone?:         "danger" | "primary";
  onConfirm:     () => void;
  onCancel:      () => void;
}

export default function ConfirmModal({
  open, title = "Confirmar exclusão", message,
  confirmLabel = "Excluir", tone = "danger",
  onConfirm, onCancel,
}: Props) {
  const danger = tone === "danger";
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1,   y: 0  }}
            exit={{   opacity: 0, scale: 0.9,  y: 20 }}
            className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8 text-center"
          >
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${danger ? "bg-red-100" : "bg-emerald-100"}`}>
              <AlertTriangle size={28} className={danger ? "text-red-600" : "text-emerald-600"} />
            </div>
            <h2 className="text-lg font-black tracking-tight mb-2">{title}</h2>
            <p className="text-sm text-slate-500 mb-8">{message}</p>
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={onConfirm}
                className={`flex-1 text-white py-3 rounded-2xl font-bold text-xs uppercase tracking-widest transition-colors ${
                  danger ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
