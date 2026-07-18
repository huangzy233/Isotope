import { describe, expect, it } from "vitest";
import { createRequirementAgent } from "./index.js";

describe("createRequirementAgent", () => {
  it("confirm_requirement requires non-empty summary", () => {
    const agent = createRequirementAgent({ systemPrompt: "x" });
    const calls: string[] = [];
    const r = agent.executeTool(
      "confirm_requirement",
      JSON.stringify({ summary: "  " }),
      {
        confirmRequirement: (s) => {
          calls.push(s);
          return { ok: true };
        },
      },
    );
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);

    const ok = agent.executeTool(
      "confirm_requirement",
      JSON.stringify({ summary: "待办 App：列表+添加" }),
      {
        confirmRequirement: (s) => {
          calls.push(s);
          return { ok: true };
        },
      },
    );
    expect(ok).toEqual({ ok: true, result: expect.any(String) });
    expect(calls[0]).toBe("待办 App：列表+添加");
  });
});
