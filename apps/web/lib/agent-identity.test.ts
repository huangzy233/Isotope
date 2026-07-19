import { describe, expect, it } from "vitest";
import { agentRoleLabel } from "../components/agent-identity";

describe("agentRoleLabel", () => {
  it("labels QA as 质检", () => {
    expect(agentRoleLabel("QA")).toBe("质检");
  });

  it("labels known agents", () => {
    expect(agentRoleLabel("Pat")).toBe("产品");
    expect(agentRoleLabel("Mike")).toBe("团队领导");
    expect(agentRoleLabel("Alex")).toBe("工程师");
  });

  it("returns null for unknown or missing names", () => {
    expect(agentRoleLabel(undefined)).toBeNull();
    expect(agentRoleLabel("Unknown")).toBeNull();
  });
});
