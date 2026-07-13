import type { IncomingMessage } from "node:http";

export interface CollectedHttpResponse {
  readonly statusCode: number;
  readonly body: string;
}

/**
 * Collect an HTTP response stream into `{ statusCode, body }` and invoke
 * `onEnd` once the full body is buffered.
 *
 * Consolidates the repeated chunk-buffer + `Buffer.concat` + utf-8 decode
 * sequence that was duplicated across the skills.sh, SkillsMP, GitHub, and
 * preview HTTP clients. Callback-based (rather than Promise-based) so callers
 * keep full control of their resolve/reject and timeout wiring without
 * introducing floating promises.
 */
export function collectHttpResponse(res: IncomingMessage, onEnd: (response: CollectedHttpResponse) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => {
    onEnd({
      statusCode: res.statusCode ?? 500,
      body: Buffer.concat(chunks).toString("utf-8"),
    });
  });
}

/**
 * Return the response body only for a successful (2xx) non-empty response,
 * otherwise `undefined`.
 *
 * Shared by preview and skills.sh markdown fetchers that treat missing or
 * empty upstream content as `undefined` rather than an error.
 */
export function optionalResponseBody(response: { statusCode: number; body: string }): string | undefined {
  if (response.statusCode < 200 || response.statusCode >= 300 || response.body.trim().length === 0) {
    return undefined;
  }
  return response.body;
}
