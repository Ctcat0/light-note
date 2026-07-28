import type {
  TodoListRecord,
  TodoRecord,
  TodoStore,
  TodoTransactionStore,
  TodoUserRecord,
  TodoSettingsRecord,
} from "../domain/types";

interface QueryResult { data: unknown[] }
interface DocumentResult { data: unknown }
interface CloudQuery {
  where(query: unknown): CloudQuery;
  orderBy(field: string, direction: "asc" | "desc"): CloudQuery;
  limit(limit: number): CloudQuery;
  get(): Promise<QueryResult>;
}
interface CloudDocument {
  get(): Promise<DocumentResult>;
  set(options: { data: Record<string, unknown> }): Promise<unknown>;
  update(options: { data: Record<string, unknown> }): Promise<unknown>;
}
interface CloudCollection extends CloudQuery { doc(id: string): CloudDocument }
interface CloudTransaction { collection(name: string): CloudCollection }
interface CloudCommand {
  eq(value: unknown): unknown;
  lt(value: unknown): unknown;
  lte(value: unknown): unknown;
  gt(value: unknown): unknown;
  in(values: unknown[]): unknown;
  and(...values: unknown[]): unknown;
  or(...values: unknown[]): unknown;
}
export interface CloudDatabase {
  command: CloudCommand;
  collection(name: string): CloudCollection;
  runTransaction<T>(operation: (transaction: CloudTransaction) => Promise<T>, retries?: number): Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function isMissing(error: unknown): boolean {
  const code = isRecord(error) ? error.errCode ?? error.code : undefined;
  const message = error instanceof Error ? error.message : isRecord(error) ? String(error.errMsg ?? error.message ?? "") : "";
  return code === -502005 || code === "-502005" || /document.*(?:not exist|not found)|-502005/i.test(message);
}
function read<T>(data: unknown): T | null {
  if (Array.isArray(data)) return data[0] === undefined ? null : data[0] as T;
  return data === null || data === undefined ? null : data as T;
}
function withoutId<T extends { _id: string }>(record: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== "_id"));
}
async function getDocument<T>(source: CloudTransaction | CloudDatabase, collection: string, id: string): Promise<T | null> {
  try { return read<T>((await source.collection(collection).doc(id).get()).data); }
  catch (error) { if (isMissing(error)) return null; throw error; }
}
function adapter(transaction: CloudTransaction): TodoTransactionStore {
  return {
    getTodo: (id) => getDocument<TodoRecord>(transaction, "todos", id),
    createTodo: async (record) => { await transaction.collection("todos").doc(record._id).set({ data: withoutId(record) }); },
    updateTodo: async (record) => { await transaction.collection("todos").doc(record._id).update({ data: withoutId(record) }); },
    getTodoList: (id) => getDocument<TodoListRecord>(transaction, "todo_lists", id),
    createTodoList: async (record) => { await transaction.collection("todo_lists").doc(record._id).set({ data: withoutId(record) }); },
  };
}

export function createCloudBaseTodoStore(database: CloudDatabase): TodoStore {
  const command = database.command;
  return {
    async findUserByOpenId(openId) {
      const result = await database.collection("users").where({ openId }).limit(1).get();
      return result.data[0] === undefined ? null : result.data[0] as TodoUserRecord;
    },
    async getSettingsByOwner(ownerId) {
      const result = await database.collection("user_settings").where({ ownerId }).limit(1).get();
      return result.data[0] === undefined ? null : result.data[0] as TodoSettingsRecord;
    },
    getTodo: (todoId) => getDocument<TodoRecord>(database, "todos", todoId),
    async listTodoLists(ownerId, includeDisabled) {
      const filter: Record<string, unknown> = { ownerId };
      if (!includeDisabled) filter.isEnabled = true;
      const result = await database.collection("todo_lists").where(filter).orderBy("sortOrder", "asc").orderBy("_id", "asc").limit(50).get();
      return result.data as TodoListRecord[];
    },
    async listTodos(options) {
      const base: Record<string, unknown> = { ownerId: options.ownerId, isDeleted: false };
      if (options.listId !== null) base.listId = options.listId;
      if (options.priority !== null) base.priority = options.priority;
      const clauses: unknown[] = [base];
      if (options.view === "today") clauses.push({ dueDateKey: options.todayDateKey });
      if (options.view === "upcoming") clauses.push(
        { status: command.in(["pending", "doing"]) },
        { dueDateKey: command.gt(options.todayDateKey) },
        { dueDateKey: command.lte(options.upcomingEndDateKey) },
      );
      if (options.view === "completed") clauses.push({ status: "completed" });
      if (options.view === "overdue") clauses.push({ status: command.in(["pending", "doing"]) }, command.or(
        { dueKind: "date", dueDateKey: command.lt(options.todayDateKey) },
        { dueKind: "datetime", dueAt: command.lt(options.now) },
      ));
      if (options.cursor !== null) clauses.push(command.or(
        { createdAt: command.lt(options.cursor.createdAt) },
        { createdAt: command.eq(options.cursor.createdAt), _id: command.lt(options.cursor.todoId) },
      ));
      const result = await database.collection("todos").where(command.and(...clauses)).orderBy("createdAt", "desc").orderBy("_id", "desc").limit(options.limit).get();
      return result.data as TodoRecord[];
    },
    runTransaction: <T>(operation: (transaction: TodoTransactionStore) => Promise<T>) => database.runTransaction((transaction) => operation(adapter(transaction)), 3),
  };
}
