import assert from "node:assert/strict";
import test from "node:test";
import {
  createDataDeletionService,
  parseDeletionRequest,
} from "../miniprogram/services/data-deletion";

const SUMMARY = {
  status: "pending",
  requestedAt: "2026-07-28T08:00:00.000Z",
  cooldownEndsAt: "2026-08-04T08:00:00.000Z",
  cancelledAt: null,
  processingStartedAt: null,
  completedAt: null,
  failedAt: null,
  canCancel: true,
  version: 1,
} as const;

test("删除申请 service 不发送身份字段并复用调用方 requestId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const service = createDataDeletionService(async (options) => {
    calls.push(options as unknown as Record<string, unknown>);
    return {
      data: options.parseData({ request: SUMMARY, duplicate: false }),
      requestId: options.requestId,
      serverTime: SUMMARY.requestedAt,
    };
  });
  const result = await service.request(
    "40000000-0000-4000-8000-000000000001",
  );
  assert.equal(result.request.status, "pending");
  assert.equal(
    calls[0]?.requestId,
    "40000000-0000-4000-8000-000000000001",
  );
  assert.equal(JSON.stringify(calls).includes("userId"), false);
  assert.equal(JSON.stringify(calls).includes("openId"), false);
});

test("删除申请 service 严格校验状态、时间和版本", () => {
  assert.throws(
    () => parseDeletionRequest({ ...SUMMARY, status: "unknown" }),
    /响应格式无效/u,
  );
  assert.throws(
    () => parseDeletionRequest({ ...SUMMARY, cooldownEndsAt: "bad" }),
    /响应格式无效/u,
  );
  assert.throws(
    () => parseDeletionRequest({ ...SUMMARY, version: 1.5 }),
    /响应格式无效/u,
  );
});
