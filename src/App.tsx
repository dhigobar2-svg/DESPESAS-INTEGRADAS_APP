import React, { useState, useEffect, lazy, Suspense } from "react";
import { format } from "date-fns";
import {
  BarChart3, ListOrdered, Settings as SettingsIcon,
  ChevronLeft, ChevronRight, Wifi, WifiOff, HardDrive,
  TrendingUp, NotebookPen, Loader2, UploadCloud,
  Wallet, Eye, EyeOff, Clock, ArrowDown, TrendingDown, CalendarClock, CalendarSync,
} from "lucide-react";
import { DataProvider, useData } from "./context/DataContext";
import { cn, formatCurrency, isRecurringCovered, buildSkipSet, ocorrenciasNoMes } from "./lib/utils";
import Toast from "./components/Toast";
import LockScreen from "./components/LockScreen";
import QuemUsa from "./components/QuemUsa";

// Lazy-loaded tabs keep the heavy chart/PDF libraries out of the initial bundle.
const Dashboard         = lazy(() => import("./components/Dashboard"));
const ExpenseList       = lazy(() => import("./components/ExpenseList"));
const Incomes           = lazy(() => import("./components/Incomes"));
const Notes             = lazy(() => import("./components/Notes"));
const Settings          = lazy(() => import("./components/Settings"));

type Tab = "menu" | "overview" | "expenses" | "incomes" | "notes" | "settings";
type FutureFilter = "upcoming" | "pending" | "recurring" | undefined;

// Título exibido no cabeçalho verde de cada tela interna. As telas não repetem
// mais esse título no corpo — ele vive só aqui.
const TITULO_TELA: Record<Tab, string> = {
  menu:     "Despesas Integradas",
  overview: "Visão Geral",
  expenses: "Minhas Despesas",
  incomes:  "Entradas / Receitas",
  notes:    "Bloco de Notas",
  settings: "Configurações",
};

const saudacaoDoDia = (h: number) =>
  h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";

// State stored in browser history entries so the system/browser back button
// navigates inside the app instead of leaving it.
interface NavState {
  despTab?: Tab;
  view?: "list" | "futures";
  filter?: FutureFilter;
  dateRange?: { from: string; to: string } | null;
  noteEditor?: boolean; // entry owned by the Notes full-screen editor
}

// ─── Inner shell (has access to DataContext) ──────────────────────────────────

function Shell() {
  const { profile, isOnline, isConnected, realtime, serverReachable, needsAuth, pendingCount, forceSync, expenses, recurring, recurringSkips, incomes } = useData();
  const skipSet = buildSkipSet(recurringSkips);
  const [activeTab, setActiveTab] = useState<Tab>("menu");
  // Drives the "Minhas Despesas" sub-tab (full list vs. próximos vencimentos).
  const [expensesView,   setExpensesView]   = useState<"list" | "futures">("list");
  const [futuresFilter,  setFuturesFilter]  = useState<FutureFilter>(undefined);
  const [expensesDateRange, setExpensesDateRange] = useState<{ from: string; to: string } | null>(null);
  const [expensesNonce,  setExpensesNonce]  = useState(0);

  const isMenu = activeTab === "menu";
  // Faixa de aviso (offline / modo local) entre o cabeçalho e o conteúdo.
  const temBanner = !isOnline || !serverReachable;

  // Privacidade: esconde os valores do resumo (útil para abrir o app em
  // público). É uma preferência deste aparelho — nunca vai para o servidor.
  const [valoresOcultos, setValoresOcultos] = useState(() => {
    try { return localStorage.getItem("ocultar_valores") === "1"; }
    catch { return false; }
  });
  const alternarValores = () => setValoresOcultos(v => {
    const novo = !v;
    try { localStorage.setItem("ocultar_valores", novo ? "1" : "0"); } catch { /* ignore */ }
    return novo;
  });
  /** Valor em reais do resumo, respeitando o "ocultar valores". */
  const dinheiro = (valor: number, comSinal = false) =>
    valoresOcultos
      ? "R$ ••••"
      : `${comSinal && valor >= 0 ? "+" : ""}R$ ${formatCurrency(valor)}`;
  /** Contagem do resumo, respeitando o "ocultar valores". */
  const contagem = (valor: number | string) => valoresOcultos ? "•••" : String(valor);

  const now = new Date();
  const mm  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const totalMonth = expenses
    .filter(e => e.due_date?.startsWith(mm))
    .reduce((s, e) => s + e.value, 0);

  // Pending = current month unpaid + any overdue from previous months
  const pendingMonth = expenses
    .filter(e => !e.paid && (e.due_date?.startsWith(mm) || (e.due_date && e.due_date < mm)))
    .reduce((s, e) => s + e.value, 0);

  // Local (não UTC): em UTC-3 o dia "virava" às 21h e os contadores de
  // vencidas / vence em breve ficavam errados até a meia-noite.
  const today   = format(now, "yyyy-MM-dd");
  const in7days = format(new Date(now.getTime() + 7 * 86_400_000), "yyyy-MM-dd");

  // Virtual future dates from active recurring expenses (not yet auto-created
  // as real expenses). A paid occurrence counts as covered — otherwise the
  // badges keep counting months the user already settled.
  const virtualRecurringFutureDates: string[] = [];
  for (const rec of recurring.filter(r => r.active)) {
    for (let mo = 0; mo <= 2; mo++) {
      const base = new Date(now.getFullYear(), now.getMonth() + mo, 1);
      // Semanal rende várias datas no mesmo mês.
      for (const dateStr of ocorrenciasNoMes(rec, base.getFullYear(), base.getMonth() + 1)) {
        if (dateStr <= today) continue;
        if (!isRecurringCovered(expenses, rec, dateStr, { skips: skipSet })) {
          virtualRecurringFutureDates.push(dateStr);
        }
      }
    }
  }

  const futureCount = expenses.filter(e => {
    try { return !e.paid && e.due_date > today; }
    catch { return false; }
  }).length + virtualRecurringFutureDates.length;

  // Expenses due within the next 7 days (urgent alert)
  const urgentFutureCount = expenses.filter(e => {
    try { return !e.paid && e.due_date > today && e.due_date <= in7days; }
    catch { return false; }
  }).length + virtualRecurringFutureDates.filter(d => d <= in7days).length;


  const recurringTotal = recurring
    .filter(r => r.active)
    .reduce((s, r) => s + r.value, 0);

  const recurringCount = recurring.filter(r => r.active).length;

  // Income for current month
  const incomeMonth = incomes
    .filter(i => i.date?.startsWith(mm))
    .reduce((s, i) => s + i.value, 0);

  const balanceMonth = incomeMonth - totalMonth;

  // Apply a navigation state to the UI (used by both in-app navigation and the
  // browser/system back button via popstate).
  const applyNav = (st: NavState | null) => {
    setActiveTab(st?.despTab ?? "menu");
    setExpensesView(st?.view ?? "list");
    setFuturesFilter(st?.filter);
    setExpensesDateRange(st?.dateRange ?? null);
    setExpensesNonce(n => n + 1);
    window.scrollTo(0, 0);
  };

  // Browser-history integration: every screen gets its own history entry, so
  // the system/browser back button navigates inside the app (menu ← tab ←
  // editor) instead of leaving the page.
  // Atalhos do ícone instalado (manifest.shortcuts): /?tela=expenses&novo=1
  // abre a tela pedida — e o modal de nova despesa — já na abertura. O
  // parâmetro é consumido na hora para não reabrir o modal ao voltar.
  const [abrirNovaDespesa, setAbrirNovaDespesa] = useState(false);
  // Pergunta "quem usa este aparelho" — uma vez só, guardada neste aparelho.
  const [perguntarQuemUsa, setPerguntarQuemUsa] = useState(() => {
    try { return !localStorage.getItem("device_user_asked") && !localStorage.getItem("device_user"); }
    catch { return false; }
  });
  const TABS_ATALHO: Tab[] = ["overview", "expenses", "incomes", "notes", "settings"];

  useEffect(() => {
    let atalho: Tab | null = null;
    try {
      const params = new URLSearchParams(location.search);
      const tela   = params.get("tela") as Tab | null;
      if (tela && TABS_ATALHO.includes(tela)) {
        atalho = tela;
        setAbrirNovaDespesa(params.get("novo") === "1");
        applyNav({ despTab: tela });
        history.replaceState({ despTab: tela } as NavState, "", location.pathname);
      }
    } catch { /* ignore */ }
    if (!atalho) {
      try { history.replaceState({ despTab: "menu" } as NavState, ""); } catch { /* ignore */ }
    }
    const onPop = (ev: PopStateEvent) => {
      const st = ev.state as NavState | null;
      if (st?.noteEditor) return; // that entry belongs to the notes editor
      applyNav(st);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = (st: NavState) => {
    try { history.pushState(st, ""); } catch { /* ignore */ }
    applyNav(st);
  };

  const handleTabChange = (tab: Tab) => {
    if (tab === "menu") {
      // Going back to the menu consumes the history entry pushed when the tab
      // was opened, keeping the in-app arrow and the system back in sync.
      const cur = history.state as NavState | null;
      if (cur?.despTab && cur.despTab !== "menu") { history.back(); return; }
      applyNav({ despTab: "menu" });
      return;
    }
    navigate({ despTab: tab });
  };

  // Open "Minhas Despesas" already on the upcoming/overdue sub-tab with a filter.
  const goToFutures = (filter?: FutureFilter) => navigate({ despTab: "expenses", view: "futures", filter });

  const goToIncomes = () => navigate({ despTab: "incomes" });

  // Open the full expense list filtered to the current month (Total Geral tile).
  const goToMonthExpenses = () => {
    const from = `${mm}-01`;
    const to   = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd");
    navigate({ despTab: "expenses", view: "list", dateRange: { from, to } });
  };

  const MenuButton = ({
    icon: Icon, title, subtitle, onClick, colorClass, badge, badgeUrgent, urgentCount,
  }: {
    icon: React.ElementType; title: string; subtitle: string;
    onClick: () => void; colorClass: string;
    badge?: number; badgeUrgent?: boolean; urgentCount?: number;
  }) => (
    <button
      onClick={onClick}
      className="w-full bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex items-center gap-4 text-left group active:scale-[0.98]"
    >
      <div className={cn("w-14 h-14 shrink-0 rounded-2xl text-white shadow-md flex items-center justify-center transition-transform group-hover:scale-105 relative", colorClass)}>
        <Icon size={26} />
        {/* Numeric badge — amber when urgent, red otherwise */}
        {badge !== undefined && badge > 0 && (
          <span className={cn(
            "absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 text-white text-[10px] font-black rounded-full flex items-center justify-center ring-2 ring-white",
            badgeUrgent ? "bg-amber-500" : "bg-red-500",
          )}>
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-black tracking-tight uppercase">{title}</h3>
        <p className="text-xs font-semibold text-slate-400">{subtitle}</p>
        {badgeUrgent && urgentCount !== undefined && urgentCount > 0 && (
          <p className="text-[11px] font-bold text-amber-600 mt-0.5">
            ⚠ {urgentCount} vence{urgentCount > 1 ? "m" : ""} em até 7 dias
          </p>
        )}
      </div>
      <ChevronRight size={20} className="text-slate-300 group-hover:text-slate-600 transition-colors shrink-0" />
    </button>
  );

  /** Um dos quatro indicadores do cartão "Resumo Financeiro". */
  const ResumoTile = ({
    icon: Icon, iconClass, label, valor, valorClass, legenda, legendaClass, onClick,
  }: {
    icon: React.ElementType; iconClass: string; label: string;
    valor: string; valorClass?: string; legenda: string; legendaClass?: string;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className="flex flex-col items-center text-center gap-1 px-0.5 py-1 rounded-2xl hover:bg-slate-50 active:scale-95 transition-all"
    >
      <span className={cn("w-11 h-11 rounded-full flex items-center justify-center text-white shadow-md mb-0.5", iconClass)}>
        <Icon size={20} />
      </span>
      {/* As alturas mínimas mantêm valores e legendas alinhados entre as quatro
          colunas mesmo quando um rótulo ("Vence em breve") ocupa duas linhas. */}
      <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 leading-tight min-h-[1.5rem] flex items-center break-words">
        {label}
      </span>
      {/* whitespace-nowrap: sem isso "R$ 36.370,38" quebrava no meio do número.
          O corpo menor em telas estreitas evita que as quatro colunas se toquem. */}
      <span className={cn("text-[9px] min-[380px]:text-[10px] font-black leading-tight tracking-tight whitespace-nowrap", valorClass ?? "text-slate-800")}>
        {valor}
      </span>
      <span className={cn("text-[9px] font-semibold leading-tight", legendaClass ?? "text-slate-400")}>{legenda}</span>
    </button>
  );

  // Servidor exige senha e este aparelho ainda não entrou: nada do app é
  // montado até a senha ser aceita.
  if (needsAuth) return <><LockScreen /><Toast /></>;

  // Logo depois da senha, uma única vez: quem usa este aparelho. Perguntar aqui
  // (em vez de esperar o usuário achar a opção em Configurações) é o que faz o
  // "lançado por" realmente ser preenchido. Responder é opcional.
  if (perguntarQuemUsa) {
    return <><QuemUsa onPronto={() => {
      try { localStorage.setItem("device_user_asked", "1"); } catch { /* ignore */ }
      setPerguntarQuemUsa(false);
    }} /><Toast /></>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header verde — mesma identidade na home e nas telas internas.
          O topo respeita a área segura do aparelho (barra de status/notch) e
          ainda desce um pouco mais: encostado no topo, o botão de voltar caía
          na faixa de gestos do sistema e ficava impossível de tocar no celular.
          Na home ele não é sticky (é alto e o cartão de resumo sobe por cima);
          nas telas internas continua fixo para o voltar ficar sempre à mão. */}
      <header
        className={cn(
          "bg-gradient-to-br from-emerald-500 via-emerald-600 to-green-700 text-white relative overflow-hidden px-4 pb-4",
          isMenu ? "z-0" : "sticky top-0 z-30 shadow-lg shadow-emerald-900/10",
        )}
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.5rem)" }}
      >
        {/* Formas suaves de fundo (no lugar da ilustração) */}
        <div className="absolute -right-16 -top-16 w-56 h-56 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-12 bottom-0 w-44 h-44 bg-white/[0.07] rounded-full blur-2xl pointer-events-none" />

        <div className="max-w-4xl mx-auto relative">
          <div className="flex items-center justify-between gap-2 min-h-11">
            {isMenu ? (
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/70">
                Despesas Integradas
              </span>
            ) : (
              <div className="flex items-center gap-1 min-w-0">
                <button
                  onClick={() => handleTabChange("menu")}
                  aria-label="Voltar"
                  className="p-2.5 -ml-2.5 text-white/80 hover:text-white active:scale-95 transition-all"
                >
                  <ChevronLeft size={24} />
                </button>
                <h1 className="text-lg font-black tracking-tight truncate">
                  {TITULO_TELA[activeTab]}
                </h1>
              </div>
            )}

            {/* Status de conexão + fila de envio + ocultar valores */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Alterações ainda não confirmadas pelo servidor (fila de envio) */}
              {pendingCount > 0 && (
                <button
                  onClick={forceSync}
                  className="flex items-center gap-1 bg-white/20 border border-white/25 rounded-full px-2 py-1 hover:bg-white/30 active:scale-95 transition-all"
                  title={`${pendingCount} alteraç${pendingCount > 1 ? "ões" : "ão"} aguardando envio — toque para sincronizar agora`}
                >
                  <UploadCloud size={12} className="text-amber-200" />
                  <span className="text-[10px] font-black text-amber-100">{pendingCount}</span>
                </button>
              )}
              {!isOnline ? (
                <div className="flex items-center gap-1.5 bg-white/15 rounded-full px-2 py-1.5" title="Offline">
                  <WifiOff size={14} className="text-red-200" />
                  <div className="w-2 h-2 rounded-full bg-red-300" />
                </div>
              ) : !serverReachable ? (
                <div className="flex items-center gap-1.5 bg-white/15 rounded-full px-2 py-1.5" title="Modo local — sem servidor">
                  <HardDrive size={14} className="text-white/70" />
                  <div className="w-2 h-2 rounded-full bg-white/50" />
                </div>
              ) : (
                // Sem Socket.IO (backend serverless) "conectado" é o estado normal:
                // os dados vão para o banco do mesmo jeito, só sem push em tempo real.
                <div className="flex items-center gap-1.5 bg-white/15 rounded-full px-2 py-1.5" title={isConnected || !realtime ? "Conectado ao servidor" : "Reconectando…"}>
                  <Wifi size={14} className={cn(isConnected || !realtime ? "text-white" : "text-amber-200")} />
                  <div className={cn(
                    "w-2 h-2 rounded-full animate-pulse",
                    isConnected || !realtime ? "bg-white" : "bg-amber-300",
                  )} />
                </div>
              )}
              {isMenu && (
                <button
                  onClick={alternarValores}
                  aria-label={valoresOcultos ? "Mostrar valores" : "Ocultar valores"}
                  title={valoresOcultos ? "Mostrar valores" : "Ocultar valores"}
                  className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center active:scale-95 transition-all"
                >
                  {valoresOcultos ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              )}
            </div>
          </div>

          {/* Saudação (só na home) */}
          {isMenu && (
            <div className="mt-5 pb-10">
              <p className="text-sm font-semibold text-white/80">{saudacaoDoDia(now.getHours())},</p>
              {/* text-2xl no celular: em 3xl um nome longo empurrava o 👋
                  sozinho para a linha de baixo. */}
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight mt-0.5">
                {profile.name} <span className="align-middle">👋</span>
              </h2>
              <p className="text-sm font-medium text-white/75 mt-2">
                Aqui está o resumo das suas finanças.
              </p>
            </div>
          )}
        </div>
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center relative z-10">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-widest">
            Modo offline — alterações serão sincronizadas ao reconectar
          </p>
        </div>
      )}

      {/* Local-only banner — online but no backend reachable (e.g. static host) */}
      {isOnline && !serverReachable && (
        <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-center relative z-10">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
            Modo local — sem servidor; os dados ficam apenas neste dispositivo
          </p>
        </div>
      )}

      {/* Content */}
      <main className="max-w-4xl mx-auto p-4">
        <>
          {isMenu && (
            <div className="space-y-3">
              {/* ── Resumo Financeiro ────────────────────────────────────────
                  Cartão branco que sobe por cima do verde do cabeçalho. Quando
                  há uma faixa de aviso (offline / modo local) ele não sobe, para
                  não cobrir o aviso. */}
              <div className={cn(
                "bg-white rounded-3xl border border-slate-100 shadow-xl shadow-emerald-900/10 p-5 relative",
                temBanner ? "mt-1" : "-mt-12",
              )}>
                <div className="flex items-center gap-2.5 mb-4">
                  <span className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                    <Wallet size={18} />
                  </span>
                  <h3 className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-700">
                    Resumo Financeiro
                  </h3>
                </div>

                <div className="flex items-center gap-3">
                  {/* Total Geral → lista de despesas do mês */}
                  <button onClick={goToMonthExpenses} className="flex-1 min-w-0 text-left active:scale-95 transition-transform">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Geral</p>
                    <p className="text-xl min-[380px]:text-[22px] font-black tracking-tight text-slate-900 truncate mt-0.5">
                      {dinheiro(totalMonth)}
                    </p>
                  </button>
                  {/* Pendente → vencimentos em aberto. Compacto de propósito:
                      com um cartão maior o "Total Geral" ao lado era cortado. */}
                  <button
                    onClick={() => goToFutures("pending")}
                    className={cn(
                      "flex items-center gap-2 rounded-2xl border px-2.5 py-2 shrink-0 active:scale-95 transition-all",
                      pendingMonth > 0 ? "bg-red-50 border-red-100" : "bg-emerald-50/70 border-emerald-100",
                    )}
                  >
                    {/* O ícone some nas telas mais estreitas: são 36 px que o
                        "Total Geral" ao lado precisa para não ser cortado. */}
                    <span className={cn(
                      "w-7 h-7 rounded-full hidden min-[380px]:flex items-center justify-center text-white shrink-0",
                      pendingMonth > 0 ? "bg-red-500" : "bg-emerald-500",
                    )}>
                      <Clock size={15} />
                    </span>
                    <span className="text-left">
                      <span className="block text-[9px] font-black uppercase tracking-widest text-slate-500">Pendente</span>
                      <span className={cn(
                        "block text-[13px] font-black tracking-tight whitespace-nowrap",
                        pendingMonth > 0 ? "text-red-600" : "text-slate-800",
                      )}>
                        {dinheiro(pendingMonth)}
                      </span>
                    </span>
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-1 border-t border-slate-100 mt-4 pt-4">
                  <ResumoTile
                    icon={ArrowDown} iconClass="bg-emerald-500"
                    label="Entradas" valor={dinheiro(incomeMonth)} valorClass="text-emerald-600"
                    legenda="Total recebido" onClick={goToIncomes}
                  />
                  {/* Seta de tendência (não a seta reta de "Entradas") e virada
                      conforme o sinal: uma seta para cima sobre um saldo negativo
                      lia exatamente ao contrário do que o número diz. */}
                  <ResumoTile
                    icon={balanceMonth >= 0 ? TrendingUp : TrendingDown}
                    iconClass={balanceMonth >= 0 ? "bg-emerald-500" : "bg-red-500"}
                    label="Saldo" valor={dinheiro(balanceMonth, true)}
                    valorClass={balanceMonth >= 0 ? "text-emerald-600" : "text-red-600"}
                    legenda="Entradas − saídas"
                    onClick={() => handleTabChange("overview")}
                  />
                  <ResumoTile
                    icon={CalendarClock} iconClass={urgentFutureCount > 0 ? "bg-amber-500" : "bg-emerald-500"}
                    label="Vence em breve"
                    valor={contagem(urgentFutureCount > 0 ? urgentFutureCount : (futureCount > 0 ? futureCount : "—"))}
                    legenda={urgentFutureCount > 0 ? "Próximos 7 dias" : "despesas"}
                    legendaClass={urgentFutureCount > 0 ? "text-amber-600" : undefined}
                    onClick={() => goToFutures("upcoming")}
                  />
                  <ResumoTile
                    icon={CalendarSync} iconClass="bg-emerald-600"
                    // "Recorrente/mês" não cabia numa coluna de tela estreita e
                    // invadia a coluna vizinha; o "/mês" foi para a legenda.
                    label="Recorrente" valor={dinheiro(recurringTotal)} valorClass="text-emerald-600"
                    legenda={`${recurringCount} ativa${recurringCount === 1 ? "" : "s"}/mês`}
                    onClick={() => goToFutures("recurring")}
                  />
                </div>
              </div>

              {/* ── Menu ─────────────────────────────────────────────────────── */}
              <h3 className="text-xs font-black uppercase tracking-[0.15em] text-slate-500 pt-5 pb-1">
                O que você deseja fazer?
              </h3>

              <MenuButton icon={BarChart3}     title="Visão Geral"       subtitle="Gráficos e estatísticas"
                onClick={() => handleTabChange("overview")}  colorClass="bg-blue-500" />
              <MenuButton icon={ListOrdered}   title="Minhas Despesas"   subtitle="Lançamentos e vencimentos"
                onClick={() => handleTabChange("expenses")}  colorClass="bg-emerald-500"
                badge={urgentFutureCount > 0 ? urgentFutureCount : futureCount}
                badgeUrgent={urgentFutureCount > 0}
                urgentCount={urgentFutureCount}
              />
              <MenuButton icon={TrendingUp}    title="Entradas / Receitas" subtitle="Salário e rendas"
                onClick={() => handleTabChange("incomes")}   colorClass="bg-teal-500" />
              <MenuButton icon={NotebookPen}   title="Bloco de Notas"    subtitle="Anotações e lembretes"
                onClick={() => handleTabChange("notes")}     colorClass="bg-amber-500" />
              <MenuButton icon={SettingsIcon}  title="Configurações"     subtitle="Ajustes e perfil"
                onClick={() => handleTabChange("settings")}  colorClass="bg-slate-700" />
            </div>
          )}

          <Suspense fallback={
            <div className="flex items-center justify-center py-24">
              <Loader2 className="animate-spin text-emerald-500" size={32} />
            </div>
          }>
            {activeTab === "overview"  && <Dashboard />}
            {activeTab === "expenses"  && (
              <ExpenseList
                key={`exp-${expensesNonce}`}
                initialView={expensesView}
                openNewOnMount={abrirNovaDespesa}
                initialFutureFilter={futuresFilter}
                initialDateFrom={expensesDateRange?.from}
                initialDateTo={expensesDateRange?.to}
              />
            )}
            {activeTab === "incomes"   && <Incomes />}
            {activeTab === "notes"     && <Notes />}
            {activeTab === "settings"  && <Settings />}
          </Suspense>
        </>
      </main>

      <Toast />
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}
