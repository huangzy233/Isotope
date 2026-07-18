export type SandboxBuildInput = {
  workspaceDir: string;
  buildDir: string;
  timeoutMs?: number; // default 300_000
};

export type Sandbox = {
  build(input: SandboxBuildInput): Promise<void>;
};

export class SandboxBuildError extends Error {
  readonly logTail: string;
  constructor(message: string, logTail: string) {
    super(message);
    this.name = "SandboxBuildError";
    this.logTail = logTail;
  }
}
