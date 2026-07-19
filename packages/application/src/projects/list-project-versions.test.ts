import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { listProjectVersions } from "./list-project-versions.js";

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

describe("listProjectVersions", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-list-ver-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("returns null for non-owner", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    expect(
      listProjectVersions(
        { ownerUserId: "other", projectId: project.id },
        workspace,
      ),
    ).toBeNull();
  });

  it("returns versions newest-first", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    workspace.recordVersion({
      projectId: project.id,
      summary: "一",
      previewRevision: "a",
    });
    workspace.recordVersion({
      projectId: project.id,
      summary: "二",
      previewRevision: "b",
    });
    const listed = listProjectVersions(
      { ownerUserId: "demo", projectId: project.id },
      workspace,
    );
    expect(listed?.map((v) => v.number)).toEqual([2, 1]);
    expect(listed?.[0]?.summary).toBe("二");
    // store itself stays ASC
    expect(workspace.listVersions(project.id).map((v) => v.number)).toEqual([
      1, 2,
    ]);
  });
});
