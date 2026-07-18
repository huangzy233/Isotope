import { describe, expect, it } from "vitest";
import { verifyUser } from "./verify-user.js";

const users = [
  { username: "demo", password: "demo" },
  { username: "reviewer", password: "reviewer" },
];

describe("verifyUser", () => {
  it("accepts a configured pair", () => {
    expect(verifyUser("demo", "demo", users)).toBe(true);
    expect(verifyUser("reviewer", "reviewer", users)).toBe(true);
  });
  it("rejects wrong password or unknown user", () => {
    expect(verifyUser("demo", "wrong", users)).toBe(false);
    expect(verifyUser("nope", "demo", users)).toBe(false);
  });
});
