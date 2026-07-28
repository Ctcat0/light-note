import type { TodoDueKind, TodoPriority, TodoStatus } from "../../../../shared/types/todo";
import type { DefaultLocation } from "../../../../shared/types/user";

export interface HomeUserRecord {
  _id: string;
  openId: string;
  status: "active" | "disabled" | "deletion_pending" | "deleted";
}

export interface HomeSettingsRecord {
  _id: string;
  ownerId: string;
  timezone: string;
  defaultLocation: DefaultLocation | null;
  showWeather: boolean;
}

export interface HomeTodoRecord {
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
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface HomeTodoQueryResult {
  todayTotal: number;
  todayCompleted: number;
  overdueCount: number;
  items: HomeTodoRecord[];
}

export interface HomeStore {
  findUserByOpenId(openId: string): Promise<HomeUserRecord | null>;
  getSettingsByOwner(ownerId: string): Promise<HomeSettingsRecord | null>;
  sumTransactions(options: { ownerId: string; type: "income" | "expense"; startAt: Date; endAt: Date }): Promise<number>;
  getTodoOverview(options: { ownerId: string; dateKey: string; now: Date }): Promise<HomeTodoQueryResult>;
}
