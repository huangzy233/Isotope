import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { appendDecision } from "./append-decision.js";
import { createProject } from "./create-project.js";
import {
  DECISIONS_PATH,
  PRODUCT_SPEC_PATH,
} from "./project-memory-paths.js";
import { writeProductSpec } from "./write-product-spec.js";

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

describe("project memory files", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;
  let projectId: string;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-app-mem-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
    const { project } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个待办清单",
        mode: "engineer",
      },
      workspace,
    );
    projectId = project.id;
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("writeProductSpec creates product-spec.md", () => {
    writeProductSpec(workspace, projectId, "  简洁待办应用  ");
    const body = workspace.readFile(projectId, PRODUCT_SPEC_PATH);
    expect(body).toBe("简洁待办应用\n");
  });

  it("appendDecision appends dated sections", () => {
    appendDecision(workspace, projectId, "用本地存储", "2026-07-19T00:00:00.000Z");
    appendDecision(workspace, projectId, "不做登录", "2026-07-19T01:00:00.000Z");
    const body = workspace.readFile(projectId, DECISIONS_PATH);
    expect(body).toContain("## 2026-07-19T00:00:00.000Z");
    expect(body).toContain("用本地存储");
    expect(body).toContain("## 2026-07-19T01:00:00.000Z");
    expect(body).toContain("不做登录");
  });
});
