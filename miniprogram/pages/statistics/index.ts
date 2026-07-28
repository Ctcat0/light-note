import { statisticsService } from "../../services/statistics";
import { requestTransactionCategoryFilter } from "../../services/transaction-category-filter";
import { readTransactionListRefreshSignal } from "../../services/transaction-list-refresh";
import type {
  CategoryStatisticsItem,
  CategoryStatisticsResult,
  StatisticsMonthCount,
  StatisticsMonthSummary,
  StatisticsPageState,
  StatisticsSectionStatus,
  StatisticsTrendItem,
  StatisticsTrendResult,
} from "../../types/statistics";
import type { SupportedTransactionType } from "../../types/transaction";
import { DEFAULT_TIME_ZONE, formatYearMonth, formatYearMonthLabel, getYearMonth } from "../../utils/date";
import { normalizeError } from "../../utils/error";
import { formatAmountInCents } from "../../utils/money";
import {
  formatRatioBasisPoints,
  getStatisticsBarWidth,
  isCurrentStatisticsRequest,
} from "../../utils/statistics";

interface TrendView extends StatisticsTrendItem {
  label: string;
  incomeDisplay: string;
  expenseDisplay: string;
  balanceDisplay: string;
  incomeWidth: number;
  expenseWidth: number;
}

interface CategoryView extends CategoryStatisticsItem {
  amountDisplay: string;
  ratioDisplay: string;
  barWidth: number;
}

interface StatisticsPageData {
  pageState: StatisticsPageState;
  errorMessage: string;
  partialErrorMessage: string;
  selectedYear: number;
  selectedMonth: number;
  selectedMonthValue: string;
  selectedMonthLabel: string;
  currentMonthEndValue: string;
  monthCount: StatisticsMonthCount;
  summary: StatisticsMonthSummary | null;
  summaryStatus: StatisticsSectionStatus;
  monthIncomeDisplay: string;
  monthExpenseDisplay: string;
  monthBalanceDisplay: string;
  trend: StatisticsTrendResult | null;
  trendStatus: StatisticsSectionStatus;
  trendItems: TrendView[];
  expenseCategories: CategoryStatisticsResult | null;
  expenseStatus: StatisticsSectionStatus;
  expenseItems: CategoryView[];
  incomeCategories: CategoryStatisticsResult | null;
  incomeStatus: StatisticsSectionStatus;
  incomeItems: CategoryView[];
  requestVersion: number;
  loadedRefreshRevision: number;
  hasLoadedOnce: boolean;
  destroyed: boolean;
}

interface StatisticsPageMethods {
  loadStatistics(preserveData: boolean): Promise<void>;
  handleRetry(): void;
  handleMonthChange(event: { detail: { value: string } }): void;
  handleMonthCountChange(event: { currentTarget: { dataset: { count?: number } } }): void;
  handleCategoryTap(event: {
    currentTarget: { dataset: { type?: string; categoryId?: string; categoryName?: string } };
  }): void;
}

function buildTrendViews(items: StatisticsTrendItem[]): TrendView[] {
  const maximum = items.reduce(
    (value, item) => Math.max(value, item.incomeInCents, item.expenseInCents),
    0,
  );
  return items.map((item) => ({
    ...item,
    label: `${item.year}年${item.month}月`,
    incomeDisplay: formatAmountInCents(item.incomeInCents),
    expenseDisplay: formatAmountInCents(item.expenseInCents),
    balanceDisplay: formatAmountInCents(item.balanceInCents),
    incomeWidth: getStatisticsBarWidth(item.incomeInCents, maximum),
    expenseWidth: getStatisticsBarWidth(item.expenseInCents, maximum),
  }));
}

function buildCategoryViews(items: CategoryStatisticsItem[]): CategoryView[] {
  const maximum = items.reduce((value, item) => Math.max(value, item.amountInCents), 0);
  return items.map((item) => ({
    ...item,
    amountDisplay: formatAmountInCents(item.amountInCents),
    ratioDisplay: formatRatioBasisPoints(item.ratioBasisPoints),
    barWidth: getStatisticsBarWidth(item.amountInCents, maximum),
  }));
}

function parseRoutePeriod(options: Record<string, string | undefined>): { year: number; month: number } | null {
  const year = Number(options.year);
  const month = Number(options.month);
  return Number.isInteger(year) && year >= 1000 && year <= 9999 && Number.isInteger(month) && month >= 1 && month <= 12
    ? { year, month }
    : null;
}

function formatMonthEnd(value: { year: number; month: number }): string {
  const day = new Date(Date.UTC(value.year, value.month, 0)).getUTCDate();
  return `${formatYearMonth(value)}-${String(day).padStart(2, "0")}`;
}

const current = getYearMonth(new Date(), DEFAULT_TIME_ZONE);

Page<StatisticsPageData, StatisticsPageMethods>({
  data: {
    pageState: "initialLoading",
    errorMessage: "",
    partialErrorMessage: "",
    selectedYear: current.year,
    selectedMonth: current.month,
    selectedMonthValue: `${formatYearMonth(current)}-01`,
    selectedMonthLabel: formatYearMonthLabel(current),
    currentMonthEndValue: formatMonthEnd(current),
    monthCount: 6,
    summary: null,
    summaryStatus: "loading",
    monthIncomeDisplay: "",
    monthExpenseDisplay: "",
    monthBalanceDisplay: "",
    trend: null,
    trendStatus: "loading",
    trendItems: [],
    expenseCategories: null,
    expenseStatus: "loading",
    expenseItems: [],
    incomeCategories: null,
    incomeStatus: "loading",
    incomeItems: [],
    requestVersion: 0,
    loadedRefreshRevision: readTransactionListRefreshSignal()?.revision ?? 0,
    hasLoadedOnce: false,
    destroyed: false,
  },

  onLoad(options: Record<string, string | undefined>): void {
    const routePeriod = parseRoutePeriod(options);
    if (routePeriod !== null) {
      this.setData({
        selectedYear: routePeriod.year,
        selectedMonth: routePeriod.month,
        selectedMonthValue: `${formatYearMonth(routePeriod)}-01`,
        selectedMonthLabel: formatYearMonthLabel(routePeriod),
      });
    }
    void this.loadStatistics(false);
  },

  onShow(): void {
    if (!this.data.hasLoadedOnce) return;
    const signal = readTransactionListRefreshSignal();
    if (signal !== null && signal.revision > this.data.loadedRefreshRevision) {
      void this.loadStatistics(true);
    }
  },

  onUnload(): void {
    this.data.destroyed = true;
    this.data.requestVersion += 1;
  },

  async onPullDownRefresh(): Promise<void> {
    try {
      await this.loadStatistics(this.data.hasLoadedOnce);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadStatistics(preserveData): Promise<void> {
    const requestVersion = this.data.requestVersion + 1;
    const period = { year: this.data.selectedYear, month: this.data.selectedMonth };
    this.setData({
      requestVersion,
      pageState: preserveData ? "refreshing" : this.data.hasLoadedOnce ? "retrying" : "initialLoading",
      errorMessage: "",
      partialErrorMessage: "",
      summaryStatus: "loading",
      trendStatus: "loading",
      expenseStatus: "loading",
      incomeStatus: "loading",
      ...(!preserveData ? {
        summary: null,
        trend: null,
        trendItems: [],
        expenseCategories: null,
        expenseItems: [],
        incomeCategories: null,
        incomeItems: [],
      } : {}),
    });

    try {
      const app = getApp<IAppOption>();
      if (app.globalData.userInitializationState !== "ready") await app.initializeUser();
      if (app.globalData.userInitializationState !== "ready") {
        throw new Error(app.globalData.userInitializationErrorMessage ?? "用户初始化失败");
      }
      const results = await Promise.allSettled([
        statisticsService.getSummary(period),
        statisticsService.getTrend({ endYear: period.year, endMonth: period.month, monthCount: this.data.monthCount }),
        statisticsService.getCategoryStatistics({ ...period, type: "expense" }),
        statisticsService.getCategoryStatistics({ ...period, type: "income" }),
      ] as const);
      if (!isCurrentStatisticsRequest({
        destroyed: this.data.destroyed,
        activeRequestVersion: this.data.requestVersion,
        responseRequestVersion: requestVersion,
        activeYear: this.data.selectedYear,
        activeMonth: this.data.selectedMonth,
        responseYear: period.year,
        responseMonth: period.month,
      })) return;

      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => normalizeError(result.reason).message);
      const [summaryResult, trendResult, expenseResult, incomeResult] = results;
      const noSuccess = results.every((result) => result.status === "rejected");
      if (noSuccess && !preserveData) {
        this.setData({
          pageState: "initialError",
          errorMessage: errors[0] ?? "统计数据加载失败",
          summaryStatus: "error",
          trendStatus: "error",
          expenseStatus: "error",
          incomeStatus: "error",
          hasLoadedOnce: true,
        });
        return;
      }

      const nextData: Partial<StatisticsPageData> = {
        pageState: errors.length > 0 ? "partialError" : "ready",
        partialErrorMessage: errors.length > 0 ? `部分数据加载失败：${[...new Set(errors)].join("；")}` : "",
        summaryStatus: summaryResult.status === "fulfilled" ? "ready" : "error",
        trendStatus: trendResult.status === "fulfilled" ? (trendResult.value.items.length ? "ready" : "empty") : "error",
        expenseStatus: expenseResult.status === "fulfilled" ? (expenseResult.value.items.length ? "ready" : "empty") : "error",
        incomeStatus: incomeResult.status === "fulfilled" ? (incomeResult.value.items.length ? "ready" : "empty") : "error",
        loadedRefreshRevision: readTransactionListRefreshSignal()?.revision ?? this.data.loadedRefreshRevision,
        hasLoadedOnce: true,
      };
      if (summaryResult.status === "fulfilled") {
        nextData.summary = summaryResult.value;
        nextData.monthIncomeDisplay = formatAmountInCents(summaryResult.value.monthIncomeInCents);
        nextData.monthExpenseDisplay = formatAmountInCents(summaryResult.value.monthExpenseInCents);
        nextData.monthBalanceDisplay = formatAmountInCents(summaryResult.value.monthBalanceInCents);
      }
      if (trendResult.status === "fulfilled") {
        nextData.trend = trendResult.value;
        nextData.trendItems = buildTrendViews(trendResult.value.items);
      }
      if (expenseResult.status === "fulfilled") {
        nextData.expenseCategories = expenseResult.value;
        nextData.expenseItems = buildCategoryViews(expenseResult.value.items);
      }
      if (incomeResult.status === "fulfilled") {
        nextData.incomeCategories = incomeResult.value;
        nextData.incomeItems = buildCategoryViews(incomeResult.value.items);
      }
      const allEmpty =
        summaryResult.status === "fulfilled" &&
        summaryResult.value.incomeCount === 0 &&
        summaryResult.value.expenseCount === 0 &&
        expenseResult.status === "fulfilled" && expenseResult.value.items.length === 0 &&
        incomeResult.status === "fulfilled" && incomeResult.value.items.length === 0;
      if (errors.length === 0 && allEmpty) nextData.pageState = "empty";
      this.setData(nextData);
      if (errors.length > 0 && preserveData) wx.showToast({ title: "部分统计刷新失败", icon: "none" });
    } catch (error) {
      if (!isCurrentStatisticsRequest({
        destroyed: this.data.destroyed,
        activeRequestVersion: this.data.requestVersion,
        responseRequestVersion: requestVersion,
        activeYear: this.data.selectedYear,
        activeMonth: this.data.selectedMonth,
        responseYear: period.year,
        responseMonth: period.month,
      })) return;
      const message = normalizeError(error).message;
      this.setData({
        pageState: preserveData ? "partialError" : "initialError",
        errorMessage: message,
        partialErrorMessage: preserveData ? message : "",
        hasLoadedOnce: true,
      });
    }
  },

  handleRetry(): void {
    void this.loadStatistics(this.data.summary !== null || this.data.trend !== null);
  },

  handleMonthChange(event): void {
    const match = /^(\d{4})-(\d{2})/.exec(event.detail.value);
    if (match === null) return;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (year === this.data.selectedYear && month === this.data.selectedMonth) return;
    this.setData({
      selectedYear: year,
      selectedMonth: month,
      selectedMonthValue: `${year}-${String(month).padStart(2, "0")}-01`,
      selectedMonthLabel: formatYearMonthLabel({ year, month }),
      requestVersion: this.data.requestVersion + 1,
    });
    void this.loadStatistics(false);
  },

  handleMonthCountChange(event): void {
    const count = Number(event.currentTarget.dataset.count);
    if ((count !== 6 && count !== 12) || count === this.data.monthCount) return;
    this.setData({ monthCount: count, requestVersion: this.data.requestVersion + 1 });
    void this.loadStatistics(true);
  },

  handleCategoryTap(event): void {
    const { type, categoryId, categoryName } = event.currentTarget.dataset;
    if (
      (type !== "expense" && type !== "income") ||
      typeof categoryId !== "string" ||
      typeof categoryName !== "string"
    ) return;
    requestTransactionCategoryFilter({
      year: this.data.selectedYear,
      month: this.data.selectedMonth,
      type: type as SupportedTransactionType,
      categoryId,
      categoryName,
    });
    wx.switchTab({ url: "/pages/ledger/index" });
  },
});
