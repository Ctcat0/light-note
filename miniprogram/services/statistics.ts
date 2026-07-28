import { CLOUD_FUNCTIONS } from "../constants/cloud";
import type {
  CategoryStatisticsResult,
  GetCategoryStatisticsRequest,
  GetStatisticsSummaryRequest,
  GetStatisticsTrendRequest,
  StatisticsMonthSummary,
  StatisticsTrendResult,
} from "../types/statistics";
import { createRequestId } from "../utils/request-id";
import { isRecord } from "../utils/record";
import {
  callCloudFunctionWithMetadata,
  type CloudCallOptions,
  type CloudCallResult,
} from "./cloud";

type StatisticsTransport = <TPayload extends object, TData>(
  options: CloudCallOptions<TPayload, TData>,
) => Promise<CloudCallResult<TData>>;

function isSafeAmount(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function parseSummary(value: unknown): StatisticsMonthSummary {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.year) ||
    !Number.isInteger(value.month) ||
    !isSafeAmount(value.monthIncomeInCents) ||
    !isSafeAmount(value.monthExpenseInCents) ||
    !isSafeAmount(value.monthBalanceInCents) ||
    !Number.isSafeInteger(value.incomeCount) ||
    !Number.isSafeInteger(value.expenseCount) ||
    value.monthBalanceInCents !== value.monthIncomeInCents - value.monthExpenseInCents
  ) {
    throw new Error("月度统计响应格式无效");
  }
  return value as unknown as StatisticsMonthSummary;
}

function parseTrend(value: unknown): StatisticsTrendResult {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.endYear) ||
    !Number.isInteger(value.endMonth) ||
    (value.monthCount !== 6 && value.monthCount !== 12) ||
    !Array.isArray(value.items) ||
    value.items.length !== value.monthCount
  ) {
    throw new Error("趋势统计响应格式无效");
  }
  const items = value.items.map((item) => {
    if (
      !isRecord(item) ||
      !Number.isInteger(item.year) ||
      !Number.isInteger(item.month) ||
      typeof item.monthKey !== "string" ||
      !isSafeAmount(item.incomeInCents) ||
      !isSafeAmount(item.expenseInCents) ||
      !isSafeAmount(item.balanceInCents) ||
      item.balanceInCents !== item.incomeInCents - item.expenseInCents
    ) {
      throw new Error("趋势统计响应格式无效");
    }
    return item as unknown as StatisticsTrendResult["items"][number];
  });
  return {
    endYear: value.endYear as number,
    endMonth: value.endMonth as number,
    monthCount: value.monthCount,
    items,
  };
}

function parseCategoryStatistics(value: unknown): CategoryStatisticsResult {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.year) ||
    !Number.isInteger(value.month) ||
    (value.type !== "expense" && value.type !== "income") ||
    !isSafeAmount(value.totalAmountInCents) ||
    !Number.isSafeInteger(value.totalCount) ||
    !Array.isArray(value.items)
  ) {
    throw new Error("分类统计响应格式无效");
  }
  const items = value.items.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.categoryId !== "string" ||
      typeof item.categoryName !== "string" ||
      typeof item.categoryIcon !== "string" ||
      !isSafeAmount(item.amountInCents) ||
      !Number.isSafeInteger(item.count) ||
      !Number.isInteger(item.ratioBasisPoints) ||
      (item.ratioBasisPoints as number) < 0 ||
      (item.ratioBasisPoints as number) > 10_000
    ) {
      throw new Error("分类统计响应格式无效");
    }
    return item as unknown as CategoryStatisticsResult["items"][number];
  });
  const totalAmount = items.reduce((total, item) => total + item.amountInCents, 0);
  const totalCount = items.reduce((total, item) => total + item.count, 0);
  if (
    totalAmount !== value.totalAmountInCents ||
    totalCount !== value.totalCount ||
    items.some((item, index) => index > 0 && item.amountInCents > items[index - 1]!.amountInCents)
  ) {
    throw new Error("分类统计响应合计不一致");
  }
  return {
    year: value.year as number,
    month: value.month as number,
    type: value.type,
    totalAmountInCents: value.totalAmountInCents as number,
    totalCount: value.totalCount as number,
    items,
  };
}

export function createStatisticsService(
  transport: StatisticsTransport = callCloudFunctionWithMetadata,
): {
  getSummary(payload: GetStatisticsSummaryRequest): Promise<StatisticsMonthSummary>;
  getTrend(payload: GetStatisticsTrendRequest): Promise<StatisticsTrendResult>;
  getCategoryStatistics(payload: GetCategoryStatisticsRequest): Promise<CategoryStatisticsResult>;
} {
  return {
    async getSummary(payload) {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "getStatisticsSummary",
        requestId: createRequestId(),
        payload,
        parseData: parseSummary,
      });
      return result.data;
    },
    async getTrend(payload) {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "getStatisticsTrend",
        requestId: createRequestId(),
        payload,
        parseData: parseTrend,
      });
      return result.data;
    },
    async getCategoryStatistics(payload) {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "getCategoryStatistics",
        requestId: createRequestId(),
        payload,
        parseData: parseCategoryStatistics,
      });
      return result.data;
    },
  };
}

export const statisticsService = createStatisticsService();

export { parseCategoryStatistics, parseSummary, parseTrend };
