import path from "node:path";

export function monorepoRoot(): string {
  return path.resolve(process.cwd(), "../..");
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

export function llmConfigPath(): string {
  return path.join(monorepoRoot(), "configs/llm/default.yaml");
}

export function alexSystemPromptPath(): string {
  return path.join(monorepoRoot(), "prompts/coding/alex-system.v1.md");
}

export function mikeSystemPromptPath(): string {
  return path.join(monorepoRoot(), "prompts/leader/mike-system.v1.md");
}
