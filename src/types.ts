/**
 * Carimbo da última edição (ISO UTC), gravado pelo cliente ao enfileirar a
 * alteração. O servidor recusa uma escrita mais antiga que a versão guardada,
 * então o aparelho que ficou offline não sobrescreve a edição mais nova feita
 * no outro. Ausente = dado antigo, tratado como "sempre aceita".
 */
export interface Versionado {
  updated_at?: string;
}

export interface Category extends Versionado {
  id: string;
  name: string;
  color: string;
}

export interface Responsible extends Versionado {
  id: string;
  name: string;
  photo?: string;
}

export interface Expense extends Versionado {
  id: string;
  category_id: string;
  description: string;
  date: string;       // yyyy-MM-dd
  due_date: string;   // yyyy-MM-dd
  value: number;
  responsible_id: string;
  paid: number;       // 0 | 1
  notes?: string;
  created_by?: string;
  recurring_id?: string;  // links an auto-generated expense back to its recurring template
  card_id?: string;       // compra no cartão de crédito (entra na fatura dele)
  // Compra parcelada: todas as parcelas compartilham o mesmo installment_id.
  installment_id?: string;
  installment_no?: number;     // 1, 2, 3…
  installment_total?: number;  // total de parcelas
  created_at?: string;    // set by the server (DATETIME DEFAULT CURRENT_TIMESTAMP)
}

/**
 * Cartão de crédito. `closing_day` é o dia em que a fatura fecha e `due_day` o
 * dia em que ela vence — é o par que decide em qual fatura uma compra cai.
 */
export interface Card extends Versionado {
  id: string;
  name: string;
  color: string;
  closing_day: number;   // 1–31
  due_day: number;       // 1–31
  limit_value?: number;  // limite do cartão (opcional)
  active: number;        // 0 | 1
}

export interface UserProfile extends Versionado {
  id?: string;
  name: string;
  photo?: string;
}

export interface Budget extends Versionado {
  id: string;
  category_id: string;
  month: string;        // yyyy-MM
  limit_value: number;
}

/** Como a recorrência se repete. Ausente = mensal (dados antigos). */
export type Frequencia = "weekly" | "monthly" | "yearly";

export interface RecurringExpense extends Versionado {
  id: string;
  category_id: string;
  description: string;
  value: number;
  responsible_id: string;
  day_of_month: number;
  active: number; // 0 | 1
  frequency?: Frequencia;
  interval_n?: number;    // a cada N semanas/meses/anos (padrão 1)
  start_date?: string;    // yyyy-MM-dd — âncora do ciclo
}

export interface IncomeType extends Versionado {
  id: string;
  name: string;
  color: string;
}

export interface Income extends Versionado {
  id: string;
  description: string;
  value: number;
  date: string;         // yyyy-MM-dd
  type: string;         // 'salario' | 'renda_extra' | 'outro'
  responsible_id?: string;
  notes?: string;
  recurring: number;    // 0 | 1  (legacy flag; superseded by recurring_income_id)
  recurring_income_id?: string;  // links an auto-generated income to its template
  created_by?: string;  // quem lançou (nome do responsável escolhido no aparelho)
}

export interface RecurringIncome extends Versionado {
  id: string;
  description: string;
  value: number;
  type: string;
  responsible_id?: string;
  day_of_month: number;
  active: number; // 0 | 1
  frequency?: Frequencia;
  interval_n?: number;
  start_date?: string;
}

// A deleted occurrence of a recurrence — keeps it from being regenerated.
export interface RecurringSkip {
  id: string;            // `${recurring_id}_${month}`
  recurring_id: string;
  month: string;         // yyyy-MM
}

export interface Note {
  id: string;
  title: string;
  content: string;
  updated_at: string;   // ISO string
}

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  /** Ação opcional no próprio aviso — usada pelo "Desfazer" da exclusão. */
  action?: { label: string; run: () => void };
}
