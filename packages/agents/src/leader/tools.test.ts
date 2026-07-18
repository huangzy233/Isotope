import { describe, expect, it, vi } from "vitest";
import { executeLeaderTool } from "./tools.js";

describe("executeLeaderTool", () => {
  it("create_task calls port", () => {
    const port = {
      createTask: vi.fn(() => ({
        taskId: "task_1",
        title: "改文案",
        assignee: "Alex" as const,
      })),
    };
    const r = executeLeaderTool(
      "create_task",
      JSON.stringify({ title: "改文案", assignee: "Alex" }),
      port,
    );
    expect(r.ok).toBe(true);
    expect(port.createTask).toHaveBeenCalledWith({
      title: "改文案",
      assignee: "Alex",
    });
    if (r.ok) {
      expect(JSON.parse(r.result)).toEqual({
        taskId: "task_1",
        title: "改文案",
        assignee: "Alex",
      });
    }
  });

  it("rejects invalid JSON", () => {
    const port = { createTask: vi.fn() };
    const r = executeLeaderTool("create_task", "{", port);
    expect(r.ok).toBe(false);
    expect(port.createTask).not.toHaveBeenCalled();
  });

  it("rejects empty title", () => {
    const port = { createTask: vi.fn() };
    const r = executeLeaderTool(
      "create_task",
      JSON.stringify({ title: "", assignee: "Alex" }),
      port,
    );
    expect(r.ok).toBe(false);
    expect(port.createTask).not.toHaveBeenCalled();
  });

  it("rejects assignee other than Alex", () => {
    const port = { createTask: vi.fn() };
    const r = executeLeaderTool(
      "create_task",
      JSON.stringify({ title: "改文案", assignee: "Mike" }),
      port,
    );
    expect(r.ok).toBe(false);
    expect(port.createTask).not.toHaveBeenCalled();
  });
});
