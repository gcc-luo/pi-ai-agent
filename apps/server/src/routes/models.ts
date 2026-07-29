import { FastifyPluginAsync } from "fastify";
import { ModelType } from "@pi-web-ui/shared";

interface CreateBody {
  id: string;
  label: string;
  provider: string;
  modelType?: ModelType;
  apiBaseUrl?: string;
  apiKey?: string;
  isDefault?: boolean;
}

interface UpdateBody {
  id: string;
  label?: string;
  provider?: string;
  modelType?: ModelType;
  apiBaseUrl?: string | null;
  apiKey?: string | null;
  isDefault?: boolean;
}

interface TestBody {
  id?: string;
  provider: string;
  modelType?: ModelType;
  apiBaseUrl?: string;
  apiKey?: string;
  modelId?: string;
}

// 16×16 white PNG (base64). Some multimodal gateways reject images whose
// dimensions are 10 px or smaller, which made the previous 1×1 probe report
// capable models as unsupported.
const TEST_IMAGE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFklEQVR42mP4TyFgGDVg1IBRA4aLAQBdePwurSGpXgAAAABJRU5ErkJggg==";

// Check whether an error response body indicates the model does not support
// image/vision input. Common across OpenAI-compatible providers (OpenAI, Zhipu,
// DashScope, SiliconFlow, etc.) and Anthropic.
function bodyRejectsImage(body: string): boolean {
  const lower = body.toLowerCase();
  return /image|vision|multimodal|visual|picture|图片|视觉|多模态/.test(lower);
}

// Some OpenAI-compatible gateways return HTTP 200 while placing the real
// upstream failure in an SSE `data: {"error": ...}` frame. Checking only
// Response.ok incorrectly marks those models as healthy.
export function responseBodyError(body: string): string | null {
  const candidates = body
    .split(/\r?\n/)
    .map((line) => line.startsWith("data:") ? line.slice(5).trim() : line.trim())
    .filter((line) => line && line !== "[DONE]");

  for (const candidate of candidates) {
    try {
      const first = JSON.parse(candidate) as unknown;
      const parsed = (typeof first === "string" ? JSON.parse(first) : first) as {
        error?: string | { message?: string };
      };
      if (typeof parsed.error === "string") return parsed.error;
      if (parsed.error && typeof parsed.error.message === "string") return parsed.error.message;
    } catch {
      // A normal non-JSON response body is handled by the HTTP status below.
    }
  }
  return null;
}

async function testOpenAICompatible(apiBaseUrl: string, apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  console.log(`[ModelTest] text-openai: POST ${url} model=${modelId ?? "gpt-4o"}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId ?? "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text().catch(() => "");
    console.log(`[ModelTest] text-openai: status=${res.status} body=${body.slice(0, 500)}`);
    const bodyError = responseBodyError(body);
    if (bodyError) return { ok: false, error: bodyError };
    if (res.ok || res.status === 400) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e: any) {
    console.log(`[ModelTest] text-openai: exception=${e.message}`);
    return { ok: false, error: e.message ?? String(e) };
  }
}

async function testAnthropic(apiBaseUrl: string, apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/messages`;
  console.log(`[ModelTest] text-anthropic: POST ${url} model=${modelId ?? "claude-sonnet-4-20250514"}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId ?? "claude-sonnet-4-20250514",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text().catch(() => "");
    console.log(`[ModelTest] text-anthropic: status=${res.status} body=${body.slice(0, 500)}`);
    if (res.ok || res.status === 400) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e: any) {
    console.log(`[ModelTest] text-anthropic: exception=${e.message}`);
    return { ok: false, error: e.message ?? String(e) };
  }
}

async function testEmbeddingOpenAI(apiBaseUrl: string, apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/embeddings`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId ?? "text-embedding-3-small",
        input: "hi",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok || res.status === 400) return { ok: true };
    const body = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, error: e.message ?? String(e) };
  }
}

async function testMultimodalOpenAI(apiBaseUrl: string, apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  console.log(`[ModelTest] multimodal-openai: POST ${url} model=${modelId ?? "gpt-4o"}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId ?? "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "hi" },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${TEST_IMAGE_PNG_B64}` },
              },
            ],
          },
        ],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text().catch(() => "");
    console.log(`[ModelTest] multimodal-openai: status=${res.status} body=${body.slice(0, 500)}`);

    const bodyError = responseBodyError(body);
    if (bodyError) {
      if (bodyRejectsImage(body)) return { ok: false, warning: "model_not_multimodal" };
      return { ok: false, error: bodyError };
    }
    if (res.ok) return { ok: true };
    // 4xx with image-rejection keywords → model does not support vision input
    if (res.status >= 400 && res.status < 500 && bodyRejectsImage(body)) {
      return { ok: false, warning: "model_not_multimodal" };
    }
    if (res.status === 400) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e: any) {
    console.log(`[ModelTest] multimodal-openai: exception=${e.message}`);
    return { ok: false, error: e.message ?? String(e) };
  }
}

async function testMultimodalAnthropic(apiBaseUrl: string, apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/messages`;
  console.log(`[ModelTest] multimodal-anthropic: POST ${url} model=${modelId ?? "claude-sonnet-4-20250514"}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId ?? "claude-sonnet-4-20250514",
        max_tokens: 1,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "hi" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: TEST_IMAGE_PNG_B64,
                },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text().catch(() => "");
    console.log(`[ModelTest] multimodal-anthropic: status=${res.status} body=${body.slice(0, 500)}`);

    if (res.ok) return { ok: true };
    if (res.status >= 400 && res.status < 500 && bodyRejectsImage(body)) {
      return { ok: false, warning: "model_not_multimodal" };
    }
    if (res.status === 400) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e: any) {
    console.log(`[ModelTest] multimodal-anthropic: exception=${e.message}`);
    return { ok: false, error: e.message ?? String(e) };
  }
}

export const modelsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => {
    return app.models.list();
  });

  app.post("/", async (req, reply) => {
    const body = req.body as CreateBody;
    if (!body?.id || !body?.label || !body?.provider) {
      return reply.code(400).send({ error: "id, label, and provider are required" });
    }
    const existing = app.models.findById(body.id);
    if (existing) {
      return reply.code(409).send({ error: "model id already exists" });
    }
    const m = app.models.create(body);
    return reply.code(201).send(m);
  });

  app.put("/", async (req, reply) => {
    const body = req.body as UpdateBody;
    if (!body?.id) {
      return reply.code(400).send({ error: "id is required" });
    }
    const m = app.models.findById(body.id);
    if (!m) return reply.code(404).send({ error: "not found" });
    const { id, ...patch } = body;
    app.models.update(id, patch);
    return app.models.findById(id);
  });

  app.delete<{ Querystring: { id: string } }>("/", async (req, reply) => {
    const { id } = req.query;
    if (!id) return reply.code(400).send({ error: "id query param is required" });
    const m = app.models.findById(id);
    if (!m) return reply.code(404).send({ error: "not found" });
    app.models.delete(id);
    return reply.code(204).send();
  });

  app.post("/test", async (req) => {
    const body = req.body as TestBody;
    if (!body?.provider) return { ok: false, error: "provider is required" };

    // Resolve API key: form input → DB stored → env fallback
    let apiKey = body.apiKey;
    if (!apiKey && body.id) {
      apiKey = app.models.getApiKey(body.id) ?? undefined;
    }
    if (!apiKey) {
      const envKey = body.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      apiKey = process.env[envKey] ?? undefined;
    }
    if (!apiKey) return { ok: false, error: "API key is required" };

    // Resolve base URL: form input → DB stored → default
    let baseUrl = body.apiBaseUrl;
    if (!baseUrl && body.id) {
      const m = app.models.findById(body.id);
      baseUrl = m?.apiBaseUrl ?? undefined;
    }
    const defaultBase = body.provider === "anthropic"
      ? "https://api.anthropic.com/v1"
      : "https://api.openai.com/v1";
    baseUrl = baseUrl || defaultBase;

    const modelType: ModelType = body.modelType ?? "text";

    if (modelType === "embedding") {
      if (body.provider === "anthropic") {
        return { ok: false, error: "Anthropic does not provide an embeddings endpoint" };
      }
      return await testEmbeddingOpenAI(baseUrl, apiKey, body.modelId);
    }

    if (modelType === "multimodal") {
      if (body.provider === "anthropic") {
        return await testMultimodalAnthropic(baseUrl, apiKey, body.modelId);
      }
      return await testMultimodalOpenAI(baseUrl, apiKey, body.modelId);
    }

    // text
    if (body.provider === "anthropic") {
      return await testAnthropic(baseUrl, apiKey, body.modelId);
    }
    return await testOpenAICompatible(baseUrl, apiKey, body.modelId);
  });
};
