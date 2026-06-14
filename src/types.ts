export interface Category {
  id: string;
  name: string;
  color: string;
}

export interface Responsible {
  id: string;
  name: string;
  photo?: string;
}

export interface Expense {
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
}

export interface UserProfile {
  id?: string;
  name: string;
  photo?: string;
}

export interface Budget {
  id: string;
  category_id: string;
  month: string;        // yyyy-MM
  limit_value: number;
}

export interface RecurringExpense {
  id: string;
  category_id: string;
  description: string;
  value: number;
  responsible_id: string;
  day_of_month: number;
  active: number; // 0 | 1
}

export interface IncomeType {
  id: string;
  name: string;
  color: string;
}

export interface Income {
  id: string;
  description: string;
  value: number;
  date: string;         // yyyy-MM-dd
  type: string;         // 'salario' | 'renda_extra' | 'outro'
  responsible_id?: string;
  notes?: string;
  recurring: number;    // 0 | 1  (legacy flag; superseded by recurring_income_id)
  recurring_income_id?: string;  // links an auto-generated income to its template
}

export interface RecurringIncome {
  id: string;
  description: string;
  value: number;
  type: string;
  responsible_id?: string;
  day_of_month: number;
  active: number; // 0 | 1
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
}
