const SKILL_TIP_BLOCK_RE = /<!-- skill-tip:start -->[\s\S]*?<!-- skill-tip:end -->\n*/g;
const ATTACHED_FILE_RE = /```\w+\s+title="[^"]+"\n[\s\S]*?```\n?/g;
const SKILL_SUFFIX_RE = /\s*\/skill:[\w-]+/g;

/** Return the text the user typed, excluding transport-only prompt wrappers. */
export function extractUserSearchQuery(content: string): string {
  return content
    .replace(SKILL_TIP_BLOCK_RE, " ")
    .replace(ATTACHED_FILE_RE, " ")
    .replace(SKILL_SUFFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}
