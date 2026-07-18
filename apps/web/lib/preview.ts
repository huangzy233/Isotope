import { createLocalSandbox } from "@isotope/sandbox";
import { createPreviewService, type PreviewService } from "@isotope/preview";
import { getWorkspace } from "./workspace";

let preview: PreviewService | null = null;

export function getPreview(): PreviewService {
  if (!preview) {
    const workspace = getWorkspace();
    preview = createPreviewService({
      resolvePaths: (projectId) => workspace.getProjectPaths(projectId),
      sandbox: createLocalSandbox(),
    });
  }
  return preview;
}
