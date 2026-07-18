import { describe, expect, it } from "vitest";
import { createPlanGatedWritePort } from "./plan-gate.js";

describe("createPlanGatedWritePort", () => {
  it("blocks writeFile when clarify gate open", () => {
    const writes: string[] = [];
    const gated = createPlanGatedWritePort(
      { planEnabled: true, planConfirmed: false },
      {
        listFiles: () => [],
        readFile: () => "",
        writeFile: (p, c) => {
          writes.push(p + c);
        },
      },
    );
    expect(() => gated.writeFile("a.ts", "x")).toThrow(/未确认/);
    expect(writes).toHaveLength(0);

    const open = createPlanGatedWritePort(
      { planEnabled: false, planConfirmed: true },
      {
        listFiles: () => [],
        readFile: () => "",
        writeFile: (p, c) => {
          writes.push(p);
        },
      },
    );
    open.writeFile("a.ts", "x");
    expect(writes).toEqual(["a.ts"]);
  });
});
