import { describe, expect, it, vi } from "vitest";
import { executeTool } from "./tools.js";

function basePort(
  overrides: Partial<{
    listFiles: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    setPreference: ReturnType<typeof vi.fn>;
    rememberDecision: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    listFiles: vi.fn(() => []),
    readFile: vi.fn(() => ""),
    writeFile: vi.fn(),
    setPreference: vi.fn(() => ({ ok: true as const })),
    rememberDecision: vi.fn(() => ({ ok: true as const })),
    ...overrides,
  };
}

describe("executeTool memory tools", () => {
  it("set_preference calls port on success", () => {
    const port = basePort();
    const r = executeTool(
      "set_preference",
      JSON.stringify({ key: "ui_language", value: "zh" }),
      port,
    );
    expect(r).toEqual({ ok: true, result: "ok" });
    expect(port.setPreference).toHaveBeenCalledWith("ui_language", "zh");
  });

  it("set_preference rejects unknown key without calling port", () => {
    const port = basePort();
    const r = executeTool(
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

  it("set_preference propagates port error", () => {
    const port = basePort({
      setPreference: vi.fn(() => ({ ok: false as const, error: "value empty" })),
    });
    const r = executeTool(
      "set_preference",
      JSON.stringify({ key: "ui_language", value: "zh" }),
      port,
    );
    expect(r).toEqual({ ok: false, error: "value empty" });
  });

  it("remember_decision calls port on success", () => {
    const port = basePort();
    const r = executeTool(
      "remember_decision",
      JSON.stringify({ text: "用本地存储" }),
      port,
    );
    expect(r).toEqual({ ok: true, result: "ok" });
    expect(port.rememberDecision).toHaveBeenCalledWith("用本地存储");
  });

  it("remember_decision rejects empty text", () => {
    const port = basePort();
    const r = executeTool(
      "remember_decision",
      JSON.stringify({ text: "  " }),
      port,
    );
    expect(r.ok).toBe(false);
    expect(port.rememberDecision).not.toHaveBeenCalled();
  });
});
