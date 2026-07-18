import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { DemoUser } from "../domain/types.js";

type FileShape = { users?: DemoUser[] };

export function loadDemoUsers(configPath: string): DemoUser[] {
  const raw = readFileSync(configPath, "utf8");
  const data = parse(raw) as FileShape;
  if (!data?.users || !Array.isArray(data.users)) {
    throw new Error(`Invalid demo users config: ${configPath}`);
  }
  for (const u of data.users) {
    if (!u?.username || !u?.password) {
      throw new Error(`Invalid demo user entry in ${configPath}`);
    }
  }
  return data.users;
}
