import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDate,
  formatDateTime,
} from "../miniprogram/utils/date";

test("按 Asia/Shanghai 格式化跨 UTC 日界线的时间", () => {
  const instant = "2026-07-20T16:30:00.000Z";

  assert.equal(formatDate(instant), "2026-07-21");
  assert.equal(formatDateTime(instant), "2026-07-21 00:30");
});

test("支持显式 UTC 时区", () => {
  assert.equal(
    formatDateTime("2026-07-20T16:30:00.000Z", "UTC"),
    "2026-07-20 16:30",
  );
});

test("拒绝非法日期和时区", () => {
  assert.throws(() => formatDate("not-a-date"), /日期格式无效/);
  assert.throws(
    () => formatDate("2026-07-20T00:00:00.000Z", "Invalid/Timezone"),
    /时区或日期格式无效/,
  );
});

