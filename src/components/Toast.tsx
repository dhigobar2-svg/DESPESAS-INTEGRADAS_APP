import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "../lib/utils";
import { useData } from "../context/DataContext";

const ICONS = {
  success: <CheckCircle2 size={18} className="text-emerald-500" />,
  error:   <XCircle     size={18} className="text-red-500" />,
  info:    <Info        size={18} className="text-blue-500" />,
};

const BORDERS = {
  success: "border-l-emerald-500",
  error:   "border-l-red-500",
  info:    "border-l-blue-500",
};

export default function Toast() {
  const { toasts, dismissToast } = useData();

  return (
    <div className="fixed bottom-6 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 60, scale: 0.95 }}
            animate={{ opacity: 1, x: 0,  scale: 1 }}
            exit={{   opacity: 0, x: 60,  scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "bg-white border border-slate-200 border-l-4 rounded-xl shadow-lg px-4 py-3 flex items-start gap-3",
              BORDERS[t.type],
            )}
          >
            <span className="mt-0.5 shrink-0">{ICONS[t.type]}</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-800">{t.message}</p>
              {t.action && (
                <button
                  onClick={() => { t.action!.run(); dismissToast(t.id); }}
                  className="mt-1.5 text-xs font-black uppercase tracking-widest text-emerald-700 hover:text-emerald-800 active:scale-95 transition-all"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-slate-400 hover:text-slate-700 transition-colors shrink-0 mt-0.5"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
