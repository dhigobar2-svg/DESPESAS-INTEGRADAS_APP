import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, Trash2, NotebookPen, Search } from "lucide-react";

interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: string; // ISO string
}

const STORAGE_KEY = "despesas_notes";

function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Note[]) : [];
  } catch {
    return [];
  }
}

function saveNotes(notes: Note[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Always shows full date; adds time for notes updated today
function formatDate(iso: string): string {
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const isToday = d.toDateString() === new Date().toDateString();
  return isToday ? `Hoje às ${timeStr} · ${dateStr}` : dateStr;
}

export default function Notes() {
  const [notes,     setNotes]     = useState<Note[]>(() => loadNotes());
  const [editing,   setEditing]   = useState<Note | null>(null);
  const [isNew,     setIsNew]     = useState(false);
  const [search,    setSearch]    = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  // Persist on every change
  useEffect(() => { saveNotes(notes); }, [notes]);

  // Auto-grow textarea whenever content changes
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [editing?.content]);

  const filtered = notes
    .filter(n =>
      n.title.toLowerCase().includes(search.toLowerCase()) ||
      n.content.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const openNew = () => {
    setEditing({ id: generateId(), title: "", content: "", updatedAt: new Date().toISOString() });
    setIsNew(true);
  };

  const openEdit = (note: Note) => {
    setEditing({ ...note });
    setIsNew(false);
  };

  const closeEditor = () => {
    setEditing(null);
    setIsNew(false);
  };

  const saveEditing = useCallback(() => {
    if (!editing) return;
    const trimmedTitle   = editing.title.trim();
    const trimmedContent = editing.content.trim();
    if (!trimmedTitle && !trimmedContent) {
      closeEditor();
      return;
    }
    const updated: Note = {
      ...editing,
      title:     trimmedTitle || "Sem título",
      content:   trimmedContent,
      updatedAt: new Date().toISOString(),
    };
    setNotes(prev =>
      isNew
        ? [updated, ...prev]
        : prev.map(n => n.id === updated.id ? updated : n),
    );
    closeEditor();
  }, [editing, isNew]);

  const deleteNote = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
    setConfirmId(null);
    if (editing?.id === id) closeEditor();
  };

  return (
    <motion.div
      key="notes"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="pb-24"
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Bloco de Notas</h2>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          {notes.length} nota{notes.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Search */}
      {notes.length > 0 && (
        <div className="relative mb-5">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar notas…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 transition-all"
          />
        </div>
      )}

      {/* Notes list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-3xl bg-amber-100 flex items-center justify-center mb-4">
            <NotebookPen size={36} className="text-amber-500" />
          </div>
          <p className="text-slate-600 font-bold text-base mb-1">
            {notes.length === 0 ? "Nenhuma nota ainda" : "Nenhuma nota encontrada"}
          </p>
          <p className="text-slate-400 text-sm">
            {notes.length === 0
              ? "Toque no + para criar sua primeira nota"
              : "Tente outro termo de busca"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {filtered.map(note => (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
              >
                <div
                  onClick={() => openEdit(note)}
                  className="relative bg-amber-50 border border-amber-200/70 rounded-2xl px-5 py-4 cursor-pointer hover:shadow-md hover:border-amber-300 transition-all active:scale-[0.99]"
                >
                  {/* Lined paper effect (decorative only) */}
                  <div
                    className="absolute inset-x-0 top-0 bottom-0 rounded-2xl pointer-events-none overflow-hidden opacity-20"
                    aria-hidden
                  >
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className="border-b border-amber-400"
                        style={{ height: 28, marginTop: i === 0 ? 20 : 0 }}
                      />
                    ))}
                  </div>

                  <div className="relative">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-slate-800 truncate leading-snug">
                          {note.title}
                        </p>
                        {note.content && (
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                            {note.content}
                          </p>
                        )}
                      </div>
                      {/* Delete button — always visible, works on touch */}
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmId(note.id); }}
                        className="shrink-0 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Excluir"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mt-2">
                      {formatDate(note.updatedAt)}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={openNew}
        className="fixed bottom-6 right-6 bg-amber-500 text-white p-4 rounded-full shadow-xl shadow-amber-500/30 hover:bg-amber-600 active:scale-95 transition-all z-40"
      >
        <Plus size={24} />
      </button>

      {/* ── Editor overlay ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {editing && (
          <motion.div
            key="editor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) saveEditing(); }}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: "spring", damping: 26, stiffness: 300 }}
              className="w-full max-w-lg bg-amber-50 rounded-3xl overflow-hidden shadow-2xl flex flex-col"
              style={{ maxHeight: "90vh" }}
            >
              {/* Editor toolbar */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-amber-200/60 shrink-0">
                <button
                  onClick={closeEditor}
                  className="text-sm font-bold text-amber-600 hover:text-amber-800 transition-colors"
                >
                  Cancelar
                </button>
                <span className="text-xs font-black uppercase tracking-widest text-slate-400">
                  {isNew ? "Nova nota" : "Editar nota"}
                </span>
                <div className="flex items-center gap-3">
                  {/* Delete button visible when editing an existing note */}
                  {!isNew && (
                    <button
                      onClick={() => setConfirmId(editing.id)}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Excluir nota"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                  <button
                    onClick={saveEditing}
                    className="text-sm font-black text-amber-600 hover:text-amber-800 transition-colors"
                  >
                    Salvar
                  </button>
                </div>
              </div>

              {/* Editor body — scrollable, amber background without conflicting line overlay */}
              <div className="overflow-y-auto flex-1 bg-amber-50 px-5 pt-4 pb-8">
                <input
                  autoFocus
                  type="text"
                  placeholder="Título"
                  value={editing.title}
                  onChange={e => setEditing(prev => prev ? { ...prev, title: e.target.value } : prev)}
                  className="w-full bg-transparent text-xl font-black text-slate-800 placeholder:text-slate-300 focus:outline-none leading-tight mb-4 border-b border-amber-200 pb-3"
                />
                <textarea
                  ref={taRef}
                  placeholder="Comece a escrever…"
                  value={editing.content}
                  onChange={e => {
                    setEditing(prev => prev ? { ...prev, content: e.target.value } : prev);
                  }}
                  className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none resize-none leading-relaxed"
                  style={{ minHeight: 200, height: "auto" }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete confirmation ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {confirmId && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-60 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-red-100 flex items-center justify-center shrink-0">
                  <Trash2 size={18} className="text-red-500" />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-800">Excluir nota?</p>
                  <p className="text-xs text-slate-500 mt-0.5">Esta ação não pode ser desfeita.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmId(null)}
                  className="flex-1 py-2.5 rounded-2xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => deleteNote(confirmId)}
                  className="flex-1 py-2.5 rounded-2xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors"
                >
                  Excluir
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
