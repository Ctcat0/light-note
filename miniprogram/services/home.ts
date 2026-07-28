import { CLOUD_FUNCTIONS } from "../constants/cloud";
import type {
  GetHomeOverviewRequest,
  HomeLedgerOverview,
  HomeModuleResult,
  HomeOverviewResult,
  HomeTodoOverview,
} from "../types/home";
import type { WeatherResult } from "../types/weather";
import { createRequestId } from "../utils/request-id";
import { isRecord } from "../utils/record";
import { callCloudFunctionWithMetadata, type CloudCallOptions, type CloudCallResult } from "./cloud";
import { parseTodo } from "./todo";
import { parseWeatherResult } from "./weather";

const SNAPSHOT_KEY = "home_overview_snapshot_v1";

export interface HomeSnapshot {
  data: HomeOverviewResult;
  savedAt: string;
}

interface StorageApi {
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, data: unknown): void;
  removeStorageSync(key: string): void;
}

export type HomeTransport = (
  options: CloudCallOptions<GetHomeOverviewRequest, HomeOverviewResult>,
) => Promise<CloudCallResult<HomeOverviewResult>>;

function parseLedger(value: unknown): HomeLedgerOverview {
  if (!isRecord(value) || !Number.isSafeInteger(value.todayIncomeInCents) || !Number.isSafeInteger(value.todayExpenseInCents) || !Number.isSafeInteger(value.monthIncomeInCents) || !Number.isSafeInteger(value.monthExpenseInCents) || !Number.isSafeInteger(value.monthBalanceInCents) || value.budget !== null) {
    throw new Error("首页收支响应格式无效");
  }
  return value as unknown as HomeLedgerOverview;
}

function parseTodos(value: unknown): HomeTodoOverview {
  if (!isRecord(value) || !Number.isSafeInteger(value.todayTotal) || !Number.isSafeInteger(value.todayCompleted) || !Number.isSafeInteger(value.todayPending) || !Number.isSafeInteger(value.overdueCount) || !Array.isArray(value.items)) {
    throw new Error("首页待办响应格式无效");
  }
  return {
    todayTotal: value.todayTotal as number,
    todayCompleted: value.todayCompleted as number,
    todayPending: value.todayPending as number,
    overdueCount: value.overdueCount as number,
    items: value.items.map(parseTodo),
  };
}

function parseModule<T>(value: unknown, parseData: (input: unknown) => T): HomeModuleResult<T> {
  if (!isRecord(value)) throw new Error("首页模块响应格式无效");
  if (value.status === "success") return { status: "success", data: parseData(value.data) };
  if (value.status === "unavailable" && value.data === null && typeof value.code === "string" && typeof value.message === "string") {
    return { status: "unavailable", data: null, code: value.code, message: value.message };
  }
  throw new Error("首页模块状态无效");
}

export function parseHomeOverview(value: unknown): HomeOverviewResult {
  if (!isRecord(value) || typeof value.dateKey !== "string" || typeof value.timezone !== "string" || typeof value.generatedAt !== "string") throw new Error("首页响应格式无效");
  return {
    dateKey: value.dateKey,
    timezone: value.timezone,
    ledger: parseModule(value.ledger, parseLedger),
    todos: parseModule(value.todos, parseTodos),
    weather: parseModule<WeatherResult>(value.weather, parseWeatherResult),
    generatedAt: value.generatedAt,
  };
}

export function loadHomeSnapshot(storage: StorageApi = wx): HomeSnapshot | null {
  try {
    const value = storage.getStorageSync(SNAPSHOT_KEY);
    if (!isRecord(value) || typeof value.savedAt !== "string") return null;
    const data = parseHomeOverview(value.data);
    if (Date.now() - new Date(value.savedAt).getTime() > 24 * 60 * 60 * 1000) return null;
    return { data, savedAt: value.savedAt };
  } catch { return null; }
}

export function saveHomeSnapshot(data: HomeOverviewResult, storage: StorageApi = wx): void {
  storage.setStorageSync(SNAPSHOT_KEY, { data, savedAt: new Date().toISOString() });
}

export function clearHomeSnapshot(storage: StorageApi = wx): void {
  storage.removeStorageSync(SNAPSHOT_KEY);
}

export function createHomeService(transport: HomeTransport = callCloudFunctionWithMetadata) {
  return {
    async getOverview(): Promise<HomeOverviewResult> {
      const result = await transport({ functionName: CLOUD_FUNCTIONS.HOME, action: "getOverview", requestId: createRequestId(), payload: {}, parseData: parseHomeOverview, timeoutMs: 15_000 });
      saveHomeSnapshot(result.data);
      return result.data;
    },
  };
}

export const homeService = createHomeService();
