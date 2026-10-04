/** Match all search terms across the resource's displayed name and description. */
export function matchesResourceSearch(
  query: string | undefined,
  ...fields: (string | null | undefined)[]
): boolean {
  const terms = (query ?? "")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const text = fields.filter(Boolean).join(" ").toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}
