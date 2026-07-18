import type { MessageProcess, WorkspaceStore } from "@isotope/workspace";

export function checkpointProcess(
  workspace: WorkspaceStore,
  messageId: string,
  process: MessageProcess,
): void {
  workspace.updateMessage(messageId, {
    process: {
      steps: process.steps.map((s) =>
        s.type === "thinking"
          ? { type: "thinking" as const, text: s.text }
          : {
              type: "tool" as const,
              id: s.id,
              name: s.name,
              status: s.status,
              ...(s.summary !== undefined ? { summary: s.summary } : {}),
            },
      ),
    },
  });
}
