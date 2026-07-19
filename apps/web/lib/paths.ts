import path from "node:path";

export function monorepoRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

export function promptsRoot(): string {
  return path.join(monorepoRoot(), "prompts");
}

export function llmConfigDir(): string {
  return path.join(monorepoRoot(), "configs/llm");
}

export function demoUsersConfigPath(): string {
  return path.join(monorepoRoot(), "configs/app/demo-users.yaml");
}

export function dataRoot(): string {
  return path.join(monorepoRoot(), "data");
}

export function templatePath(): string {
  return path.join(monorepoRoot(), "templates/vite-react");
}

export function writePolicyPath(): string {
  return path.join(monorepoRoot(), "configs/workspace/write-policy.yaml");
}
