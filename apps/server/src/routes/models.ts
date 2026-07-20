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

// 4x4 bright red square PNG (base64) — recognizable test image for multimodal probe.
// A vision-capable model should identify this as red/crimson/colored.
const RED_SQUARE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQI12P4z8BQz0BFwMDAwMDAxAAGIJqBAcxmYGJgAAAAPwEKAJ/YBkkAAAAASUVORK5CYII=";

// Check if model response describes visual content (color, shape, etc.)
function responseDescribesImage(text: string): boolean {
  const lower = text.toLowerCase();
  // Keywords indicating the model actually "saw" the image
  const visualKeywords = [
    "red", "crimson", "scarlet", "红色", "红",
    "color", "colour", "颜色", "色",
    "square", "rectangle", "shape", "方块", "方形", "形状",
    "image", "picture", "photo", "图片", "图像", "照片",
    "solid", "plain", "simple", "纯色",
    "bright", "dark", "light", "亮", "暗",
  ];
  return visualKeywords.some((kw) => lower.includes(kw));
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

// Check whether an error response body indicates the model does not support
// image/vision input. Common across OpenAI-compatible providers (OpenAI, Zhipu,
// DashScope, SiliconFlow, etc.).
function bodyRejectsImage(body: string): boolean {
  const lower = body.toLowerCase();
  return /image|vision|multimodal|visual|picture|图片|视觉|多模态/.test(lower);
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
              { type: "text", text: "Describe the color and shape you see in this image in one short sentence." },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${RED_SQUARE_PNG_B64}` },
              },
            ],
          },
        ],
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text().catch(() => "");
    console.log(`[ModelTest] multimodal-openai: status=${res.status} body=${body.slice(0, 500)}`);

    if (res.ok) {
      // Parse response and check if model actually described the image
      try {
        const json = JSON.parse(body);
        const content = json.choices?.[0]?.message?.content ?? "";
        console.log(`[ModelTest] multimodal-openai: response content="${content.slice(0, 200)}"`);
        if (!responseDescribesImage(content)) {
          console.log(`[ModelTest] multimodal-openai: model did not describe image visual content`);
          return { ok: true, warning: "model_not_multimodal" };
        }
      } catch {
        // Failed to parse, but HTTP was OK — assume connection works
      }
      return { ok: true };
    }

    // 400: connection works, but check if the model rejected the image
    if (res.status === 400 && bodyRejectsImage(body)) {
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
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe the color and shape you see in this image in one short sentence." },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: RED_SQUARE_PNG_B64,
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

    if (res.ok) {
      // Parse response and check if model actually described the image
      try {
        const json = JSON.parse(body);
        // Anthropic returns content as array: [{ type: "text", text: "..." }]
        const content = json.content?.[0]?.text ?? "";
        console.log(`[ModelTest] multimodal-anthropic: response content="${content.slice(0, 200)}"`);
        if (!responseDescribesImage(content)) {
          console.log(`[ModelTest] multimodal-anthropic: model did not describe image visual content`);
          return { ok: true, warning: "model_not_multimodal" };
        }
      } catch {
        // Failed to parse, but HTTP was OK — assume connection works
      }
      return { ok: true };
    }

    if (res.status === 400 && bodyRejectsImage(body)) {
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
