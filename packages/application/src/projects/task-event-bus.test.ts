import { describe, expect, it, vi } from "vitest";
import type { Task } from "@isotope/workspace";
import { createTaskEventBus } from "./task-event-bus.js";

function sampleTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    projectId: "proj_1",
    title: "统一文案",
    assignee: "Alex",
    status: "assigned",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastProgressAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("createTaskEventBus", () => {
  it("delivers events to multiple subscribers", () => {
    const bus = createTaskEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe(h1);
    bus.subscribe(h2);

    const event = { type: "task.created" as const, task: sampleTask() };
    bus.publish(event);

    expect(h1).toHaveBeenCalledWith(event);
    expect(h2).toHaveBeenCalledWith(event);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = createTaskEventBus();
    const handler = vi.fn();
    const unsub = bus.subscribe(handler);
    unsub();

    bus.publish({ type: "task.created", task: sampleTask() });

    expect(handler).not.toHaveBeenCalled();
  });
});
