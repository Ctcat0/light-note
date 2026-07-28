interface LocationFailure {
  errMsg?: unknown;
}

export function isLocationPermissionDenied(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const message = (error as LocationFailure).errMsg;
  if (typeof message !== "string") return false;
  return /auth deny|not authorized|permission denied|privacy permission/u.test(message.toLowerCase());
}
