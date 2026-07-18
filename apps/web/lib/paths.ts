import path from "node:path";

export function monorepoRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

export function demoUsersConfigPath(): string {
  return path.join(monorepoRoot(), "configs/app/demo-users.yaml");
}
