import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, "..");
const localEnvPath = resolve(workspaceRoot, ".env.local");
const outputPath = resolve(
  workspaceRoot,
  "miniprogram/config/environment.runtime.ts",
);

function parseEnvFile(contents) {
  const values = new Map();

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`环境配置行格式无效：${rawLine}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  return values;
}

const localValues = existsSync(localEnvPath)
  ? parseEnvFile(readFileSync(localEnvPath, "utf8"))
  : new Map();

function readEnvironmentId(key) {
  const value = process.env[key] ?? localValues.get(key) ?? "";

  if (value.length > 0 && !/^[A-Za-z0-9-]+$/u.test(value)) {
    throw new Error(`${key} 只能包含字母、数字和连字符`);
  }

  return value;
}

const developmentId = readEnvironmentId("CLOUD_ENV_ID_DEVELOPMENT");
const testId = readEnvironmentId("CLOUD_ENV_ID_TEST");
const productionId = readEnvironmentId("CLOUD_ENV_ID_PRODUCTION");

const generatedSource = `import type { EnvironmentConfig, EnvironmentName } from "./environment";

// 此文件由 \`npm run configure:env\` 生成并被 Git 忽略，请勿手工提交。
export const environmentConfigurations: Readonly<
  Record<EnvironmentName, EnvironmentConfig>
> = {
  development: {
    name: "development",
    cloudEnvId: ${JSON.stringify(developmentId)},
    enableCloud: true,
  },
  test: {
    name: "test",
    cloudEnvId: ${JSON.stringify(testId)},
    enableCloud: true,
  },
  production: {
    name: "production",
    cloudEnvId: ${JSON.stringify(productionId)},
    enableCloud: true,
  },
};
`;

writeFileSync(outputPath, generatedSource, "utf8");
console.log("CloudBase 前端环境配置已生成");
