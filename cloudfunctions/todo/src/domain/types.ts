import type { ApiErrorCode } from "../../../../shared/types/api";
import type {
  TodoDueKind,
  TodoPriority,
  TodoStatus,
  TodoView,
} from "../../../../shared/types/todo";

export interface TodoUserRecord {
  _id: string;
  openId: string;
  status: "active" | "disabled" | "deletion_pending" | "deleted";
}

export interface TodoSettingsRecord {
  _id: string;
  ownerId: string;
  timezone: string;
}

export interface TodoListRecord {
  _id: string;
  ownerId: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface TodoRecord {
  _id: string;
  ownerId: string;
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  listId: string;
  dueKind: TodoDueKind;
  dueDateKey: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  requestId: string;
  createFingerprint: string;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  lastMutationRequestId?: string;
  lastMutationFingerprint?: string;
}

export interface TodoTransactionStore {
  getTodo(todoId: string): Promise<TodoRecord | null>;
  createTodo(todo: TodoRecord): Promise<void>;
  updateTodo(todo: TodoRecord): Promise<void>;
  getTodoList(listId: string): Promise<TodoListRecord | null>;
  createTodoList(list: TodoListRecord): Promise<void>;
}

export interface TodoStore {
  findUserByOpenId(openId: string): Promise<TodoUserRecord | null>;
  getSettingsByOwner(ownerId: string): Promise<TodoSettingsRecord | null>;
  getTodo(todoId: string): Promise<TodoRecord | null>;
  listTodoLists(ownerId: string, includeDisabled: boolean): Promise<TodoListRecord[]>;
  listTodos(options: {
    ownerId: string;
    view: TodoView;
    listId: string | null;
    priority: TodoPriority | null;
    todayDateKey: string;
    upcomingEndDateKey: string;
    now: Date;
    limit: number;
    cursor: { createdAt: Date; todoId: string } | null;
  }): Promise<TodoRecord[]>;
  runTransaction<T>(operation: (transaction: TodoTransactionStore) => Promise<T>): Promise<T>;
}

export class TodoError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "TodoError";
    this.code = code;
  }
}
