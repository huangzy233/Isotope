import { afterEach, describe, expect, it } from "vitest";
import {
  destroyTurnHub,
  ensureTurnHub,
  isTurnHubActive,
  publishTurnEvent,
  subscribeTurn,
} from "./turn-hub.js";

describe("turn-hub", () => {
  afterEach(() => {
    destroyTurnHub("p1");
  });

  it("publish fans out to all subscribers", () => {
    ensureTurnHub("p1");
    const a: unknown[] = [];
    const b: unknown[] = [];
    subscribeTurn("p1", (e) => a.push(e));
    subscribeTurn("p1", (e) => b.push(e));
    publishTurnEvent("p1", { type: "token", text: "x" });
    expect(a).toEqual([{ type: "token", text: "x" }]);
    expect(b).toEqual([{ type: "token", text: "x" }]);
  });

  it("subscriber throw is isolated; publish does not throw", () => {
    ensureTurnHub("p1");
    const ok: unknown[] = [];
    subscribeTurn("p1", () => {
      throw new Error("Invalid state: Controller is already closed");
    });
    subscribeTurn("p1", (e) => ok.push(e));
    expect(() =>
      publishTurnEvent("p1", { type: "token", text: "hi" }),
    ).not.toThrow();
    expect(ok).toEqual([{ type: "token", text: "hi" }]);
  });

  it("unsubscribe stops delivery; replay then live for new subscriber", () => {
    ensureTurnHub("p1");
    publishTurnEvent("p1", { type: "status", phase: "thinking" });
    publishTurnEvent("p1", { type: "token", text: "a" });
    const got: unknown[] = [];
    const unsub = subscribeTurn("p1", (e) => got.push(e));
    expect(got).toEqual([
      { type: "status", phase: "thinking" },
      { type: "token", text: "a" },
    ]);
    publishTurnEvent("p1", { type: "token", text: "b" });
    expect(got.at(-1)).toEqual({ type: "token", text: "b" });
    unsub?.();
    publishTurnEvent("p1", { type: "token", text: "c" });
    expect(got.filter((e) => (e as { text?: string }).text === "c")).toHaveLength(
      0,
    );
  });

  it("buffer drops oldest beyond 200", () => {
    ensureTurnHub("p1");
    for (let i = 0; i < 210; i++) {
      publishTurnEvent("p1", { type: "token", text: String(i) });
    }
    const got: unknown[] = [];
    subscribeTurn("p1", (e) => got.push(e));
    expect(got).toHaveLength(200);
    expect((got[0] as { text: string }).text).toBe("10");
    expect((got.at(-1) as { text: string }).text).toBe("209");
  });

  it("isTurnHubActive reflects ensure/destroy", () => {
    expect(isTurnHubActive("p1")).toBe(false);
    ensureTurnHub("p1");
    expect(isTurnHubActive("p1")).toBe(true);
    destroyTurnHub("p1");
    expect(isTurnHubActive("p1")).toBe(false);
  });
});
