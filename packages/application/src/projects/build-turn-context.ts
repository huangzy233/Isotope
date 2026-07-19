import type { PreferenceKey } from "@isotope/memory";
import type { Message, Project } from "@isotope/workspace";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";
import {
  DECISIONS_CONTEXT_TAIL,
  DECISIONS_PATH,
  PRODUCT_SPEC_PATH,
} from "./project-memory-paths.js";
import { splitDecisionSections } from "./append-decision.js";

export type BuildTurnContextInput = {
  messages: Message[];
  project: Project;
  preferences: Partial<Record<PreferenceKey, string>>;
  readProjectFile: (relativePath: string) => string | null;
  windowN?: number;
  decisionsTailK?: number;
  digestMaxChars?: number;
};

export type TurnContext = {
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

type HistoryLine = { role: "user" | "assistant"; content: string };

const DEFAULT_WINDOW_N = 20;
const DEFAULT_DECISIONS_TAIL_K = DECISIONS_CONTEXT_TAIL;
const DEFAULT_DIGEST_MAX_CHARS = 2000;

function filterAndMapMessages(messages: Message[]): HistoryLine[] {
  const out: HistoryLine[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (m.content === ASSISTANT_PLACEHOLDER) continue;
    let content = m.content;
    if (m.role === "assistant" && m.agentName) {
      content = `[${m.agentName}] ${content}`;
    }
    out.push({ role: m.role, content });
  }
  return out;
}

function buildDigest(
  older: HistoryLine[],
  digestMaxChars: number,
): HistoryLine {
  let digest = older.map((m) => `${m.role}: ${m.content}`).join("\n");
  if (digest.length > digestMaxChars) {
    digest = `${digest.slice(0, digestMaxChars)}…`;
  }
  return { role: "user", content: `【对话摘要】\n${digest}` };
}

function buildPreferenceSection(
  preferences: Partial<Record<PreferenceKey, string>>,
): string | null {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(preferences)) {
    if (value == null || value === "") continue;
    lines.push(`- ${key}: ${value}`);
  }
  if (lines.length === 0) return null;
  return `### 用户偏好\n${lines.join("\n")}`;
}

function buildSpecSection(
  project: Project,
  readProjectFile: (relativePath: string) => string | null,
): string | null {
  const fromFile = readProjectFile(PRODUCT_SPEC_PATH);
  const spec = fromFile ?? project.confirmedRequirement;
  if (spec == null || spec === "") return null;
  return `### 产品规格\n${spec}`;
}

function buildDecisionsSection(
  readProjectFile: (relativePath: string) => string | null,
  decisionsTailK: number,
): string | null {
  const raw = readProjectFile(DECISIONS_PATH);
  if (raw == null || raw.trim() === "") return null;
  const sections = splitDecisionSections(raw);
  if (sections.length === 0) return null;
  const tail = sections
    .slice(-decisionsTailK)
    .map((s) => s.replace(/\s+$/, ""))
    .join("\n");
  if (!tail) return null;
  return `### 决策\n${tail}`;
}

function buildMemoryBlock(
  input: BuildTurnContextInput,
  decisionsTailK: number,
): HistoryLine | null {
  const parts = [
    buildPreferenceSection(input.preferences),
    buildSpecSection(input.project, input.readProjectFile),
    buildDecisionsSection(input.readProjectFile, decisionsTailK),
  ].filter((p): p is string => p != null);

  if (parts.length === 0) return null;
  return { role: "user", content: `【记忆】\n${parts.join("\n\n")}` };
}

export function buildTurnContext(input: BuildTurnContextInput): TurnContext {
  const windowN = input.windowN ?? DEFAULT_WINDOW_N;
  const decisionsTailK = input.decisionsTailK ?? DEFAULT_DECISIONS_TAIL_K;
  const digestMaxChars = input.digestMaxChars ?? DEFAULT_DIGEST_MAX_CHARS;

  const all = filterAndMapMessages(input.messages);
  const recent =
    all.length > windowN ? all.slice(-windowN) : all;
  const older = all.length > windowN ? all.slice(0, -windowN) : [];

  const history: HistoryLine[] = [];
  const memory = buildMemoryBlock(input, decisionsTailK);
  if (memory) history.push(memory);
  if (older.length > 0) history.push(buildDigest(older, digestMaxChars));
  history.push(...recent);

  return { history };
}
