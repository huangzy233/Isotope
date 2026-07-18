import { describe, expect, it } from "vitest";
import { resolveTurnKind } from "./resolve-turn-kind.js";

describe("resolveTurnKind", () => {
  it("matrix", () => {
    expect(resolveTurnKind({ planEnabled: true, teamEnabled: false, planConfirmed: false })).toBe("plan_clarify");
    expect(resolveTurnKind({ planEnabled: true, teamEnabled: true, planConfirmed: false })).toBe("plan_clarify");
    expect(resolveTurnKind({ planEnabled: false, teamEnabled: true, planConfirmed: false })).toBe("team");
    expect(resolveTurnKind({ planEnabled: false, teamEnabled: false, planConfirmed: false })).toBe("engineer");
    expect(resolveTurnKind({ planEnabled: false, teamEnabled: true, planConfirmed: true })).toBe("team");
    expect(resolveTurnKind({ planEnabled: false, teamEnabled: false, planConfirmed: true })).toBe("engineer");
    // 已确认又开 Plan：P0 仍因 planConfirmed 不进 clarify
    expect(resolveTurnKind({ planEnabled: true, teamEnabled: false, planConfirmed: true })).toBe("engineer");
  });
});
