import type { LlmToolDefinition } from "@isotope/llm";
import { CODER_TOOLS, executeTool } from "./tools.js";

export const CODER_DISPLAY_NAME = "Alex";

export type WorkspaceToolPort = {
  listFiles(relativeDir?: string): string[];
  readFile(relativePath: string): string;
  writeFile(relativePath: string, content: string): void;
};

export type CoderAgent = {
  displayName: typeof CODER_DISPLAY_NAME;
  systemPrompt: string;
  tools: LlmToolDefinition[];
  executeTool(
    name: string,
    argsJson: string,
    port: WorkspaceToolPort,
  ): { ok: true; result: string } | { ok: false; error: string };
};

export function createCoderAgent(input: {
  systemPrompt: string;
}): CoderAgent {
  return {
    displayName: CODER_DISPLAY_NAME,
    systemPrompt: input.systemPrompt,
    tools: CODER_TOOLS,
    executeTool,
  };
}
