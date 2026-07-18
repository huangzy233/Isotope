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

  it("updateMessage updates content or returns null", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    const msg = store.appendMessage({
      projectId: p.id,
      role: "assistant",
      content: "旧文案",
      agentName: "Alex",
    });
    const updated = store.updateMessage(msg.id, { content: "新文案" });
    expect(updated?.content).toBe("新文案");
    expect(updated?.id).toBe(msg.id);
    expect(store.listMessages(p.id)[0]?.content).toBe("新文案");
    expect(store.updateMessage("msg_missing", { content: "x" })).toBeNull();
  });

  it("appendMessage and updateMessage persist process", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    const msg = store.appendMessage({
      projectId: p.id,
      role: "assistant",
      content: "结论",
      agentName: "Alex",
      process: {
        steps: [
          { type: "thinking", text: "先看文件" },
          {
            type: "tool",
            id: "c1",
            name: "read_file",
            status: "done",
            summary: "src/App.tsx",
          },
        ],
      },
    });
    expect(store.listMessages(p.id)[0]?.process?.steps).toEqual(
      msg.process?.steps,
    );

    const updated = store.updateMessage(msg.id, {
      content: "新结论",
      process: {
        steps: [{ type: "thinking", text: "改完了" }],
      },
    });
    expect(updated?.content).toBe("新结论");
    expect(updated?.process?.steps).toEqual([
      { type: "thinking", text: "改完了" },
    ]);
    expect(store.listMessages(p.id)[0]?.process?.steps[0]).toEqual({
      type: "thinking",
      text: "改完了",
    });
  });

  it("messages without process_json list without process", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "y",
      mode: "engineer",
    });
    store.appendMessage({
      projectId: p.id,
      role: "user",
      content: "hi",
    });
    expect(store.listMessages(p.id)[0]?.process).toBeUndefined();
  });

  it("createTask / updateTask / listTasks and cascade on deleteProject", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "team",
    });
    const mike = store.appendMessage({
      projectId: p.id,
      role: "assistant",
      content: "拆任务",
      agentName: "Mike",
    });
    const task = store.createTask({
      projectId: p.id,
      title: "统一文案",
      assignee: "Alex",
      status: "assigned",
      createdByMessageId: mike.id,
    });
    expect(task.status).toBe("assigned");
    expect(task.assignee).toBe("Alex");
    expect(store.listTasks(p.id)).toHaveLength(1);

    const linked = store.updateMessage(mike.id, { taskId: task.id });
    expect(linked?.taskId).toBe(task.id);

    const running = store.updateTask(task.id, { status: "running" });
    expect(running?.status).toBe("running");
    expect(running?.lastProgressAt).toBeTruthy();

    store.deleteProject(p.id);
    expect(store.getTask(task.id)).toBeNull();
    expect(store.listTasks(p.id)).toEqual([]);
  });

  it("pending version intent upsert and take", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    expect(store.takePendingVersionIntent(p.id)).toBe(false);
    store.upsertPendingVersionIntent(p.id);
    store.upsertPendingVersionIntent(p.id);
    expect(store.takePendingVersionIntent(p.id)).toBe(true);
    expect(store.takePendingVersionIntent(p.id)).toBe(false);
  });

  it("recordVersion increments and message joins versionNumber", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    const v1 = store.recordVersion({
      projectId: p.id,
      summary: "统一首页文案",
      previewRevision: "abc",
    });
    expect(v1.number).toBe(1);
    expect(v1.summary).toBe("统一首页文案");
    expect(v1.previewRevision).toBe("abc");
    expect(v1.snapshotRef).toBeNull();

    const v2 = store.recordVersion({
      projectId: p.id,
      summary: "调整按钮颜色",
    });
    expect(v2.number).toBe(2);

    const msg = store.appendMessage({
      projectId: p.id,
      role: "system",
      content: v1.summary,
      versionId: v1.id,
    });
    expect(msg.versionId).toBe(v1.id);
    expect(msg.versionNumber).toBe(1);

    const listed = store.listMessages(p.id);
    expect(listed[0]?.versionId).toBe(v1.id);
    expect(listed[0]?.versionNumber).toBe(1);
    expect(listed[0]?.content).toBe("统一首页文案");
  });

  it("deleteProject clears versions and pending intents", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    store.upsertPendingVersionIntent(p.id);
    store.recordVersion({ projectId: p.id, summary: "s" });
    store.deleteProject(p.id);
    expect(store.takePendingVersionIntent(p.id)).toBe(false);
    expect(store.listVersions(p.id)).toEqual([]);
  });
});
