import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, 
  ListOrdered, 
  Settings as SettingsIcon, 
  Plus, 
  Save, 
  Trash2, 
  Edit2, 
  CheckCircle2, 
  XCircle, 
  Wifi, 
  WifiOff, 
  FileText, 
  Share2,
  ChevronRight,
  User,
  Camera,
  Calendar,
  DollarSign,
  Tag,
  Users,
  ChevronLeft,
  BarChart3,
  PieChart as PieChartIcon
} from 'lucide-react';
import { 
  PieChart, Pie, Cell, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList 
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { io } from 'socket.io-client';
import { cn } from './lib/utils';

// --- Types ---
interface Category {
  id: string;
  name: string;
  color: string;
}

interface Responsible {
  id: string;
  name: string;
  photo?: string;
}

interface Expense {
  id: string;
  category_id: string;
  description: string;
  date: string;
  due_date: string;
  value: number;
  responsible_id: string;
  paid: number; // 0 or 1
}

interface UserProfile {
  name: string;
  photo?: string;
}

// --- Constants ---
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

export default function App() {
  // --- State ---
  const [activeTab, setActiveTab] = useState<'menu' | 'overview' | 'expenses' | 'settings'>('menu');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({ name: 'Usuário' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  // --- Sync & Socket ---
  useEffect(() => {
    const socket = io();
    
    const fetchData = async () => {
      try {
        const res = await fetch('/api/data');
        const data = await res.json();
        setExpenses(data.expenses);
        setCategories(data.categories);
        setResponsibles(data.responsibles);
        
        // Save to local storage for offline
        localStorage.setItem('expenses', JSON.stringify(data.expenses));
        localStorage.setItem('categories', JSON.stringify(data.categories));
        localStorage.setItem('responsibles', JSON.stringify(data.responsibles));
      } catch (err) {
        console.error("Fetch failed, using local data", err);
        const localExpenses = localStorage.getItem('expenses');
        const localCategories = localStorage.getItem('categories');
        const localResponsibles = localStorage.getItem('responsibles');
        if (localExpenses) setExpenses(JSON.parse(localExpenses));
        if (localCategories) setCategories(JSON.parse(localCategories));
        if (localResponsibles) setResponsibles(JSON.parse(localResponsibles));
      }
    };

    fetchData();

    socket.on('data_updated', fetchData);
    
    const handleOnline = () => {
      setIsOnline(true);
      syncWithServer();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      socket.disconnect();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const syncWithServer = async () => {
    if (!navigator.onLine) return;
    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenses: JSON.parse(localStorage.getItem('expenses') || '[]'),
          categories: JSON.parse(localStorage.getItem('categories') || '[]'),
          responsibles: JSON.parse(localStorage.getItem('responsibles') || '[]'),
        })
      });
    } catch (err) {
      console.error("Sync failed", err);
    }
  };

  // --- Calculations ---
  const currentMonth = new Date();
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  const stats = useMemo(() => {
    const monthExpenses = expenses.filter(e => {
      const d = parseISO(e.due_date);
      return isWithinInterval(d, { start: monthStart, end: monthEnd });
    });

    const totalMonth = monthExpenses.reduce((acc, curr) => acc + curr.value, 0);
    const pendingMonth = monthExpenses.filter(e => !e.paid).reduce((acc, curr) => acc + curr.value, 0);
    const totalGeneral = expenses.reduce((acc, curr) => acc + curr.value, 0);

    // Chart Data: Categories
    const catData = categories.map(cat => ({
      name: cat.name,
      value: monthExpenses.filter(e => e.category_id === cat.id).reduce((acc, curr) => acc + curr.value, 0),
      color: cat.color
    })).filter(d => d.value > 0);

    // Chart Data: Top Expenses (Grouped by Category)
    const topExpenses = categories.map(cat => ({
      name: cat.name,
      value: monthExpenses.filter(e => e.category_id === cat.id).reduce((acc, curr) => acc + curr.value, 0)
    })).filter(d => d.value > 0).sort((a, b) => b.value - a.value).slice(0, 3);

    // Chart Data: Responsibles
    const respData = responsibles.map(r => ({
      name: r.name,
      value: monthExpenses.filter(e => e.responsible_id === r.id).reduce((acc, curr) => acc + curr.value, 0)
    })).filter(d => d.value > 0);

    return { totalMonth, pendingMonth, totalGeneral, catData, topExpenses, respData };
  }, [expenses, categories, responsibles, monthStart, monthEnd]);

  // --- Handlers ---
  const handleSaveExpense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newExpense: Expense = {
      id: editingExpense?.id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      category_id: formData.get('category') as string,
      description: formData.get('description') as string,
      date: formData.get('date') as string,
      due_date: formData.get('due_date') as string,
      value: parseFloat(formData.get('value') as string),
      responsible_id: formData.get('responsible') as string,
      paid: formData.get('paid') === 'on' ? 1 : 0,
    };

    const updatedExpenses = editingExpense 
      ? expenses.map(ex => ex.id === editingExpense.id ? newExpense : ex)
      : [...expenses, newExpense];

    setExpenses(updatedExpenses);
    localStorage.setItem('expenses', JSON.stringify(updatedExpenses));
    setShowAddModal(false);
    setEditingExpense(null);
    syncWithServer();
  };

  const handleDelete = async (table: 'expenses' | 'categories' | 'responsibles', id: string) => {
    const previousExpenses = [...expenses];
    const previousCategories = [...categories];
    const previousResponsibles = [...responsibles];

    if (table === 'expenses') {
      const updated = expenses.filter(e => e.id !== id);
      setExpenses(updated);
      localStorage.setItem('expenses', JSON.stringify(updated));
    } else if (table === 'categories') {
      const updated = categories.filter(c => c.id !== id);
      setCategories(updated);
      localStorage.setItem('categories', JSON.stringify(updated));
    } else if (table === 'responsibles') {
      const updated = responsibles.filter(r => r.id !== id);
      setResponsibles(updated);
      localStorage.setItem('responsibles', JSON.stringify(updated));
    }

    if (navigator.onLine) {
      try {
        const res = await fetch(`/api/${table}/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || "Erro ao excluir item.");
          // Rollback
          setExpenses(previousExpenses);
          setCategories(previousCategories);
          setResponsibles(previousResponsibles);
          return;
        }
      } catch (err) {
        console.error("Delete failed", err);
      }
    }
    syncWithServer();
  };

  const togglePaid = (id: string) => {
    const updated = expenses.map(e => e.id === id ? { ...e, paid: e.paid ? 0 : 1 } : e);
    setExpenses(updated);
    localStorage.setItem('expenses', JSON.stringify(updated));
    syncWithServer();
  };

  const generatePDF = () => {
    const doc = new jsPDF();
    doc.text("Relatório de Despesas - DESPESAS INTEGRADAS", 14, 15);
    
    const tableData = expenses.map(e => [
      format(parseISO(e.due_date), 'dd/MM/yyyy'),
      e.description || '-',
      categories.find(c => c.id === e.category_id)?.name || '-',
      `R$ ${e.value.toFixed(2)}`,
      responsibles.find(r => r.id === e.responsible_id)?.name || '-',
      e.paid ? 'Pago' : 'Pendente'
    ]);

    autoTable(doc, {
      head: [['Vencimento', 'Descrição', 'Categoria', 'Valor', 'Responsável', 'Status']],
      body: tableData,
      startY: 25,
    });

    doc.save('relatorio-despesas.pdf');
  };

  const shareWhatsApp = () => {
    const text = expenses.map(e => 
      `*${format(parseISO(e.due_date), 'dd/MM/yyyy')}* - ${e.description || 'Sem desc.'} (${categories.find(c => c.id === e.category_id)?.name}): R$ ${e.value.toFixed(2)} (${e.paid ? 'Pago' : 'Pendente'})`
    ).join('\n');
    window.open(`https://wa.me/?text=${encodeURIComponent("Relatório de Despesas:\n\n" + text)}`, '_blank');
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        callback(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Components ---
  const MenuButton = ({ icon: Icon, title, subtitle, onClick, colorClass }: { icon: any, title: string, subtitle: string, onClick: () => void, colorClass: string }) => (
    <button 
      onClick={onClick}
      className="w-full bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex items-center gap-6 text-left group active:scale-[0.98]"
    >
      <div className={cn("p-4 rounded-2xl text-white shadow-lg transition-transform group-hover:scale-110", colorClass)}>
        <Icon size={32} />
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-black tracking-tighter uppercase">{title}</h3>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{subtitle}</p>
      </div>
      <ChevronRight className="text-slate-300 group-hover:text-slate-600 transition-colors" />
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="w-10">
            {activeTab !== 'menu' && (
              <button onClick={() => setActiveTab('menu')} className="p-2 -ml-2 text-slate-400 hover:text-slate-900 transition-colors">
                <ChevronLeft size={24} />
              </button>
            )}
          </div>
          <h1 className="text-xl font-black tracking-tighter text-center uppercase">
            Despesas Integradas
          </h1>
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-3 h-3 rounded-full shadow-sm",
              isOnline ? "bg-emerald-500 animate-pulse" : "bg-red-500"
            )} />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <AnimatePresence mode="wait">
          {activeTab === 'menu' && (
            <motion.div 
              key="menu"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-4 pt-4"
            >
              <div className="bg-emerald-600 p-8 rounded-[2.5rem] text-white mb-8 shadow-2xl shadow-emerald-200 relative overflow-hidden">
                <div className="relative z-10">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80 mb-2">Bem-vindo de volta,</p>
                  <h2 className="text-3xl font-black tracking-tighter mb-4">{userProfile.name}</h2>
                  <div className="flex gap-4">
                    <div className="bg-white/20 backdrop-blur-md p-3 rounded-2xl">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Total Mês</p>
                      <p className="text-xl font-black">R$ {stats.totalMonth.toFixed(2)}</p>
                    </div>
                    <div className="bg-white/20 backdrop-blur-md p-3 rounded-2xl">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Pendentes</p>
                      <p className="text-xl font-black">R$ {stats.pendingMonth.toFixed(2)}</p>
                    </div>
                  </div>
                </div>
                <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
              </div>

              <MenuButton 
                icon={BarChart3} 
                title="Visão Geral" 
                subtitle="Gráficos e Estatísticas" 
                onClick={() => setActiveTab('overview')}
                colorClass="bg-blue-500"
              />
              <MenuButton 
                icon={ListOrdered} 
                title="Minhas Despesas" 
                subtitle="Lista e Histórico" 
                onClick={() => setActiveTab('expenses')}
                colorClass="bg-emerald-500"
              />
              <MenuButton 
                icon={SettingsIcon} 
                title="Configurações" 
                subtitle="Ajustes e Perfil" 
                onClick={() => setActiveTab('settings')}
                colorClass="bg-slate-700"
              />
            </motion.div>
          )}

          {activeTab === 'overview' && (
            <motion.div 
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Visão Geral</h2>
                <button 
                  onClick={() => { setEditingExpense(null); setShowAddModal(true); }}
                  className="bg-emerald-600 text-white p-2 rounded-full shadow-lg hover:bg-emerald-700 transition-transform active:scale-95"
                >
                  <Plus size={24} />
                </button>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total do Mês</p>
                  <p className="text-3xl font-black tracking-tighter">R$ {stats.totalMonth.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pendente</p>
                  <p className="text-3xl font-black tracking-tighter text-red-500">R$ {stats.pendingMonth.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Geral</p>
                  <p className="text-3xl font-black tracking-tighter text-emerald-600">R$ {stats.totalGeneral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-widest mb-6 text-slate-500">Categorias do Mês</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={stats.catData}
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                          label={({ value }) => `R$ ${value.toFixed(2)}`}
                        >
                          {stats.catData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => `R$ ${v.toFixed(2)}`} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-widest mb-6 text-slate-500">MAIORES DESPESAS (MÊS)</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.topExpenses} margin={{ top: 20, bottom: 20 }}>
                        <XAxis dataKey="name" fontSize={10} hide />
                        <YAxis fontSize={10} hide />
                        <Tooltip formatter={(v: number) => `R$ ${v.toFixed(2)}`} />
                        <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]}>
                          <LabelList dataKey="value" position="top" fontSize={10} formatter={(v: number) => `R$ ${v.toFixed(2)}`} />
                          <LabelList dataKey="name" position="bottom" fontSize={10} offset={10} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm md:col-span-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest mb-6 text-slate-500">DESPESAS POR RESPONSÁVEL (MÊS)</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.respData} layout="vertical" margin={{ right: 60 }}>
                        <XAxis type="number" fontSize={10} hide />
                        <YAxis dataKey="name" type="category" fontSize={10} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v: number) => `R$ ${v.toFixed(2)}`} />
                        <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                          <LabelList dataKey="value" position="right" fontSize={10} formatter={(v: number) => `R$ ${v.toFixed(2)}`} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'expenses' && (
            <motion.div 
              key="expenses"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Minhas Despesas</h2>
                <div className="flex gap-2">
                  <button onClick={generatePDF} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-50 transition-colors">
                    <FileText size={16} /> PDF
                  </button>
                  <button onClick={shareWhatsApp} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-emerald-50 text-emerald-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-colors">
                    <Share2 size={16} /> WhatsApp
                  </button>
                </div>
              </div>

              {/* Expense List */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Vencimento</th>
                        <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Despesa</th>
                        <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Valor</th>
                        <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</th>
                        <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {expenses.map(expense => {
                        const cat = categories.find(c => c.id === expense.category_id);
                        const resp = responsibles.find(r => r.id === expense.responsible_id);
                        return (
                          <tr key={expense.id} className="hover:bg-slate-50 transition-colors group">
                            <td className="px-6 py-4">
                              <p className="text-sm font-bold">{format(parseISO(expense.due_date), 'dd/MM/yyyy')}</p>
                              <p className="text-[10px] text-slate-400 uppercase font-medium">{resp?.name || 'Sem resp.'}</p>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col">
                                <p className="text-sm font-bold text-slate-900">{expense.description || '-'}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat?.color || '#cbd5e1' }} />
                                  <p className="text-[10px] font-medium text-slate-500 uppercase">{cat?.name || 'Outros'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm font-black">R$ {expense.value.toFixed(2)}</p>
                            </td>
                            <td className="px-6 py-4">
                              <button 
                                onClick={() => togglePaid(expense.id)}
                                className={cn(
                                  "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all",
                                  expense.paid 
                                    ? "bg-emerald-100 text-emerald-700" 
                                    : "bg-red-100 text-red-700"
                                )}
                              >
                                {expense.paid ? 'Pago' : 'Pendente'}
                              </button>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-2 transition-opacity">
                                <button 
                                  onClick={() => { setEditingExpense(expense); setShowAddModal(true); }}
                                  className="p-2 text-slate-400 hover:text-blue-600 transition-colors bg-slate-50 rounded-lg"
                                >
                                  <Edit2 size={16} />
                                </button>
                                <button 
                                  onClick={() => handleDelete('expenses', expense.id)}
                                  className="p-2 text-slate-400 hover:text-red-600 transition-colors bg-slate-50 rounded-lg"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {expenses.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center">
                            <p className="text-slate-400 text-sm font-medium">Nenhuma despesa lançada.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Configurações Gerais</h2>

              {/* Profile */}
              <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                  <User size={16} /> Meu Perfil
                </h3>
                <div className="flex items-center gap-6">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border-2 border-slate-200">
                      {userProfile.photo ? (
                        <img src={userProfile.photo} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <User size={32} className="text-slate-300" />
                      )}
                    </div>
                    <label className="absolute bottom-0 right-0 bg-emerald-600 text-white p-1.5 rounded-full shadow-lg cursor-pointer hover:bg-emerald-700 transition-colors">
                      <Camera size={12} />
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => handlePhotoUpload(e, (photo) => setUserProfile({ ...userProfile, photo }))} 
                      />
                    </label>
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Nome de Exibição</label>
                    <input 
                      type="text" 
                      value={userProfile.name}
                      onChange={(e) => setUserProfile({ ...userProfile, name: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
              </section>

              {/* Categories */}
              <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                  <Tag size={16} /> Categorias
                </h3>
                <div className="space-y-3 mb-6">
                  {categories.map(cat => (
                    <div key={cat.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: cat.color }} />
                        <span className="text-sm font-bold">{cat.name}</span>
                      </div>
                      <button 
                        onClick={() => handleDelete('categories', cat.id)}
                        className="text-slate-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    const newCat = {
                      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                      name: formData.get('name') as string,
                      color: formData.get('color') as string,
                    };
                    setCategories([...categories, newCat]);
                    localStorage.setItem('categories', JSON.stringify([...categories, newCat]));
                    e.currentTarget.reset();
                    syncWithServer();
                  }}
                  className="flex gap-2"
                >
                  <input name="name" placeholder="Nova categoria..." required className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium" />
                  <input name="color" type="color" defaultValue="#10b981" className="w-12 h-10 p-1 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer" />
                  <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-widest">Add</button>
                </form>
              </section>

              {/* Responsibles */}
              <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                  <Users size={16} /> Responsáveis
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                  {responsibles.map(resp => (
                    <div key={resp.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden">
                          {resp.photo ? <img src={resp.photo} className="w-full h-full object-cover" /> : <User size={16} className="text-slate-400" />}
                        </div>
                        <span className="text-sm font-bold">{resp.name}</span>
                      </div>
                      <button 
                        onClick={() => handleDelete('responsibles', resp.id)}
                        className="text-slate-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    const photoInput = e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement;
                    
                    const createResp = (photo?: string) => {
                      const newResp = {
                        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                        name: formData.get('name') as string,
                        photo: photo
                      };
                      const updated = [...responsibles, newResp];
                      setResponsibles(updated);
                      localStorage.setItem('responsibles', JSON.stringify(updated));
                      syncWithServer();
                    };

                    if (photoInput.files?.[0]) {
                      const reader = new FileReader();
                      reader.onloadend = () => createResp(reader.result as string);
                      reader.readAsDataURL(photoInput.files[0]);
                    } else {
                      createResp();
                    }
                    e.currentTarget.reset();
                  }}
                  className="space-y-3"
                >
                  <div className="flex gap-2">
                    <input name="name" placeholder="Novo responsável..." required className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium" />
                    <label className="bg-slate-100 text-slate-600 p-2 rounded-xl cursor-pointer hover:bg-slate-200 transition-colors">
                      <Camera size={20} />
                      <input type="file" accept="image/*" className="hidden" />
                    </label>
                  </div>
                  <button type="submit" className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-emerald-500/20">Cadastrar Responsável</button>
                </form>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <h2 className="text-xl font-black tracking-tighter uppercase mb-6">
                  {editingExpense ? 'Editar Despesa' : 'Nova Despesa'}
                </h2>
                <form onSubmit={handleSaveExpense} className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Descrição</label>
                    <input 
                      type="text" 
                      name="description" 
                      defaultValue={editingExpense?.description} 
                      placeholder="Ex: Aluguel, Supermercado..." 
                      required 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" 
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Categoria</label>
                    <select name="category" defaultValue={editingExpense?.category_id} required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold">
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Lançamento</label>
                      <input type="date" name="date" defaultValue={editingExpense?.date || format(new Date(), 'yyyy-MM-dd')} required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Vencimento</label>
                      <input type="date" name="due_date" defaultValue={editingExpense?.due_date || format(new Date(), 'yyyy-MM-dd')} required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Valor (R$)</label>
                    <input type="number" step="0.01" name="value" defaultValue={editingExpense?.value} placeholder="0,00" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-black" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Responsável</label>
                    <select name="responsible" defaultValue={editingExpense?.responsible_id} required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold">
                      {responsibles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      {responsibles.length === 0 && <option value="">Nenhum cadastrado</option>}
                    </select>
                  </div>
                  <div className="flex items-center gap-3 py-2">
                    <input type="checkbox" name="paid" id="paid" defaultChecked={editingExpense?.paid === 1} className="w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                    <label htmlFor="paid" className="text-sm font-bold text-slate-700">Já está pago?</label>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button 
                      type="button" 
                      onClick={() => setShowAddModal(false)}
                      className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit" 
                      className="flex-1 bg-emerald-600 text-white py-4 rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 transition-colors"
                    >
                      Salvar
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
