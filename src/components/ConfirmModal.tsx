import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle } from "lucide-react";

interface Props {
  open:      boolean;
  title?:    string;
  message:   string;
  onConfirm: () => void;
  onCancel:  () => void;
}

export default function ConfirmModal({ open, title = "Confirmar exclusão", message, onConfirm, onCancel }: Props) {
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
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={28} className="text-red-600" />
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
                className="flex-1 bg-red-600 text-white py-3 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-red-700 transition-colors"
              >
                Excluir
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
