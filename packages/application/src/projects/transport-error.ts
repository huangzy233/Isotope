/** SSE / ReadableStream 传输层错误，不得当作 LLM/业务失败写入「生成失败：…」。 */
export function isTransportDisconnectError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /Controller is already closed|Invalid state/i.test(err.message)
  );
}
