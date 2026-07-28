import { createHash } from "node:crypto";

function stableId(prefix: string, source: string): string {
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

export function createDefaultTodoListId(ownerId: string): string {
  return stableId("tdl", `${ownerId}:default`);
}

export function createTodoId(ownerId: string, requestId: string): string {
  return stableId("todo", `${ownerId}:${requestId}`);
}
