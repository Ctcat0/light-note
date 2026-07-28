import { todoService } from "../../services/todo";
import type { Todo, TodoList, TodoView } from "../../types/todo";
import { formatDateTime } from "../../utils/date";
import { normalizeError } from "../../utils/error";
import { createRequestId } from "../../utils/request-id";

const PAGE_SIZE = 20;

interface TodoItemView extends Todo {
  dueLabel: string;
  priorityLabel: string;
  priorityClass: string;
  statusLabel: string;
  completed: boolean;
}

interface TodoPageData {
  viewState: "loading" | "ready" | "empty" | "error";
  errorMessage: string;
  views: Array<{ value: TodoView; label: string }>;
  selectedView: TodoView;
  todoLists: TodoList[];
  listFilterOptions: Array<{ listId: string; name: string }>;
  selectedListIndex: number;
  items: TodoItemView[];
  nextCursor: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: string;
  mutatingTodoId: string;
  initialized: boolean;
  requestVersion: number;
  timeZone: string;
}

interface TodoPageMethods {
  loadFirstPage(): Promise<void>;
  loadMore(): Promise<void>;
  handleRetry(): void;
  handleLoadMoreRetry(): void;
  handleViewChange(event: { currentTarget: { dataset: { view?: string } } }): void;
  handleListFilterChange(event: { detail: { value: string } }): void;
  handleAdd(): void;
  handleEdit(event: { currentTarget: { dataset: { id?: string } } }): void;
  handleToggleStatus(event: { currentTarget: { dataset: { id?: string } } }): Promise<void>;
  handleDelete(event: { currentTarget: { dataset: { id?: string } } }): Promise<void>;
}

function toItemView(todo: Todo, timeZone: string): TodoItemView {
  const priorityLabels = { high: "高", medium: "中", low: "低", none: "无" } as const;
  const statusLabels = { pending: "待处理", doing: "进行中", completed: "已完成", cancelled: "已取消" } as const;
  let dueLabel = "无截止日期";
  if (todo.dueKind === "date" && todo.dueDateKey !== null) dueLabel = todo.dueDateKey;
  if (todo.dueKind === "datetime" && todo.dueAt !== null) dueLabel = formatDateTime(todo.dueAt, timeZone);
  return { ...todo, dueLabel, priorityLabel: priorityLabels[todo.priority], priorityClass: `priority-${todo.priority}`, statusLabel: statusLabels[todo.status], completed: todo.status === "completed" };
}

Page<TodoPageData, TodoPageMethods>({
  data: {
    viewState: "loading",
    errorMessage: "",
    views: [
      { value: "today", label: "今天" },
      { value: "upcoming", label: "近期" },
      { value: "all", label: "全部" },
      { value: "completed", label: "完成" },
      { value: "overdue", label: "逾期" },
    ],
    selectedView: "today",
    todoLists: [],
    listFilterOptions: [{ listId: "", name: "全部清单" }],
    selectedListIndex: 0,
    items: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    loadMoreError: "",
    mutatingTodoId: "",
    initialized: false,
    requestVersion: 0,
    timeZone: "Asia/Shanghai",
  },

  onShow(): void { void this.loadFirstPage(); },
  async onPullDownRefresh(): Promise<void> { try { await this.loadFirstPage(); } finally { wx.stopPullDownRefresh(); } },
  onReachBottom(): void { void this.loadMore(); },

  async loadFirstPage(): Promise<void> {
    const requestVersion = this.data.requestVersion + 1;
    this.setData({ requestVersion, viewState: this.data.initialized && this.data.items.length > 0 ? "ready" : "loading", errorMessage: "", loadMoreError: "" });
    try {
      const app = getApp<IAppOption>();
      if (app.globalData.userInitializationState !== "ready") await app.initializeUser();
      if (app.globalData.userInitializationState !== "ready" || app.globalData.userInitialization === null) throw new Error(app.globalData.userInitializationErrorMessage ?? "用户初始化失败");
      const timeZone = app.globalData.userInitialization.settings.timezone;
      const listsResult = await todoService.listTodoLists();
      if (requestVersion !== this.data.requestVersion) return;
      const selected = this.data.listFilterOptions[this.data.selectedListIndex]?.listId ?? "";
      const listFilterOptions = [{ listId: "", name: "全部清单" }, ...listsResult.items.map((item) => ({ listId: item.listId, name: item.name }))];
      let selectedListIndex = listFilterOptions.findIndex((item) => item.listId === selected);
      if (selectedListIndex < 0) selectedListIndex = 0;
      const result = await todoService.listTodos({ view: this.data.selectedView, listId: listFilterOptions[selectedListIndex]?.listId || null, priority: null, cursor: null, limit: PAGE_SIZE });
      if (requestVersion !== this.data.requestVersion) return;
      const items = result.items.map((item) => toItemView(item, timeZone));
      this.setData({ todoLists: listsResult.items, listFilterOptions, selectedListIndex, items, nextCursor: result.pagination.nextCursor, hasMore: result.pagination.hasMore, viewState: items.length === 0 ? "empty" : "ready", initialized: true, errorMessage: "", timeZone });
    } catch (error) {
      if (requestVersion !== this.data.requestVersion) return;
      const message = normalizeError(error).message;
      if (this.data.initialized && this.data.items.length > 0) {
        this.setData({ errorMessage: message, viewState: "ready" });
        wx.showToast({ title: message, icon: "none" });
      } else this.setData({ viewState: "error", errorMessage: message, initialized: true });
    }
  },

  async loadMore(): Promise<void> {
    if (!this.data.hasMore || this.data.loadingMore || this.data.nextCursor === null) return;
    this.setData({ loadingMore: true, loadMoreError: "" });
    try {
      const result = await todoService.listTodos({ view: this.data.selectedView, listId: this.data.listFilterOptions[this.data.selectedListIndex]?.listId || null, priority: null, cursor: this.data.nextCursor, limit: PAGE_SIZE });
      const known = new Set(this.data.items.map((item) => item.todoId));
      const items = [...this.data.items, ...result.items.filter((item) => !known.has(item.todoId)).map((item) => toItemView(item, this.data.timeZone))];
      this.setData({ items, nextCursor: result.pagination.nextCursor, hasMore: result.pagination.hasMore, loadingMore: false });
    } catch (error) { this.setData({ loadingMore: false, loadMoreError: normalizeError(error).message }); }
  },

  handleRetry(): void { void this.loadFirstPage(); },
  handleLoadMoreRetry(): void { void this.loadMore(); },
  handleViewChange(event): void {
    const view = event.currentTarget.dataset.view;
    if (view !== "today" && view !== "upcoming" && view !== "all" && view !== "completed" && view !== "overdue") return;
    this.setData({ selectedView: view, items: [], initialized: false, nextCursor: null, hasMore: false });
    void this.loadFirstPage();
  },
  handleListFilterChange(event): void {
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.listFilterOptions.length) return;
    this.setData({ selectedListIndex: index, items: [], initialized: false, nextCursor: null, hasMore: false });
    void this.loadFirstPage();
  },
  handleAdd(): void { void wx.navigateTo({ url: "/pages/todo-edit/index" }); },
  handleEdit(event): void { const id = event.currentTarget.dataset.id; if (id) void wx.navigateTo({ url: `/pages/todo-edit/index?todoId=${encodeURIComponent(id)}` }); },

  async handleToggleStatus(event): Promise<void> {
    const todo = this.data.items.find((item) => item.todoId === event.currentTarget.dataset.id);
    if (!todo || this.data.mutatingTodoId) return;
    this.setData({ mutatingTodoId: todo.todoId });
    try {
      await todoService.setTodoStatus({ todoId: todo.todoId, expectedVersion: todo.version, status: todo.completed ? "pending" : "completed" }, createRequestId());
      await this.loadFirstPage();
    } catch (error) { wx.showToast({ title: normalizeError(error).message, icon: "none" }); }
    finally { this.setData({ mutatingTodoId: "" }); }
  },

  async handleDelete(event): Promise<void> {
    const todo = this.data.items.find((item) => item.todoId === event.currentTarget.dataset.id);
    if (!todo || this.data.mutatingTodoId) return;
    const confirmation = await wx.showModal({ title: "删除待办", content: `确定删除“${todo.title}”吗？删除后不可在小程序内恢复。`, confirmText: "删除", confirmColor: "#b34040" });
    if (!confirmation.confirm) return;
    this.setData({ mutatingTodoId: todo.todoId });
    try {
      await todoService.deleteTodo({ todoId: todo.todoId, expectedVersion: todo.version }, createRequestId());
      wx.showToast({ title: "已删除", icon: "success" });
      await this.loadFirstPage();
    } catch (error) { wx.showToast({ title: normalizeError(error).message, icon: "none" }); }
    finally { this.setData({ mutatingTodoId: "" }); }
  },
});
