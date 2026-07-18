import type { LlmClient } from "@isotope/llm";
import type { Message, WorkspaceStore } from "@isotope/workspace";

const FALLBACK = "代码已更新";
const MAX_SUMMARY_CHARS = 80;

export function pickVersionContext(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.content.trim() && !m.versionId) {
      return m.content.trim();
    }
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role === "user" && m.content.trim()) {
      return m.content.trim();
    }
  }
  return FALLBACK;
}

export function truncateSummary(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return FALLBACK;
  if (t.length <= MAX_SUMMARY_CHARS) return t;
  return t.slice(0, MAX_SUMMARY_CHARS);
}

export async function summarizeVersionChange(
  context: string,
  llm: LlmClient,
  promptTemplate: string,
): Promise<string> {
  const fallback = truncateSummary(context);
  try {
    const prompt = promptTemplate.replaceAll("{{context}}", context);
    let text = "";
    for await (const ev of llm.complete({
      messages: [{ role: "user", content: prompt }],
    })) {
      if (ev.type === "content_delta") {
        text += ev.text;
      }
    }
    const cleaned = truncateSummary(text);
    return cleaned === FALLBACK && text.trim() === "" ? fallback : cleaned;
  } catch {
    return fallback;
  }
}

export function resolveVersionContext(workspace: WorkspaceStore, projectId: string): string {
  return pickVersionContext(workspace.listMessages(projectId));
}
