<script setup lang="ts">
import { computed, ref, watch } from "vue";
import SkillSelect from "./SkillSelect.vue";
import PluginSelect from "./PluginSelect.vue";
import ConnectorSelect from "./ConnectorSelect.vue";
import ChatKbPicker from "./ChatKbPicker.vue";
import ChatExpertPicker from "./ChatExpertPicker.vue";
import CapabilityCategoryIcon from "./CapabilityCategoryIcon.vue";
import type { ExpertDto, KbDto, PluginDto } from "@pi-web-ui/shared";
import type { ComposerResourceSelection } from "../utils/composer-tokens.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{
  mode: "session" | "draft";
  menuLayout?: boolean;
  projectId: string;
  sessionId?: string;
  disabled?: boolean;
  skillNames?: string[];
  pluginIds?: string[];
  connectorIds?: string[];
  expertId?: string | null;
}>();

const emit = defineEmits<{
  (event: "select-skill", name: string): void;
  (event: "update:pluginIds", value: string[]): void;
  (event: "update:connectorIds", value: string[]): void;
  (event: "update:expertId", value: string | null): void;
  (event: "import-skill"): void;
  (event: "manage-connectors"): void;
  (event: "resource-selected", value: ComposerResourceSelection): void;
  (event: "pick-files"): void;
}>();

type MenuCategory = "files" | "skills" | "connectors" | "plugins" | "experts" | "knowledge";
const { t } = useI18n();
const activeCategory = ref<MenuCategory>("files");
const searchQuery = ref("");
watch(activeCategory, () => { searchQuery.value = ""; });
const searchPlaceholder = computed(() => t("chat.resourceSearch", {
  category: menuCategories.value.find((category) => category.key === activeCategory.value)?.label ?? "",
}));
const menuCategories = computed(() => [
  { key: "files" as const, label: t("chat.fileCategory") },
  { key: "skills" as const, label: t("chat.addSkills") },
  { key: "connectors" as const, label: t("chat.addConnectors") },
  { key: "plugins" as const, label: t("chat.addPlugins") },
  { key: "experts" as const, label: t("chat.addExperts") },
  ...(props.mode === "session" && props.sessionId
    ? [{ key: "knowledge" as const, label: t("chat.addKnowledgeBases") }]
    : []),
]);

function selectSkill(name: string) {
  emit("select-skill", name);
}

function selectPlugin(plugin: PluginDto) {
  emit("resource-selected", { resourceId: plugin.id, kind: "plugin", label: plugin.name, icon: plugin.icon, value: `@${plugin.name}` });
}

function selectExpert(expert: ExpertDto) {
  emit("resource-selected", { resourceId: expert.id, kind: "expert", label: expert.name, icon: expert.icon, value: `@${expert.name}` });
}

function selectKnowledgeBase(kb: KbDto) {
  emit("resource-selected", { resourceId: kb.id, kind: "knowledge_base", label: kb.name, icon: "📚", value: `@${kb.name}` });
}

</script>

<template>
  <div v-if="props.menuLayout" class="capability-menu">
    <nav class="capability-menu-categories" :aria-label="t('chat.addMenu')">
      <button
        v-for="category in menuCategories"
        :key="category.key"
        type="button"
        class="capability-menu-category"
        :class="{ selected: activeCategory === category.key }"
        :aria-current="activeCategory === category.key ? 'page' : undefined"
        @click="activeCategory = category.key"
      >
        <span class="capability-menu-category-icon">
          <CapabilityCategoryIcon :name="category.key" />
        </span>
        <span>{{ category.label }}</span>
        <svg class="capability-menu-category-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="m4.5 2.5 3.5 3.5-3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </nav>
    <div class="capability-menu-detail">
      <div v-if="activeCategory !== 'files'" class="capability-menu-search">
        <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="7.5" cy="7.5" r="4.5" stroke="currentColor" stroke-width="1.4" />
          <path d="m11 11 4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
        <input v-model="searchQuery" type="search" :placeholder="searchPlaceholder" :aria-label="searchPlaceholder" autocomplete="off" @keydown.enter.stop.prevent />
        <button v-if="searchQuery" type="button" :aria-label="t('chat.clearResourceSearch')" @click="searchQuery = ''">×</button>
      </div>
      <div v-show="activeCategory === 'files'" class="capability-menu-file-options">
        <div class="capability-menu-section-title">{{ t('chat.fileCategory') }}</div>
        <button type="button" class="capability-menu-resource" @click="emit('pick-files')">
          <span class="capability-menu-resource-icon">↑</span>
          <span class="capability-menu-resource-copy"><strong>{{ t('chat.uploadFiles') }}</strong><small>{{ t('chat.uploadHint') }}</small></span>
        </button>
      </div>
      <div v-show="activeCategory === 'skills'" class="capability-menu-resource-list">
        <SkillSelect :inline="true" :search-query="searchQuery" @select="selectSkill" @import="emit('import-skill')" />
      </div>
      <div v-show="activeCategory === 'connectors'" class="capability-menu-resource-list">
        <ConnectorSelect
          :inline="true" :search-query="searchQuery"
          :project-id="projectId"
          :draft="props.mode === 'draft'"
          :model-value="connectorIds"
          :disabled="disabled"
          @manage="emit('manage-connectors')"
          @update:model-value="emit('update:connectorIds', $event)"
        />
      </div>
      <div v-show="activeCategory === 'plugins'" class="capability-menu-resource-list">
        <PluginSelect
          :inline="true" :search-query="searchQuery"
          :session-id="sessionId"
          :draft="props.mode === 'draft'"
          :model-value="pluginIds"
          :disabled="disabled"
          @update:model-value="emit('update:pluginIds', $event)"
          @selected="selectPlugin"
        />
      </div>
      <div v-show="activeCategory === 'experts'" class="capability-menu-resource-list">
        <ChatExpertPicker
          :inline="true" :search-query="searchQuery"
          :session-id="sessionId"
          :draft="props.mode === 'draft'"
          :model-value="expertId"
          @update:model-value="emit('update:expertId', $event)"
          @selected="selectExpert"
        />
      </div>
      <div v-if="props.mode === 'session' && sessionId" v-show="activeCategory === 'knowledge'" class="capability-menu-resource-list">
        <ChatKbPicker :inline="true" :search-query="searchQuery" :session-id="sessionId" @selected="selectKnowledgeBase" />
      </div>
    </div>
  </div>
  <div class="capability-toolbar">
    <template v-if="!props.menuLayout">
      <SkillSelect @select="selectSkill" @import="emit('import-skill')" />
      <ChatExpertPicker
        :session-id="sessionId"
        :draft="props.mode === 'draft'"
        :model-value="expertId"
        @update:model-value="emit('update:expertId', $event)"
        @selected="selectExpert"
      />
      <ChatKbPicker v-if="props.mode === 'session' && sessionId" :session-id="sessionId" @selected="selectKnowledgeBase" />
      <PluginSelect
        :session-id="sessionId"
        :draft="props.mode === 'draft'"
        :model-value="pluginIds"
        :disabled="disabled"
        @update:model-value="emit('update:pluginIds', $event)"
        @selected="selectPlugin"
      />
      <ConnectorSelect
        :project-id="projectId"
        :draft="props.mode === 'draft'"
        :model-value="connectorIds"
        :disabled="disabled"
        @manage="emit('manage-connectors')"
        @update:model-value="emit('update:connectorIds', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.capability-toolbar {
  display: contents;
}

.capability-menu {
  display: grid;
  min-width: 0;
  height: min(254px, calc(60vh - 44px));
  min-height: 0;
  grid-template-columns: minmax(158px, 26%) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}

.capability-menu-categories {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border-right: 1px solid var(--border-subtle);
}

.capability-menu-category {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 9px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.capability-menu-category:hover,
.capability-menu-category.selected {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.capability-menu-category-icon {
  display: flex;
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: flex-start;
  color: var(--text-muted);
}

.capability-menu-category-chevron {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--text-faint);
}

.capability-menu-detail {
  min-width: 0;
  min-height: 0;
  max-height: none;
  overflow: auto;
  padding: 10px;
}

.capability-menu-search {
  position: sticky;
  top: -10px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  margin-bottom: 10px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-surface);
  color: var(--text-muted);
}
.capability-menu-search:focus-within { border-color: var(--accent); }
.capability-menu-search input {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
}
.capability-menu-search input::-webkit-search-cancel-button { display: none; }
.capability-menu-search button {
  border: 0;
  padding: 0 3px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
}

.capability-menu-section-title {
  padding: 4px 8px 7px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.capability-menu-resource {
  display: flex;
  width: 100%;
  min-height: 50px;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.capability-menu-resource:hover,
.capability-menu-resource:focus-visible {
  outline: none;
  background: var(--bg-hover);
}

.capability-menu-resource-icon {
  display: grid;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 15px;
}

.capability-menu-resource-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.capability-menu-resource-copy strong {
  font-size: 12px;
  font-weight: 550;
}

.capability-menu-resource-copy small {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capability-menu-resource-list :deep(.skill-select),
.capability-menu-resource-list :deep(.plugin-select) {
  display: block;
  width: 100%;
}
</style>
