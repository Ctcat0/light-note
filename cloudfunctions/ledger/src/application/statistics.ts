import type {
  CategoryStatisticsResult,
  StatisticsMonthCount,
  StatisticsMonthSummary,
  StatisticsTrendResult,
} from "../../../../shared/types/statistics";
import type { SupportedTransactionType } from "../../../../shared/types/transaction";
import type { LedgerStore, UserSettingsRecord } from "../domain/types";
import { LedgerError } from "../domain/types";
import { getTransactionMonthRange } from "./transactions";

function shiftPeriod(year: number, month: number, offset: number): { year: number; month: number } {
  const absoluteMonth = year * 12 + (month - 1) + offset;
  return {
    year: Math.floor(absoluteMonth / 12),
    month: (absoluteMonth % 12 + 12) % 12 + 1,
  };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function assertAggregate(value: { amountInCents: number; count: number }): void {
  if (
    !Number.isSafeInteger(value.amountInCents) ||
    value.amountInCents < 0 ||
    !Number.isSafeInteger(value.count) ||
    value.count < 0
  ) {
    throw new LedgerError("INTERNAL_ERROR", "统计聚合结果无效");
  }
}

async function aggregateMonth(options: {
  ownerId: string;
  type: SupportedTransactionType;
  year: number;
  month: number;
  settings: UserSettingsRecord;
  store: LedgerStore;
}): Promise<{ amountInCents: number; count: number }> {
  const range = getTransactionMonthRange(
    options.year,
    options.month,
    options.settings.timezone,
  );
  const aggregate = await options.store.aggregateTransactions({
    ownerId: options.ownerId,
    type: options.type,
    startAt: range.startAt,
    endAt: range.endAt,
  });
  assertAggregate(aggregate);
  return aggregate;
}

export async function getStatisticsSummary(options: {
  ownerId: string;
  year: number;
  month: number;
  settings: UserSettingsRecord;
  store: LedgerStore;
}): Promise<StatisticsMonthSummary> {
  try {
    const [income, expense] = await Promise.all([
      aggregateMonth({ ...options, type: "income" }),
      aggregateMonth({ ...options, type: "expense" }),
    ]);
    return {
      year: options.year,
      month: options.month,
      monthIncomeInCents: income.amountInCents,
      monthExpenseInCents: expense.amountInCents,
      monthBalanceInCents: income.amountInCents - expense.amountInCents,
      incomeCount: income.count,
      expenseCount: expense.count,
    };
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    throw new LedgerError("STATISTICS_QUERY_FAILED", "月度统计加载失败");
  }
}

export async function getStatisticsTrend(options: {
  ownerId: string;
  endYear: number;
  endMonth: number;
  monthCount: StatisticsMonthCount;
  settings: UserSettingsRecord;
  store: LedgerStore;
}): Promise<StatisticsTrendResult> {
  const periods = Array.from({ length: options.monthCount }, (_, index) =>
    shiftPeriod(
      options.endYear,
      options.endMonth,
      index - options.monthCount + 1,
    ),
  );
  try {
    const items = await Promise.all(
      periods.map(async (period) => {
        const [income, expense] = await Promise.all([
          aggregateMonth({ ...options, ...period, type: "income" }),
          aggregateMonth({ ...options, ...period, type: "expense" }),
        ]);
        return {
          ...period,
          monthKey: monthKey(period.year, period.month),
          incomeInCents: income.amountInCents,
          expenseInCents: expense.amountInCents,
          balanceInCents: income.amountInCents - expense.amountInCents,
        };
      }),
    );
    return {
      endYear: options.endYear,
      endMonth: options.endMonth,
      monthCount: options.monthCount,
      items,
    };
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    throw new LedgerError("STATISTICS_TREND_FAILED", "趋势统计加载失败");
  }
}

export async function getCategoryStatistics(options: {
  ownerId: string;
  year: number;
  month: number;
  type: SupportedTransactionType;
  settings: UserSettingsRecord;
  store: LedgerStore;
}): Promise<CategoryStatisticsResult> {
  const range = getTransactionMonthRange(
    options.year,
    options.month,
    options.settings.timezone,
  );
  try {
    const rows = await options.store.aggregateTransactionsByCategory({
      ownerId: options.ownerId,
      type: options.type,
      startAt: range.startAt,
      endAt: range.endAt,
    });
    rows.forEach(assertAggregate);
    const categories = await options.store.getCategoriesByIds(
      options.ownerId,
      rows.map((item) => item.categoryId),
    );
    const categoryMap = new Map(categories.map((item) => [item._id, item]));
    const totalAmountInCents = rows.reduce(
      (total, item) => total + item.amountInCents,
      0,
    );
    const totalCount = rows.reduce((total, item) => total + item.count, 0);
    if (!Number.isSafeInteger(totalAmountInCents) || !Number.isSafeInteger(totalCount)) {
      throw new LedgerError("INTERNAL_ERROR", "分类统计合计无效");
    }
    const items = rows
      .map((item) => {
        const category = categoryMap.get(item.categoryId);
        return {
          categoryId: item.categoryId,
          categoryName: category?.name ?? "已删除分类",
          categoryIcon: category?.icon ?? "other",
          amountInCents: item.amountInCents,
          count: item.count,
          ratioBasisPoints:
            totalAmountInCents === 0
              ? 0
              : Math.round((item.amountInCents / totalAmountInCents) * 10_000),
        };
      })
      .sort(
        (left, right) =>
          right.amountInCents - left.amountInCents ||
          left.categoryId.localeCompare(right.categoryId),
      );
    return {
      year: options.year,
      month: options.month,
      type: options.type,
      totalAmountInCents,
      totalCount,
      items,
    };
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    throw new LedgerError("STATISTICS_CATEGORY_FAILED", "分类统计加载失败");
  }
}
