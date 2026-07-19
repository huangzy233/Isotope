import { handlePreviewBuildComplete } from "@isotope/application";
import { createLocalSandbox } from "@isotope/sandbox";
import { createPreviewService, type PreviewService } from "@isotope/preview";
import { getPromptLoader, getSharedRouter } from "./agent";
import { getWorkspace } from "./workspace";

let preview: PreviewService | null = null;

export function getPreview(): PreviewService {
  if (!preview) {
    const workspace = getWorkspace();
    preview = createPreviewService({
      resolvePaths: (projectId) => workspace.getProjectPaths(projectId),
      sandbox: createLocalSandbox(),
      onBuildComplete: (projectId, result) => {
        void (async () => {
          try {
            const { llm } = getSharedRouter();
            const bundle = getPromptLoader().load("workspace/version-summary");
            await handlePreviewBuildComplete(
              {
                projectId,
                ok: result.ok,
                revision: result.revision,
                error: result.error,
              },
              workspace,
              llm,
              { promptTemplate: bundle.system, model: bundle.model },
            );
          } catch {
            // summary is best-effort; missing key / LLM errors must not break preview
          }
        })();
      },
    });
  }
  return preview;
}
