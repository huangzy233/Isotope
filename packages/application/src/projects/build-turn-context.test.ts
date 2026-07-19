import { describe, expect, it } from "vitest";
import type { Message, Project } from "@isotope/workspace";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import { DECISIONS_PATH, PRODUCT_SPEC_PATH } from "./project-memory-paths.js";
import { buildTurnContext } from "./build-turn-context.js";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "demo",
    mode: "engineer",
    planEnabled: false,
    teamEnabled: false,
    planConfirmed: false,
    ownerUserId: "u1",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

function msg(
  overrides: Partial<Message> & Pick<Message, "role" | "content">,
): Message {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    projectId: "p1",
    createdAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildTurnContext", () => {
  it("filters placeholder and process is irrelevant (content only)", () => {
    const { history } = buildTurnContext({
      messages: [
        msg({
          role: "user",
          content: "hello",
          process: { steps: [{ type: "thinking", text: "secret" }] },
        }),
        msg({ role: "assistant", content: ASSISTANT_PLACEHOLDER }),
        msg({ role: "system", content: "system noise" }),
        msg({ role: "assistant", content: "ok" }),
      ],
      project: project(),
      preferences: {},
      readProjectFile: () => null,
    });

    expect(history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "ok" },
    ]);
    expect(JSON.stringify(history)).not.toContain("secret");
  });

  it("prefixes agentName on assistant lines", () => {
    const { history } = buildTurnContext({
      messages: [
        msg({ role: "user", content: "go" }),
        msg({ role: "assistant", content: "done", agentName: "Alex" }),
        msg({ role: "assistant", content: "plain" }),
      ],
      project: project(),
      preferences: {},
      readProjectFile: () => null,
    });

    expect(history).toEqual([
      { role: "user", content: "go" },
      { role: "assistant", content: "[Alex] done" },
      { role: "assistant", content: "plain" },
    ]);
  });

  it("windows to N and inserts digest for older", () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      msg({
        id: `m${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `c${i}`,
      }),
    );

    const { history } = buildTurnContext({
      messages,
      project: project(),
      preferences: {},
      readProjectFile: () => null,
      windowN: 2,
      digestMaxChars: 2000,
    });

    expect(history[0]).toEqual({
      role: "user",
      content: "【对话摘要】\nuser: c0\nassistant: c1\nuser: c2",
    });
    expect(history.slice(1)).toEqual([
      { role: "assistant", content: "c3" },
      { role: "user", content: "c4" },
    ]);
  });

  it("injects memory block with pref + spec file + decisions tail", () => {
    const decisions = [
      "## 2026-07-19T00:00:00.000Z\nold",
      "## 2026-07-19T01:00:00.000Z\nmid",
      "## 2026-07-19T02:00:00.000Z\nnew",
    ].join("\n");

    const { history } = buildTurnContext({
      messages: [msg({ role: "user", content: "hi" })],
      project: project({ confirmedRequirement: "db fallback" }),
      preferences: { ui_language: "zh", explanation_verbosity: "brief" },
      readProjectFile: (p) => {
        if (p === PRODUCT_SPEC_PATH) return "spec from file";
        if (p === DECISIONS_PATH) return decisions;
        return null;
      },
      decisionsTailK: 2,
    });

    expect(history[0]?.role).toBe("user");
    expect(history[0]?.content).toBe(
      [
        "【记忆】",
        "### 用户偏好",
        "- ui_language: zh",
        "- explanation_verbosity: brief",
        "",
        "### 产品规格",
        "spec from file",
        "",
        "### 决策",
        "## 2026-07-19T01:00:00.000Z\nmid",
        "## 2026-07-19T02:00:00.000Z\nnew",
      ].join("\n"),
    );
    expect(history[1]).toEqual({ role: "user", content: "hi" });
  });

  it("falls back to confirmedRequirement when spec file missing", () => {
    const { history } = buildTurnContext({
      messages: [msg({ role: "user", content: "hi" })],
      project: project({ confirmedRequirement: "from db" }),
      preferences: {},
      readProjectFile: () => null,
    });

    expect(history[0]?.content).toContain("### 产品规格\nfrom db");
    expect(history[0]?.content).not.toContain("【已确认需求】");
  });

  it("omits memory block when empty", () => {
    const { history } = buildTurnContext({
      messages: [msg({ role: "user", content: "hi" })],
      project: project(),
      preferences: {},
      readProjectFile: () => null,
    });

    expect(history).toEqual([{ role: "user", content: "hi" }]);
  });

  it("does not insert 【已确认需求】 prefix", () => {
    const { history } = buildTurnContext({
      messages: [msg({ role: "user", content: "hi" })],
      project: project({ confirmedRequirement: "需求摘要" }),
      preferences: {},
      readProjectFile: () => null,
    });

    const joined = history.map((h) => h.content).join("\n");
    expect(joined).not.toContain("【已确认需求】");
    expect(joined).toContain("【记忆】");
    expect(joined).toContain("### 产品规格\n需求摘要");
  });
});
