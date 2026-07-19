import { describe, expect, it } from "vitest";
import { peekToolSummary, toolSummary } from "./tool-summary.js";

describe("toolSummary / peekToolSummary", () => {
  it("peeks write_file path from partial JSON before content completes", () => {
    const partial = '{"path":"src/components/LineChart.tsx","content":"export ';
    expect(peekToolSummary("write_file", partial)).toBe(
      "src/components/LineChart.tsx",
    );
    expect(toolSummary("write_file", partial)).toBe(
      "src/components/LineChart.tsx",
    );
  });

  it("returns full path from complete JSON", () => {
    expect(
      toolSummary(
        "write_file",
        JSON.stringify({ path: "a.ts", content: "x" }),
      ),
    ).toBe("a.ts");
  });
});
