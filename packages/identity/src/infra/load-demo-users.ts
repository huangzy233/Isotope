import type { DemoUser } from "../domain/types.js";

type Env = Record<string, string | undefined>;

export function loadDemoUsers(env: Env = process.env): DemoUser[] {
  const raw = env.DEMO_USERS?.trim();
  if (!raw) {
    throw new Error("DEMO_USERS must be set");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DEMO_USERS must be valid JSON");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("DEMO_USERS must be a non-empty JSON array");
  }

  const users: DemoUser[] = [];
  for (const entry of parsed) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as DemoUser).username !== "string" ||
      typeof (entry as DemoUser).password !== "string"
    ) {
      throw new Error(
        "DEMO_USERS entries must be { username: string, password: string }",
      );
    }
    const username = (entry as DemoUser).username.trim();
    const password = (entry as DemoUser).password;
    if (!username || !password) {
      throw new Error(
        "DEMO_USERS entries must have non-empty username and password",
      );
    }
    users.push({ username, password });
  }
  return users;
}
