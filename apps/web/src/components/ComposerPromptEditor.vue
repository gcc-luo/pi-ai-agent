<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  getComposerPlainText,
  getComposerTokenElement,
  insertComposerToken,
  type ComposerResourceToken,
} from "../utils/composer-tokens.js";

const props = defineProps<{ placeholder: string }>();
const emit = defineEmits<{
  (event: "update", value: string): void;
  (event: "update-tokens", value: ComposerResourceToken[]): void;
  (event: "keydown", value: KeyboardEvent): void;
  (event: "paste", value: ClipboardEvent): void;
  (event: "compositionstart"): void;
  (event: "compositionend"): void;
  (event: "remove-token", value: ComposerResourceToken): void;
}>();

const editor = ref<HTMLDivElement | null>(null);
let savedRange: Range | null = null;

function rangeBelongsToEditor(range: Range): boolean {
  const root = editor.value;
  return Boolean(root && root.contains(range.startContainer) && root.contains(range.endContainer));
}

function saveSelection() {
  const root = editor.value;
  const selection = root?.ownerDocument.getSelection();
  if (!root || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (rangeBelongsToEditor(range)) savedRange = range.cloneRange();
}

function emitCurrentValue() {
  if (!editor.value) return;
  emit("update", getComposerPlainText(editor.value));
  emit("update-tokens", Array.from(editor.value.querySelectorAll<HTMLElement>("[data-composer-token]"), (element) => ({
    id: element.dataset.composerToken ?? "",
    resourceId: element.dataset.composerResourceId,
    kind: (element.dataset.composerKind ?? "file") as ComposerResourceToken["kind"],
    label: element.dataset.composerLabel ?? "",
    icon: element.dataset.composerIcon ?? element.querySelector<HTMLElement>(".composer-resource-token-icon")?.textContent ?? "",
    value: element.dataset.composerValue ?? "",
  })));
  saveSelection();
}

function insertToken(token: ComposerResourceToken) {
  if (!editor.value) return;
  insertComposerToken(editor.value, token, savedRange);
  savedRange = null;
  emitCurrentValue();
}

function clear() {
  if (!editor.value) return;
  editor.value.replaceChildren();
  savedRange = null;
  emit("update", "");
  emit("update-tokens", []);
}

function setText(value: string) {
  if (!editor.value) return;
  const root = editor.value;
  root.replaceChildren(document.createTextNode(value));
  root.focus();
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  savedRange = range.cloneRange();
  emit("update", getComposerPlainText(root));
  emit("update-tokens", []);
}

function removeTokens(kind: ComposerResourceToken["kind"], resourceId?: string) {
  const root = editor.value;
  if (!root) return;
  const removed = Array.from(root.querySelectorAll<HTMLElement>("[data-composer-kind]"))
    .filter((token) => token.dataset.composerKind === kind
      && (resourceId === undefined || token.dataset.composerResourceId === resourceId));
  if (!removed.length) return;
  removed.forEach((token) => token.remove());
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  savedRange = range.cloneRange();
  emitCurrentValue();
}

function focus() {
  if (!editor.value) return;
  editor.value.focus();
  if (savedRange && rangeBelongsToEditor(savedRange)) {
    const selection = editor.value.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedRange);
  }
}

function onClick(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const removeButton = event.target.closest<HTMLButtonElement>("[data-remove-composer-token]");
  const tokenElement = removeButton && getComposerTokenElement(removeButton, editor.value!);
  if (!removeButton || !tokenElement || !editor.value) return;

  event.preventDefault();
  event.stopPropagation();
  const token: ComposerResourceToken = {
    id: tokenElement.dataset.composerToken ?? "",
    resourceId: tokenElement.dataset.composerResourceId,
    kind: (tokenElement.dataset.composerKind ?? "file") as ComposerResourceToken["kind"],
    label: tokenElement.dataset.composerLabel ?? "",
    icon: tokenElement.dataset.composerIcon ?? tokenElement.querySelector<HTMLElement>(".composer-resource-token-icon")?.textContent ?? "",
    value: tokenElement.dataset.composerValue ?? "",
  };
  const range = editor.value.ownerDocument.createRange();
  range.setStartBefore(tokenElement);
  range.collapse(true);
  const selection = editor.value.ownerDocument.getSelection();
  tokenElement.remove();
  selection?.removeAllRanges();
  selection?.addRange(range);
  savedRange = range.cloneRange();

  const next = range.startContainer.childNodes[range.startOffset];
  if (next?.nodeType === Node.TEXT_NODE && next.textContent?.startsWith(" ")) {
    next.textContent = next.textContent.slice(1);
  }
  emit("remove-token", token);
  emitCurrentValue();
}

function onKeydown(event: KeyboardEvent) {
  saveSelection();
  emit("keydown", event);
}

function onPaste(event: ClipboardEvent) {
  saveSelection();
  emit("paste", event);
}

onMounted(() => document.addEventListener("selectionchange", saveSelection));
onBeforeUnmount(() => document.removeEventListener("selectionchange", saveSelection));

defineExpose({ clear, focus, insertToken, removeTokens, saveSelection, setText });
</script>

<template>
  <div
    ref="editor"
    class="composer-prompt-editor"
    contenteditable="true"
    role="textbox"
    aria-multiline="true"
    spellcheck="true"
    data-test="composer-prompt-editor"
    :data-placeholder="props.placeholder"
    @input="emitCurrentValue"
    @click="onClick"
    @keydown="onKeydown"
    @paste="onPaste"
    @focus="saveSelection"
    @blur="saveSelection"
    @keyup="saveSelection"
    @mouseup="saveSelection"
    @compositionstart="emit('compositionstart')"
    @compositionend="emit('compositionend')"
  />
</template>

<style scoped>
.composer-prompt-editor {
  flex: 1;
  min-width: 0;
  min-height: 78px;
  max-height: 180px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 13px 14px 10px;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  outline: none;
}

.composer-prompt-editor:empty::before {
  color: var(--text-faint);
  content: attr(data-placeholder);
  pointer-events: none;
}

.composer-prompt-editor :deep(.composer-resource-token) {
  display: inline-flex;
  max-width: min(240px, 70%);
  align-items: center;
  gap: 5px;
  margin: 0 2px;
  padding: 2px 5px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--accent) 9%, var(--bg-surface));
  color: var(--accent);
  font-size: 12px;
  line-height: 1.35;
  vertical-align: middle;
  white-space: nowrap;
}

.composer-prompt-editor :deep(.composer-resource-token-icon) {
  flex: 0 0 auto;
  font-size: 14px;
  line-height: 1;
}

.composer-prompt-editor :deep(.composer-resource-token-icon img) {
  display: block;
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.composer-prompt-editor :deep(.composer-resource-token-label) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.composer-prompt-editor :deep(.composer-resource-token-remove) {
  display: grid;
  flex: 0 0 15px;
  width: 15px;
  height: 15px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.composer-prompt-editor :deep(.composer-resource-token-remove:hover),
.composer-prompt-editor :deep(.composer-resource-token-remove:focus-visible) {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  outline: none;
}

@media (prefers-reduced-motion: reduce) {
  .composer-prompt-editor,
  .composer-prompt-editor :deep(.composer-resource-token),
  .composer-prompt-editor :deep(.composer-resource-token-remove) {
    scroll-behavior: auto;
    transition: none;
  }
}
</style>
