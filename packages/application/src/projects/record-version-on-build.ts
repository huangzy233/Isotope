import type { LlmClient } from "@isotope/llm";
import type { WorkspaceStore } from "@isotope/workspace";
import {
  resolveVersionContext,
  summarizeVersionChange,
} from "./summarize-version.js";

export async function handlePreviewBuildComplete(
  input: {
    projectId: string;
    ok: boolean;
    revision: string | null;
    error: string | null;
  },
  workspace: WorkspaceStore,
  llm: LlmClient,
  opts: { promptTemplate: string },
): Promise<void> {
  const hadPending = workspace.takePendingVersionIntent(input.projectId);
  if (!hadPending) return;
  if (!input.ok) return;

  const context = resolveVersionContext(workspace, input.projectId);
  const summary = await summarizeVersionChange(
    context,
    llm,
    opts.promptTemplate,
  );
  const version = workspace.recordVersion({
    projectId: input.projectId,
    summary,
    previewRevision: input.revision,
  });
  workspace.appendMessage({
    projectId: input.projectId,
    role: "system",
    content: summary,
    versionId: version.id,
  });
}
