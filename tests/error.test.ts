import assert from "node:assert/strict";
import test from "node:test";

import { CLIENT_ERROR_CODES } from "../miniprogram/constants/errors";
import { parseApiResponse } from "../miniprogram/services/cloud";
import {
  AppError,
  normalizeError,
  toErrorViewModel,
} from "../miniprogram/utils/error";

test("保留已经标准化的应用错误", () => {
  const source = new AppError("RESOURCE_NOT_FOUND", "记录不存在", "req-1");

  assert.equal(normalizeError(source), source);
  assert.deepEqual(toErrorViewModel(source), {
    message: "记录不存在",
    requestId: "req-1",
  });
});

test("读取微信风格错误对象的 errMsg", () => {
  const result = normalizeError(
    { errMsg: "callFunction:fail timeout" },
    CLIENT_ERROR_CODES.NETWORK_ERROR,
  );

  assert.equal(result.code, "NETWORK_ERROR");
  assert.equal(result.message, "callFunction:fail timeout");
});

test("未知错误使用受控兜底文案", () => {
  const result = normalizeError(null);

  assert.equal(result.code, "UNKNOWN_ERROR");
  assert.equal(result.message, "操作未完成，请稍后重试");
});

test("流水列表和汇总错误码可通过统一云函数响应解析", () => {
  for (const code of [
    "INVALID_YEAR",
    "INVALID_MONTH",
    "INVALID_PAGE_SIZE",
    "INVALID_CURSOR",
    "TRANSACTION_LIST_FAILED",
    "TRANSACTION_SUMMARY_FAILED",
  ] as const) {
    const response = parseApiResponse({
      success: false,
      code,
      message: "受控错误",
      data: null,
      requestId: "11111111-1111-4111-a111-111111111111",
      serverTime: "2026-07-21T10:00:00.000Z",
    });
    assert.equal(response.code, code);
  }
});
