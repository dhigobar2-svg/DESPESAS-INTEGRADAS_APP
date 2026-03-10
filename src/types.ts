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

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}
