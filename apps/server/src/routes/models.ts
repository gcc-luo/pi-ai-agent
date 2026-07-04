import { FastifyPluginAsync } from "fastify";

interface CreateBody {
  id: string;
  label: string;
  provider: string;
  apiBaseUrl?: string;
  apiKey?: string;
  isDefault?: boolean;
}

interface UpdateBody {
  id: string;
  label?: string;
  provider?: string;
  apiBaseUrl?: string | null;
  apiKey?: string | null;
  isDefault?: boolean;
}

interface TestBody {
  id?: string;
  provider: string;
  apiBaseUrl?: string;
  apiKey?: string;
  modelId?: string;
}

async function testOpenAICompatible(apiBaseUrl: string, apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
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
    if (res.ok || res.status === 400) return { ok: true };
    const body = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, error: e.message ?? String(e) };
  }
}

async function testAnthropic(apiBaseUrl: string, apiKey: string, modelId?: string): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/messages`;
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
    if (res.ok || res.status === 400) return { ok: true };
    const body = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e: any) {
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

    if (body.provider === "anthropic") {
      return await testAnthropic(baseUrl, apiKey, body.modelId);
    }
    return await testOpenAICompatible(baseUrl, apiKey, body.modelId);
  });
};
