import { describe, expect, it, vi } from "vitest";
import { executeQaTool } from "./tools.js";

function basePort(
  overrides: Partial<{
    listFiles: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
    runCheck: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    listFiles: vi.fn(() => []),
    readFile: vi.fn(() => ""),
    runCheck: vi.fn(async () => ({ ok: true, log: "" })),
    ...overrides,
  };
}

describe("executeQaTool", () => {
  it("run_check returns log", async () => {
    const r = await executeQaTool("run_check", "{}", {
      listFiles: () => [],
      readFile: () => "",
      runCheck: async () => ({ ok: false, log: "error TS" }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.result).toContain("error TS");
    expect(JSON.parse(r.result)).toEqual({ ok: false, log: "error TS" });
  });

  it("run_check supports sync port.runCheck", async () => {
    const r = await executeQaTool("run_check", "{}", {
      listFiles: () => [],
      readFile: () => "",
      runCheck: () => ({ ok: true, log: "clean" }),
    });
    expect(r).toEqual({
      ok: true,
      result: JSON.stringify({ ok: true, log: "clean" }),
    });
  });

  it("list_files and read_file are read-only", async () => {
    const port = basePort({
      listFiles: vi.fn(() => ["src/App.tsx"]),
      readFile: vi.fn(() => "export default function App() {}"),
    });
    const listed = await executeQaTool("list_files", "{}", port);
    expect(listed).toEqual({
      ok: true,
      result: JSON.stringify(["src/App.tsx"]),
    });
    const read = await executeQaTool(
      "read_file",
      JSON.stringify({ path: "src/App.tsx" }),
      port,
    );
    expect(read).toEqual({
      ok: true,
      result: "export default function App() {}",
    });
  });

  it("rejects write_file", async () => {
    const r = await executeQaTool(
      "write_file",
      JSON.stringify({ path: "src/App.tsx", content: "x" }),
      basePort(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Unknown tool/i);
    }
  });
});
