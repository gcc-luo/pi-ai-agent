const SKILL_TIP_BLOCK_RE = /<!-- skill-tip:start -->[\s\S]*?<!-- skill-tip:end -->\n*/g;
const ATTACHED_FILE_RE = /```\w+\s+title="[^"]+"\n[\s\S]*?```\n?/g;
const SKILL_SUFFIX_RE = /\s*\/skill:[\w-]+/g;

const SEARCH_PREFIX_PATTERNS = [
  /^(?:(?:请|麻烦)?(?:帮我|帮忙|替我)(?:在|从)?(?:当前|这个|该)?(?:知识库|资料库|文档库)?(?:里面|里|中|内)?(?:帮我|帮忙)?(?:搜索|搜|查|查找|查看|查询|查阅|检索|找)(?:一下)?[\s，,：:。！？!?]*)+/i,
  /^(?:(?:请|麻烦)?(?:在|从)?(?:当前|这个|该)?(?:知识库|资料库|文档库)(?:里面|里|中|内)?(?:帮我|帮忙)?(?:搜索|搜|查|查找|查看|查询|查阅|检索|找)(?:一下)?[\s，,：:。！？!?]*)+/i,
  /^(?:(?:请|麻烦)?(?:帮我|帮忙|替我)?(?:搜索|搜|查|查找|查看|查询|查阅|检索|找)(?:一下)?[\s，,：:。！？!?]*)+/i,
  /^(?:(?:请问|请|麻烦)\s*)+/i,
];

const CONVERSATIONAL_FILLER_RE = /(?:请帮忙|请帮助|帮我|帮忙|替我|请问|麻烦|谢谢|感谢|可以吗|好吗)/gi;
const KNOWLEDGE_BASE_REFERENCE_RE = /(?:当前|这个|该)?(?:知识库|资料库|文档库)(?:里面|里|中|内)?/gi;

/** Return the text the user typed, excluding transport-only prompt wrappers. */
export function extractUserSearchQuery(content: string): string {
  return content
    .replace(SKILL_TIP_BLOCK_RE, " ")
    .replace(ATTACHED_FILE_RE, " ")
    .replace(SKILL_SUFFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keep the user's full wording and add a compact retrieval variant. Embedding
 * models are good at natural language already; the compact variant mainly
 * prevents request framing such as "帮我搜索知识库中..." from dominating it.
 */
export function buildSearchQueryVariants(query: string): string[] {
  const original = query.replace(/\s+/g, " ").trim();
  if (!original) return [];

  let normalized = original;
  for (const pattern of SEARCH_PREFIX_PATTERNS) normalized = normalized.replace(pattern, "");
  normalized = normalized
    .replace(KNOWLEDGE_BASE_REFERENCE_RE, " ")
    .replace(CONVERSATIONAL_FILLER_RE, " ")
    .trimStart()
    .replace(/^(?:(?:中|内|里|和|与|的|关于|有关|其中|内部)\s*)+/, "")
    .replace(/^[\s，,：:。！？!?、;；]+|[\s，,：:。！？!?、;；]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // If normalization stripped too much, preserve the user's original query.
  if ([...normalized].length < 2) normalized = original;
  return [...new Set([original, normalized])];
}
