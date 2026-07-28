export const CLOUD_FUNCTIONS = {
  USER: "user",
  LEDGER: "ledger",
  TODO: "todo",
  WEATHER: "weather",
  HOME: "home",
  DATA_DELETION: "dataDeletion",
} as const;

export type CloudFunctionName =
  (typeof CLOUD_FUNCTIONS)[keyof typeof CLOUD_FUNCTIONS];
