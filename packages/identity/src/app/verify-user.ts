import type { DemoUser } from "../domain/types.js";

export function verifyUser(
  username: string,
  password: string,
  users: DemoUser[],
): boolean {
  return users.some((u) => u.username === username && u.password === password);
}
