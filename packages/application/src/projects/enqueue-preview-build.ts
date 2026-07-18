import type { PreviewService, PreviewStatusSnapshot } from "@isotope/preview";
import type { WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";

export function enqueuePreviewBuild(
  input: { ownerUserId: string; projectId: string },
  workspace: WorkspaceStore,
  preview: PreviewService,
): PreviewStatusSnapshot | null {
  if (!getProject(input, workspace)) {
    return null;
  }
  return preview.enqueueBuild(input.projectId);
}
