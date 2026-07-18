import type { PreviewService, PreviewStatusSnapshot } from "@isotope/preview";
import type { WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";

export function getPreviewStatus(
  input: { ownerUserId: string; projectId: string; ensure?: boolean },
  workspace: WorkspaceStore,
  preview: PreviewService,
): PreviewStatusSnapshot | null {
  if (!getProject(input, workspace)) {
    return null;
  }
  if (input.ensure === true) {
    return preview.ensureBuild(input.projectId);
  }
  return preview.getStatus(input.projectId);
}
