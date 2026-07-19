import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type PromptBundle = {
  id: string;
  version: string;
  system: string;
  model: string;
  tools: string[];
};

type PromptMeta = {
  id?: unknown;
  version?: unknown;
  model?: unknown;
  tools?: unknown;
};

type CacheEntry = {
  mdMtimeMs: number;
  metaMtimeMs: number;
  bundle: PromptBundle;
};

export function createPromptLoader(input: {
  promptsRoot: string;
  defaultModel: string;
  /** 测试可注入 */
  readFile?: (abs: string) => string;
  statMtimeMs?: (abs: string) => number;
}): {
  load(id: string, version?: string): PromptBundle;
  clearCache(): void;
} {
  const readFile =
    input.readFile ?? ((abs: string) => fs.readFileSync(abs, "utf8"));
  const statMtimeMs =
    input.statMtimeMs ?? ((abs: string) => fs.statSync(abs).mtimeMs);
  const cache = new Map<string, CacheEntry>();

  function resolvePaths(id: string, version: string) {
    const slash = id.lastIndexOf("/");
    if (slash <= 0 || slash === id.length - 1) {
      throw new Error(`Invalid prompt id: ${id}`);
    }
    const dir = id.slice(0, slash);
    const name = id.slice(slash + 1);
    const base = `${name}.${version}`;
    return {
      mdPath: path.join(input.promptsRoot, dir, `${base}.md`),
      metaPath: path.join(input.promptsRoot, dir, `${base}.meta.yaml`),
    };
  }

  function parseMeta(raw: string, metaPath: string): PromptMeta {
    const parsed = parseYaml(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid prompt meta: ${metaPath}`);
    }
    return parsed as PromptMeta;
  }

  function normalizeTools(tools: unknown, metaPath: string): string[] {
    if (tools === undefined || tools === null) {
      return [];
    }
    if (
      !Array.isArray(tools) ||
      !tools.every((t): t is string => typeof t === "string")
    ) {
      throw new Error(`Invalid tools in prompt meta: ${metaPath}`);
    }
    return tools;
  }

  function load(id: string, version = "v1"): PromptBundle {
    const { mdPath, metaPath } = resolvePaths(id, version);
    const cacheKey = `${id}@${version}`;
    const mdMtimeMs = statMtimeMs(mdPath);
    const metaMtimeMs = statMtimeMs(metaPath);
    const cached = cache.get(cacheKey);
    if (
      cached &&
      cached.mdMtimeMs === mdMtimeMs &&
      cached.metaMtimeMs === metaMtimeMs
    ) {
      return cached.bundle;
    }

    const system = readFile(mdPath);
    const meta = parseMeta(readFile(metaPath), metaPath);
    const tools = normalizeTools(meta.tools, metaPath);
    const model =
      typeof meta.model === "string" && meta.model.length > 0
        ? meta.model
        : input.defaultModel;

    const bundle: PromptBundle = {
      id: typeof meta.id === "string" && meta.id.length > 0 ? meta.id : id,
      version:
        typeof meta.version === "string" && meta.version.length > 0
          ? meta.version
          : version,
      system,
      model,
      tools,
    };
    cache.set(cacheKey, { mdMtimeMs, metaMtimeMs, bundle });
    return bundle;
  }

  return {
    load,
    clearCache() {
      cache.clear();
    },
  };
}
