import type { LlmToolDefinition } from "@isotope/llm";
import { REQUIREMENT_TOOLS, executeRequirementTool } from "./tools.js";

export const REQUIREMENT_DISPLAY_NAME = "Pat";

export type ConfirmRequirementPort = {
  confirmRequirement(
    summary: string,
  ): { ok: true } | { ok: false; error: string };
};

export type RequirementAgent = {
  displayName: typeof REQUIREMENT_DISPLAY_NAME;
  systemPrompt: string;
  tools: LlmToolDefinition[];
  executeTool(
    name: string,
    argsJson: string,
    port: ConfirmRequirementPort,
  ): { ok: true; result: string } | { ok: false; error: string };
};

export function createRequirementAgent(input: {
  systemPrompt: string;
  tools?: LlmToolDefinition[];
}): RequirementAgent {
  return {
    displayName: REQUIREMENT_DISPLAY_NAME,
    systemPrompt: input.systemPrompt,
    tools: input.tools ?? REQUIREMENT_TOOLS,
    executeTool: executeRequirementTool,
  };
}

export { REQUIREMENT_TOOLS };
