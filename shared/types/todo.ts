export type TodoStatus = "pending" | "doing" | "completed" | "cancelled";

export type TodoPriority = "high" | "medium" | "low" | "none";

export type TodoDueKind = "none" | "date" | "datetime";

export type TodoView = "today" | "upcoming" | "all" | "completed" | "overdue";

export type TodoDueInput =
  | { dueKind: "none" }
  | { dueKind: "date"; dueDateKey: string }
  | { dueKind: "datetime"; dueAt: string };

export interface Todo {
  todoId: string;
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  listId: string;
  dueKind: TodoDueKind;
  dueDateKey: string | null;
  dueAt: string | null;
  completedAt: string | null;
  isOverdue: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TodoList {
  listId: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
  isEnabled: boolean;
  version: number;
}

export type CreateTodoRequest = {
  title: string;
  description: string | null;
  priority: TodoPriority;
  listId: string;
} & TodoDueInput;

export type TodoChanges = {
  title?: string;
  description?: string | null;
  priority?: TodoPriority;
  listId?: string;
  due?: TodoDueInput;
};

export interface UpdateTodoRequest {
  todoId: string;
  expectedVersion: number;
  changes: TodoChanges;
}

export interface SetTodoStatusRequest {
  todoId: string;
  expectedVersion: number;
  status: TodoStatus;
}

export interface DeleteTodoRequest {
  todoId: string;
  expectedVersion: number;
}

export interface DeleteTodoResult {
  todoId: string;
  deletedAt: string;
  version: number;
}

export interface GetTodoRequest {
  todoId: string;
}

export interface GetTodoResult {
  todo: Todo;
}

export interface ListTodosRequest {
  view: TodoView;
  listId?: string | null;
  priority?: TodoPriority | null;
  cursor: string | null;
  limit: number;
}

export interface ListTodosResult {
  items: Todo[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
  todayDateKey: string;
}

export interface ListTodoListsRequest {
  includeDisabled: boolean;
}

export interface ListTodoListsResult {
  items: TodoList[];
}
