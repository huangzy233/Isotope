import type { CoderAgent, WorkspaceToolPort } from "@isotope/agents";
import type { LlmClient } from "@isotope/llm";

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

export type RunTurnInput = {
  llm: LlmClient;
  agent: CoderAgent;
  port: WorkspaceToolPort;
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
