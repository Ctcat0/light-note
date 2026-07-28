import type { SupportedTransactionType } from "./transaction";

export type StatisticsMonthCount = 6 | 12;

export interface StatisticsPeriod {
  year: number;
  month: number;
}

export interface StatisticsMonthSummary extends StatisticsPeriod {
  monthIncomeInCents: number;
  monthExpenseInCents: number;
  monthBalanceInCents: number;
  incomeCount: number;
  expenseCount: number;
}

export interface StatisticsTrendItem extends StatisticsPeriod {
  monthKey: string;
  incomeInCents: number;
  expenseInCents: number;
  balanceInCents: number;
}

export interface StatisticsTrendResult {
  endYear: number;
  endMonth: number;
  monthCount: StatisticsMonthCount;
  items: StatisticsTrendItem[];
}

export interface CategoryStatisticsItem {
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  amountInCents: number;
  count: number;
  ratioBasisPoints: number;
}

export interface CategoryStatisticsResult extends StatisticsPeriod {
  type: SupportedTransactionType;
  totalAmountInCents: number;
  totalCount: number;
  items: CategoryStatisticsItem[];
}

export type GetStatisticsSummaryRequest = StatisticsPeriod;

export interface GetStatisticsTrendRequest {
  endYear: number;
  endMonth: number;
  monthCount: StatisticsMonthCount;
}

export interface GetCategoryStatisticsRequest extends StatisticsPeriod {
  type: SupportedTransactionType;
}
