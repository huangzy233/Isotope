import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { parse } from "yaml";

export type WritePolicy = { allow: string[] };

/** Normalize a relative path for ACL matching. Returns null if unsafe/absolute. */
export function normalizePolicyPath(relativePath: string): string | null {
  const raw = relativePath.replace(/\\/g, "/");
  if (!raw || posix.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    return null;
  }

  const normalized = posix.normalize(raw);
  if (
    !normalized ||
    normalized === "." ||
    posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    return null;
  }

  return normalized.replace(/^\.\//, "");
}

function matchAllow(pattern: string, rel: string): boolean {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return rel === prefix || rel.startsWith(prefix + "/");
  }
  return rel === pattern;
}

export function isPathAllowed(policy: WritePolicy, relativePath: string): boolean {
  const rel = normalizePolicyPath(relativePath);
  if (rel === null) return false;
  return policy.allow.some((pattern) => matchAllow(pattern, rel));
}

export function loadWritePolicy(filePath: string): WritePolicy {
  const raw = parse(readFileSync(filePath, "utf8")) as { allow?: unknown };
  if (!raw || !Array.isArray(raw.allow)) {
    throw new Error(`Invalid write policy: ${filePath}`);
  }
  return { allow: raw.allow as string[] };
}

export function createWritePolicyPort<
  T extends { writeFile(path: string, content: string): void },
>(policy: WritePolicy, port: T): T {
  return {
    ...port,
    writeFile: (relativePath: string, content: string) => {
      const rel = normalizePolicyPath(relativePath);
      if (rel === null || !policy.allow.some((pattern) => matchAllow(pattern, rel))) {
        throw new Error(
          `不允许修改受保护文件：${relativePath}；请只改允许路径（如 src/）`,
        );
      }
      port.writeFile(rel, content);
    },
  };
}
