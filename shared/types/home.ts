import type { Todo } from "./todo";
import type { WeatherResult } from "./weather";

export type HomeModuleResult<T> =
  | { status: "success"; data: T }
  | { status: "unavailable"; data: null; code: string; message: string };

export interface HomeLedgerOverview {
  todayIncomeInCents: number;
  todayExpenseInCents: number;
  monthIncomeInCents: number;
  monthExpenseInCents: number;
  monthBalanceInCents: number;
  budget: null;
}

export interface HomeTodoOverview {
  todayTotal: number;
  todayCompleted: number;
  todayPending: number;
  overdueCount: number;
  items: Todo[];
}

export interface HomeOverviewResult {
  dateKey: string;
  timezone: string;
  ledger: HomeModuleResult<HomeLedgerOverview>;
  todos: HomeModuleResult<HomeTodoOverview>;
  weather: HomeModuleResult<WeatherResult>;
  generatedAt: string;
}

export interface GetHomeOverviewRequest {
  dateKey?: string;
}
