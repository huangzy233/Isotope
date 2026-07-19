import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export type LlmDefaultConfig = {
  defaultModel: string;
  maxToolRounds: number;
  timeoutMs?: number;
};

export type LlmProviderConfig = {
  id: string;
  type: "openai-compatible";
  baseUrl: string;
  apiKeyEnv: string;
  timeoutMs: number;
  models: string[];
};

type CacheEntry = { mtimeMs: number; data: unknown };

const cache = new Map<string, CacheEntry>();

function readYamlCached(filePath: string): unknown {
  const mtimeMs = statSync(filePath).mtimeMs;
  const hit = cache.get(filePath);
  if (hit && hit.mtimeMs === mtimeMs) {
    return hit.data;
  }
  const data = parse(readFileSync(filePath, "utf8"));
  cache.set(filePath, { mtimeMs, data });
  return data;
}

export function clearLlmConfigCache(): void {
  cache.clear();
}

export function loadLlmDefaults(configDir: string): LlmDefaultConfig {
  const filePath = path.join(configDir, "default.yaml");
  const raw = readYamlCached(filePath) as LlmDefaultConfig;
  return {
    defaultModel: raw.defaultModel,
    maxToolRounds: raw.maxToolRounds,
    timeoutMs: raw.timeoutMs,
  };
}

export function loadLlmProviders(configDir: string): LlmProviderConfig[] {
  const providersDir = path.join(configDir, "providers");
  const files = readdirSync(providersDir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();

  const providers: LlmProviderConfig[] = [];
  const modelToProvider = new Map<string, string>();

  for (const file of files) {
    const filePath = path.join(providersDir, file);
    const raw = readYamlCached(filePath) as LlmProviderConfig;
    if (raw.type !== "openai-compatible") {
      throw new Error(
        `Unsupported LLM provider type in ${file}: ${String(raw.type)}`,
      );
    }
    for (const model of raw.models) {
      const existing = modelToProvider.get(model);
      if (existing) {
        throw new Error(
          `Duplicate model "${model}" in providers "${existing}" and "${raw.id}"`,
        );
      }
      modelToProvider.set(model, raw.id);
    }
    providers.push({
      id: raw.id,
      type: "openai-compatible",
      baseUrl: raw.baseUrl,
      apiKeyEnv: raw.apiKeyEnv,
      timeoutMs: raw.timeoutMs,
      models: [...raw.models],
    });
  }

  return providers;
}
