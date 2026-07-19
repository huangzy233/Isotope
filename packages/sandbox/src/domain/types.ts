export const CHECK_LOG_TAIL_CHARS = 4096;

export type SandboxBuildInput = {
  workspaceDir: string;
  buildDir: string;
  timeoutMs?: number; // default 300_000
};

export type SandboxTypecheckInput = {
  workspaceDir: string;
  timeoutMs?: number; // default 120_000
};

export type SandboxTypecheckResult = {
  ok: boolean;
  log: string; // 尾部截断 CHECK_LOG_TAIL_CHARS
};

export type Sandbox = {
  build(input: SandboxBuildInput): Promise<void>;
  typecheck(input: SandboxTypecheckInput): Promise<SandboxTypecheckResult>;
};

export class SandboxBuildError extends Error {
  readonly logTail: string;
  constructor(message: string, logTail: string) {
    super(message);
    this.name = "SandboxBuildError";
    this.logTail = logTail;
  }
}
