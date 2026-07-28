import { createHash } from "node:crypto";

export function createDeletionRequestId(ownerId: string): string {
  return `del_${createHash("sha256").update(ownerId).digest("hex").slice(0, 28)}`;
}
