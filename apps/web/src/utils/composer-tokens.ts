export type ComposerTokenKind = "file" | "image" | "skill" | "plugin" | "expert" | "knowledge_base" | "connector";

export interface ComposerResourceSelection {
  resourceId?: string;
  kind: ComposerTokenKind;
  label: string;
  icon: string;
  value: string;
}

export interface ComposerResourceToken extends ComposerResourceSelection {
  id: string;
}

const TOKEN_LABELS: Record<ComposerTokenKind, string> = {
  file: "文件",
  image: "图片",
  skill: "技能",
  plugin: "插件",
  expert: "专家",
  knowledge_base: "知识库",
  connector: "连接器",
};

function isWithinEditor(editor: HTMLElement, node: Node): boolean {
  return node === editor || editor.contains(node);
}

export function insertComposerToken(
  editor: HTMLElement,
  token: ComposerResourceToken,
  savedRange?: Range | null,
): void {
  const doc = editor.ownerDocument;
  const selection = doc.getSelection();
  const activeRange = savedRange
    && isWithinEditor(editor, savedRange.startContainer)
    && isWithinEditor(editor, savedRange.endContainer)
    ? savedRange.cloneRange()
    : selection?.rangeCount && isWithinEditor(editor, selection.getRangeAt(0).startContainer)
      && isWithinEditor(editor, selection.getRangeAt(0).endContainer)
      ? selection.getRangeAt(0).cloneRange()
      : null;
  const range = activeRange ?? doc.createRange();

  if (!activeRange) {
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  editor.focus();
  selection?.removeAllRanges();
  selection?.addRange(range);
  range.deleteContents();

  const chip = doc.createElement("span");
  chip.className = "composer-resource-token";
  chip.contentEditable = "false";
  chip.dataset.composerToken = token.id;
  if (token.resourceId) chip.dataset.composerResourceId = token.resourceId;
  chip.dataset.composerKind = token.kind;
  chip.dataset.composerLabel = token.label;
  chip.dataset.composerValue = token.value;
  chip.setAttribute("role", "group");
  chip.setAttribute("aria-label", `${TOKEN_LABELS[token.kind]}：${token.label}`);

  const icon = doc.createElement("span");
  icon.className = "composer-resource-token-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = token.icon;
  chip.append(icon);

  const label = doc.createElement("span");
  label.className = "composer-resource-token-label";
  label.textContent = token.label;
  chip.append(label);

  const remove = doc.createElement("button");
  remove.type = "button";
  remove.className = "composer-resource-token-remove";
  remove.dataset.removeComposerToken = "true";
  remove.setAttribute("aria-label", `移除${TOKEN_LABELS[token.kind]}：${token.label}`);
  remove.textContent = "×";
  chip.append(remove);

  range.insertNode(chip);

  let trailingSpace = chip.nextSibling;
  if (trailingSpace?.nodeType !== Node.TEXT_NODE || !/^\s/.test(trailingSpace.textContent ?? "")) {
    trailingSpace = doc.createTextNode(" ");
    chip.after(trailingSpace);
  }

  const caret = doc.createRange();
  caret.setStart(trailingSpace, 1);
  caret.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(caret);
}

export function getComposerPlainText(editor: HTMLElement): string {
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "").replaceAll("\u00a0", " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node as HTMLElement;
    if (element.dataset.composerToken) return element.dataset.composerValue ?? "";
    if (element.tagName === "BR") return "\n";

    const text = Array.from(element.childNodes, serialize).join("");
    if ((element.tagName === "DIV" || element.tagName === "P") && text && !text.endsWith("\n")) {
      return `${text}\n`;
    }
    return text;
  };

  return Array.from(editor.childNodes, serialize).join("");
}

export function getComposerTokenElement(target: EventTarget | null, editor: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const token = target.closest<HTMLElement>("[data-composer-token]");
  return token && editor.contains(token) ? token : null;
}
