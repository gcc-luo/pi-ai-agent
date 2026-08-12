import { ModelDto } from "@pi-web-ui/shared";
import { createHash } from "node:crypto";

export interface EmbeddingModelConfig {
  apiBaseUrl: string;
  apiKey: string;
  modelId: string;
  modelVersion?: string;
}

export interface EmbeddingResult {
  embeddings: number[][];
  dimension: number;
}

const EMBEDDING_TIMEOUT_MS = 30_000;
const DEFAULT_BATCH_SIZE = 64;
const MAX_ATTEMPTS = 3;

/**
 * Generate embeddings for multiple texts using an OpenAI-compatible API.
 */
export async function getEmbeddings(
  config: EmbeddingModelConfig,
  texts: string[]
): Promise<EmbeddingResult> {
  if (!texts.length) {
    return { embeddings: [], dimension: 0 };
  }

  const baseUrl = config.apiBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/embeddings`;

  console.log(`[Embedding] request: model=${config.modelId} texts=${texts.length} url=${url}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.modelId,
      input: texts,
    }),
    signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding API error: HTTP ${res.status} ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    data: { embedding: number[]; index: number }[];
    model: string;
    usage?: { total_tokens: number };
  };

  // Sort by index to ensure correct ordering
  const sorted = data.data.sort((a, b) => a.index - b.index);
  const embeddings = sorted.map((d) => d.embedding);
  const dimension = embeddings[0]?.length ?? 0;

  if (embeddings.length !== texts.length) {
    throw new Error(`Embedding API returned ${embeddings.length} vectors for ${texts.length} inputs`);
  }
  if (dimension === 0 || embeddings.some((v) => v.length !== dimension || v.some((n) => !Number.isFinite(n)))) {
    throw new Error("Embedding API returned invalid or inconsistent vectors");
  }

  console.log(`[Embedding] response: dimension=${dimension} tokens=${data.usage?.total_tokens ?? "?"}`);

  return { embeddings, dimension };
}

/**
 * Generate embeddings in bounded batches with retry/backoff. Providers commonly
 * reject very large input arrays even when every individual chunk is valid.
 */
export async function getEmbeddingsBatched(
  config: EmbeddingModelConfig,
  texts: string[],
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<EmbeddingResult> {
  const embeddings: number[][] = [];
  let dimension = 0;

  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batch = texts.slice(offset, offset + batchSize);
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await getEmbeddings(config, batch);
        if (dimension !== 0 && result.dimension !== dimension) {
          throw new Error(`Embedding dimension changed from ${dimension} to ${result.dimension}`);
        }
        dimension = result.dimension;
        embeddings.push(...result.embeddings);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 3 ** (attempt - 1)));
        }
      }
    }
    if (lastError) throw lastError;
  }

  return { embeddings, dimension };
}

/**
 * Generate embedding for a single text.
 */
export async function getEmbedding(
  config: EmbeddingModelConfig,
  text: string
): Promise<number[]> {
  const result = await getEmbeddings(config, [text]);
  return result.embeddings[0] ?? [];
}

/**
 * Encode a float32 array to a Buffer for SQLite BLOB storage.
 */
export function encodeEmbedding(vector: number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    const val = vector[i] ?? 0;
    buffer.writeFloatLE(val, i * 4);
  }
  return buffer;
}

/**
 * Decode a SQLite BLOB back to a float32 array.
 */
export function decodeEmbedding(blob: Buffer): number[] {
  const dim = Math.floor(blob.length / 4);
  const result: number[] = new Array(dim);
  for (let i = 0; i < dim; i++) {
    result[i] = blob.readFloatLE(i * 4);
  }
  return result;
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

/**
 * Build EmbeddingModelConfig from a ModelDto.
 */
export function modelToEmbeddingConfig(model: ModelDto): EmbeddingModelConfig | null {
  if (model.modelType !== "embedding") return null;
  if (!model.apiBaseUrl) return null;

  // For models without API key, we can't call the API
  // The key might be stored in the database but not returned to frontend
  // We'll handle this at the repository level
  return {
    apiBaseUrl: model.apiBaseUrl,
    apiKey: model.apiKey ?? "",
    modelId: model.id,
    modelVersion: embeddingModelVersion(model.apiBaseUrl, model.id),
  };
}

export function embeddingModelVersion(apiBaseUrl: string, modelId: string): string {
  return createHash("sha256")
    .update(`${apiBaseUrl.replace(/\/+$/, "")}\u0000${modelId}`)
    .digest("hex")
    .slice(0, 16);
}
