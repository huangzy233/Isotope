import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { createCoderAgent } from "@isotope/agents";
import { createOpenAiCompatibleClient, type LlmClient } from "@isotope/llm";
import { alexSystemPromptPath, llmConfigPath } from "./paths";

type LlmFileConfig = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxToolRounds: number;
};

export function loadLlmFileConfig(): LlmFileConfig {
  const data = parse(readFileSync(llmConfigPath(), "utf8")) as LlmFileConfig;
  return data;
}

export function createTurnDeps(): {
  llm: LlmClient;
  agent: ReturnType<typeof createCoderAgent>;
  maxToolRounds: number;
} {
  const file = loadLlmFileConfig();
  const apiKey = process.env.LLM_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error("未配置 LLM_API_KEY");
  }
  const llm = createOpenAiCompatibleClient({
    apiKey,
    baseUrl: process.env.LLM_BASE_URL?.trim() || file.baseUrl,
    model: process.env.LLM_MODEL?.trim() || file.model,
    timeoutMs: file.timeoutMs,
  });
  const systemPrompt = readFileSync(alexSystemPromptPath(), "utf8");
  return {
    llm,
    agent: createCoderAgent({ systemPrompt }),
    maxToolRounds: file.maxToolRounds,
  };
}
