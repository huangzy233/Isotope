import type { Project, ProjectMode, WorkspaceStore } from "@isotope/workspace";
import { updateProjectFlags } from "./update-project-flags.js";

/** @deprecated 用 updateProjectFlags；保留 mode→teamEnabled 兼容 */
export function updateProjectMode(
  input: { ownerUserId: string; projectId: string; mode: ProjectMode },
  workspace: WorkspaceStore,
): Project | null {
  return updateProjectFlags(
    {
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
      teamEnabled: input.mode === "team",
    },
    workspace,
  );
}
