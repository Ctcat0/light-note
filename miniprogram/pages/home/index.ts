import { homeService, loadHomeSnapshot } from "../../services/home";
import { todoService } from "../../services/todo";
import type { HomeOverviewResult } from "../../types/home";
import type { PageViewState } from "../../types/page-state";
import type { Todo } from "../../types/todo";
import { formatDayLabel, formatTime, formatWeekdayLabel } from "../../utils/date";
import { normalizeError } from "../../utils/error";
import { formatAmountInCents } from "../../utils/money";
import { createRequestId } from "../../utils/request-id";

interface HomeTodoView extends Todo { dueDisplay: string }

interface HomePageData {
  viewState: PageViewState;
  errorMessage: string;
  refreshing: boolean;
  requestVersion: number;
  hasSnapshot: boolean;
  snapshotNotice: string;
  dateLabel: string;
  weatherAvailable: boolean;
  weatherMessage: string;
  weatherCity: string;
  weatherTemperature: string;
  weatherCondition: string;
  weatherRange: string;
  weatherUpdated: string;
  weatherStale: boolean;
  todosAvailable: boolean;
  todosMessage: string;
  todayTotal: number;
  todayCompleted: number;
  todayPending: number;
  overdueCount: number;
  todoItems: HomeTodoView[];
  updatingTodoId: string;
  ledgerAvailable: boolean;
  ledgerMessage: string;
  todayIncomeDisplay: string;
  todayExpenseDisplay: string;
  monthIncomeDisplay: string;
  monthExpenseDisplay: string;
  monthBalanceDisplay: string;
}

interface HomePageMethods {
  loadOverview(): Promise<void>;
  applyOverview(result: HomeOverviewResult, snapshot: boolean): void;
  handleRetry(): void;
  handleOpenWeather(): void;
  handleOpenTodo(): void;
  handleOpenLedger(): void;
  handleAddExpense(): void;
  handleAddIncome(): void;
  handleAddTodo(): void;
  handleCompleteTodo(event: WechatMiniprogram.TouchEvent): Promise<void>;
}

function money(value = 0): string { return formatAmountInCents(value); }
function dueDisplay(todo: Todo): string {
  if (todo.isOverdue) return "已逾期";
  if (todo.dueDateKey !== null) return todo.dueKind === "datetime" && todo.dueAt !== null ? `今天 ${formatTime(todo.dueAt)}` : "今天";
  return "";
}

Page<HomePageData, HomePageMethods>({
  data: {
    viewState: "loading",
    errorMessage: "",
    refreshing: false,
    requestVersion: 0,
    hasSnapshot: false,
    snapshotNotice: "",
    dateLabel: "今天",
    weatherAvailable: false,
    weatherMessage: "请先选择城市",
    weatherCity: "未选择城市",
    weatherTemperature: "--",
    weatherCondition: "--",
    weatherRange: "--",
    weatherUpdated: "--",
    weatherStale: false,
    todosAvailable: false,
    todosMessage: "待办摘要暂时不可用",
    todayTotal: 0,
    todayCompleted: 0,
    todayPending: 0,
    overdueCount: 0,
    todoItems: [],
    updatingTodoId: "",
    ledgerAvailable: false,
    ledgerMessage: "收支摘要暂时不可用",
    todayIncomeDisplay: money(),
    todayExpenseDisplay: money(),
    monthIncomeDisplay: money(),
    monthExpenseDisplay: money(),
    monthBalanceDisplay: money(),
  },

  onLoad(): void {
    const snapshot = loadHomeSnapshot();
    if (snapshot !== null) this.applyOverview(snapshot.data, true);
  },

  onShow(): void { void this.loadOverview(); },

  async onPullDownRefresh(): Promise<void> {
    try { await this.loadOverview(); } finally { wx.stopPullDownRefresh(); }
  },

  async loadOverview(): Promise<void> {
    if (this.data.refreshing) return;
    const version = this.data.requestVersion + 1;
    this.setData({ requestVersion: version, refreshing: true, ...(this.data.hasSnapshot ? {} : { viewState: "loading" }), errorMessage: "" });
    try {
      const app = getApp<IAppOption>();
      if (app.globalData.userInitializationState !== "ready") await app.initializeUser();
      const result = await homeService.getOverview();
      if (this.data.requestVersion !== version) return;
      this.applyOverview(result, false);
    } catch (error) {
      if (this.data.requestVersion !== version) return;
      const message = normalizeError(error).message;
      this.setData(this.data.hasSnapshot
        ? { snapshotNotice: `刷新失败，正在展示上次数据：${message}` }
        : { viewState: "error", errorMessage: message });
    } finally {
      if (this.data.requestVersion === version) this.setData({ refreshing: false });
    }
  },

  applyOverview(result, snapshot): void {
    const dateLabel = `${formatDayLabel(result.dateKey)} ${formatWeekdayLabel(result.dateKey)}`;
    const weather = result.weather.status === "success" ? result.weather.data : null;
    const today = weather?.daily[0];
    const todos = result.todos.status === "success" ? result.todos.data : null;
    const ledger = result.ledger.status === "success" ? result.ledger.data : null;
    this.setData({
      viewState: "ready",
      hasSnapshot: true,
      snapshotNotice: snapshot ? `正在展示 ${formatTime(result.generatedAt)} 的首页快照` : "",
      dateLabel,
      weatherAvailable: weather !== null,
      weatherMessage: result.weather.status === "unavailable" ? result.weather.message : "",
      weatherCity: weather?.location.displayName ?? "未选择城市",
      weatherTemperature: weather === null ? "--" : `${weather.current.temperatureCelsius}°`,
      weatherCondition: weather?.current.conditionText ?? "--",
      weatherRange: today === undefined ? "--" : `${today.minTemperatureCelsius}° / ${today.maxTemperatureCelsius}°`,
      weatherUpdated: weather === null ? "--" : formatTime(weather.fetchedAt),
      weatherStale: weather?.cacheStatus === "stale",
      todosAvailable: todos !== null,
      todosMessage: result.todos.status === "unavailable" ? result.todos.message : "",
      todayTotal: todos?.todayTotal ?? 0,
      todayCompleted: todos?.todayCompleted ?? 0,
      todayPending: todos?.todayPending ?? 0,
      overdueCount: todos?.overdueCount ?? 0,
      todoItems: (todos?.items ?? []).map((item) => ({ ...item, dueDisplay: dueDisplay(item) })),
      ledgerAvailable: ledger !== null,
      ledgerMessage: result.ledger.status === "unavailable" ? result.ledger.message : "",
      todayIncomeDisplay: money(ledger?.todayIncomeInCents),
      todayExpenseDisplay: money(ledger?.todayExpenseInCents),
      monthIncomeDisplay: money(ledger?.monthIncomeInCents),
      monthExpenseDisplay: money(ledger?.monthExpenseInCents),
      monthBalanceDisplay: money(ledger?.monthBalanceInCents),
      errorMessage: "",
    });
  },

  handleRetry(): void { void this.loadOverview(); },
  handleOpenWeather(): void { wx.navigateTo({ url: "/pages/weather/index" }); },
  handleOpenTodo(): void { wx.switchTab({ url: "/pages/todo/index" }); },
  handleOpenLedger(): void { wx.switchTab({ url: "/pages/ledger/index" }); },
  handleAddExpense(): void { wx.navigateTo({ url: "/pages/transaction-create/index?type=expense" }); },
  handleAddIncome(): void { wx.navigateTo({ url: "/pages/transaction-create/index?type=income" }); },
  handleAddTodo(): void { wx.navigateTo({ url: "/pages/todo-edit/index" }); },

  async handleCompleteTodo(event): Promise<void> {
    if (this.data.updatingTodoId) return;
    const todoId = String(event.currentTarget.dataset.id ?? "");
    const todo = this.data.todoItems.find((item) => item.todoId === todoId);
    if (!todo) return;
    this.setData({ updatingTodoId: todoId });
    try {
      await todoService.setTodoStatus({ todoId, expectedVersion: todo.version, status: "completed" }, createRequestId());
      await this.loadOverview();
    } catch (error) {
      wx.showToast({ title: normalizeError(error).message, icon: "none" });
    } finally { this.setData({ updatingTodoId: "" }); }
  },
});
