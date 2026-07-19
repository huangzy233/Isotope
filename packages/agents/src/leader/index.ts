import type { LlmToolDefinition } from "@isotope/llm";
import { LEADER_TOOLS, executeLeaderTool } from "./tools.js";

export const LEADER_DISPLAY_NAME = "Mike";

export type TaskToolPort = {
  createTask(input: {
    title: string;
    assignee: "Alex";
  }): { taskId: string; title: string; assignee: "Alex" };
};

export type LeaderAgent = {
  displayName: typeof LEADER_DISPLAY_NAME;
  systemPrompt: string;
  tools: LlmToolDefinition[];
  executeTool(
    name: string,
    argsJson: string,
    port: TaskToolPort,
  ): { ok: true; result: string } | { ok: false; error: string };
};

export function createLeaderAgent(input: {
  systemPrompt: string;
  tools?: LlmToolDefinition[];
}): LeaderAgent {
  return {
    displayName: LEADER_DISPLAY_NAME,
    systemPrompt: input.systemPrompt,
    tools: input.tools ?? LEADER_TOOLS,
    executeTool: executeLeaderTool,
  };
}

export { LEADER_TOOLS };
