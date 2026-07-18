import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./session.js";

const secret = "test-secret";

describe("session token", () => {
  it("round-trips a valid payload", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = createSessionToken({ sub: "demo", exp }, secret);
    expect(verifySessionToken(token, secret)).toEqual({ sub: "demo", exp });
  });
  it("returns null for tampered or expired token", () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const expired = createSessionToken({ sub: "demo", exp }, secret);
    expect(verifySessionToken(expired, secret)).toBeNull();
    const valid = createSessionToken(
      { sub: "demo", exp: Math.floor(Date.now() / 1000) + 3600 },
      secret,
    );
    expect(verifySessionToken(valid + "x", secret)).toBeNull();
    expect(verifySessionToken(valid, "other")).toBeNull();
  });
});
