import type {
  TodoListRecord,
  TodoRecord,
  TodoSettingsRecord,
  TodoStore,
  TodoTransactionStore,
  TodoUserRecord,
} from "../../cloudfunctions/todo/src/domain/types";

function clone<T>(value: T): T { return structuredClone(value); }

export class InMemoryTodoStore implements TodoStore, TodoTransactionStore {
  readonly users = new Map<string, TodoUserRecord>();
  readonly settings = new Map<string, TodoSettingsRecord>();
  readonly lists = new Map<string, TodoListRecord>();
  readonly todos = new Map<string, TodoRecord>();
  failNextWrite = false;
  private queue: Promise<void> = Promise.resolve();

  async findUserByOpenId(openId: string): Promise<TodoUserRecord | null> {
    return [...this.users.values()].find((user) => user.openId === openId) ?? null;
  }
  async getSettingsByOwner(ownerId: string): Promise<TodoSettingsRecord | null> {
    return [...this.settings.values()].find((settings) => settings.ownerId === ownerId) ?? null;
  }
  async getTodo(todoId: string): Promise<TodoRecord | null> { return clone(this.todos.get(todoId) ?? null); }
  async getTodoList(listId: string): Promise<TodoListRecord | null> { return clone(this.lists.get(listId) ?? null); }
  async createTodo(todo: TodoRecord): Promise<void> {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error("simulated write failure"); }
    if (this.todos.has(todo._id)) throw new Error("duplicate todo");
    this.todos.set(todo._id, clone(todo));
  }
  async updateTodo(todo: TodoRecord): Promise<void> {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error("simulated write failure"); }
    if (!this.todos.has(todo._id)) throw new Error("missing todo");
    this.todos.set(todo._id, clone(todo));
  }
  async createTodoList(list: TodoListRecord): Promise<void> {
    if (this.lists.has(list._id)) throw new Error("duplicate list");
    this.lists.set(list._id, clone(list));
  }
  async listTodoLists(ownerId: string, includeDisabled: boolean): Promise<TodoListRecord[]> {
    return [...this.lists.values()].filter((item) => item.ownerId === ownerId && (includeDisabled || item.isEnabled)).sort((left, right) => left.sortOrder - right.sortOrder || left._id.localeCompare(right._id)).map(clone);
  }
  async listTodos(options: Parameters<TodoStore["listTodos"]>[0]): Promise<TodoRecord[]> {
    return [...this.todos.values()]
      .filter((item) => {
        if (item.ownerId !== options.ownerId || item.isDeleted) return false;
        if (options.listId !== null && item.listId !== options.listId) return false;
        if (options.priority !== null && item.priority !== options.priority) return false;
        if (options.view === "today" && item.dueDateKey !== options.todayDateKey) return false;
        if (options.view === "upcoming" && (!(["pending", "doing"] as string[]).includes(item.status) || item.dueDateKey === null || item.dueDateKey <= options.todayDateKey || item.dueDateKey > options.upcomingEndDateKey)) return false;
        if (options.view === "completed" && item.status !== "completed") return false;
        if (options.view === "overdue") {
          if (!(["pending", "doing"] as string[]).includes(item.status)) return false;
          const overdue = item.dueKind === "date" ? item.dueDateKey !== null && item.dueDateKey < options.todayDateKey : item.dueKind === "datetime" ? item.dueAt !== null && item.dueAt.getTime() < options.now.getTime() : false;
          if (!overdue) return false;
        }
        if (options.cursor !== null) {
          const time = item.createdAt.getTime();
          const cursorTime = options.cursor.createdAt.getTime();
          if (time > cursorTime || (time === cursorTime && item._id >= options.cursor.todoId)) return false;
        }
        return true;
      })
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right._id.localeCompare(left._id))
      .slice(0, options.limit)
      .map(clone);
  }
  runTransaction<T>(operation: (transaction: TodoTransactionStore) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const todos = clone(this.todos);
      const lists = clone(this.lists);
      try { return await operation(this); }
      catch (error) {
        this.todos.clear(); for (const [key, value] of todos) this.todos.set(key, value);
        this.lists.clear(); for (const [key, value] of lists) this.lists.set(key, value);
        throw error;
      }
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

export function seedTodoUser(store: InMemoryTodoStore, options: { userId?: string; openId?: string; status?: TodoUserRecord["status"] } = {}) {
  const userId = options.userId ?? "usr_todo_a";
  const openId = options.openId ?? "openid-todo-a";
  store.users.set(userId, { _id: userId, openId, status: options.status ?? "active" });
  store.settings.set(`settings_${userId}`, { _id: `settings_${userId}`, ownerId: userId, timezone: "Asia/Shanghai" });
  return { userId, openId };
}
