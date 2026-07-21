import assert from "node:assert/strict";
import test from "node:test";

import { CLIENT_ERROR_CODES } from "../miniprogram/constants/errors";
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

