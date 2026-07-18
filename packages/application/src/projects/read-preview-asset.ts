import type { PreviewAsset, PreviewService } from "@isotope/preview";
import type { WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";

export function readPreviewAsset(
  input: { ownerUserId: string; projectId: string; relativePath: string },
  workspace: WorkspaceStore,
  preview: PreviewService,
): PreviewAsset | null {
  if (!getProject(input, workspace)) {
    return null;
  }
  return preview.readAsset(input.projectId, input.relativePath);
}
