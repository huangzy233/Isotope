import {
  CODER_TOOLS,
  LEADER_TOOLS,
  REQUIREMENT_TOOLS,
  createCoderAgent,
  createLeaderAgent,
  createRequirementAgent,
  type CoderAgent,
  type LeaderAgent,
  type RequirementAgent,
} from "@isotope/agents";
import {
  createLlmRouter,
  loadLlmDefaults,
  loadLlmProviders,
  type LlmClient,
} from "@isotope/llm";
import { filterTools } from "./filter-tools";
import { llmConfigDir, promptsRoot } from "./paths";
import { createPromptLoader } from "./prompt-loader";

type SharedRouter = {
  llm: LlmClient;
  maxToolRounds: number;
  defaultModel: string;
};

let cachedRouter: SharedRouter | null = null;
let cachedLoader: ReturnType<typeof createPromptLoader> | null = null;

function resolveDefaultModel(fileDefault: string): string {
  return process.env.LLM_MODEL?.trim() || fileDefault;
}

function createSharedRouter(): SharedRouter {
  const configDir = llmConfigDir();
  const defaults = loadLlmDefaults(configDir);
  const providers = loadLlmProviders(configDir);
  const llm = createLlmRouter({
    providers,
    resolveApiKey: (envName) => process.env[envName]?.trim() ?? "",
    overrideBaseUrl: process.env.LLM_BASE_URL?.trim() || undefined,
  });
  return {
    llm,
    maxToolRounds: defaults.maxToolRounds,
    defaultModel: resolveDefaultModel(defaults.defaultModel),
  };
}

/** Lazy singleton — same style as getPreview. */
export function getSharedRouter(): SharedRouter {
  if (!cachedRouter) {
    cachedRouter = createSharedRouter();
  }
  return cachedRouter;
}

export function getPromptLoader(): ReturnType<typeof createPromptLoader> {
  if (!cachedLoader) {
    const { defaultModel } = getSharedRouter();
    cachedLoader = createPromptLoader({
      promptsRoot: promptsRoot(),
      defaultModel,
    });
  }
  return cachedLoader;
}

export function createTurnDeps(): {
  llm: LlmClient;
  model: string;
  agent: CoderAgent;
  maxToolRounds: number;
} {
  const { llm, maxToolRounds } = getSharedRouter();
  const bundle = getPromptLoader().load("coding/alex-system");
  return {
    llm,
    model: bundle.model,
    agent: createCoderAgent({
      systemPrompt: bundle.system,
      tools: filterTools(CODER_TOOLS, bundle.tools),
    }),
    maxToolRounds,
  };
}

export function createTeamTurnDeps(): {
  llm: LlmClient;
  leader: LeaderAgent;
  leaderModel: string;
  leaderSummary: LeaderAgent;
  leaderSummaryModel: string;
  coder: CoderAgent;
  coderModel: string;
  maxToolRounds: number;
} {
  const { llm, maxToolRounds } = getSharedRouter();
  const loader = getPromptLoader();
  const leaderBundle = loader.load("leader/mike-system");
  const summaryBundle = loader.load("leader/mike-summary");
  const coderBundle = loader.load("coding/alex-system");
  return {
    llm,
    leader: createLeaderAgent({
      systemPrompt: leaderBundle.system,
      tools: filterTools(LEADER_TOOLS, leaderBundle.tools),
    }),
    leaderModel: leaderBundle.model,
    leaderSummary: createLeaderAgent({
      systemPrompt: summaryBundle.system,
      tools: filterTools(LEADER_TOOLS, summaryBundle.tools),
    }),
    leaderSummaryModel: summaryBundle.model,
    coder: createCoderAgent({
      systemPrompt: coderBundle.system,
      tools: filterTools(CODER_TOOLS, coderBundle.tools),
    }),
    coderModel: coderBundle.model,
    maxToolRounds,
  };
}

export function createPlanTurnDeps(): {
  llm: LlmClient;
  model: string;
  agent: RequirementAgent;
  maxToolRounds: number;
} {
  const { llm, maxToolRounds } = getSharedRouter();
  const bundle = getPromptLoader().load("requirement/pat-system");
  return {
    llm,
    model: bundle.model,
    agent: createRequirementAgent({
      systemPrompt: bundle.system,
      tools: filterTools(REQUIREMENT_TOOLS, bundle.tools),
    }),
    maxToolRounds,
  };
}
