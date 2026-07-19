import type { LlmToolDefinition } from "@isotope/llm";
import { QA_TOOLS, executeQaTool, type QaToolPort } from "./tools.js";

export const QA_DISPLAY_NAME = "QA";

export type { QaToolPort };

export type QaAgent = {
  displayName: typeof QA_DISPLAY_NAME;
  systemPrompt: string;
  tools: LlmToolDefinition[];
  executeTool(
    name: string,
    argsJson: string,
    port: QaToolPort,
  ): Promise<{ ok: true; result: string } | { ok: false; error: string }>;
};

export function createQaAgent(input: {
  systemPrompt: string;
  tools?: LlmToolDefinition[];
}): QaAgent {
  return {
    displayName: QA_DISPLAY_NAME,
    systemPrompt: input.systemPrompt,
    tools: input.tools ?? QA_TOOLS,
    executeTool: executeQaTool,
  };
}

export { QA_TOOLS, executeQaTool };
