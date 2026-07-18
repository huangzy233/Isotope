import type { WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";
import { isNoisyWorkspacePath } from "./workspace-source-noise.js";

export const MAX_WORKSPACE_SOURCE_BYTES = 512 * 1024;

export type WorkspaceSourceFileReadResult =
  | { ok: true; path: string; content: string }
  | {
      ok: false;
      code: "invalid_path" | "not_found" | "not_text" | "too_large";
      message: string;
    };

export function readWorkspaceSourceFile(
  input: {
    ownerUserId: string;
    projectId: string;
    relativePath: string;
  },
  workspace: WorkspaceStore,
): WorkspaceSourceFileReadResult | null {
  if (!getProject(input, workspace)) {
    return null;
  }

  const relativePath = input.relativePath.replace(/^\/+/, "");
  if (!relativePath || isNoisyWorkspacePath(relativePath)) {
    return { ok: false, code: "invalid_path", message: "无法访问该路径" };
  }

  let content: string;
  try {
    content = workspace.readFile(input.projectId, relativePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Invalid path/i.test(message)) {
      return { ok: false, code: "invalid_path", message: "无法访问该路径" };
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return { ok: false, code: "not_found", message: "文件不存在" };
    }
    if (/ENOENT|no such file/i.test(message)) {
      return { ok: false, code: "not_found", message: "文件不存在" };
    }
    return { ok: false, code: "invalid_path", message: "无法访问该路径" };
  }

  if (content.includes("\0")) {
    return {
      ok: false,
      code: "not_text",
      message: "暂不支持预览此文件",
    };
  }
  if (Buffer.byteLength(content, "utf8") > MAX_WORKSPACE_SOURCE_BYTES) {
    return {
      ok: false,
      code: "too_large",
      message: "文件过大，暂不支持预览",
    };
  }

  return { ok: true, path: relativePath, content };
}
