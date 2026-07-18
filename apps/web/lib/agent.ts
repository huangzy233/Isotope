import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  createCoderAgent,
  createLeaderAgent,
  createRequirementAgent,
  type CoderAgent,
  type LeaderAgent,
  type RequirementAgent,
} from "@isotope/agents";
import { createOpenAiCompatibleClient, type LlmClient } from "@isotope/llm";
import {
  alexSystemPromptPath,
  llmConfigPath,
  mikeSummaryPromptPath,
  mikeSystemPromptPath,
  patSystemPromptPath,
} from "./paths";

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

function createSharedLlm(): { llm: LlmClient; maxToolRounds: number } {
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
  return { llm, maxToolRounds: file.maxToolRounds };
}

export function createTurnDeps(): {
  llm: LlmClient;
  agent: ReturnType<typeof createCoderAgent>;
  maxToolRounds: number;
} {
  const { llm, maxToolRounds } = createSharedLlm();
  const systemPrompt = readFileSync(alexSystemPromptPath(), "utf8");
  return {
    llm,
    agent: createCoderAgent({ systemPrompt }),
    maxToolRounds,
  };
}

export function createTeamTurnDeps(): {
  llm: LlmClient;
  leader: LeaderAgent;
  leaderSummaryPrompt: string;
  coder: CoderAgent;
  maxToolRounds: number;
} {
  const { llm, maxToolRounds } = createSharedLlm();
  const mikePrompt = readFileSync(mikeSystemPromptPath(), "utf8");
  const mikeSummaryPrompt = readFileSync(mikeSummaryPromptPath(), "utf8");
  const alexPrompt = readFileSync(alexSystemPromptPath(), "utf8");
  return {
    llm,
    leader: createLeaderAgent({ systemPrompt: mikePrompt }),
    leaderSummaryPrompt: mikeSummaryPrompt,
    coder: createCoderAgent({ systemPrompt: alexPrompt }),
    maxToolRounds,
  };
}

export function createPlanTurnDeps(): {
  llm: LlmClient;
  agent: RequirementAgent;
  maxToolRounds: number;
} {
  const { llm, maxToolRounds } = createSharedLlm();
  const systemPrompt = readFileSync(patSystemPromptPath(), "utf8");
  return {
    llm,
    agent: createRequirementAgent({ systemPrompt }),
    maxToolRounds,
  };
}
