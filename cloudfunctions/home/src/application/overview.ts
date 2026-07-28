import type {
  HomeLedgerOverview,
  HomeModuleResult,
  HomeOverviewResult,
  HomeTodoOverview,
} from "../../../../shared/types/home";
import type { Todo } from "../../../../shared/types/todo";
import type { WeatherResult } from "../../../../shared/types/weather";
import { getWeatherForSettings } from "../../../weather/src/application/weather";
import type { WeatherProvider, WeatherStore } from "../../../weather/src/domain/types";
import { WeatherError } from "../../../weather/src/domain/types";
import type { HomeSettingsRecord, HomeStore, HomeTodoRecord } from "../domain/types";
import { createOverviewRanges } from "./date";

function unavailable<T>(error: unknown, fallbackCode: string, fallbackMessage: string): HomeModuleResult<T> {
  if (error instanceof WeatherError) return { status: "unavailable", data: null, code: error.code, message: error.message };
  return { status: "unavailable", data: null, code: fallbackCode, message: fallbackMessage };
}

function toTodo(record: HomeTodoRecord, now: Date, dateKey: string): Todo {
  const isOverdue = record.status !== "completed" && record.status !== "cancelled" && (
    (record.dueKind === "date" && record.dueDateKey !== null && record.dueDateKey < dateKey) ||
    (record.dueKind === "datetime" && record.dueAt !== null && new Date(record.dueAt).getTime() < now.getTime())
  );
  return {
    todoId: record._id,
    title: record.title,
    description: record.description,
    status: record.status,
    priority: record.priority,
    listId: record.listId,
    dueKind: record.dueKind,
    dueDateKey: record.dueDateKey,
    dueAt: record.dueAt === null ? null : new Date(record.dueAt).toISOString(),
    completedAt: record.completedAt === null ? null : new Date(record.completedAt).toISOString(),
    isOverdue,
    version: record.version,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  };
}

async function ledgerModule(ownerId: string, settings: HomeSettingsRecord, now: Date, store: HomeStore): Promise<HomeLedgerOverview> {
  const ranges = createOverviewRanges(now, settings.timezone);
  const [todayIncomeInCents, todayExpenseInCents, monthIncomeInCents, monthExpenseInCents] = await Promise.all([
    store.sumTransactions({ ownerId, type: "income", startAt: ranges.todayStart, endAt: ranges.tomorrowStart }),
    store.sumTransactions({ ownerId, type: "expense", startAt: ranges.todayStart, endAt: ranges.tomorrowStart }),
    store.sumTransactions({ ownerId, type: "income", startAt: ranges.monthStart, endAt: ranges.nextMonthStart }),
    store.sumTransactions({ ownerId, type: "expense", startAt: ranges.monthStart, endAt: ranges.nextMonthStart }),
  ]);
  return { todayIncomeInCents, todayExpenseInCents, monthIncomeInCents, monthExpenseInCents, monthBalanceInCents: monthIncomeInCents - monthExpenseInCents, budget: null };
}

async function todoModule(ownerId: string, settings: HomeSettingsRecord, now: Date, store: HomeStore): Promise<HomeTodoOverview> {
  const dateKey = createOverviewRanges(now, settings.timezone).dateKey;
  const result = await store.getTodoOverview({ ownerId, dateKey, now });
  return {
    todayTotal: result.todayTotal,
    todayCompleted: result.todayCompleted,
    todayPending: result.todayTotal - result.todayCompleted,
    overdueCount: result.overdueCount,
    items: result.items.slice(0, 5).map((item) => toTodo(item, now, dateKey)),
  };
}

export async function getHomeOverview(options: {
  ownerId: string;
  settings: HomeSettingsRecord;
  requestedDateKey?: string;
  now: Date;
  store: HomeStore;
  weatherStore: WeatherStore;
  provider: WeatherProvider;
}): Promise<HomeOverviewResult> {
  const dateKey = createOverviewRanges(options.now, options.settings.timezone).dateKey;
  if (options.requestedDateKey !== undefined && options.requestedDateKey !== dateKey) throw new Error("INVALID_DATE");
  const [ledger, todos, weather] = await Promise.allSettled([
    ledgerModule(options.ownerId, options.settings, options.now, options.store),
    todoModule(options.ownerId, options.settings, options.now, options.store),
    options.settings.showWeather
      ? getWeatherForSettings({ settings: options.settings, now: options.now, store: options.weatherStore, provider: options.provider })
      : Promise.reject(new WeatherError("WEATHER_UNAVAILABLE", "天气展示已关闭")),
  ]);
  return {
    dateKey,
    timezone: options.settings.timezone,
    ledger: ledger.status === "fulfilled" ? { status: "success", data: ledger.value } : unavailable<HomeLedgerOverview>(ledger.reason, "TRANSACTION_SUMMARY_FAILED", "收支摘要暂时不可用"),
    todos: todos.status === "fulfilled" ? { status: "success", data: todos.value } : unavailable<HomeTodoOverview>(todos.reason, "TODO_LIST_FAILED", "待办摘要暂时不可用"),
    weather: weather.status === "fulfilled" ? { status: "success", data: weather.value as WeatherResult } : unavailable<WeatherResult>(weather.reason, "WEATHER_UNAVAILABLE", "天气暂时不可用"),
    generatedAt: options.now.toISOString(),
  };
}
