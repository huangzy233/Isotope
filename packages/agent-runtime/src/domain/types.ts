import type { CoderAgent, WorkspaceToolPort } from "@isotope/agents";
import type { LlmClient } from "@isotope/llm";

export type RunTurnInput = {
  llm: LlmClient;
  agent: CoderAgent;
  port: WorkspaceToolPort;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  maxToolRounds: number;
  signal?: AbortSignal;
  onToken: (text: string) => void;
};

export type RunTurnResult = {
  assistantText: string;
  filesChanged: boolean;
};
