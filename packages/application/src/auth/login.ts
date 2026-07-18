import {
  createSessionToken,
  verifyUser,
  type DemoUser,
} from "@isotope/identity";

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

export function login(input: {
  username: string;
  password: string;
  users: DemoUser[];
  sessionSecret: string;
  ttlSeconds?: number;
}): LoginResult {
  const { username, password, users, sessionSecret, ttlSeconds = 60 * 60 * 24 * 7 } =
    input;
  if (!username || !password) {
    return { ok: false, error: "请输入用户名和密码" };
  }
  if (!verifyUser(username, password, users)) {
    return { ok: false, error: "用户名或密码错误" };
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = createSessionToken({ sub: username, exp }, sessionSecret);
  return { ok: true, token };
}
