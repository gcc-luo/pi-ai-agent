type NormalizedText = {
  value: string;
  rawStarts: number[];
  rawEnds: number[];
};

const BLOCK_SELECTOR = "p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre";

function normalizeWithOffsets(value: string): NormalizedText {
  let normalized = "";
  const rawStarts: number[] = [];
  const rawEnds: number[] = [];
  let pendingSpaceStart: number | null = null;

  for (let index = 0; index < value.length; index++) {
    const character = value[index] ?? "";
    if (/\s/.test(character)) {
      if (normalized && pendingSpaceStart === null) pendingSpaceStart = index;
      continue;
    }

    if (pendingSpaceStart !== null) {
      normalized += " ";
      rawStarts.push(pendingSpaceStart);
      rawEnds.push(index);
      pendingSpaceStart = null;
    }
    normalized += character.toLocaleLowerCase();
    rawStarts.push(index);
    rawEnds.push(index + 1);
  }

  return { value: normalized, rawStarts, rawEnds };
}

function textNodes(element: Element): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    if (node.data && !node.parentElement?.closest("script,style,code,mark")) nodes.push(node);
    current = walker.nextNode();
  }
  return nodes;
}

function wrapTextRange(element: Element, start: number, end: number): HTMLElement | null {
  const nodes = textNodes(element);
  const rawLength = nodes.reduce((length, node) => length + node.data.length, 0);
  if (start < 0 || end > rawLength || start >= end) return null;

  const segments: { node: Text; start: number; end: number }[] = [];
  let offset = 0;
  for (const node of nodes) {
    const nodeEnd = offset + node.data.length;
    const segmentStart = Math.max(0, start - offset);
    const segmentEnd = Math.min(node.data.length, end - offset);
    if (segmentStart < segmentEnd) segments.push({ node, start: segmentStart, end: segmentEnd });
    offset = nodeEnd;
    if (offset >= end) break;
  }

  let firstMark: HTMLElement | null = null;
  for (const segment of segments.reverse()) {
    let selected = segment.node;
    if (segment.end < selected.data.length) selected.splitText(segment.end);
    if (segment.start > 0) selected = selected.splitText(segment.start);
    const mark = element.ownerDocument.createElement("mark");
    mark.className = "kb-citation-highlight";
    selected.parentNode?.replaceChild(mark, selected);
    mark.appendChild(selected);
    firstMark = mark;
  }
  return firstMark;
}

function candidatePhrases(value: string): string[] {
  const normalized = normalizeWithOffsets(value).value;
  if (!normalized) return [];

  const sentences = value
    .split(/[。！？；.!?;\n]+/)
    .map((sentence) => normalizeWithOffsets(sentence).value)
    .filter((sentence) => sentence.length >= 8);
  return [...new Set([normalized, ...sentences.sort((left, right) => right.length - left.length)])];
}

/** Highlights the most specific passage found in rendered document content. */
export function highlightCitationText(container: HTMLElement, citationText: string): HTMLElement | null {
  const candidates = candidatePhrases(citationText);
  if (!candidates.length) return null;

  const blocks = Array.from(container.querySelectorAll(BLOCK_SELECTOR));
  if (!blocks.length) blocks.push(container);

  for (const candidate of candidates) {
    for (const block of blocks) {
      const nodes = textNodes(block);
      const rawText = nodes.map((node) => node.data).join("");
      const normalized = normalizeWithOffsets(rawText);
      const matchStart = normalized.value.indexOf(candidate);
      if (matchStart < 0) continue;
      const firstRawOffset = normalized.rawStarts[matchStart];
      const lastRawOffset = normalized.rawEnds[matchStart + candidate.length - 1];
      if (firstRawOffset === undefined || lastRawOffset === undefined) continue;
      const mark = wrapTextRange(block, firstRawOffset, lastRawOffset);
      if (mark) return mark;
    }
  }

  return null;
}
