import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { listWorkspaceSourceFiles } from "./list-workspace-source-files.js";
import { readWorkspaceSourceFile } from "./read-workspace-source-file.js";
import { isNoisyWorkspacePath } from "./workspace-source-noise.js";

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

describe("workspace source files", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-src-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("isNoisyWorkspacePath matches path segments", () => {
    expect(isNoisyWorkspacePath("node_modules/pkg/index.js")).toBe(true);
    expect(isNoisyWorkspacePath("src/.next/cache")).toBe(true);
    expect(isNoisyWorkspacePath("src/App.tsx")).toBe(false);
    expect(isNoisyWorkspacePath(".env.example")).toBe(false);
  });

  it("listWorkspaceSourceFiles returns null for non-owner", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    expect(
      listWorkspaceSourceFiles(
        { ownerUserId: "reviewer", projectId: project.id },
        workspace,
      ),
    ).toBeNull();
  });

  it("listWorkspaceSourceFiles includes template sources and excludes noise", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    workspace.writeFile(project.id, "node_modules/pkg/index.js", "x");
    workspace.writeFile(project.id, "dist/out.js", "x");
    const files = listWorkspaceSourceFiles(
      { ownerUserId: "demo", projectId: project.id },
      workspace,
    );
    expect(files).toContain("src/App.tsx");
    expect(files?.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(files?.some((f) => f.startsWith("dist/"))).toBe(false);
  });

  it("readWorkspaceSourceFile returns null for non-owner", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    expect(
      readWorkspaceSourceFile(
        { ownerUserId: "reviewer", projectId: project.id, relativePath: "src/App.tsx" },
        workspace,
      ),
    ).toBeNull();
  });

  it("readWorkspaceSourceFile returns content for owner", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const result = readWorkspaceSourceFile(
      { ownerUserId: "demo", projectId: project.id, relativePath: "src/App.tsx" },
      workspace,
    );
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.path).toBe("src/App.tsx");
      expect(result.content).toContain("App");
    }
  });

  it("readWorkspaceSourceFile rejects noisy and traversal paths", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    workspace.writeFile(project.id, "node_modules/pkg/index.js", "secret");
    const noisy = readWorkspaceSourceFile(
      {
        ownerUserId: "demo",
        projectId: project.id,
        relativePath: "node_modules/pkg/index.js",
      },
      workspace,
    );
    expect(noisy).toEqual({
      ok: false,
      code: "invalid_path",
      message: "无法访问该路径",
    });
    const traversal = readWorkspaceSourceFile(
      { ownerUserId: "demo", projectId: project.id, relativePath: "../secret" },
      workspace,
    );
    expect(traversal?.ok).toBe(false);
    if (traversal && !traversal.ok) {
      expect(traversal.code).toBe("invalid_path");
    }
  });

  it("readWorkspaceSourceFile returns not_found for missing file", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const result = readWorkspaceSourceFile(
      { ownerUserId: "demo", projectId: project.id, relativePath: "src/missing.ts" },
      workspace,
    );
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      message: "文件不存在",
    });
  });

  it("readWorkspaceSourceFile rejects binary content", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    workspace.writeFile(project.id, "src/bin.dat", "a\0b");
    const result = readWorkspaceSourceFile(
      { ownerUserId: "demo", projectId: project.id, relativePath: "src/bin.dat" },
      workspace,
    );
    expect(result).toEqual({
      ok: false,
      code: "not_text",
      message: "暂不支持预览此文件",
    });
  });
});
