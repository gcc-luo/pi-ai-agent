/**
 * FTS5 tokenization helpers for Chinese text using jieba word segmentation.
 *
 * The built-in `unicode61` tokenizer groups consecutive CJK characters into
 * one giant token (e.g. "夏日炎炎蝉声噪" → single token), making word-level
 * search impossible. We solve this by pre-segmenting text with jieba BEFORE
 * writing to the FTS5 index.
 *
 * Result: "夏日炎炎蝉声噪" → jieba → ["夏日", "炎炎", "蝉声", "噪"]
 * → inserted into FTS as "夏日 炎炎 蝉声 噪" (4 separate tokens).
 *
 * The original content in `kb_chunks` is NOT modified — only the FTS5 index
 * receives the pre-tokenized version. This is safe because `kb_chunks_fts`
 * uses `content='kb_chunks'` (external content mode), so snippet/highlight
 * functions read the original text from `kb_chunks`.
 */

import nodejieba from "nodejieba";

const CJK_RE = /[㐀-鿿]/;

/**
 * Pre-tokenize content for FTS5 indexing using jieba word segmentation.
 *
 * - Chinese text is segmented into words: "夏日炎炎" → "夏日 炎炎"
 * - Adjacent non-CJK tokens (English, digits) are merged back: "K" + "u" + "b" → "Kub..."
 * - Punctuation is kept as-is (unicode61 treats it as separator)
 *
 * Example outputs:
 *   "夏日炎炎蝉声噪" → "夏日 炎炎 蝉声 噪"
 *   "配置Kubernetes集群" → "配置 Kubernetes 集群"
 *   "【诗四·夏】" → "【 诗 四 · 夏 】"
 */
export function tokenizeForFts(content: string): string {
  const words = nodejieba.cut(content);

  // jieba splits English words into individual characters (e.g. "K8s" → ["K", "8", "s"]).
  // Merge consecutive non-CJK tokens back into whole words.
  const merged: string[] = [];
  let nonCjkBuf = "";

  for (const w of words) {
    if (CJK_RE.test(w)) {
      if (nonCjkBuf) { merged.push(nonCjkBuf); nonCjkBuf = ""; }
      merged.push(w);
    } else {
      nonCjkBuf += w;
    }
  }
  if (nonCjkBuf) merged.push(nonCjkBuf);

  return merged.join(" ");
}

/**
 * Segment a search query into FTS5 tokens using jieba.
 * Returns an array of tokens, each either a CJK word or a non-CJK string.
 * Punctuation-only tokens are filtered out.
 *
 * Example: "安装Kubernetes集群" → ["安装", "Kubernetes", "集群"]
 */
export function segmentQuery(query: string): string[] {
  const words = nodejieba.cut(query);
  const merged: string[] = [];
  let nonCjkBuf = "";

  for (const w of words) {
    if (CJK_RE.test(w)) {
      if (nonCjkBuf) { merged.push(nonCjkBuf); nonCjkBuf = ""; }
      merged.push(w);
    } else {
      nonCjkBuf += w;
    }
  }
  if (nonCjkBuf) merged.push(nonCjkBuf);

  // Filter out punctuation-only tokens and empty strings
  return merged.filter((t) => t.trim().length > 0 && /[a-zA-Z0-9㐀-鿿]/.test(t));
}
