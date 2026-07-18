import { verifySessionToken } from "@isotope/identity";

export function getSession(
  token: string,
  sessionSecret: string,
): { username: string } | null {
  const payload = verifySessionToken(token, sessionSecret);
  if (!payload) return null;
  return { username: payload.sub };
}
