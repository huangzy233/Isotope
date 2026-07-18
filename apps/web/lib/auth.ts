import { cookies } from "next/headers";
import { getSession, login as appLogin } from "@isotope/application";
import { loadDemoUsers, type DemoUser } from "@isotope/identity";
import { demoUsersConfigPath } from "./paths";

export const SESSION_COOKIE = "isotope_session";

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

let cachedUsers: DemoUser[] | null = null;

export function getDemoUsers(): DemoUser[] {
  if (!cachedUsers) cachedUsers = loadDemoUsers(demoUsersConfigPath());
  return cachedUsers;
}

export async function readSession(): Promise<{ username: string } | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSession(token, getSessionSecret());
}

export function loginWithPassword(username: string, password: string) {
  return appLogin({
    username,
    password,
    users: getDemoUsers(),
    sessionSecret: getSessionSecret(),
  });
}
