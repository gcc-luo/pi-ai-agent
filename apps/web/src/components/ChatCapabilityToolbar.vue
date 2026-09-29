<script setup lang="ts">
import SkillSelect from "./SkillSelect.vue";
import PluginSelect from "./PluginSelect.vue";
import ConnectorSelect from "./ConnectorSelect.vue";
import ChatKbPicker from "./ChatKbPicker.vue";
import ChatExpertPicker from "./ChatExpertPicker.vue";

const props = defineProps<{
  mode: "session" | "draft";
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
}>();

function selectSkill(name: string) {
  emit("select-skill", name);
}
</script>

<template>
  <div class="capability-toolbar">
    <SkillSelect @select="selectSkill" @import="emit('import-skill')" />
    <ChatExpertPicker
      :session-id="sessionId"
      :draft="props.mode === 'draft'"
      :model-value="expertId"
      @update:model-value="emit('update:expertId', $event)"
    />
    <ChatKbPicker v-if="props.mode === 'session' && sessionId" :session-id="sessionId" />
    <PluginSelect
      :session-id="sessionId"
      :draft="props.mode === 'draft'"
      :model-value="pluginIds"
      :disabled="disabled"
      @update:model-value="emit('update:pluginIds', $event)"
    />
    <ConnectorSelect
      :project-id="projectId"
      :draft="props.mode === 'draft'"
      :model-value="connectorIds"
      :disabled="disabled"
      @manage="emit('manage-connectors')"
      @update:model-value="emit('update:connectorIds', $event)"
    />
  </div>
</template>

<style scoped>
.capability-toolbar {
  display: contents;
}
</style>
