import assert from "node:assert/strict";
import test from "node:test";
import { createTodoService, parseTodo, parseTodoListResult } from "../miniprogram/services/todo";

const TODO = {
  todoId: "todo_1", title: "完成报告", description: null, status: "pending", priority: "high", listId: "list_1", dueKind: "date", dueDateKey: "2026-07-23", dueAt: null, completedAt: null, isOverdue: false, version: 1, createdAt: "2026-07-22T05:00:00.000Z", updatedAt: "2026-07-22T05:00:00.000Z",
};

test("todo service 创建请求保留调用方 requestId 且不发送身份字段", async () => {
  const calls: object[] = [];
  const service = createTodoService(async (options) => {
    calls.push(options);
    return { data: options.parseData(TODO), requestId: options.requestId, serverTime: TODO.updatedAt };
  });
  const result = await service.createTodo({ title: "完成报告", description: null, priority: "high", listId: "list_1", dueKind: "date", dueDateKey: "2026-07-23" }, "11111111-1111-4111-a111-111111111111");
  assert.equal(result.todoId, TODO.todoId);
  const serialized = JSON.stringify(calls[0]);
  assert.match(serialized, /11111111-1111-4111-a111-111111111111/);
  assert.doesNotMatch(serialized, /ownerId|openId|userId/);
});

test("todo service 严格校验 dueKind 组合和完成时间", () => {
  assert.throws(() => parseTodo({ ...TODO, dueKind: "none", dueDateKey: "2026-07-23" }), /不一致/);
  assert.throws(() => parseTodo({ ...TODO, status: "completed", completedAt: null }), /不一致/);
});

test("todo service 发送视图游标并校验分页一致性", async () => {
  const calls: object[] = [];
  const service = createTodoService(async (options) => {
    calls.push(options);
    return { data: options.parseData({ items: [TODO], pagination: { limit: 20, nextCursor: "cursor", hasMore: true }, todayDateKey: "2026-07-22" }), requestId: options.requestId, serverTime: TODO.updatedAt };
  });
  const result = await service.listTodos({ view: "upcoming", listId: null, priority: null, cursor: null, limit: 20 });
  assert.equal(result.items[0]?.todoId, TODO.todoId);
  assert.match(JSON.stringify(calls[0]), /"view":"upcoming"/);
  assert.throws(() => parseTodoListResult({ items: [], pagination: { limit: 20, nextCursor: null, hasMore: true }, todayDateKey: "2026-07-22" }), /不一致/);
});
