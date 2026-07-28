import type { ApiErrorCode, ApiResponse, CloudFunctionRequest } from "../../../../shared/types/api";
import type {
  CreateTodoRequest,
  DeleteTodoRequest,
  DeleteTodoResult,
  GetTodoRequest,
  GetTodoResult,
  ListTodoListsRequest,
  ListTodoListsResult,
  ListTodosRequest,
  ListTodosResult,
  SetTodoStatusRequest,
  Todo,
  TodoChanges,
  TodoDueInput,
  UpdateTodoRequest,
} from "../../../../shared/types/todo";
import type { TodoStore } from "../domain/types";
import { TodoError } from "../domain/types";
import {
  createTodo,
  deleteTodo,
  getTodo,
  isTodoPriority,
  isTodoStatus,
  listTodoLists,
  listTodos,
  resolveTodoUser,
  setTodoStatus,
  updateTodo,
} from "./todos";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TodoResponseData = Todo | GetTodoResult | DeleteTodoResult | ListTodosResult | ListTodoListsResult;

interface TodoFunctionDependencies {
  getOpenId(): string | undefined;
  getCurrentTime(): Date;
  store: TodoStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && keys.every((key) => allowed.includes(key));
}

function extractRequestId(event: unknown): string {
  return isRecord(event) && typeof event.requestId === "string" ? event.requestId.slice(0, 128) : `server-${Date.now().toString(36)}`;
}

function parseBase(event: unknown): CloudFunctionRequest<object> {
  if (!isRecord(event)) throw new TodoError("INVALID_ARGUMENT", "请求格式无效");
  if (["ownerId", "userId", "openId", "openid", "OPENID"].some((key) => Object.prototype.hasOwnProperty.call(event, key))) {
    throw new TodoError("INVALID_ARGUMENT", "请求包含不可信身份字段");
  }
  if (typeof event.action !== "string" || !isRecord(event.payload)) throw new TodoError("INVALID_ARGUMENT", "请求格式无效");
  if (typeof event.requestId !== "string" || !UUID_PATTERN.test(event.requestId)) throw new TodoError("REQUEST_ID_REQUIRED", "requestId 必须是 UUID");
  return { action: event.action, requestId: event.requestId, payload: event.payload };
}

function parseDue(value: Record<string, unknown>): TodoDueInput {
  if (value.dueKind === "none" && exact(value, ["dueKind"], ["dueKind"])) return { dueKind: "none" };
  if (value.dueKind === "date" && exact(value, ["dueKind", "dueDateKey"], ["dueKind", "dueDateKey"]) && typeof value.dueDateKey === "string") {
    return { dueKind: "date", dueDateKey: value.dueDateKey };
  }
  if (value.dueKind === "datetime" && exact(value, ["dueKind", "dueAt"], ["dueKind", "dueAt"]) && typeof value.dueAt === "string") {
    return { dueKind: "datetime", dueAt: value.dueAt };
  }
  throw new TodoError("TODO_DUE_INVALID", "截止日期参数无效");
}

function parseCreate(value: object): CreateTodoRequest {
  if (!isRecord(value) || typeof value.title !== "string" || (value.description !== null && typeof value.description !== "string") || !isTodoPriority(value.priority) || typeof value.listId !== "string") {
    throw new TodoError("INVALID_ARGUMENT", "待办新增参数无效");
  }
  const base = ["title", "description", "priority", "listId"];
  const dueRecord = Object.fromEntries(Object.entries(value).filter(([key]) => !base.includes(key)));
  const due = parseDue(dueRecord);
  if (!exact(value, [...base, ...Object.keys(dueRecord)], base)) throw new TodoError("INVALID_ARGUMENT", "待办新增参数无效");
  return { title: value.title, description: value.description, priority: value.priority, listId: value.listId, ...due };
}

function parseGet(value: object): GetTodoRequest {
  if (!isRecord(value) || !exact(value, ["todoId"], ["todoId"]) || typeof value.todoId !== "string" || !value.todoId.trim()) throw new TodoError("INVALID_ARGUMENT", "待办 ID 无效");
  return { todoId: value.todoId };
}

function parseExpectedVersion(value: Record<string, unknown>): number {
  if (typeof value.expectedVersion !== "number" || !Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1) throw new TodoError("INVALID_ARGUMENT", "待办版本无效");
  return value.expectedVersion;
}

function parseChanges(value: unknown): TodoChanges {
  if (!isRecord(value) || Object.keys(value).length === 0 || !exact(value, ["title", "description", "priority", "listId", "due"], [])) throw new TodoError("INVALID_ARGUMENT", "待办修改内容无效");
  const changes: TodoChanges = {};
  if (value.title !== undefined) {
    if (typeof value.title !== "string") throw new TodoError("INVALID_ARGUMENT", "待办标题无效");
    changes.title = value.title;
  }
  if (value.description !== undefined) {
    if (value.description !== null && typeof value.description !== "string") throw new TodoError("INVALID_ARGUMENT", "待办描述无效");
    changes.description = value.description;
  }
  if (value.priority !== undefined) {
    if (!isTodoPriority(value.priority)) throw new TodoError("INVALID_ARGUMENT", "待办优先级无效");
    changes.priority = value.priority;
  }
  if (value.listId !== undefined) {
    if (typeof value.listId !== "string" || !value.listId.trim()) throw new TodoError("INVALID_ARGUMENT", "待办清单无效");
    changes.listId = value.listId;
  }
  if (value.due !== undefined) {
    if (!isRecord(value.due)) throw new TodoError("TODO_DUE_INVALID", "截止日期参数无效");
    changes.due = parseDue(value.due);
  }
  return changes;
}

function parseUpdate(value: object): UpdateTodoRequest {
  if (!isRecord(value) || !exact(value, ["todoId", "expectedVersion", "changes"], ["todoId", "expectedVersion", "changes"]) || typeof value.todoId !== "string" || !value.todoId.trim()) throw new TodoError("INVALID_ARGUMENT", "待办更新参数无效");
  return { todoId: value.todoId, expectedVersion: parseExpectedVersion(value), changes: parseChanges(value.changes) };
}

function parseStatus(value: object): SetTodoStatusRequest {
  if (!isRecord(value) || !exact(value, ["todoId", "expectedVersion", "status"], ["todoId", "expectedVersion", "status"]) || typeof value.todoId !== "string" || !value.todoId.trim() || !isTodoStatus(value.status)) throw new TodoError("INVALID_ARGUMENT", "待办状态参数无效");
  return { todoId: value.todoId, expectedVersion: parseExpectedVersion(value), status: value.status };
}

function parseDelete(value: object): DeleteTodoRequest {
  if (!isRecord(value) || !exact(value, ["todoId", "expectedVersion"], ["todoId", "expectedVersion"]) || typeof value.todoId !== "string" || !value.todoId.trim()) throw new TodoError("INVALID_ARGUMENT", "待办删除参数无效");
  return { todoId: value.todoId, expectedVersion: parseExpectedVersion(value) };
}

function parseList(value: object): ListTodosRequest {
  if (!isRecord(value) || !exact(value, ["view", "listId", "priority", "cursor", "limit"], ["view", "cursor", "limit"])) throw new TodoError("INVALID_ARGUMENT", "待办列表参数无效");
  if (value.view !== "today" && value.view !== "upcoming" && value.view !== "all" && value.view !== "completed" && value.view !== "overdue") throw new TodoError("INVALID_ARGUMENT", "待办视图无效");
  if (value.listId !== undefined && value.listId !== null && (typeof value.listId !== "string" || !value.listId.trim())) throw new TodoError("INVALID_ARGUMENT", "待办清单筛选无效");
  if (value.priority !== undefined && value.priority !== null && !isTodoPriority(value.priority)) throw new TodoError("INVALID_ARGUMENT", "待办优先级筛选无效");
  if (value.cursor !== null && typeof value.cursor !== "string") throw new TodoError("INVALID_CURSOR", "分页游标无效");
  if (typeof value.limit !== "number" || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 50) throw new TodoError("INVALID_PAGE_SIZE", "limit 必须是 1 至 50 的整数");
  return { view: value.view, listId: typeof value.listId === "string" ? value.listId : null, priority: isTodoPriority(value.priority) ? value.priority : null, cursor: value.cursor, limit: value.limit };
}

function parseLists(value: object): ListTodoListsRequest {
  if (!isRecord(value) || !exact(value, ["includeDisabled"], ["includeDisabled"]) || typeof value.includeDisabled !== "boolean") throw new TodoError("INVALID_ARGUMENT", "待办清单参数无效");
  return { includeDisabled: value.includeDisabled };
}

function success(data: TodoResponseData, requestId: string, now: Date): ApiResponse<TodoResponseData> {
  return { success: true, code: "OK", message: "操作成功", data, requestId, serverTime: now.toISOString() };
}

function failure(code: ApiErrorCode, message: string, requestId: string, now: Date): ApiResponse<TodoResponseData> {
  return { success: false, code, message, data: null, requestId, serverTime: now.toISOString() };
}

export function createTodoFunctionHandler(dependencies: TodoFunctionDependencies): (event: unknown) => Promise<ApiResponse<TodoResponseData>> {
  return async (event) => {
    const now = dependencies.getCurrentTime();
    const fallbackRequestId = extractRequestId(event);
    try {
      const request = parseBase(event);
      const identity = await resolveTodoUser(dependencies.getOpenId(), dependencies.store);
      let data: TodoResponseData;
      switch (request.action) {
        case "createTodo":
          data = await createTodo({ ownerId: identity.user._id, requestId: request.requestId, payload: parseCreate(request.payload), settings: identity.settings, now, store: dependencies.store });
          break;
        case "getTodo":
          data = await getTodo({ ownerId: identity.user._id, todoId: parseGet(request.payload).todoId, settings: identity.settings, now, store: dependencies.store });
          break;
        case "updateTodo":
          data = await updateTodo({ ownerId: identity.user._id, requestId: request.requestId, payload: parseUpdate(request.payload), settings: identity.settings, now, store: dependencies.store });
          break;
        case "setTodoStatus":
          data = await setTodoStatus({ ownerId: identity.user._id, requestId: request.requestId, payload: parseStatus(request.payload), settings: identity.settings, now, store: dependencies.store });
          break;
        case "deleteTodo":
          data = await deleteTodo({ ownerId: identity.user._id, requestId: request.requestId, payload: parseDelete(request.payload), now, store: dependencies.store });
          break;
        case "listTodos":
          data = await listTodos({ ownerId: identity.user._id, payload: parseList(request.payload), settings: identity.settings, now, store: dependencies.store });
          break;
        case "listTodoLists":
          data = await listTodoLists(identity.user._id, parseLists(request.payload).includeDisabled, now, dependencies.store);
          break;
        default:
          throw new TodoError("INVALID_ARGUMENT", "未知的待办操作");
      }
      return success(data, request.requestId, now);
    } catch (error) {
      if (error instanceof TodoError) return failure(error.code, error.message, fallbackRequestId, now);
      const action = isRecord(event) && typeof event.action === "string" ? event.action : "";
      const mapping: Record<string, [ApiErrorCode, string]> = {
        createTodo: ["TODO_CREATE_FAILED", "待办保存失败，请稍后重试"],
        listTodos: ["TODO_LIST_FAILED", "待办列表加载失败，请稍后重试"],
        updateTodo: ["TODO_UPDATE_FAILED", "待办更新失败，请稍后重试"],
        setTodoStatus: ["TODO_UPDATE_FAILED", "待办状态更新失败，请稍后重试"],
        deleteTodo: ["TODO_DELETE_FAILED", "待办删除失败，请稍后重试"],
      };
      const [code, message] = mapping[action] ?? ["DEPENDENCY_ERROR", "待办服务暂时不可用，请稍后重试"];
      return failure(code, message, fallbackRequestId, now);
    }
  };
}
