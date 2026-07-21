function randomHex(length: number): string {
  let result = "";

  for (let index = 0; index < length; index += 1) {
    result += Math.floor(Math.random() * 16).toString(16);
  }

  return result;
}

export function createRequestId(): string {
  const timestamp = Date.now().toString(16).padStart(12, "0").slice(-12);

  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-a${randomHex(3)}-${timestamp}`;
}
