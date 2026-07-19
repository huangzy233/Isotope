import fs from "node:fs";
import path from "node:path";
import type { Sandbox } from "@isotope/sandbox";
import { SandboxBuildError } from "@isotope/sandbox";
import type {
  PreviewAsset,
  PreviewService,
  PreviewStatusSnapshot,
  ResolveProjectPaths,
  OnBuildComplete,
} from "../domain/types.js";

const MAX_ERROR_BYTES = 2048;
const DEFAULT_STALE_BUILDING_MS = 300_000;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function statusPath(workspaceDir: string): string {
  return path.join(path.dirname(workspaceDir), "preview-status.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

function idleSnapshot(): PreviewStatusSnapshot {
  return {
    status: "idle",
    revision: null,
    error: null,
    updatedAt: nowIso(),
  };
}

function readStatusFile(filePath: string): PreviewStatusSnapshot | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as PreviewStatusSnapshot;
    return raw;
  } catch {
    return null;
  }
}

function writeStatus(filePath: string, snapshot: PreviewStatusSnapshot): void {
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
}

function isStaleBuilding(
  snapshot: PreviewStatusSnapshot,
  staleBuildingMs: number,
): boolean {
  if (snapshot.status !== "building") return false;
  const updated = Date.parse(snapshot.updatedAt);
  if (Number.isNaN(updated)) return true;
  return Date.now() - updated > staleBuildingMs;
}

function resolveSafePath(rootDir: string, relativePath: string): string | null {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function formatError(err: unknown): string {
  let text: string;
  if (err instanceof SandboxBuildError) {
    text = err.logTail
      ? `${err.message}\n${err.logTail}`
      : err.message;
  } else if (err instanceof Error) {
    text = err.message;
  } else {
    text = String(err);
  }
  if (Buffer.byteLength(text, "utf8") <= MAX_ERROR_BYTES) return text;
  let truncated = text;
  while (Buffer.byteLength(truncated, "utf8") > MAX_ERROR_BYTES) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

export function createPreviewService(opts: {
  resolvePaths: ResolveProjectPaths;
  sandbox: Sandbox;
  buildTimeoutMs?: number;
  staleBuildingMs?: number;
  onBuildComplete?: OnBuildComplete;
}): PreviewService {
  const staleBuildingMs = opts.staleBuildingMs ?? DEFAULT_STALE_BUILDING_MS;
  let queue: Promise<void> = Promise.resolve();
  const active = new Set<string>();

  function notifyBuildComplete(
    projectId: string,
    result: {
      ok: boolean;
      revision: string | null;
      error: string | null;
    },
  ) {
    if (!opts.onBuildComplete) return;
    void Promise.resolve()
      .then(() => opts.onBuildComplete?.(projectId, result))
      .catch(() => {});
  }

  function schedule(projectId: string, job: () => Promise<void>) {
    active.add(projectId);
    // Swallow prior rejection so one failed build does not stall the serial queue.
    queue = queue
      .catch(() => {})
      .then(job)
      .finally(() => {
        active.delete(projectId);
      });
  }

  function pathsOrNull(projectId: string) {
    return opts.resolvePaths(projectId);
  }

  function getStatus(projectId: string): PreviewStatusSnapshot {
    const paths = pathsOrNull(projectId);
    if (!paths) return idleSnapshot();
    return readStatusFile(statusPath(paths.workspaceDir)) ?? idleSnapshot();
  }

  function isActivelyBuilding(projectId: string, snapshot: PreviewStatusSnapshot): boolean {
    if (active.has(projectId)) return true;
    return snapshot.status === "building" && !isStaleBuilding(snapshot, staleBuildingMs);
  }

  function startBuild(projectId: string): PreviewStatusSnapshot {
    const paths = pathsOrNull(projectId);
    if (!paths) return idleSnapshot();

    const file = statusPath(paths.workspaceDir);
    const building: PreviewStatusSnapshot = {
      status: "building",
      revision: readStatusFile(file)?.revision ?? null,
      error: null,
      updatedAt: nowIso(),
    };
    writeStatus(file, building);

    schedule(projectId, async () => {
      try {
        await opts.sandbox.build({
          workspaceDir: paths.workspaceDir,
          buildDir: paths.buildDir,
          timeoutMs: opts.buildTimeoutMs,
        });
        const revision = Date.now().toString(36);
        writeStatus(file, {
          status: "ready",
          revision,
          error: null,
          updatedAt: nowIso(),
        });
        notifyBuildComplete(projectId, {
          ok: true,
          revision,
          error: null,
        });
      } catch (err) {
        const error = formatError(err);
        const revision = readStatusFile(file)?.revision ?? null;
        writeStatus(file, {
          status: "failed",
          revision,
          error,
          updatedAt: nowIso(),
        });
        notifyBuildComplete(projectId, {
          ok: false,
          revision,
          error,
        });
      }
    });

    return building;
  }

  function ensureBuild(projectId: string): PreviewStatusSnapshot {
    const paths = pathsOrNull(projectId);
    if (!paths) return idleSnapshot();

    const snapshot = getStatus(projectId);
    if (snapshot.status === "ready") return snapshot;
    if (isActivelyBuilding(projectId, snapshot)) return snapshot;
    return startBuild(projectId);
  }

  function enqueueBuild(projectId: string): PreviewStatusSnapshot {
    const paths = pathsOrNull(projectId);
    if (!paths) return idleSnapshot();

    const snapshot = getStatus(projectId);
    if (isActivelyBuilding(projectId, snapshot)) return snapshot;
    return startBuild(projectId);
  }

  function readAsset(projectId: string, relativePath: string): PreviewAsset | null {
    const paths = pathsOrNull(projectId);
    if (!paths) return null;

    const snapshot = getStatus(projectId);
    if (snapshot.status !== "ready") return null;

    const rel = relativePath || "index.html";
    const target = resolveSafePath(paths.buildDir, rel);
    if (!target) return null;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;

    return {
      body: fs.readFileSync(target),
      contentType: contentTypeFor(target),
    };
  }

  return { getStatus, ensureBuild, enqueueBuild, readAsset };
}
