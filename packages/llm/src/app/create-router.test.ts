import { describe, expect, it } from "vitest";
import { createLlmRouter } from "./create-router.js";

function sseFixture(): string {
  return [
    'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ].join("");
}

describe("createLlmRouter", () => {
  it("routes two models on same provider with different body.model", async () => {
    const bodies: unknown[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(sseFixture(), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };
    const router = createLlmRouter({
      providers: [
        {
          id: "deepseek",
          type: "openai-compatible",
          baseUrl: "https://example.test",
          apiKeyEnv: "LLM_API_KEY",
          timeoutMs: 5000,
          models: ["m1", "m2"],
        },
      ],
      resolveApiKey: () => "sk-test",
      fetch: fetchFn,
    });
    for await (const _ of router.complete({
      model: "m1",
      messages: [{ role: "user", content: "a" }],
    })) {}
    for await (const _ of router.complete({
      model: "m2",
      messages: [{ role: "user", content: "b" }],
    })) {}
    expect((bodies[0] as { model: string }).model).toBe("m1");
    expect((bodies[1] as { model: string }).model).toBe("m2");
  });

  it("throws on unknown model", async () => {
    const router = createLlmRouter({
      providers: [
        {
          id: "deepseek",
          type: "openai-compatible",
          baseUrl: "https://example.test",
          apiKeyEnv: "LLM_API_KEY",
          timeoutMs: 5000,
          models: ["m1"],
        },
      ],
      resolveApiKey: () => "sk-test",
    });
    const iter = router
      .complete({
        model: "nope",
        messages: [{ role: "user", content: "x" }],
      })
      [Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow(/unknown model/i);
  });
});
