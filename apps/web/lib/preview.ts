import { readFileSync } from "node:fs";
import { handlePreviewBuildComplete } from "@isotope/application";
import type { LlmClient } from "@isotope/llm";
import { createOpenAiCompatibleClient } from "@isotope/llm";
import { createLocalSandbox } from "@isotope/sandbox";
import { createPreviewService, type PreviewService } from "@isotope/preview";
import { loadLlmFileConfig } from "./agent";
import { versionSummaryPromptPath } from "./paths";
import { getWorkspace } from "./workspace";

let preview: PreviewService | null = null;

function createSummaryLlm(): LlmClient {
  const file = loadLlmFileConfig();
  const apiKey = process.env.LLM_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return {
      async *complete() {
        throw new Error("未配置 LLM_API_KEY");
      },
    };
  }
  return createOpenAiCompatibleClient({
    apiKey,
    baseUrl: process.env.LLM_BASE_URL?.trim() || file.baseUrl,
    model:
      process.env.LLM_SUMMARY_MODEL?.trim() ||
      process.env.LLM_MODEL?.trim() ||
      file.model,
    timeoutMs: file.timeoutMs,
  });
}

export function getPreview(): PreviewService {
  if (!preview) {
    const workspace = getWorkspace();
    const promptTemplate = readFileSync(versionSummaryPromptPath(), "utf8");
    preview = createPreviewService({
      resolvePaths: (projectId) => workspace.getProjectPaths(projectId),
      sandbox: createLocalSandbox(),
      onBuildComplete: (projectId, result) => {
        void handlePreviewBuildComplete(
          {
            projectId,
            ok: result.ok,
            revision: result.revision,
            error: result.error,
          },
          workspace,
          createSummaryLlm(),
          { promptTemplate },
        ).catch(() => {});
      },
    });
  }
  return preview;
}
