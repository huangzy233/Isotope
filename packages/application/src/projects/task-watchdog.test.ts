import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createTaskEventBus, type TaskEvent } from "./task-event-bus.js";
import { startTaskWatchdog } from "./task-watchdog.js";
import { isTurnLocked, releaseTurnLock, tryAcquireTurnLock } from "./turn-lock.js";

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("startTaskWatchdog", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;
  const fixedNow = 1_700_000_000_000;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-watchdog-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  function stuckIso(): string {
    return new Date(fixedNow - 120_000).toISOString();
  }

  it("calls onRetryAssigned for stuck assigned tasks", async () => {
    const project = workspace.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "team",
    });
    const task = workspace.createTask({
      projectId: project.id,
      title: "统一文案",
      assignee: "Alex",
      status: "assigned",
    });
    workspace.updateTask(task.id, { lastProgressAt: stuckIso() });

    const onRetryAssigned = vi.fn();
    const stop = startTaskWatchdog({
      workspace,
      bus: createTaskEventBus(),
      isTurnLocked: () => false,
      onRetryAssigned,
      intervalMs: 20,
      stuckMs: 90_000,
      now: () => fixedNow,
    });

    await delay(50);
    stop();

    expect(onRetryAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id, status: "assigned" }),
    );
  });

  it("marks stuck running tasks as failed and publishes events", async () => {
    const project = workspace.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "team",
    });
    const task = workspace.createTask({
      projectId: project.id,
      title: "实现页面",
      assignee: "Alex",
      status: "running",
    });
    workspace.updateTask(task.id, { lastProgressAt: stuckIso() });

    const events: TaskEvent[] = [];
    const bus = createTaskEventBus();
    bus.subscribe((event) => events.push(event));

    const stop = startTaskWatchdog({
      workspace,
      bus,
      isTurnLocked: () => false,
      onRetryAssigned: vi.fn(),
      intervalMs: 20,
      stuckMs: 90_000,
      now: () => fixedNow,
    });

    await delay(50);
    stop();

    const updated = workspace.getTask(task.id);
    expect(updated?.status).toBe("failed");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "task.failed", task: expect.objectContaining({ id: task.id }) }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "task.updated",
        task: expect.objectContaining({ id: task.id, status: "failed" }),
        prevStatus: "running",
      }),
    );
  });

  it("skips stuck tasks when turn is locked", async () => {
    const project = workspace.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "team",
    });
    const task = workspace.createTask({
      projectId: project.id,
      title: "统一文案",
      assignee: "Alex",
      status: "assigned",
    });
    workspace.updateTask(task.id, { lastProgressAt: stuckIso() });
    tryAcquireTurnLock(project.id);

    const onRetryAssigned = vi.fn();
    const stop = startTaskWatchdog({
      workspace,
      bus: createTaskEventBus(),
      isTurnLocked,
      onRetryAssigned,
      intervalMs: 20,
      stuckMs: 90_000,
      now: () => fixedNow,
    });

    await delay(50);
    stop();
    releaseTurnLock(project.id);

    expect(onRetryAssigned).not.toHaveBeenCalled();
  });
});
