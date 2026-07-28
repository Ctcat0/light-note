import { ledgerService } from "../../services/ledger";
import { consumeTransactionCategoryFilter } from "../../services/transaction-category-filter";
import { readTransactionListRefreshSignal } from "../../services/transaction-list-refresh";
import type {
  TransactionCursor,
  TransactionDayGroup,
  TransactionListItem,
  TransactionListFilter,
  TransactionListLoadStatus,
  TransactionMonthSummary,
} from "../../types/transaction";
import {
  compareYearMonth,
  DEFAULT_TIME_ZONE,
  formatYearMonth,
  formatYearMonthLabel,
  getYearMonth,
  shiftYearMonth,
  type YearMonth,
} from "../../utils/date";
import { normalizeError } from "../../utils/error";
import { formatAmountInCents } from "../../utils/money";
import {
  canLoadMoreTransactions,
  getTransactionListSuccessStatus,
  groupTransactionsByDay,
  isCurrentTransactionListRequest,
  mergeTransactionPages,
} from "../../utils/transaction-list";

const PAGE_SIZE = 20;

interface LedgerPageData {
  selectedFilter: TransactionListFilter;
  selectedFilterLabel: string;
  categoryFilterId: string;
  categoryFilterName: string;
  loadStatus: TransactionListLoadStatus;
  items: TransactionListItem[];
  groups: TransactionDayGroup[];
  summary: TransactionMonthSummary | null;
  monthIncomeDisplay: string;
  monthExpenseDisplay: string;
  monthBalanceDisplay: string;
  selectedYear: number;
  selectedMonth: number;
  selectedMonthPickerValue: string;
  selectedMonthLabel: string;
  currentMonthEndValue: string;
  canSelectNextMonth: boolean;
  nextCursor: TransactionCursor | null;
  hasMore: boolean;
  errorMessage: string;
  timeZone: string;
  requestVersion: number;
  lastRefreshRevision: number;
  hasLoadedOnce: boolean;
  firstPageLoading: boolean;
  destroyed: boolean;
}

interface MonthPickerEvent {
  detail: { value: string };
}

interface LedgerPageMethods {
  loadFirstPage(mode: "initial" | "refresh"): Promise<void>;
  loadMore(): Promise<void>;
  changeMonth(target: YearMonth): void;
  handlePreviousMonth(): void;
  handleNextMonth(): void;
  handleMonthPickerChange(event: MonthPickerEvent): void;
  handleRetry(): void;
  handleLoadMoreRetry(): void;
  handleFilterChange(event: { currentTarget: { dataset: { filter?: string } } }): void;
  handleClearCategoryFilter(): void;
  handleOpenStatistics(): void;
  handleAddTransaction(): void;
  handleTransactionTap(event: { currentTarget: { dataset: { id?: string } } }): void;
}

function getInitialData(): LedgerPageData {
  const current = getYearMonth(new Date(), DEFAULT_TIME_ZONE);
  const signal = readTransactionListRefreshSignal();
  return {
    selectedFilter: "all",
    selectedFilterLabel: "收支",
    categoryFilterId: "",
    categoryFilterName: "",
    loadStatus: "initialLoading",
    items: [],
    groups: [],
    summary: null,
    monthIncomeDisplay: "",
    monthExpenseDisplay: "",
    monthBalanceDisplay: "",
    selectedYear: current.year,
    selectedMonth: current.month,
    selectedMonthPickerValue: `${formatYearMonth(current)}-01`,
    selectedMonthLabel: formatYearMonthLabel(current),
    currentMonthEndValue: formatMonthPickerEnd(current),
    canSelectNextMonth: false,
    nextCursor: null,
    hasMore: false,
    errorMessage: "",
    timeZone: DEFAULT_TIME_ZONE,
    requestVersion: 0,
    lastRefreshRevision: signal?.revision ?? 0,
    hasLoadedOnce: false,
    firstPageLoading: false,
    destroyed: false,
  };
}

function isSameMonth(data: LedgerPageData, target: YearMonth): boolean {
  return data.selectedYear === target.year && data.selectedMonth === target.month;
}

function formatMonthPickerEnd(value: YearMonth): string {
  const lastDay = new Date(Date.UTC(value.year, value.month, 0)).getUTCDate();
  return `${formatYearMonth(value)}-${String(lastDay).padStart(2, "0")}`;
}

Page<LedgerPageData, LedgerPageMethods>({
  data: getInitialData(),

  onLoad(): void {
    this.setData({ destroyed: false });
    void this.loadFirstPage("initial");
  },

  onShow(): void {
    const categorySignal = consumeTransactionCategoryFilter();
    if (categorySignal !== null) {
      this.setData({
        selectedFilter: categorySignal.type,
        selectedFilterLabel: categorySignal.type === "expense" ? "支出" : "收入",
        categoryFilterId: categorySignal.categoryId,
        categoryFilterName: categorySignal.categoryName,
        selectedYear: categorySignal.year,
        selectedMonth: categorySignal.month,
        selectedMonthPickerValue: `${formatYearMonth(categorySignal)}-01`,
        selectedMonthLabel: formatYearMonthLabel(categorySignal),
        requestVersion: this.data.requestVersion + 1,
        firstPageLoading: false,
        items: [],
        groups: [],
        summary: null,
        nextCursor: null,
        hasMore: false,
      });
      void this.loadFirstPage("initial");
      return;
    }
    if (!this.data.hasLoadedOnce) return;
    const signal = readTransactionListRefreshSignal();
    if (signal === null || signal.revision <= this.data.lastRefreshRevision) return;
    this.setData({ lastRefreshRevision: signal.revision });
    const target = { year: signal.year, month: signal.month };
    if (signal.affectedMonths.some((value) => isSameMonth(this.data, value))) {
      void this.loadFirstPage("refresh");
      return;
    }
    this.changeMonth(target);
  },

  onUnload(): void {
    this.data.destroyed = true;
    this.data.requestVersion += 1;
  },

  async onPullDownRefresh(): Promise<void> {
    try {
      await this.loadFirstPage(this.data.hasLoadedOnce ? "refresh" : "initial");
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onReachBottom(): void {
    void this.loadMore();
  },

  async loadFirstPage(mode): Promise<void> {
    if (this.data.firstPageLoading) return;
    const requestVersion = this.data.requestVersion + 1;
    const selected = {
      year: this.data.selectedYear,
      month: this.data.selectedMonth,
    };
    const hadData = this.data.items.length > 0;
    this.setData({
      requestVersion,
      firstPageLoading: true,
      loadStatus: mode === "refresh" && hadData ? "refreshing" : "initialLoading",
      errorMessage: "",
      ...(mode === "initial"
        ? {
            items: [],
            groups: [],
            summary: null,
            monthIncomeDisplay: "",
            monthExpenseDisplay: "",
            monthBalanceDisplay: "",
            nextCursor: null,
            hasMore: false,
          }
        : {}),
    });

    try {
      const app = getApp<IAppOption>();
      if (app.globalData.userInitializationState !== "ready") {
        await app.initializeUser();
      }
      if (
        app.globalData.userInitializationState !== "ready" ||
        app.globalData.userInitialization === null
      ) {
        throw new Error(
          app.globalData.userInitializationErrorMessage ?? "用户初始化失败",
        );
      }
      const timeZone = app.globalData.userInitialization.settings.timezone;
      const currentMonth = getYearMonth(new Date(), timeZone);
      if (!this.data.hasLoadedOnce && timeZone !== this.data.timeZone) {
        selected.year = currentMonth.year;
        selected.month = currentMonth.month;
        this.setData({
          selectedYear: currentMonth.year,
          selectedMonth: currentMonth.month,
          selectedMonthPickerValue: `${formatYearMonth(currentMonth)}-01`,
          selectedMonthLabel: formatYearMonthLabel(currentMonth),
        });
      }
      this.setData({
        timeZone,
        currentMonthEndValue: formatMonthPickerEnd(currentMonth),
        canSelectNextMonth: compareYearMonth(selected, currentMonth) < 0,
      });
      const result = await ledgerService.listTransactions({
        filter: this.data.selectedFilter,
        categoryId: this.data.categoryFilterId || null,
        year: selected.year,
        month: selected.month,
        pageSize: PAGE_SIZE,
        cursor: null,
      });
      if (!isCurrentTransactionListRequest({
        destroyed: this.data.destroyed,
        activeRequestVersion: this.data.requestVersion,
        responseRequestVersion: requestVersion,
        activeYear: this.data.selectedYear,
        activeMonth: this.data.selectedMonth,
        responseYear: selected.year,
        responseMonth: selected.month,
      })) {
        return;
      }
      if (
        result.summary.year !== selected.year ||
        result.summary.month !== selected.month
      ) {
        throw new Error("月度汇总与当前月份不匹配");
      }
      const items = mergeTransactionPages([], result.items);
      this.setData({
        items,
        groups: groupTransactionsByDay(items, timeZone),
        summary: result.summary,
        monthIncomeDisplay: formatAmountInCents(
          result.summary.monthIncomeInCents,
        ),
        monthExpenseDisplay: formatAmountInCents(
          result.summary.monthExpenseInCents,
        ),
        monthBalanceDisplay: formatAmountInCents(
          result.summary.monthBalanceInCents,
        ),
        nextCursor: result.pagination.nextCursor,
        hasMore: result.pagination.hasMore,
        loadStatus: getTransactionListSuccessStatus(
          items.length,
          result.pagination.hasMore,
        ),
        errorMessage: "",
        timeZone,
        hasLoadedOnce: true,
        firstPageLoading: false,
      });
    } catch (error) {
      if (!isCurrentTransactionListRequest({
        destroyed: this.data.destroyed,
        activeRequestVersion: this.data.requestVersion,
        responseRequestVersion: requestVersion,
        activeYear: this.data.selectedYear,
        activeMonth: this.data.selectedMonth,
        responseYear: selected.year,
        responseMonth: selected.month,
      })) {
        return;
      }
      const normalized = normalizeError(error);
      if (mode === "refresh" && hadData) {
        this.setData({
          loadStatus: "refreshError",
          errorMessage: normalized.message,
          hasLoadedOnce: true,
          firstPageLoading: false,
        });
        wx.showToast({ title: normalized.message, icon: "none" });
      } else {
        this.setData({
          loadStatus: "initialError",
          errorMessage: normalized.message,
          hasLoadedOnce: true,
          firstPageLoading: false,
        });
      }
    }
  },

  async loadMore(): Promise<void> {
    if (!canLoadMoreTransactions(this.data)) {
      return;
    }
    const requestVersion = this.data.requestVersion;
    const selected = {
      year: this.data.selectedYear,
      month: this.data.selectedMonth,
    };
    const cursor = this.data.nextCursor;
    this.setData({ loadStatus: "loadingMore", errorMessage: "" });
    try {
      const result = await ledgerService.listTransactions({
        filter: this.data.selectedFilter,
        categoryId: this.data.categoryFilterId || null,
        year: selected.year,
        month: selected.month,
        pageSize: PAGE_SIZE,
        cursor,
      });
      if (!isCurrentTransactionListRequest({
        destroyed: this.data.destroyed,
        activeRequestVersion: this.data.requestVersion,
        responseRequestVersion: requestVersion,
        activeYear: this.data.selectedYear,
        activeMonth: this.data.selectedMonth,
        responseYear: selected.year,
        responseMonth: selected.month,
      })) {
        return;
      }
      const items = mergeTransactionPages(this.data.items, result.items);
      if (
        result.summary.year !== selected.year ||
        result.summary.month !== selected.month
      ) {
        throw new Error("月度汇总与当前月份不匹配");
      }
      this.setData({
        items,
        groups: groupTransactionsByDay(items, this.data.timeZone),
        summary: result.summary,
        monthIncomeDisplay: formatAmountInCents(
          result.summary.monthIncomeInCents,
        ),
        monthExpenseDisplay: formatAmountInCents(
          result.summary.monthExpenseInCents,
        ),
        monthBalanceDisplay: formatAmountInCents(
          result.summary.monthBalanceInCents,
        ),
        nextCursor: result.pagination.nextCursor,
        hasMore: result.pagination.hasMore,
        loadStatus: result.pagination.hasMore ? "ready" : "noMore",
      });
    } catch (error) {
      if (!isCurrentTransactionListRequest({
        destroyed: this.data.destroyed,
        activeRequestVersion: this.data.requestVersion,
        responseRequestVersion: requestVersion,
        activeYear: this.data.selectedYear,
        activeMonth: this.data.selectedMonth,
        responseYear: selected.year,
        responseMonth: selected.month,
      })) {
        return;
      }
      this.setData({
        loadStatus: "loadMoreError",
        errorMessage: normalizeError(error).message,
      });
    }
  },

  changeMonth(target): void {
    const current = getYearMonth(new Date(), this.data.timeZone);
    if (compareYearMonth(target, current) > 0 || isSameMonth(this.data, target)) {
      return;
    }
    this.setData({
      selectedYear: target.year,
      selectedMonth: target.month,
      selectedMonthPickerValue: `${formatYearMonth(target)}-01`,
      selectedMonthLabel: formatYearMonthLabel(target),
      canSelectNextMonth: compareYearMonth(target, current) < 0,
      requestVersion: this.data.requestVersion + 1,
      firstPageLoading: false,
      items: [],
      groups: [],
      summary: null,
      monthIncomeDisplay: "",
      monthExpenseDisplay: "",
      monthBalanceDisplay: "",
      nextCursor: null,
      hasMore: false,
      errorMessage: "",
    });
    void this.loadFirstPage("initial");
  },

  handlePreviousMonth(): void {
    this.changeMonth(
      shiftYearMonth(
        { year: this.data.selectedYear, month: this.data.selectedMonth },
        -1,
      ),
    );
  },

  handleNextMonth(): void {
    if (!this.data.canSelectNextMonth) return;
    this.changeMonth(
      shiftYearMonth(
        { year: this.data.selectedYear, month: this.data.selectedMonth },
        1,
      ),
    );
  },

  handleMonthPickerChange(event): void {
    const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(event.detail.value);
    if (match === null) return;
    this.changeMonth({ year: Number(match[1]), month: Number(match[2]) });
  },

  handleRetry(): void {
    void this.loadFirstPage(
      this.data.items.length > 0 ? "refresh" : "initial",
    );
  },

  handleLoadMoreRetry(): void {
    if (this.data.loadStatus !== "loadMoreError") return;
    this.setData({ loadStatus: "ready", errorMessage: "" });
    void this.loadMore();
  },

  handleFilterChange(event): void {
    const filter = event.currentTarget.dataset.filter;
    if (
      (filter !== "all" && filter !== "expense" && filter !== "income") ||
      filter === this.data.selectedFilter
    ) {
      return;
    }
    this.setData({
      selectedFilter: filter,
      selectedFilterLabel:
        filter === "all" ? "收支" : filter === "expense" ? "支出" : "收入",
      categoryFilterId: "",
      categoryFilterName: "",
      requestVersion: this.data.requestVersion + 1,
      firstPageLoading: false,
      items: [],
      groups: [],
      summary: null,
      monthIncomeDisplay: "",
      monthExpenseDisplay: "",
      monthBalanceDisplay: "",
      nextCursor: null,
      hasMore: false,
      errorMessage: "",
    });
    void this.loadFirstPage("initial");
  },

  handleClearCategoryFilter(): void {
    if (!this.data.categoryFilterId) return;
    this.setData({
      categoryFilterId: "",
      categoryFilterName: "",
      requestVersion: this.data.requestVersion + 1,
      firstPageLoading: false,
      items: [],
      groups: [],
      summary: null,
      nextCursor: null,
      hasMore: false,
    });
    void this.loadFirstPage("initial");
  },

  handleOpenStatistics(): void {
    wx.navigateTo({
      url: `/pages/statistics/index?year=${this.data.selectedYear}&month=${this.data.selectedMonth}`,
    });
  },

  handleAddTransaction(): void {
    wx.navigateTo({ url: "/pages/transaction-create/index" });
  },

  handleTransactionTap(event): void {
    const transactionId = event.currentTarget.dataset.id;
    if (typeof transactionId !== "string" || transactionId.length === 0) return;
    wx.navigateTo({
      url: `/pages/transaction-edit/index?transactionId=${encodeURIComponent(transactionId)}`,
    });
  },
});
