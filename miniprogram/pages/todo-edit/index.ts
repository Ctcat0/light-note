import { todoService } from "../../services/todo";
import type { TodoDueInput, TodoList, TodoPriority } from "../../types/todo";
import { createIsoFromZonedDateTime, getDateTimeInputValues } from "../../utils/date";
import { normalizeError } from "../../utils/error";
import { createRequestId } from "../../utils/request-id";

interface TodoForm {
  title: string;
  description: string;
  priority: TodoPriority;
  listId: string;
  dueKind: "none" | "date" | "datetime";
  dateValue: string;
  timeValue: string;
}

interface TodoEditData {
  viewState: "loading" | "ready" | "error";
  errorMessage: string;
  todoId: string;
  expectedVersion: number;
  isEditing: boolean;
  todoLists: TodoList[];
  listIndex: number;
  priorityOptions: Array<{ value: TodoPriority; label: string }>;
  priorityIndex: number;
  dueKindOptions: Array<{ value: TodoForm["dueKind"]; label: string }>;
  dueKindIndex: number;
  form: TodoForm;
  titleError: string;
  submitErrorMessage: string;
  submitting: boolean;
  submissionRequestId: string;
  descriptionLength: number;
  timeZone: string;
}

interface InputEvent { detail: { value: string } }

interface TodoEditMethods {
  loadPage(): Promise<void>;
  handleRetry(): void;
  handleTitleInput(event: InputEvent): void;
  handleDescriptionInput(event: InputEvent): void;
  handlePriorityChange(event: InputEvent): void;
  handleListChange(event: InputEvent): void;
  handleDueKindChange(event: InputEvent): void;
  handleDateChange(event: InputEvent): void;
  handleTimeChange(event: InputEvent): void;
  handleSubmit(): Promise<void>;
  handleRetrySubmission(): void;
}

function initialForm(): TodoForm {
  const values = getDateTimeInputValues(new Date());
  return { title: "", description: "", priority: "none", listId: "", dueKind: "none", dateValue: values.dateValue, timeValue: values.timeValue };
}

Page<TodoEditData, TodoEditMethods>({
  data: {
    viewState: "loading",
    errorMessage: "",
    todoId: "",
    expectedVersion: 0,
    isEditing: false,
    todoLists: [],
    listIndex: 0,
    priorityOptions: [
      { value: "none", label: "无" },
      { value: "low", label: "低" },
      { value: "medium", label: "中" },
      { value: "high", label: "高" },
    ],
    priorityIndex: 0,
    dueKindOptions: [
      { value: "none", label: "无截止日期" },
      { value: "date", label: "按日期" },
      { value: "datetime", label: "具体时间" },
    ],
    dueKindIndex: 0,
    form: initialForm(),
    titleError: "",
    submitErrorMessage: "",
    submitting: false,
    submissionRequestId: "",
    descriptionLength: 0,
    timeZone: "Asia/Shanghai",
  },

  onLoad(options: Record<string, string | undefined>): void {
    const todoId = options.todoId ? decodeURIComponent(options.todoId) : "";
    this.setData({ todoId, isEditing: todoId.length > 0 });
    void this.loadPage();
  },

  async loadPage(): Promise<void> {
    this.setData({ viewState: "loading", errorMessage: "" });
    try {
      const app = getApp<IAppOption>();
      if (app.globalData.userInitializationState !== "ready") await app.initializeUser();
      if (app.globalData.userInitializationState !== "ready" || app.globalData.userInitialization === null) throw new Error(app.globalData.userInitializationErrorMessage ?? "用户初始化失败");
      const timeZone = app.globalData.userInitialization.settings.timezone;
      const lists = await todoService.listTodoLists();
      if (lists.items.length === 0) throw new Error("没有可用的待办清单");
      let form = { ...this.data.form, listId: lists.items.find((item) => item.isDefault)?.listId ?? lists.items[0]?.listId ?? "" };
      let expectedVersion = 0;
      let priorityIndex = this.data.priorityOptions.findIndex((item) => item.value === form.priority);
      let dueKindIndex = 0;
      let listIndex = lists.items.findIndex((item) => item.listId === form.listId);
      if (this.data.todoId) {
        const detail = await todoService.getTodo(this.data.todoId);
        const todo = detail.todo;
        const dateTime = todo.dueAt ? getDateTimeInputValues(todo.dueAt, timeZone) : null;
        form = {
          title: todo.title,
          description: todo.description ?? "",
          priority: todo.priority,
          listId: todo.listId,
          dueKind: todo.dueKind,
          dateValue: todo.dueDateKey ?? dateTime?.dateValue ?? getDateTimeInputValues(new Date(), timeZone).dateValue,
          timeValue: dateTime?.timeValue ?? "09:00",
        };
        expectedVersion = todo.version;
        priorityIndex = this.data.priorityOptions.findIndex((item) => item.value === todo.priority);
        dueKindIndex = this.data.dueKindOptions.findIndex((item) => item.value === todo.dueKind);
        listIndex = lists.items.findIndex((item) => item.listId === todo.listId);
      }
      this.setData({ viewState: "ready", todoLists: lists.items, listIndex: Math.max(0, listIndex), priorityIndex: Math.max(0, priorityIndex), dueKindIndex: Math.max(0, dueKindIndex), form, expectedVersion, descriptionLength: form.description.length, timeZone });
      wx.setNavigationBarTitle({ title: this.data.isEditing ? "编辑待办" : "新建待办" });
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: normalizeError(error).message });
    }
  },

  handleRetry(): void { void this.loadPage(); },
  handleTitleInput(event): void { this.setData({ "form.title": event.detail.value, titleError: "", submitErrorMessage: "", submissionRequestId: "" }); },
  handleDescriptionInput(event): void { this.setData({ "form.description": event.detail.value, descriptionLength: event.detail.value.length, submitErrorMessage: "", submissionRequestId: "" }); },
  handlePriorityChange(event): void {
    const index = Number(event.detail.value);
    const option = this.data.priorityOptions[index];
    if (option) this.setData({ priorityIndex: index, "form.priority": option.value, submitErrorMessage: "", submissionRequestId: "" });
  },
  handleListChange(event): void {
    const index = Number(event.detail.value);
    const list = this.data.todoLists[index];
    if (list) this.setData({ listIndex: index, "form.listId": list.listId, submitErrorMessage: "", submissionRequestId: "" });
  },
  handleDueKindChange(event): void {
    const index = Number(event.detail.value);
    const option = this.data.dueKindOptions[index];
    if (option) this.setData({ dueKindIndex: index, "form.dueKind": option.value, submitErrorMessage: "", submissionRequestId: "" });
  },
  handleDateChange(event): void { this.setData({ "form.dateValue": event.detail.value, submitErrorMessage: "", submissionRequestId: "" }); },
  handleTimeChange(event): void { this.setData({ "form.timeValue": event.detail.value, submitErrorMessage: "", submissionRequestId: "" }); },

  async handleSubmit(): Promise<void> {
    if (this.data.submitting) return;
    const title = this.data.form.title.trim();
    if (!title) { this.setData({ titleError: "请输入待办标题" }); return; }
    const due: TodoDueInput = this.data.form.dueKind === "none"
      ? { dueKind: "none" }
      : this.data.form.dueKind === "date"
        ? { dueKind: "date", dueDateKey: this.data.form.dateValue }
        : { dueKind: "datetime", dueAt: createIsoFromZonedDateTime(this.data.form.dateValue, this.data.form.timeValue, this.data.timeZone) };
    const requestId = this.data.submissionRequestId || createRequestId();
    this.setData({ submitting: true, submissionRequestId: requestId, submitErrorMessage: "", titleError: "" });
    try {
      if (this.data.isEditing) {
        await todoService.updateTodo({
          todoId: this.data.todoId,
          expectedVersion: this.data.expectedVersion,
          changes: { title, description: this.data.form.description, priority: this.data.form.priority, listId: this.data.form.listId, due },
        }, requestId);
      } else {
        await todoService.createTodo({ title, description: this.data.form.description, priority: this.data.form.priority, listId: this.data.form.listId, ...due }, requestId);
      }
      wx.showToast({ title: this.data.isEditing ? "已更新" : "已创建", icon: "success" });
      setTimeout(() => wx.navigateBack(), 350);
    } catch (error) {
      this.setData({ submitting: false, submitErrorMessage: normalizeError(error).message });
    }
  },

  handleRetrySubmission(): void { void this.handleSubmit(); },
});
