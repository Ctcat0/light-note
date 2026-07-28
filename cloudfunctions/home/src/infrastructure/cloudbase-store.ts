import type {
  HomeSettingsRecord,
  HomeStore,
  HomeTodoRecord,
  HomeUserRecord,
} from "../domain/types";

interface QueryResult { data: unknown[] }
interface CountResult { total: number }
interface AggregateResult { list: unknown[] }
interface CloudQuery {
  where(query: unknown): CloudQuery;
  orderBy(field: string, direction: "asc" | "desc"): CloudQuery;
  limit(limit: number): CloudQuery;
  get(): Promise<QueryResult>;
  count(): Promise<CountResult>;
}
interface CloudAggregate {
  match(query: unknown): CloudAggregate;
  group(options: Record<string, unknown>): CloudAggregate;
  end(): Promise<AggregateResult>;
}
interface CloudCollection extends CloudQuery { aggregate(): CloudAggregate }
interface CloudCommand {
  and(...values: unknown[]): unknown;
  gte(value: unknown): { and(condition: unknown): unknown };
  lt(value: unknown): unknown;
  in(values: unknown[]): unknown;
  or(...values: unknown[]): unknown;
  aggregate: { sum(field: string | number): unknown };
}
export interface CloudDatabase {
  command: CloudCommand;
  collection(name: string): CloudCollection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createCloudBaseHomeStore(database: CloudDatabase): HomeStore {
  const command = database.command;
  return {
    async findUserByOpenId(openId) {
      const result = await database.collection("users").where({ openId }).limit(1).get();
      return result.data[0] === undefined ? null : result.data[0] as HomeUserRecord;
    },
    async getSettingsByOwner(ownerId) {
      const result = await database.collection("user_settings").where({ ownerId }).limit(1).get();
      return result.data[0] === undefined ? null : result.data[0] as HomeSettingsRecord;
    },
    async sumTransactions(options) {
      const result = await database.collection("transactions").aggregate().match({
        ownerId: options.ownerId,
        isDeleted: false,
        type: options.type,
        status: "active",
        occurredAt: command.gte(options.startAt).and(command.lt(options.endAt)),
      }).group({ _id: null, total: command.aggregate.sum("$amountInCents") }).end();
      const first = result.list[0];
      return isRecord(first) && typeof first.total === "number" ? first.total : 0;
    },
    async getTodoOverview(options) {
      const todayBase = { ownerId: options.ownerId, isDeleted: false, dueDateKey: options.dateKey };
      const pendingStatuses = command.in(["pending", "doing"]);
      const overdueFilter = command.and(
        { ownerId: options.ownerId, isDeleted: false, status: pendingStatuses },
        command.or(
          { dueKind: "date", dueDateKey: command.lt(options.dateKey) },
          { dueKind: "datetime", dueAt: command.lt(options.now) },
        ),
      );
      const [todayTotal, todayCompleted, overdueCount, todayItems, overdueItems] = await Promise.all([
        database.collection("todos").where(todayBase).count(),
        database.collection("todos").where({ ...todayBase, status: "completed" }).count(),
        database.collection("todos").where(overdueFilter).count(),
        database.collection("todos").where({ ...todayBase, status: pendingStatuses }).orderBy("createdAt", "desc").orderBy("_id", "desc").limit(5).get(),
        database.collection("todos").where(overdueFilter).orderBy("createdAt", "desc").orderBy("_id", "desc").limit(5).get(),
      ]);
      const records = [...overdueItems.data, ...todayItems.data] as HomeTodoRecord[];
      const unique = [...new Map(records.map((item) => [item._id, item])).values()].slice(0, 5);
      return { todayTotal: todayTotal.total, todayCompleted: todayCompleted.total, overdueCount: overdueCount.total, items: unique };
    },
  };
}
