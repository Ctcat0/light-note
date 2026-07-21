export type EnvironmentName = "development" | "test" | "production";

export type MiniProgramEnvironmentVersion = "develop" | "trial" | "release";

export interface EnvironmentConfig {
  name: EnvironmentName;
  cloudEnvId: string;
  enableCloud: boolean;
}

import { environmentConfigurations } from "./environment.runtime";

export { environmentConfigurations };

export function resolveEnvironmentConfig(
  envVersion: MiniProgramEnvironmentVersion,
): EnvironmentConfig {
  if (envVersion === "release") {
    return environmentConfigurations.production;
  }

  if (envVersion === "trial") {
    return environmentConfigurations.test;
  }

  return environmentConfigurations.development;
}

export function getCurrentEnvironmentConfig(): EnvironmentConfig {
  const accountInfo = wx.getAccountInfoSync();
  const envVersion = accountInfo.miniProgram.envVersion;

  return resolveEnvironmentConfig(envVersion);
}

export function isDevelopmentDiagnosticsEnabled(): boolean {
  return wx.getAccountInfoSync().miniProgram.envVersion === "develop";
}
