import type { WorkspaceStore } from "@isotope/workspace";
import { PRODUCT_SPEC_PATH } from "./project-memory-paths.js";

export function writeProductSpec(
  workspace: WorkspaceStore,
  projectId: string,
  summary: string,
): void {
  workspace.writeFile(projectId, PRODUCT_SPEC_PATH, `${summary.trim()}\n`);
}
