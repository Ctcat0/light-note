import { createHash } from "node:crypto";

export function createTransactionId(
  ownerId: string,
  requestId: string,
): string {
  const digest = createHash("sha256")
    .update(`${ownerId}\0${requestId}`)
    .digest("hex")
    .slice(0, 32);

  return `txn_${digest}`;
}
