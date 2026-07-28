import assert from "node:assert/strict";
import test from "node:test";
import { createTodoFunctionHandler } from "../cloudfunctions/todo/src/application/handler";
import type { TodoRecord } from "../cloudfunctions/todo/src/domain/types";
import { InMemoryTodoStore, seedTodoUser } from "./helpers/in-memory-todo-store";

const NOW = new Date("2026-07-22T05:00:00.000Z");
const REQUEST_ID = "11111111-1111-4111-a111-111111111111";

function fixture() {
  const store = new InMemoryTodoStore();
  const user = seedTodoUser(store);
  const handler = createTodoFunctionHandler({ getOpenId: () => user.openId, getCurrentTime: () => new Date(NOW), store });
  return { store, user, handler };
}

async function defaultListId(value: ReturnType<typeof fixture>): Promise<string> {
  const response = await value.handler({ action: "listTodoLists", requestId: "22222222-2222-4222-a222-222222222222", payload: { includeDisabled: false } });
  assert.equal(response.success, true);
  if (!response.success || !("items" in response.data)) throw new Error("missing list");
  return response.data.items[0]?.listId ?? "";
}

async function createOne(value: ReturnType<typeof fixture>, due: object = { dueKind: "none" }) {
  const listId = await defaultListId(value);
  return value.handler({ action: "createTodo", requestId: REQUEST_ID, payload: { title: "  完成报告  ", description: "  补充数据  ", priority: "high", listId, ...due } });
}

test("首次读取会按用户创建唯一默认清单", async () => {
  const value = fixture();
  const first = await defaultListId(value);
  const second = await defaultListId(value);
  assert.equal(first, second);
  assert.equal(value.store.lists.size, 1);
  assert.equal([...value.store.lists.values()][0]?.ownerId, value.user.userId);
});

test("创建待办规范化字段并按 requestId 幂等", async () => {
  const value = fixture();
  const first = await createOne(value, { dueKind: "date", dueDateKey: "2026-07-23" });
  const second = await createOne(value, { dueKind: "date", dueDateKey: "2026-07-23" });
  assert.equal(first.success, true);
  assert.deepEqual(second, first);
  if (!first.success || !("title" in first.data)) return;
  assert.equal(first.data.title, "完成报告");
  assert.equal(first.data.description, "补充数据");
  assert.equal(first.data.dueAt, null);
  assert.equal(value.store.todos.size, 1);
});

test("相同 requestId 用于不同内容会被拒绝", async () => {
  const value = fixture();
  await createOne(value);
  const listId = await defaultListId(value);
  const response = await value.handler({ action: "createTodo", requestId: REQUEST_ID, payload: { title: "另一任务", description: null, priority: "none", listId, dueKind: "none" } });
  assert.equal(response.code, "DUPLICATE_REQUEST");
});

test("完成和撤销完成正确维护 completedAt 且重复请求安全", async () => {
  const value = fixture();
  const created = await createOne(value);
  if (!created.success || !("title" in created.data)) return;
  const completed = await value.handler({ action: "setTodoStatus", requestId: "33333333-3333-4333-a333-333333333333", payload: { todoId: created.data.todoId, expectedVersion: 1, status: "completed" } });
  assert.equal(completed.success, true);
  if (!completed.success || !("title" in completed.data)) return;
  assert.equal(completed.data.completedAt, NOW.toISOString());
  const repeated = await value.handler({ action: "setTodoStatus", requestId: "33333333-3333-4333-a333-333333333333", payload: { todoId: created.data.todoId, expectedVersion: 1, status: "completed" } });
  assert.deepEqual(repeated, completed);
  const undone = await value.handler({ action: "setTodoStatus", requestId: "44444444-4444-4444-a444-444444444444", payload: { todoId: created.data.todoId, expectedVersion: 2, status: "pending" } });
  assert.equal(undone.success, true);
  if (undone.success && "title" in undone.data) assert.equal(undone.data.completedAt, null);
});

test("编辑检查版本，删除为逻辑删除且不再出现在详情和列表", async () => {
  const value = fixture();
  const created = await createOne(value);
  if (!created.success || !("title" in created.data)) return;
  const conflict = await value.handler({ action: "updateTodo", requestId: "55555555-5555-4555-a555-555555555555", payload: { todoId: created.data.todoId, expectedVersion: 9, changes: { title: "冲突" } } });
  assert.equal(conflict.code, "VERSION_CONFLICT");
  const deleted = await value.handler({ action: "deleteTodo", requestId: "66666666-6666-4666-a666-666666666666", payload: { todoId: created.data.todoId, expectedVersion: 1 } });
  assert.equal(deleted.success, true);
  const repeated = await value.handler({ action: "deleteTodo", requestId: "66666666-6666-4666-a666-666666666666", payload: { todoId: created.data.todoId, expectedVersion: 1 } });
  assert.deepEqual(repeated, deleted);
  assert.equal(value.store.todos.get(created.data.todoId)?.isDeleted, true);
  const detail = await value.handler({ action: "getTodo", requestId: "77777777-7777-4777-a777-777777777777", payload: { todoId: created.data.todoId } });
  assert.equal(detail.code, "TODO_NOT_FOUND");
});

test("今日、近期和逾期视图遵守日期、时刻与无截止日期语义", async () => {
  const value = fixture();
  const listId = await defaultListId(value);
  const make = (id: string, dueKind: TodoRecord["dueKind"], dueDateKey: string | null, dueAt: Date | null, status: TodoRecord["status"] = "pending"): TodoRecord => ({
    _id: id, ownerId: value.user.userId, title: id, description: null, status, priority: "none", listId, dueKind, dueDateKey, dueAt, completedAt: status === "completed" ? NOW : null, requestId: id, createFingerprint: id, isDeleted: false, deletedAt: null, createdAt: new Date(`2026-07-${id === "today" ? "22" : "21"}T00:00:00.000Z`), updatedAt: NOW, version: 1,
  });
  value.store.todos.set("today", make("today", "date", "2026-07-22", null));
  value.store.todos.set("upcoming", make("upcoming", "date", "2026-07-25", null));
  value.store.todos.set("old-date", make("old-date", "date", "2026-07-21", null));
  value.store.todos.set("old-time", make("old-time", "datetime", "2026-07-22", new Date("2026-07-22T04:00:00.000Z")));
  value.store.todos.set("none", make("none", "none", null, null));
  const query = async (view: string) => value.handler({ action: "listTodos", requestId: `88888888-8888-4888-a888-88888888888${view.length}`, payload: { view, cursor: null, limit: 20 } });
  const today = await query("today");
  const upcoming = await query("upcoming");
  const overdue = await query("overdue");
  assert.equal(today.success, true); assert.equal(upcoming.success, true); assert.equal(overdue.success, true);
  if (today.success && "todayDateKey" in today.data) assert.deepEqual(today.data.items.map((item) => item.todoId).sort(), ["old-time", "today"]);
  if (upcoming.success && "todayDateKey" in upcoming.data) assert.deepEqual(upcoming.data.items.map((item) => item.todoId), ["upcoming"]);
  if (overdue.success && "todayDateKey" in overdue.data) assert.deepEqual(overdue.data.items.map((item) => item.todoId).sort(), ["old-date", "old-time"]);
});

test("身份字段、跨用户资源和非法截止组合不会越权或落库", async () => {
  const value = fixture();
  const forged = await value.handler({ action: "listTodos", requestId: REQUEST_ID, ownerId: "forged", payload: { view: "all", cursor: null, limit: 20 } });
  assert.equal(forged.code, "INVALID_ARGUMENT");
  const listId = await defaultListId(value);
  const other = seedTodoUser(value.store, { userId: "usr_other", openId: "openid-other" });
  value.store.todos.set("todo_other", { _id: "todo_other", ownerId: other.userId, title: "他人任务", description: null, status: "pending", priority: "none", listId, dueKind: "none", dueDateKey: null, dueAt: null, completedAt: null, requestId: "seed", createFingerprint: "seed", isDeleted: false, deletedAt: null, createdAt: NOW, updatedAt: NOW, version: 1 });
  const cross = await value.handler({ action: "updateTodo", requestId: "99999999-9999-4999-a999-999999999999", payload: { todoId: "todo_other", expectedVersion: 1, changes: { title: "越权" } } });
  assert.equal(cross.code, "TODO_NOT_FOUND");
  const invalidDue = await value.handler({ action: "createTodo", requestId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", payload: { title: "非法日期", description: null, priority: "none", listId, dueKind: "date", dueDateKey: "2026-02-30", dueAt: NOW.toISOString() } });
  assert.equal(invalidDue.code, "TODO_DUE_INVALID");
});
