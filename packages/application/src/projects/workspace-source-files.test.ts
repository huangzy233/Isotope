import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { listWorkspaceSourceFiles } from "./list-workspace-source-files.js";
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
});
