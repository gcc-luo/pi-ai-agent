import { describe, expect, it } from "vitest";
import { responseBodyError } from "../../src/routes/models.js";

describe("model response parsing", () => {
  it("detects errors hidden inside successful SSE responses", () => {
    expect(responseBodyError(
      'data: {"error":{"message":"HTTP Error: 400","type":"http_error"}}\n\n',
    )).toBe("HTTP Error: 400");
  });

  it("does not treat normal SSE chunks as errors", () => {
    expect(responseBodyError(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
    )).toBeNull();
  });

  it("detects gateways that wrap the JSON error body in a string", () => {
    expect(responseBodyError(
      '"{\\"error\\":{\\"message\\":\\"Unexpected item type in content.\\"}}"',
    )).toBe("Unexpected item type in content.");
  });
});
