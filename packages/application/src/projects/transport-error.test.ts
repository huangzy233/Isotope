import { describe, expect, it } from "vitest";
import { isTransportDisconnectError } from "./transport-error.js";

describe("isTransportDisconnectError", () => {
  it("matches Controller is already closed", () => {
    expect(
      isTransportDisconnectError(
        new Error("Invalid state: Controller is already closed"),
      ),
    ).toBe(true);
  });

  it("does not match ordinary LLM errors", () => {
    expect(isTransportDisconnectError(new Error("rate limit"))).toBe(false);
    expect(isTransportDisconnectError("string")).toBe(false);
    expect(isTransportDisconnectError(null)).toBe(false);
  });
});
