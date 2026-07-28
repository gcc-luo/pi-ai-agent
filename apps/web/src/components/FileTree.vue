<script setup lang="ts">
import { ref, watch, h, nextTick } from "vue";
import { NTree, NModal, NInput, NRadioGroup, NRadio, NDropdown } from "naive-ui";
import { api } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import { useAgentStore } from "../stores/agent.js";
import type { TreeOption } from "naive-ui";
import type { FileNodeDto } from "@pi-web-ui/shared";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ (e: "select", path: string): void }>();

const { t } = useI18n();
const agent = useAgentStore();

const treeData = ref<TreeOption[]>([]);
const selectedKeys = ref<string[]>([]);
const selectedNode = ref<FileNodeDto | null>(null);

const dirIcon = h("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none" }, [
  h("path", {
    d: "M1.5 3a1 1 0 011-1h3.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293h3.586a1 1 0 011 1V11a1 1 0 01-1 1h-9a1 1 0 01-1-1V3z",
    stroke: "currentColor",
    "stroke-width": "1.2",
  }),
]);

const fileIcon = h("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none" }, [
  h("path", {
    d: "M4 1.5h4.586a1 1 0 01.707.293l2.414 2.414a1 1 0 01.293.707V12a1 1 0 01-1 1H4a1 1 0 01-1-1V2.5a1 1 0 011-1z",
    stroke: "currentColor",
    "stroke-width": "1.2",
  }),
  h("path", {
    d: "M8.5 1.5v3h3",
    stroke: "currentColor",
    "stroke-width": "1.2",
    "stroke-linejoin": "round",
  }),
]);

const renameIcon = h("svg", { width: 12, height: 12, viewBox: "0 0 12 12", fill: "none" }, [
  h("path", {
    d: "M2 10l1-3 5-5 2 2-5 5-3 1z",
    stroke: "currentColor",
    "stroke-width": "1.2",
    "stroke-linejoin": "round",
  }),
]);

const deleteIcon = h("svg", { width: 12, height: 12, viewBox: "0 0 12 12", fill: "none" }, [
  h("path", {
    d: "M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3M2 3h8M5 3V2h2v1",
    stroke: "currentColor",
    "stroke-width": "1.2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }),
]);

function toTree(nodes: FileNodeDto[]): TreeOption[] {
  return nodes.map((n) => ({
    key: n.path,
    label: n.name,
    isLeaf: n.type === "file",
    prefix: () =>
      h("span", { class: n.type === "directory" ? "tree-icon dir" : "tree-icon file" }, [
        n.type === "directory" ? dirIcon : fileIcon,
      ]),
    suffix: () =>
      h("span", {
        class: "tree-node-actions",
        onClick: (e: MouseEvent) => e.stopPropagation(),
      }, [
        h("button", {
          class: "node-action",
          title: t("file.renameTitle"),
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            startRename(n);
          },
        }, [renameIcon]),
        h("button", {
          class: "node-action danger",
          title: t("file.deleteTitle"),
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            startDelete(n);
          },
        }, [deleteIcon]),
      ]),
    children: n.children ? toTree(n.children) : undefined,
  }));
}

// ─── Context menu: Reveal in Folder / Open With... ───
const ctxMenu = ref<{ show: boolean; x: number; y: number; path: string }>({
  show: false, x: 0, y: 0, path: "",
});

const ctxMenuOptions = [
  { label: t("file.revealInFolder"), key: "reveal" },
  { type: "divider", key: "d1" },
  { label: t("file.open"), key: "open-file" },
  { label: t("file.openWith"), key: "open-with" },
];

function onContextMenu(node: FileNodeDto, e: MouseEvent) {
  if (node.type !== "file") return;
  e.preventDefault();
  selectedKeys.value = [node.path];
  selectedNode.value = node;
  ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, path: node.path };
}

// NTree reads nodeProps from its own prop, not from individual TreeOption
// objects. Keeping this mapping here makes right-click work for every row.
function nodeProps({ option }: { option: TreeOption }) {
  return {
    onContextmenu: (e: MouseEvent) => {
      if (!option.isLeaf || typeof option.key !== "string") return;
      onContextMenu({ name: String(option.label), path: option.key, type: "file" }, e);
    },
  };
}

async function onCtxMenuSelect(key: string) {
  const p = ctxMenu.value.path;
  ctxMenu.value = { ...ctxMenu.value, show: false };
  if (!p) return;
  try {
    await api.openFile(props.projectId, p, key as "reveal" | "open-file" | "open-with");
  } catch (err: any) {
    alert(t("file.openError") + ": " + (err?.message ?? String(err)));
  }
}

async function load() {
  try {
    const list = await api.listFiles(props.projectId, "/");
    treeData.value = toTree(list);
  } catch (e) {
    console.error("FileTree load failed", e);
  }
}

watch(() => props.projectId, load, { immediate: true });

// Push-based refresh: when Pi finishes a file-modifying tool (write/edit/bash),
// the server emits `file_changed` → the agent store bumps lastFileChange.
// Debounce so a burst of edits triggers one tree reload, not N.
let reloadTimer: number | null = null;
watch(() => agent.lastFileChange, () => {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => load(), 250);
});

function handleSelect(keys: string[]) {
  selectedKeys.value = keys;
  if (!keys[0]) {
    selectedNode.value = null;
    return;
  }
  const node = findNode(treeData.value, keys[0]);
  selectedNode.value = node;
  emit("select", keys[0]);
}

function findNode(nodes: TreeOption[], path: string): FileNodeDto | null {
  for (const n of nodes) {
    if (n.key === path) {
      const isDir = !n.isLeaf;
      return { name: String(n.label), path: String(n.key), type: isDir ? "directory" : "file" };
    }
    if (n.children) {
      const found = findNode(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

function parentDirOf(node: FileNodeDto | null): string {
  if (!node) return "";
  if (node.type === "directory") return node.path;
  const idx = node.path.lastIndexOf("/");
  return idx === -1 ? "" : node.path.slice(0, idx);
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

// ─── Create ───
const createShow = ref(false);
const createName = ref("");
const createType = ref<"file" | "directory">("file");
const createParent = ref("");
const createInputRef = ref<InstanceType<typeof NInput> | null>(null);
const createBusy = ref(false);

function startCreate() {
  createParent.value = parentDirOf(selectedNode.value);
  createName.value = "";
  createType.value = "file";
  createShow.value = true;
  nextTick(() => {
    const el = (createInputRef.value as any)?.$el as HTMLElement | undefined;
    const input = el?.querySelector("input") as HTMLInputElement | null;
    input?.focus();
  });
}

async function handleCreate() {
  const name = createName.value.trim();
  if (!name) return;
  const target = joinPath(createParent.value, name);
  createBusy.value = true;
  try {
    await api.createFile(props.projectId, target, createType.value);
    createShow.value = false;
    await load();
    selectedKeys.value = [target];
    selectedNode.value = { name, path: target, type: createType.value };
    emit("select", target);
  } catch (e: any) {
    console.error("create file failed", e);
    alert(e?.message ?? "create failed");
  } finally {
    createBusy.value = false;
  }
}

// ─── Rename ───
const renameShow = ref(false);
const renameTarget = ref<FileNodeDto | null>(null);
const renameName = ref("");
const renameInputRef = ref<InstanceType<typeof NInput> | null>(null);
const renameBusy = ref(false);

function startRename(node: FileNodeDto) {
  renameTarget.value = node;
  renameName.value = node.name;
  renameShow.value = true;
  nextTick(() => {
    const el = (renameInputRef.value as any)?.$el as HTMLElement | undefined;
    const input = el?.querySelector("input") as HTMLInputElement | null;
    input?.focus();
    input?.select();
  });
}

async function handleRename() {
  const node = renameTarget.value;
  if (!node) return;
  const name = renameName.value.trim();
  if (!name || name === node.name) {
    renameShow.value = false;
    return;
  }
  const to = joinPath(parentOf(node.path), name);
  renameBusy.value = true;
  try {
    await api.renameFile(props.projectId, node.path, to);
    renameShow.value = false;
    await load();
    selectedKeys.value = [to];
    selectedNode.value = { name, path: to, type: node.type };
    emit("select", to);
  } catch (e: any) {
    console.error("rename file failed", e);
    alert(e?.message ?? "rename failed");
  } finally {
    renameBusy.value = false;
  }
}

// ─── Delete ───
const deleteShow = ref(false);
const deleteTarget = ref<FileNodeDto | null>(null);
const deleteBusy = ref(false);

function startDelete(node: FileNodeDto) {
  deleteTarget.value = node;
  deleteShow.value = true;
}

async function handleDelete() {
  const node = deleteTarget.value;
  if (!node) return;
  deleteBusy.value = true;
  try {
    await api.deleteFile(props.projectId, node.path);
    deleteShow.value = false;
    if (selectedKeys.value[0] === node.path) {
      selectedKeys.value = [];
      selectedNode.value = null;
    }
    await load();
  } catch (e: any) {
    console.error("delete file failed", e);
    alert(e?.message ?? "delete failed");
  } finally {
    deleteBusy.value = false;
  }
}

defineExpose({ startCreate, refresh: load });
</script>

<template>
  <div class="file-tree">
    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :show="ctxMenu.show"
      :options="ctxMenuOptions"
      @select="onCtxMenuSelect"
      @clickoutside="() => { ctxMenu.show = false; }"
    />
    <NTree
      :data="treeData"
      :selected-keys="selectedKeys"
      :node-props="nodeProps"
      block-line
      selectable
      :indent="16"
      @update:selected-keys="handleSelect"
    />

    <!-- Create dialog -->
    <NModal :show="createShow" @update:show="(v: boolean) => { if (!v) createShow = false; }">
      <div class="dialog" @click.stop>
        <div class="dialog-header">
          <h3 class="dialog-title">{{ t('file.createTitle') }}</h3>
          <button class="dialog-close" @click="createShow = false">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <div class="dialog-body">
          <div class="field-row">
            <label class="field-label">{{ t('file.createName') }}</label>
            <NInput
              ref="createInputRef"
              v-model:value="createName"
              size="small"
              :placeholder="t('file.createNamePlaceholder')"
              @keydown.enter="handleCreate"
            />
          </div>
          <div class="field-row">
            <label class="field-label">{{ t('file.createType') }}</label>
            <NRadioGroup v-model:value="createType" name="fileType">
              <NRadio value="file">{{ t('file.typeFile') }}</NRadio>
              <NRadio value="directory">{{ t('file.typeDirectory') }}</NRadio>
            </NRadioGroup>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn-cancel" @click="createShow = false">{{ t('file.createCancel') }}</button>
          <button class="btn-save" :disabled="!createName.trim() || createBusy" @click="handleCreate">
            {{ t('file.createSave') }}
          </button>
        </div>
      </div>
    </NModal>

    <!-- Rename dialog -->
    <NModal :show="renameShow" @update:show="(v: boolean) => { if (!v) renameShow = false; }">
      <div class="dialog" @click.stop>
        <div class="dialog-header">
          <h3 class="dialog-title">{{ t('file.renameTitle') }}</h3>
          <button class="dialog-close" @click="renameShow = false">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <div class="dialog-body">
          <div class="field-row">
            <label class="field-label">{{ t('file.renameLabel') }}</label>
            <NInput
              ref="renameInputRef"
              v-model:value="renameName"
              size="small"
              :placeholder="t('file.renamePlaceholder')"
              @keydown.enter="handleRename"
            />
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn-cancel" @click="renameShow = false">{{ t('file.renameCancel') }}</button>
          <button class="btn-save" :disabled="!renameName.trim() || renameBusy" @click="handleRename">
            {{ t('file.renameSave') }}
          </button>
        </div>
      </div>
    </NModal>

    <!-- Delete confirm -->
    <NModal :show="deleteShow" @update:show="(v: boolean) => { if (!v) deleteShow = false; }">
      <div class="dialog" @click.stop>
        <div class="dialog-header">
          <h3 class="dialog-title">{{ t('file.deleteTitle') }}</h3>
        </div>
        <div class="dialog-body">
          <p class="delete-target">{{ deleteTarget?.path }}</p>
          <p class="delete-warn">{{ t('file.deleteMessage') }}</p>
        </div>
        <div class="dialog-actions">
          <button class="btn-cancel" @click="deleteShow = false">{{ t('file.deleteCancel') }}</button>
          <button class="btn-confirm danger" :disabled="deleteBusy" @click="handleDelete">
            {{ t('file.deleteConfirm') }}
          </button>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.file-tree {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 8px 12px;
}

.file-tree :deep(.n-tree) {
  --n-node-color-hover: var(--bg-hover);
  --n-node-color-active: var(--accent-dim);
  --n-text-color: var(--text-secondary);
  --n-font-size: 12px;
}

.file-tree :deep(.n-tree-node-content) {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 0;
  border-radius: var(--radius-sm);
  transition: background-color var(--transition-fast), color var(--transition-fast), transform var(--transition-fast);
}

.file-tree :deep(.n-tree-node-content:hover) {
  background: var(--bg-hover);
  color: var(--text-primary);
  transform: translateX(1px);
}

.file-tree :deep(.n-tree-node--selected .n-tree-node-content) {
  background: var(--accent-dim);
  color: var(--accent);
}

.file-tree :deep(.n-tree-node--selected) {
  position: relative;
}

.file-tree :deep(.n-tree-node--selected::before) {
  content: "";
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 2px;
  background: var(--accent);
  border-radius: 1px;
}

.file-tree :deep(.n-tree-node-switcher) {
  color: var(--text-faint);
}

.tree-icon {
  display: inline-flex;
  align-items: center;
  margin-right: 4px;
}

.tree-icon.dir {
  color: var(--amber);
  opacity: 0.7;
}

.tree-icon.file {
  color: var(--text-muted);
}

/* node action buttons (rename / delete) — hidden until the row is hovered */
.file-tree :deep(.tree-node-actions) {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.file-tree :deep(.n-tree-node:hover .tree-node-actions),
.file-tree :deep(.n-tree-node--selected .tree-node-actions) {
  opacity: 1;
}

.file-tree :deep(.node-action) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.file-tree :deep(.node-action:hover) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.file-tree :deep(.node-action.danger:hover) {
  background: var(--rose-dim, rgba(244, 63, 94, 0.15));
  color: var(--rose);
}

/* ─── Dialog (shared) ─── */
.dialog {
  width: 420px;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}
.dialog-title {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.dialog-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.dialog-body {
  padding: 4px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 16px;
}
.btn-cancel,
.btn-save,
.btn-confirm {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btn-cancel {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-muted);
}
.btn-cancel:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}
.btn-save {
  border: none;
  background: var(--accent);
  color: var(--bg-void);
}
.btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-save:not(:disabled):hover {
  filter: brightness(1.1);
}
.btn-confirm {
  border: none;
  background: var(--accent);
  color: var(--bg-void);
}
.btn-confirm.danger {
  background: var(--rose);
}
.btn-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-confirm:not(:disabled):hover {
  filter: brightness(1.1);
}

.delete-target {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-hover);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  word-break: break-all;
}
.delete-warn {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}
</style>
