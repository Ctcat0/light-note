import assert from "node:assert/strict";
import test from "node:test";

import { formatAmountInCents } from "../miniprogram/utils/money";

test("金额按整数分格式化为人民币", () => {
  assert.equal(formatAmountInCents(0), "¥0.00");
  assert.equal(formatAmountInCents(1), "¥0.01");
  assert.equal(formatAmountInCents(1234), "¥12.34");
  assert.equal(formatAmountInCents(-1234), "-¥12.34");
});

test("可以隐藏货币符号", () => {
  assert.equal(
    formatAmountInCents(1234, { showCurrencySymbol: false }),
    "12.34",
  );
});

test("拒绝浮点数和非安全整数金额", () => {
  assert.throws(() => formatAmountInCents(12.34), /安全整数/);
  assert.throws(
    () => formatAmountInCents(Number.MAX_SAFE_INTEGER + 1),
    /安全整数/,
  );
});

