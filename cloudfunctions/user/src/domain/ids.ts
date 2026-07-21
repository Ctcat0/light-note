import { createHash } from "node:crypto";

function stableId(prefix: string, source: string): string {
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 24);

  return `${prefix}_${digest}`;
}

export function createUserId(openId: string): string {
  return stableId("usr", openId);
}

export function createSettingsId(ownerId: string): string {
  return stableId("set", ownerId);
}

export function createCategoryId(
  ownerId: string,
  type: string,
  systemKey: string,
): string {
  return stableId("cat", `${ownerId}:${type}:${systemKey}`);
}

export function createAccountId(ownerId: string, systemKey: string): string {
  return stableId("acc", `${ownerId}:${systemKey}`);
}
