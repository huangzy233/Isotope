import { describe, expect, it, vi } from "vitest";
import { executeLeaderTool } from "./tools.js";

const memoryStubs = {
  setPreference: vi.fn(() => ({ ok: true as const })),
  rememberDecision: vi.fn(() => ({ ok: true as const })),
};

describe("executeLeaderTool", () => {
  it("create_task calls port", () => {
    const port = {
      createTask: vi.fn(() => ({
        taskId: "task_1",
        title: "改文案",
        assignee: "Alex" as const,
      })),
      ...memoryStubs,
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
    const port = { createTask: vi.fn(), ...memoryStubs };
    const r = executeLeaderTool("create_task", "{", port);
    expect(r.ok).toBe(false);
    expect(port.createTask).not.toHaveBeenCalled();
  });

  it("rejects empty title", () => {
    const port = { createTask: vi.fn(), ...memoryStubs };
    const r = executeLeaderTool(
      "create_task",
      JSON.stringify({ title: "", assignee: "Alex" }),
      port,
    );
    expect(r.ok).toBe(false);
    expect(port.createTask).not.toHaveBeenCalled();
  });

  it("rejects assignee other than Alex", () => {
    const port = { createTask: vi.fn(), ...memoryStubs };
    const r = executeLeaderTool(
      "create_task",
      JSON.stringify({ title: "改文案", assignee: "Mike" }),
      port,
    );
    expect(r.ok).toBe(false);
    expect(port.createTask).not.toHaveBeenCalled();
  });

  it("set_preference calls port on success", () => {
    const port = {
      createTask: vi.fn(),
      setPreference: vi.fn(() => ({ ok: true as const })),
      rememberDecision: vi.fn(() => ({ ok: true as const })),
    };
    const r = executeLeaderTool(
      "set_preference",
      JSON.stringify({ key: "explanation_verbosity", value: "brief" }),
      port,
    );
    expect(r).toEqual({ ok: true, result: "ok" });
    expect(port.setPreference).toHaveBeenCalledWith(
      "explanation_verbosity",
      "brief",
    );
  });

  it("set_preference rejects unknown key without calling port", () => {
    const port = {
      createTask: vi.fn(),
      setPreference: vi.fn(() => ({ ok: true as const })),
      rememberDecision: vi.fn(() => ({ ok: true as const })),
    };
    const r = executeLeaderTool(
      "set_preference",
      JSON.stringify({ key: "favorite_color", value: "blue" }),
      port,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/unknown key/i);
    }
    expect(port.setPreference).not.toHaveBeenCalled();
  });

  it("remember_decision calls port on success", () => {
    const port = {
      createTask: vi.fn(),
      setPreference: vi.fn(() => ({ ok: true as const })),
      rememberDecision: vi.fn(() => ({ ok: true as const })),
    };
    const r = executeLeaderTool(
      "remember_decision",
      JSON.stringify({ text: "不做登录" }),
      port,
    );
    expect(r).toEqual({ ok: true, result: "ok" });
    expect(port.rememberDecision).toHaveBeenCalledWith("不做登录");
  });
});
