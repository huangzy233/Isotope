import type { WorkspaceToolPort } from "@isotope/agents";
import type { LlmClient, LlmToolDefinition } from "@isotope/llm";

export type TurnPhase = "thinking" | "running" | "streaming";

export type ToolEvent = {
  id: string;
  name: string;
  state: "start" | "end";
  summary?: string;
  ok?: boolean;
};

export type TurnProcessStep =
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      status: "running" | "done" | "error";
      summary?: string;
    };

export type TurnProcess = { steps: TurnProcessStep[] };

export type TurnAgent<TPort = unknown> = {
  displayName: string;
  systemPrompt: string;
  tools: LlmToolDefinition[];
  executeTool(
    name: string,
    argsJson: string,
    port: TPort,
  ): { ok: true; result: string } | { ok: false; error: string };
};

export type RunTurnInput<TPort = WorkspaceToolPort> = {
  llm: LlmClient;
  model: string;
  agent: TurnAgent<TPort>;
  port: TPort;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  maxToolRounds: number;
  signal?: AbortSignal;
  onToken: (text: string) => void;
  onThinking?: (text: string) => void;
  onTool?: (ev: ToolEvent) => void;
  onStatus?: (phase: TurnPhase) => void;
};

export type RunTurnResult = {
  assistantText: string;
  filesChanged: boolean;
  process: TurnProcess;
};
