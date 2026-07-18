import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSqliteWorkspace } from "./workspace-store.js";

const repoTemplate = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

describe("createFsSqliteWorkspace", () => {
  let dataRoot: string;
  let store: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-ws-"));
    store = createFsSqliteWorkspace({
      dataRoot,
      templatePath: repoTemplate,
    });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("creates project, copies template, lists by owner only", () => {
    const a = store.createProject({
      ownerUserId: "demo",
      name: "待办",
      mode: "engineer",
    });
    store.createProject({
      ownerUserId: "reviewer",
      name: "别人的",
      mode: "team",
    });

    expect(a.id.startsWith("proj_")).toBe(true);
    expect(
      fs.existsSync(
        path.join(dataRoot, "projects", a.id, "workspace", "package.json"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(dataRoot, "projects", a.id, "build"))).toBe(
      true,
    );

    const listed = store.listProjects("demo");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(a.id);
    expect(store.listProjects("reviewer")).toHaveLength(1);
    expect(store.getProject(a.id)?.ownerUserId).toBe("demo");
  });

  it("appends and lists messages; updates updatedAt", async () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    const before = store.getProject(p.id)!.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const message = store.appendMessage({
      projectId: p.id,
      role: "user",
      content: "hello",
    });
    expect(message.id).toBeTruthy();
    expect(store.listMessages(p.id)).toHaveLength(1);
    expect(store.getProject(p.id)!.updatedAt >= before).toBe(true);
  });

  it("reads/writes files and rejects escape", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    store.writeFile(p.id, "src/note.txt", "hi");
    expect(store.readFile(p.id, "src/note.txt")).toBe("hi");
    expect(store.listFiles(p.id, "src")).toContain("src/note.txt");
    expect(() => store.readFile(p.id, "../secret")).toThrow(/Invalid path/);
  });

  it("deleteProject removes db rows and project directory", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "待删",
      mode: "engineer",
    });
    store.appendMessage({ projectId: p.id, role: "user", content: "hi" });
    const dir = path.join(dataRoot, "projects", p.id);
    expect(fs.existsSync(dir)).toBe(true);

    store.deleteProject(p.id);

    expect(store.getProject(p.id)).toBeNull();
    expect(store.listMessages(p.id)).toHaveLength(0);
    expect(store.listProjects("demo")).toHaveLength(0);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("deleteProject is safe for unknown id", () => {
    expect(() => store.deleteProject("proj_nonexistent")).not.toThrow();
  });

  it("getProjectPaths returns dirs for existing project only", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    const paths = store.getProjectPaths(p.id);
    expect(paths?.workspaceDir).toBe(
      path.join(dataRoot, "projects", p.id, "workspace"),
    );
    expect(paths?.buildDir).toBe(
      path.join(dataRoot, "projects", p.id, "build"),
    );
    expect(store.getProjectPaths("proj_missing")).toBeNull();
  });
});
