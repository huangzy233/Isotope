import type { LlmClient } from "../domain/types.js";
import { createOpenAiCompatibleClient } from "../providers/openai-compatible.js";
import type { LlmProviderConfig } from "./load-providers.js";

export function createLlmRouter(input: {
  providers: LlmProviderConfig[];
  resolveApiKey: (envName: string) => string;
  /** 可选：覆盖某 provider 的 baseUrl（映射现网 LLM_BASE_URL） */
  overrideBaseUrl?: string;
  fetch?: typeof fetch;
}): LlmClient {
  const modelToClient = new Map<string, LlmClient>();

  for (const provider of input.providers) {
    if (provider.type !== "openai-compatible") {
      throw new Error(
        `Unsupported LLM provider type: ${String(provider.type)}`,
      );
    }
    const apiKey = input.resolveApiKey(provider.apiKeyEnv);
    if (!apiKey.trim()) {
      throw new Error(`未配置 ${provider.apiKeyEnv}`);
    }
    const client = createOpenAiCompatibleClient({
      apiKey,
      baseUrl: input.overrideBaseUrl ?? provider.baseUrl,
      timeoutMs: provider.timeoutMs,
      fetch: input.fetch,
    });
    for (const model of provider.models) {
      if (modelToClient.has(model)) {
        throw new Error(`Duplicate model: ${model}`);
      }
      modelToClient.set(model, client);
    }
  }

  return {
    async *complete(request) {
      const client = modelToClient.get(request.model);
      if (!client) {
        throw new Error(`Unknown model: ${request.model}`);
      }
      yield* client.complete(request);
    },
  };
}
