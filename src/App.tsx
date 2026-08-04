import React, { useState, useEffect, lazy, Suspense } from "react";
import { format } from "date-fns";
import {
  BarChart3, ListOrdered, Settings as SettingsIcon,
  ChevronLeft, ChevronRight, Wifi, WifiOff, HardDrive,
  TrendingUp, NotebookPen, Loader2, UploadCloud,
  Wallet, Coins, Eye, EyeOff, Clock, ArrowDown, TrendingDown, CalendarClock, CalendarSync,
} from "lucide-react";
import { DataProvider, useData } from "./context/DataContext";
import { cn, isRecurringCovered, buildSkipSet, ocorrenciasNoMes } from "./lib/utils";
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
  const {
    profile, isOnline, isConnected, realtime, serverReachable, needsAuth, pendingCount, forceSync,
    expenses, recurring, recurringSkips, incomes,
    valoresOcultos, alternarValores, moeda,
  } = useData();
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

  /** Valor em reais do resumo, respeitando o "ocultar valores". */
  const dinheiro = (valor: number, comSinal = false) =>
    `${!valoresOcultos && comSinal && valor >= 0 ? "+" : ""}R$ ${moeda(valor)}`;
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
      className="w-full h-full bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex items-center gap-4 text-left group active:scale-[0.98]"
    >
      <div className={cn("w-16 h-16 shrink-0 rounded-2xl text-white shadow-md flex items-center justify-center transition-transform group-hover:scale-105 relative", colorClass)}>
        <Icon size={30} />
        {/* Numeric badge — amber when urgent, red otherwise */}
        {badge !== undefined && badge > 0 && (
          <span className={cn(
            "absolute -top-2 -right-2 min-w-6 h-6 px-1.5 text-white text-[11px] font-black rounded-full flex items-center justify-center ring-2 ring-white",
            badgeUrgent ? "bg-amber-500" : "bg-red-500",
          )}>
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-lg font-black tracking-tight uppercase leading-tight">{title}</h3>
        <p className="text-[13px] font-semibold text-slate-400 leading-tight mt-0.5">{subtitle}</p>
        {badgeUrgent && urgentCount !== undefined && urgentCount > 0 && (
          <p className="text-xs font-bold text-amber-600 mt-1">
            ⚠ {urgentCount} vence{urgentCount > 1 ? "m" : ""} em até 7 dias
          </p>
        )}
      </div>
      <ChevronRight size={22} className="text-slate-300 group-hover:text-slate-600 transition-colors shrink-0" />
    </button>
  );

  /**
   * Um dos quatro indicadores do cartão "Resumo Financeiro".
   *
   * No celular o ícone fica ACIMA do texto: lado a lado, numa célula de ~150 px,
   * sobrava tão pouca largura que todo valor era cortado ("R$ 36…"). Empilhado,
   * o número usa a célula inteira e coube em corpo maior. A partir de `sm` volta
   * a ficar ao lado do texto, como no modelo de referência.
   */
  const ResumoTile = ({
    icon: Icon, iconClass, label, valor, valorClass, legenda, legendaClass, onClick, className,
  }: {
    icon: React.ElementType; iconClass: string; label: string;
    valor: string; valorClass?: string; legenda: string; legendaClass?: string;
    onClick: () => void; className?: string;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 sm:p-3.5 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors",
        className,
      )}
    >
      <span className={cn(
        "w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-full flex items-center justify-center text-white shadow-md",
        iconClass,
      )}>
        <Icon size={21} />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] sm:text-[11px] font-black uppercase tracking-wide text-slate-500 leading-tight">
          {label}
        </span>
        <span className={cn(
          "block text-[15px] sm:text-base font-black tracking-tight leading-tight mt-0.5 truncate",
          valorClass ?? "text-slate-800",
        )}>
          {valor}
        </span>
        <span className={cn("block text-[10px] font-semibold leading-tight mt-0.5", legendaClass ?? "text-slate-400")}>
          {legenda}
        </span>
      </span>
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
          "bg-gradient-to-br from-emerald-500 via-emerald-600 to-green-700 text-white relative overflow-hidden pb-4",
          isMenu ? "z-0" : "sticky top-0 z-30 shadow-lg shadow-emerald-900/10",
        )}
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.5rem)" }}
      >
        {/* Formas suaves de fundo (no lugar da ilustração) */}
        <div className="absolute -right-16 -top-16 w-56 h-56 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-12 bottom-0 w-44 h-44 bg-white/[0.07] rounded-full blur-2xl pointer-events-none" />

        <div className={cn("mx-auto relative px-4", isMenu ? "max-w-6xl" : "max-w-4xl")}>
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
              {/* Ocultar valores vale para o app inteiro, então o botão fica
                  no cabeçalho de todas as telas — esconder na home e continuar
                  mostrando tudo na lista de despesas não protegia nada. */}
              <button
                onClick={alternarValores}
                aria-label={valoresOcultos ? "Mostrar valores" : "Ocultar valores"}
                title={valoresOcultos ? "Mostrar valores" : "Ocultar valores"}
                className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center active:scale-95 transition-all"
              >
                {valoresOcultos ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
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
      <main className={cn("mx-auto p-4", isMenu ? "max-w-6xl" : "max-w-4xl")}>
        <>
          {isMenu && (
            <div className="space-y-3">
              {/* ── Resumo Financeiro ────────────────────────────────────────
                  Cartão branco que sobe por cima do verde do cabeçalho. Quando
                  há uma faixa de aviso (offline / modo local) ele não sobe, para
                  não cobrir o aviso. */}
              <div className={cn(
                "bg-gradient-to-br from-emerald-600 to-green-700 rounded-[1.75rem] shadow-xl shadow-emerald-900/20 p-3 sm:p-4 relative",
                temBanner ? "mt-1" : "-mt-14",
              )}>
                <div className="flex items-center gap-2.5 px-1.5 pt-1 pb-3.5">
                  <span className="w-10 h-10 rounded-xl bg-lime-400 text-emerald-900 flex items-center justify-center shrink-0">
                    <Wallet size={20} />
                  </span>
                  <h3 className="text-xs font-black uppercase tracking-[0.15em] text-white">
                    Resumo Financeiro
                  </h3>
                </div>

                {/* Grade de duas colunas iguais, não flex: com "Pendente" fixo e
                    "Total Geral" ocupando o resto, o total ficava com 63 px num
                    aparelho de 414 px e era cortado. Metade e metade, os dois
                    valores têm sempre o mesmo espaço — e o mesmo corpo de fonte. */}
                <div className="grid grid-cols-2 items-stretch gap-2 sm:gap-2.5 px-1.5 pb-3.5">
                  {/* Total Geral → lista de despesas do mês */}
                  <button
                    onClick={goToMonthExpenses}
                    className="flex items-center gap-3 min-w-0 text-left active:opacity-80 transition-opacity"
                  >
                    {/* Os ícones desta linha só aparecem a partir de sm: no
                        celular são ~90 px que os valores precisam para não
                        serem cortados — e o pedido aqui era fonte maior. */}
                    <span className="w-12 h-12 rounded-2xl bg-white/15 hidden sm:flex items-center justify-center text-white shrink-0">
                      <Coins size={22} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[10px] font-black uppercase tracking-widest text-white/80">Total Geral</span>
                      <span className="block text-[15px] min-[400px]:text-base sm:text-lg font-black tracking-tight text-white truncate">
                        {dinheiro(totalMonth)}
                      </span>
                    </span>
                  </button>
                  {/* Pendente → vencimentos em aberto */}
                  <button
                    onClick={() => goToFutures("pending")}
                    className={cn(
                      "flex items-center gap-2.5 min-w-0 rounded-2xl border px-2 sm:px-3 py-2.5 active:opacity-80 transition-opacity",
                      pendingMonth > 0 ? "bg-red-500/30 border-red-300/50" : "bg-white/15 border-white/35",
                    )}
                  >
                    <span className="w-9 h-9 rounded-full border-2 border-white/40 hidden sm:flex items-center justify-center text-white shrink-0">
                      <Clock size={17} />
                    </span>
                    <span className="text-left min-w-0">
                      <span className="block text-[9px] font-black uppercase tracking-widest text-white/85">Pendente</span>
                      <span className="block text-[15px] min-[400px]:text-base sm:text-lg font-black tracking-tight text-white truncate">
                        {dinheiro(pendingMonth)}
                      </span>
                    </span>
                  </button>
                </div>

                {/* Painel branco: 2×2 no celular, 4 colunas no desktop. As bordas
                    são por célula porque o número de colunas muda com a largura. */}
                <div className="bg-white rounded-2xl grid grid-cols-2 lg:grid-cols-4 overflow-hidden">
                  <ResumoTile
                    className="border-b border-r border-slate-100 lg:border-b-0"
                    icon={ArrowDown} iconClass="bg-emerald-600"
                    label="Entradas" valor={dinheiro(incomeMonth)} valorClass="text-emerald-600"
                    legenda="Total recebido" onClick={goToIncomes}
                  />
                  {/* Seta de tendência (não a seta reta de "Entradas") e virada
                      conforme o sinal: uma seta para cima sobre um saldo negativo
                      lia exatamente ao contrário do que o número diz. */}
                  <ResumoTile
                    className="border-b border-slate-100 lg:border-b-0 lg:border-r"
                    icon={balanceMonth >= 0 ? TrendingUp : TrendingDown}
                    iconClass={balanceMonth >= 0 ? "bg-lime-500" : "bg-red-500"}
                    label="Saldo" valor={dinheiro(balanceMonth, true)}
                    valorClass={balanceMonth >= 0 ? "text-emerald-600" : "text-red-600"}
                    legenda="Entradas − saídas"
                    onClick={() => handleTabChange("overview")}
                  />
                  <ResumoTile
                    className="border-r border-slate-100"
                    icon={CalendarClock} iconClass={urgentFutureCount > 0 ? "bg-amber-500" : "bg-emerald-600"}
                    label="Vence em breve"
                    valor={contagem(urgentFutureCount > 0 ? urgentFutureCount : (futureCount > 0 ? futureCount : "—"))}
                    valorClass="text-slate-900"
                    legenda={urgentFutureCount > 0 ? "Próximos 7 dias" : "despesas a vencer"}
                    legendaClass={urgentFutureCount > 0 ? "text-amber-600" : undefined}
                    onClick={() => goToFutures("upcoming")}
                  />
                  <ResumoTile
                    icon={CalendarSync} iconClass="bg-emerald-500"
                    label="Recorrente/mês" valor={dinheiro(recurringTotal)} valorClass="text-emerald-600"
                    legenda={`${recurringCount} ativa${recurringCount === 1 ? "" : "s"} por mês`}
                    onClick={() => goToFutures("recurring")}
                  />
                </div>
              </div>

              {/* ── Menu ─────────────────────────────────────────────────────── */}
              <h3 className="text-xs font-black uppercase tracking-[0.15em] text-slate-500 pt-5 pb-1">
                O que você deseja fazer?
              </h3>

              {/* Em telas largas os cartões se distribuem em colunas — empilhados
                  eles deixavam metade do monitor vazia e jogavam Configurações
                  para fora da primeira dobra. */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
