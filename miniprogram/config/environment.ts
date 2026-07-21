export type EnvironmentName = "development" | "test" | "production";

export interface EnvironmentConfig {
  name: EnvironmentName;
  cloudEnvId: string;
  enableCloud: boolean;
}

/**
 * CloudBase 环境 ID 不是密钥，但应按开发、测试、生产环境分别配置。
 * 天气 API Key 等服务端密钥禁止添加到本文件或任何小程序前端文件。
 */
export const environment: EnvironmentConfig = {
  name: "development",
  cloudEnvId: "cloud1-d1gs4h1yj714bd6bc",
  enableCloud: true,
};

