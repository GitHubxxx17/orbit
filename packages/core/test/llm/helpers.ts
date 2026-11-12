/** Shared helpers for LLM tests: build a streaming Response from text chunks. */
export function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

export function sseResponse(chunks: string[], init: ResponseInit = { status: 200 }): Response {
  return new Response(streamOf(chunks), init);
}

/** Format one JSON payload as an SSE event. */
export function event(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
