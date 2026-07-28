import { createHash } from "node:crypto";
import type {
  CreateTodoRequest,
  DeleteTodoRequest,
  DeleteTodoResult,
  GetTodoResult,
  ListTodoListsResult,
  ListTodosRequest,
  ListTodosResult,
  SetTodoStatusRequest,
  Todo,
  TodoChanges,
  TodoDueInput,
  TodoList,
  TodoPriority,
  TodoStatus,
  UpdateTodoRequest,
} from "../../../../shared/types/todo";
import { createDefaultTodoListId, createTodoId } from "../domain/ids";
import type {
  TodoListRecord,
  TodoRecord,
  TodoSettingsRecord,
  TodoStore,
  TodoTransactionStore,
  TodoUserRecord,
} from "../domain/types";
import { TodoError } from "../domain/types";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE_STATUSES: readonly TodoStatus[] = ["pending", "doing"];

function toDate(value: Date | string): Date {
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime())) throw new TodoError("INTERNAL_ERROR", "待办时间数据无效");
  return result;
}

function dateKeyFor(value: Date, timeZone: string): string {
  try {
    const parts = new Map(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value).map((part) => [part.type, part.value] as const));
    const year = parts.get("year");
    const month = parts.get("month");
    const day = parts.get("day");
    if (!year || !month || !day) throw new Error("missing date parts");
    return `${year}-${month}-${day}`;
  } catch {
    throw new TodoError("INTERNAL_ERROR", "用户时区配置无效");
  }
}

function shiftDateKey(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return shifted.toISOString().slice(0, 10);
}

function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return date.toISOString().slice(0, 10) === value;
}

function parseDue(input: TodoDueInput, timeZone: string): {
  dueKind: TodoDueInput["dueKind"];
  dueDateKey: string | null;
  dueAt: Date | null;
} {
  if (input.dueKind === "none") return { dueKind: "none", dueDateKey: null, dueAt: null };
  if (input.dueKind === "date") {
    if (!isValidDateKey(input.dueDateKey)) throw new TodoError("TODO_DUE_INVALID", "截止日期无效");
    return { dueKind: "date", dueDateKey: input.dueDateKey, dueAt: null };
  }
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(input.dueAt)) {
    throw new TodoError("TODO_DUE_INVALID", "截止时间无效");
  }
  return { dueKind: "datetime", dueDateKey: dateKeyFor(dueAt, timeZone), dueAt };
}

function normalizeTitle(value: string): string {
  const title = value.trim();
  if (title.length === 0) throw new TodoError("TODO_TITLE_REQUIRED", "请输入待办标题");
  if (title.length > 100) throw new TodoError("TODO_TITLE_TOO_LONG", "待办标题不能超过 100 字");
  return title;
}

function normalizeDescription(value: string | null): string | null {
  if (value === null) return null;
  const description = value.trim();
  if (description.length > 500) throw new TodoError("TODO_DESCRIPTION_TOO_LONG", "待办描述不能超过 500 字");
  return description.length === 0 ? null : description;
}

function fingerprint(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isOverdue(record: TodoRecord, now: Date, todayDateKey: string): boolean {
  if (!ACTIVE_STATUSES.includes(record.status)) return false;
  if (record.dueKind === "date") return record.dueDateKey !== null && record.dueDateKey < todayDateKey;
  if (record.dueKind === "datetime") return record.dueAt !== null && toDate(record.dueAt).getTime() < now.getTime();
  return false;
}

function toTodo(record: TodoRecord, now: Date, todayDateKey: string): Todo {
  return {
    todoId: record._id,
    title: record.title,
    description: record.description,
    status: record.status,
    priority: record.priority,
    listId: record.listId,
    dueKind: record.dueKind,
    dueDateKey: record.dueDateKey,
    dueAt: record.dueAt === null ? null : toDate(record.dueAt).toISOString(),
    completedAt: record.completedAt === null ? null : toDate(record.completedAt).toISOString(),
    isOverdue: isOverdue(record, now, todayDateKey),
    version: record.version,
    createdAt: toDate(record.createdAt).toISOString(),
    updatedAt: toDate(record.updatedAt).toISOString(),
  };
}

function toTodoList(record: TodoListRecord): TodoList {
  return {
    listId: record._id,
    name: record.name,
    icon: record.icon,
    sortOrder: record.sortOrder,
    isDefault: record.isDefault,
    isEnabled: record.isEnabled,
    version: record.version,
  };
}

async function requireEnabledList(transaction: TodoTransactionStore, ownerId: string, listId: string): Promise<void> {
  const list = await transaction.getTodoList(listId);
  if (list === null || list.ownerId !== ownerId) throw new TodoError("TODO_LIST_NOT_FOUND", "待办清单不存在");
  if (!list.isEnabled) throw new TodoError("TODO_LIST_DISABLED", "待办清单已停用");
}

async function requireOwnedTodo(transaction: TodoTransactionStore, ownerId: string, todoId: string): Promise<TodoRecord> {
  const todo = await transaction.getTodo(todoId);
  if (todo === null || todo.ownerId !== ownerId || todo.isDeleted) throw new TodoError("TODO_NOT_FOUND", "待办不存在或已删除");
  return todo;
}

export async function resolveTodoUser(openId: string | undefined, store: TodoStore): Promise<{ user: TodoUserRecord; settings: TodoSettingsRecord }> {
  if (!openId?.trim()) throw new TodoError("UNAUTHENTICATED", "无法获取有效的微信用户身份");
  const user = await store.findUserByOpenId(openId);
  if (user === null) throw new TodoError("USER_NOT_INITIALIZED", "请先完成用户初始化");
  if (user.status !== "active") throw new TodoError("USER_DISABLED", "当前用户不可用");
  const settings = await store.getSettingsByOwner(user._id);
  if (settings === null) throw new TodoError("USER_NOT_INITIALIZED", "用户设置尚未初始化");
  dateKeyFor(new Date(), settings.timezone);
  return { user, settings };
}

export async function ensureDefaultTodoList(ownerId: string, now: Date, store: TodoStore): Promise<TodoListRecord> {
  const listId = createDefaultTodoListId(ownerId);
  return store.runTransaction(async (transaction) => {
    const existing = await transaction.getTodoList(listId);
    if (existing !== null) {
      if (existing.ownerId !== ownerId) throw new TodoError("INTERNAL_ERROR", "默认清单归属异常");
      return existing;
    }
    const record: TodoListRecord = {
      _id: listId,
      ownerId,
      name: "默认清单",
      icon: "list",
      sortOrder: 0,
      isDefault: true,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await transaction.createTodoList(record);
    return record;
  });
}

export async function listTodoLists(ownerId: string, includeDisabled: boolean, now: Date, store: TodoStore): Promise<ListTodoListsResult> {
  await ensureDefaultTodoList(ownerId, now, store);
  const items = await store.listTodoLists(ownerId, includeDisabled);
  return { items: items.map(toTodoList) };
}

export async function createTodo(options: { ownerId: string; requestId: string; payload: CreateTodoRequest; settings: TodoSettingsRecord; now: Date; store: TodoStore }): Promise<Todo> {
  const title = normalizeTitle(options.payload.title);
  const description = normalizeDescription(options.payload.description);
  const due = parseDue(options.payload, options.settings.timezone);
  const todoId = createTodoId(options.ownerId, options.requestId);
  const createFingerprint = fingerprint({ title, description, priority: options.payload.priority, listId: options.payload.listId, ...due, dueAt: due.dueAt?.toISOString() ?? null });
  const record = await options.store.runTransaction(async (transaction) => {
    await requireEnabledList(transaction, options.ownerId, options.payload.listId);
    const existing = await transaction.getTodo(todoId);
    if (existing !== null) {
      if (existing.ownerId !== options.ownerId || existing.requestId !== options.requestId || existing.createFingerprint !== createFingerprint) {
        throw new TodoError("DUPLICATE_REQUEST", "requestId 已用于其他待办请求");
      }
      return existing;
    }
    const next: TodoRecord = {
      _id: todoId,
      ownerId: options.ownerId,
      title,
      description,
      status: "pending",
      priority: options.payload.priority,
      listId: options.payload.listId,
      ...due,
      completedAt: null,
      requestId: options.requestId,
      createFingerprint,
      isDeleted: false,
      deletedAt: null,
      createdAt: options.now,
      updatedAt: options.now,
      version: 1,
    };
    await transaction.createTodo(next);
    return next;
  });
  return toTodo(record, options.now, dateKeyFor(options.now, options.settings.timezone));
}

export async function getTodo(options: { ownerId: string; todoId: string; settings: TodoSettingsRecord; now: Date; store: TodoStore }): Promise<GetTodoResult> {
  const record = await options.store.getTodo(options.todoId);
  if (record === null || record.ownerId !== options.ownerId || record.isDeleted) throw new TodoError("TODO_NOT_FOUND", "待办不存在或已删除");
  return { todo: toTodo(record, options.now, dateKeyFor(options.now, options.settings.timezone)) };
}

function mutationAlreadyApplied(record: TodoRecord, requestId: string, value: string): boolean {
  return record.lastMutationRequestId === requestId && record.lastMutationFingerprint === value;
}

export async function updateTodo(options: { ownerId: string; requestId: string; payload: UpdateTodoRequest; settings: TodoSettingsRecord; now: Date; store: TodoStore }): Promise<Todo> {
  const mutationFingerprint = fingerprint(options.payload);
  const record = await options.store.runTransaction(async (transaction) => {
    const current = await requireOwnedTodo(transaction, options.ownerId, options.payload.todoId);
    if (mutationAlreadyApplied(current, options.requestId, mutationFingerprint)) return current;
    if (current.version !== options.payload.expectedVersion) throw new TodoError("VERSION_CONFLICT", "待办已更新，请刷新后重试");
    const changes: TodoChanges = options.payload.changes;
    if (changes.listId !== undefined) await requireEnabledList(transaction, options.ownerId, changes.listId);
    const due = changes.due === undefined ? {} : parseDue(changes.due, options.settings.timezone);
    const next: TodoRecord = {
      ...current,
      ...(changes.title === undefined ? {} : { title: normalizeTitle(changes.title) }),
      ...(changes.description === undefined ? {} : { description: normalizeDescription(changes.description) }),
      ...(changes.priority === undefined ? {} : { priority: changes.priority }),
      ...(changes.listId === undefined ? {} : { listId: changes.listId }),
      ...due,
      updatedAt: options.now,
      version: current.version + 1,
      lastMutationRequestId: options.requestId,
      lastMutationFingerprint: mutationFingerprint,
    };
    await transaction.updateTodo(next);
    return next;
  });
  return toTodo(record, options.now, dateKeyFor(options.now, options.settings.timezone));
}

export async function setTodoStatus(options: { ownerId: string; requestId: string; payload: SetTodoStatusRequest; settings: TodoSettingsRecord; now: Date; store: TodoStore }): Promise<Todo> {
  const mutationFingerprint = fingerprint(options.payload);
  const record = await options.store.runTransaction(async (transaction) => {
    const current = await requireOwnedTodo(transaction, options.ownerId, options.payload.todoId);
    if (mutationAlreadyApplied(current, options.requestId, mutationFingerprint)) return current;
    if (current.version !== options.payload.expectedVersion) throw new TodoError("VERSION_CONFLICT", "待办已更新，请刷新后重试");
    const next: TodoRecord = {
      ...current,
      status: options.payload.status,
      completedAt: options.payload.status === "completed" ? options.now : null,
      updatedAt: options.now,
      version: current.version + 1,
      lastMutationRequestId: options.requestId,
      lastMutationFingerprint: mutationFingerprint,
    };
    await transaction.updateTodo(next);
    return next;
  });
  return toTodo(record, options.now, dateKeyFor(options.now, options.settings.timezone));
}

export async function deleteTodo(options: { ownerId: string; requestId: string; payload: DeleteTodoRequest; now: Date; store: TodoStore }): Promise<DeleteTodoResult> {
  const mutationFingerprint = fingerprint(options.payload);
  const record = await options.store.runTransaction(async (transaction) => {
    const current = await transaction.getTodo(options.payload.todoId);
    if (current === null || current.ownerId !== options.ownerId) throw new TodoError("TODO_NOT_FOUND", "待办不存在或已删除");
    if (mutationAlreadyApplied(current, options.requestId, mutationFingerprint)) return current;
    if (current.isDeleted) throw new TodoError("TODO_NOT_FOUND", "待办不存在或已删除");
    if (current.version !== options.payload.expectedVersion) throw new TodoError("VERSION_CONFLICT", "待办已更新，请刷新后重试");
    const next: TodoRecord = {
      ...current,
      isDeleted: true,
      deletedAt: options.now,
      updatedAt: options.now,
      version: current.version + 1,
      lastMutationRequestId: options.requestId,
      lastMutationFingerprint: mutationFingerprint,
    };
    await transaction.updateTodo(next);
    return next;
  });
  return { todoId: record._id, deletedAt: toDate(record.deletedAt ?? options.now).toISOString(), version: record.version };
}

export async function listTodos(options: { ownerId: string; payload: ListTodosRequest; settings: TodoSettingsRecord; now: Date; store: TodoStore }): Promise<ListTodosResult> {
  const todayDateKey = dateKeyFor(options.now, options.settings.timezone);
  const records = await options.store.listTodos({
    ownerId: options.ownerId,
    view: options.payload.view,
    listId: options.payload.listId ?? null,
    priority: options.payload.priority ?? null,
    todayDateKey,
    upcomingEndDateKey: shiftDateKey(todayDateKey, 7),
    now: options.now,
    limit: options.payload.limit + 1,
    cursor: decodeCursor(options.payload.cursor, options.payload),
  });
  const hasMore = records.length > options.payload.limit;
  const visible = records.slice(0, options.payload.limit);
  const last = visible[visible.length - 1];
  return {
    items: visible.map((record) => toTodo(record, options.now, todayDateKey)),
    pagination: {
      limit: options.payload.limit,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last, options.payload) : null,
    },
    todayDateKey,
  };
}

function encodeCursor(record: TodoRecord, request: ListTodosRequest): string {
  return Buffer.from(JSON.stringify({ c: toDate(record.createdAt).toISOString(), i: record._id, v: request.view, l: request.listId ?? null, p: request.priority ?? null }), "utf8").toString("base64url");
}

function decodeCursor(value: string | null, request: ListTodosRequest): { createdAt: Date; todoId: string } | null {
  if (value === null) return null;
  if (value.length === 0 || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TodoError("INVALID_CURSOR", "分页游标无效");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const createdAt = new Date(String(parsed.c));
    if (Number.isNaN(createdAt.getTime()) || typeof parsed.i !== "string" || parsed.v !== request.view || parsed.l !== (request.listId ?? null) || parsed.p !== (request.priority ?? null)) throw new Error("cursor mismatch");
    return { createdAt, todoId: parsed.i };
  } catch {
    throw new TodoError("INVALID_CURSOR", "分页游标无效");
  }
}

export function isTodoPriority(value: unknown): value is TodoPriority {
  return value === "high" || value === "medium" || value === "low" || value === "none";
}

export function isTodoStatus(value: unknown): value is TodoStatus {
  return value === "pending" || value === "doing" || value === "completed" || value === "cancelled";
}
