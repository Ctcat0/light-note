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
  TodoDueKind,
  TodoList,
  TodoPriority,
  TodoStatus,
  UpdateTodoRequest,
} from "../types/todo";
import { CLOUD_FUNCTIONS } from "../constants/cloud";
import {
  callCloudFunctionWithMetadata,
  type CloudCallOptions,
  type CloudCallResult,
} from "./cloud";
import { createRequestId } from "../utils/request-id";
import { isRecord } from "../utils/record";

type TodoTransport = <TPayload extends object, TData>(
  options: CloudCallOptions<TPayload, TData>,
) => Promise<CloudCallResult<TData>>;

function isStatus(value: unknown): value is TodoStatus {
  return value === "pending" || value === "doing" || value === "completed" || value === "cancelled";
}

function isPriority(value: unknown): value is TodoPriority {
  return value === "high" || value === "medium" || value === "low" || value === "none";
}

function isDueKind(value: unknown): value is TodoDueKind {
  return value === "none" || value === "date" || value === "datetime";
}

function isIsoOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(new Date(value).getTime()));
}

export function parseTodo(value: unknown): Todo {
  if (
    !isRecord(value) ||
    typeof value.todoId !== "string" ||
    typeof value.title !== "string" ||
    (value.description !== null && typeof value.description !== "string") ||
    !isStatus(value.status) ||
    !isPriority(value.priority) ||
    typeof value.listId !== "string" ||
    !isDueKind(value.dueKind) ||
    (value.dueDateKey !== null && typeof value.dueDateKey !== "string") ||
    !isIsoOrNull(value.dueAt) ||
    !isIsoOrNull(value.completedAt) ||
    typeof value.isOverdue !== "boolean" ||
    !Number.isSafeInteger(value.version) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) throw new Error("待办响应格式无效");
  if (
    (value.dueKind === "none" && (value.dueDateKey !== null || value.dueAt !== null)) ||
    (value.dueKind === "date" && (typeof value.dueDateKey !== "string" || value.dueAt !== null)) ||
    (value.dueKind === "datetime" && (typeof value.dueDateKey !== "string" || typeof value.dueAt !== "string")) ||
    (value.status === "completed") !== (value.completedAt !== null)
  ) throw new Error("待办响应数据不一致");
  return {
    todoId: value.todoId,
    title: value.title,
    description: value.description,
    status: value.status,
    priority: value.priority,
    listId: value.listId,
    dueKind: value.dueKind,
    dueDateKey: value.dueDateKey,
    dueAt: value.dueAt,
    completedAt: value.completedAt,
    isOverdue: value.isOverdue,
    version: value.version as number,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseTodoList(value: unknown): TodoList {
  if (!isRecord(value) || typeof value.listId !== "string" || typeof value.name !== "string" || (value.icon !== null && typeof value.icon !== "string") || !Number.isSafeInteger(value.sortOrder) || typeof value.isDefault !== "boolean" || typeof value.isEnabled !== "boolean" || !Number.isSafeInteger(value.version)) {
    throw new Error("待办清单响应格式无效");
  }
  return { listId: value.listId, name: value.name, icon: value.icon, sortOrder: value.sortOrder as number, isDefault: value.isDefault, isEnabled: value.isEnabled, version: value.version as number };
}

function parseGet(value: unknown): GetTodoResult {
  if (!isRecord(value)) throw new Error("待办详情响应格式无效");
  return { todo: parseTodo(value.todo) };
}

export function parseTodoListResult(value: unknown): ListTodosResult {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.pagination) || !Number.isSafeInteger(value.pagination.limit) || typeof value.pagination.hasMore !== "boolean" || (value.pagination.nextCursor !== null && typeof value.pagination.nextCursor !== "string") || typeof value.todayDateKey !== "string") {
    throw new Error("待办列表响应格式无效");
  }
  if ((value.pagination.hasMore && value.pagination.nextCursor === null) || (!value.pagination.hasMore && value.pagination.nextCursor !== null)) throw new Error("待办分页响应不一致");
  return { items: value.items.map(parseTodo), pagination: { limit: value.pagination.limit as number, hasMore: value.pagination.hasMore, nextCursor: value.pagination.nextCursor }, todayDateKey: value.todayDateKey };
}

function parseTodoLists(value: unknown): ListTodoListsResult {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("待办清单响应格式无效");
  return { items: value.items.map(parseTodoList) };
}

function parseDelete(value: unknown): DeleteTodoResult {
  if (!isRecord(value) || typeof value.todoId !== "string" || typeof value.deletedAt !== "string" || Number.isNaN(new Date(value.deletedAt).getTime()) || !Number.isSafeInteger(value.version)) throw new Error("待办删除响应格式无效");
  return { todoId: value.todoId, deletedAt: value.deletedAt, version: value.version as number };
}

export function createTodoService(transport: TodoTransport = callCloudFunctionWithMetadata) {
  return {
    async listTodoLists(): Promise<ListTodoListsResult> {
      const result = await transport({ functionName: CLOUD_FUNCTIONS.TODO, action: "listTodoLists", requestId: createRequestId(), payload: { includeDisabled: false }, parseData: parseTodoLists });
      return result.data;
    },
    async listTodos(payload: ListTodosRequest): Promise<ListTodosResult> {
      const result = await transport({ functionName: CLOUD_FUNCTIONS.TODO, action: "listTodos", requestId: createRequestId(), payload, parseData: parseTodoListResult });
      return result.data;
    },
    async getTodo(todoId: string): Promise<GetTodoResult> {
      const result = await transport({ functionName: CLOUD_FUNCTIONS.TODO, action: "getTodo", requestId: createRequestId(), payload: { todoId }, parseData: parseGet });
      return result.data;
    },
    async createTodo(payload: CreateTodoRequest, requestId: string): Promise<Todo> {
      const result = await transport({ functionName: CLOUD_FUNCTIONS.TODO, action: "createTodo", requestId, payload, parseData: parseTodo });
      return result.data;
    },
    async updateTodo(payload: UpdateTodoRequest, requestId: string): Promise<Todo> {
      const result = await transport({ functionName: CLOUD_FUNCTIONS.TODO, action: "updateTodo", requestId, payload, parseData: parseTodo });
      return result.data;
    },
    async setTodoStatus(payload: SetTodoStatusRequest, requestId: string): Promise<Todo> {
      const result = await transport({ functionName: CLOUD_FUNCTIONS.TODO, action: "setTodoStatus", requestId, payload, parseData: parseTodo });
      return result.data;
    },
    async deleteTodo(payload: DeleteTodoRequest, requestId: string): Promise<DeleteTodoResult> {
      const result = await transport({ functionName: CLOUD_FUNCTIONS.TODO, action: "deleteTodo", requestId, payload, parseData: parseDelete });
      return result.data;
    },
  };
}

export const todoService = createTodoService();
