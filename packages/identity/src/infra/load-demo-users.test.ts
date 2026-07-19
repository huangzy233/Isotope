import { describe, expect, it } from "vitest";
import { loadDemoUsers } from "./load-demo-users.js";

describe("loadDemoUsers", () => {
  it("loads multiple users from DEMO_USERS JSON", () => {
    expect(
      loadDemoUsers({
        DEMO_USERS: JSON.stringify([
          { username: "demo", password: "demo" },
          { username: "reviewer", password: "reviewer" },
        ]),
      }),
    ).toEqual([
      { username: "demo", password: "demo" },
      { username: "reviewer", password: "reviewer" },
    ]);
  });

  it("trims username whitespace", () => {
    expect(
      loadDemoUsers({
        DEMO_USERS: JSON.stringify([
          { username: "  demo  ", password: "secret" },
        ]),
      }),
    ).toEqual([{ username: "demo", password: "secret" }]);
  });

  it("throws when DEMO_USERS is missing or invalid", () => {
    expect(() => loadDemoUsers({})).toThrow(/DEMO_USERS must be set/);
    expect(() => loadDemoUsers({ DEMO_USERS: "not-json" })).toThrow(
      /DEMO_USERS must be valid JSON/,
    );
    expect(() => loadDemoUsers({ DEMO_USERS: "[]" })).toThrow(
      /non-empty JSON array/,
    );
    expect(() =>
      loadDemoUsers({ DEMO_USERS: JSON.stringify([{ username: "demo" }]) }),
    ).toThrow(/username: string, password: string/);
    expect(() =>
      loadDemoUsers({
        DEMO_USERS: JSON.stringify([{ username: "", password: "x" }]),
      }),
    ).toThrow(/non-empty username and password/);
  });
});
