import { describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleClient } from "./openai-compatible.js";

describe("createOpenAiCompatibleClient", () => {
  it("posts chat completions and yields content deltas", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        const body = [
          'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ].join("");
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    );

    const client = createOpenAiCompatibleClient({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      timeoutMs: 5000,
      fetch: fetchMock,
    });

    const events = [];
    for await (const ev of client.complete({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(ev);
    }

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.com/v1/chat/completions");
    expect(init?.method).toBe("POST");
    const payload = JSON.parse(String(init?.body));
    expect(payload.model).toBe("deepseek-v4-pro");

    for await (const _ of client.complete({
      model: "other-model",
      messages: [{ role: "user", content: "hi" }],
    })) {
      /* drain */
    }
    const secondPayload = JSON.parse(
      String(fetchMock.mock.calls[1]![1]?.body),
    );
    expect(secondPayload.model).toBe("other-model");
    expect(payload.stream).toBe(true);
    expect(events).toEqual([
      { type: "content_delta", text: "你" },
      { type: "content_delta", text: "好" },
      { type: "finished", finishReason: "stop" },
    ]);
  });

  it("aggregates tool_call deltas into tool_calls event", async () => {
    const fetchMock = vi.fn(async () => {
      const body = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"write_file","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"a.ts\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ].join("");
      return new Response(body, { status: 200 });
    });
    const client = createOpenAiCompatibleClient({
      apiKey: "k",
      baseUrl: "https://example.com/v1",
      timeoutMs: 5000,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const events = [];
    for await (const ev of client.complete({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      tools: [
        {
          type: "function",
          function: {
            name: "write_file",
            description: "write",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    })) {
      events.push(ev);
    }
    expect(events[0]).toEqual({
      type: "tool_calls_begin",
      toolCalls: [{ id: "call_1", name: "write_file" }],
    });
    expect(events.at(-2)).toMatchObject({
      type: "tool_calls",
      toolCalls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "write_file",
            arguments: '{"path":"a.ts"}',
          },
        },
      ],
    });
    expect(events.at(-1)).toEqual({
      type: "finished",
      finishReason: "tool_calls",
    });
  });

  it("yields tool_call_args once path is visible in partial write_file arguments", async () => {
    const fetchMock = vi.fn(async () => {
      const body = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"write_file","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"src/App.tsx\\","}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"content\\":\\"hello world that is long\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ].join("");
      return new Response(body, { status: 200 });
    });
    const client = createOpenAiCompatibleClient({
      apiKey: "k",
      baseUrl: "https://example.com/v1",
      timeoutMs: 5000,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const events = [];
    for await (const ev of client.complete({
      model: "m",
      messages: [{ role: "user", content: "x" }],
    })) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual([
      "tool_calls_begin",
      "tool_call_args",
      "tool_calls",
      "finished",
    ]);
    expect(events[1]).toMatchObject({
      type: "tool_call_args",
      id: "c1",
      name: "write_file",
    });
    expect(
      (events[1] as { arguments: string }).arguments,
    ).toContain('"path":"src/App.tsx"');
  });

  it("yields tool_calls_begin before aggregated tool_calls when content preceded tools", async () => {
    const fetchMock = vi.fn(async () => {
      const body = [
        'data: {"choices":[{"delta":{"content":"我先读"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"read_file","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"index.html\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ].join("");
      return new Response(body, { status: 200 });
    });
    const client = createOpenAiCompatibleClient({
      apiKey: "k",
      baseUrl: "https://example.com/v1",
      timeoutMs: 5000,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const events = [];
    for await (const ev of client.complete({
      model: "m",
      messages: [{ role: "user", content: "x" }],
    })) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual([
      "content_delta",
      "tool_calls_begin",
      "tool_call_args",
      "tool_calls",
      "finished",
    ]);
  });
});
