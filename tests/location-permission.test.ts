import assert from "node:assert/strict";
import test from "node:test";
import { isLocationPermissionDenied } from "../miniprogram/utils/location-permission";

test("定位权限错误可以与普通定位失败区分", () => {
  assert.equal(isLocationPermissionDenied({ errMsg: "getLocation:fail auth deny" }), true);
  assert.equal(isLocationPermissionDenied({ errMsg: "getLocation:fail:system permission denied" }), true);
  assert.equal(isLocationPermissionDenied({ errMsg: "getLocation:fail privacy permission is not authorized" }), true);
  assert.equal(isLocationPermissionDenied({ errMsg: "getLocation:fail timeout" }), false);
  assert.equal(isLocationPermissionDenied(null), false);
});
