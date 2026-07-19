import { describe, expect, it } from "vitest";
import type { Message } from "@isotope/workspace";
import { pickVersionContext } from "./summarize-version.js";

function msg(
  partial: Pick<Message, "role" | "content"> &
    Partial<Pick<Message, "agentName" | "versionId">>,
): Message {
  return {
    id: "m",
    projectId: "p",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("pickVersionContext", () => {
  it("prefers Alex assistant over later QA report", () => {
    const context = pickVersionContext([
      msg({ role: "user", content: "加折线图" }),
      msg({
        role: "assistant",
        content: "已新增 LineChart 并挂到 App",
        agentName: "Alex",
      }),
      msg({
        role: "assistant",
        content: "【质检结果】PASS\n检查：typecheck\n问题：无",
        agentName: "QA",
      }),
    ]);
    expect(context).toBe("已新增 LineChart 并挂到 App");
  });

  it("skips QA-shaped content even without agentName", () => {
    const context = pickVersionContext([
      msg({ role: "assistant", content: "改了按钮颜色", agentName: "Alex" }),
      msg({
        role: "assistant",
        content: "质检结果通过，类型检查无问题。",
      }),
    ]);
    expect(context).toBe("改了按钮颜色");
  });

  it("falls back to user when only QA assistants exist", () => {
    const context = pickVersionContext([
      msg({ role: "user", content: "做个仪表盘" }),
      msg({
        role: "assistant",
        content: "【质检结果】PASS\n检查：typecheck\n问题：无",
        agentName: "QA",
      }),
    ]);
    expect(context).toBe("做个仪表盘");
  });
});
