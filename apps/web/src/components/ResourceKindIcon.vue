<script setup lang="ts">
import ExpertAvatar from "./ExpertAvatar.vue";
import PluginAvatar from "./PluginAvatar.vue";

const props = withDefaults(defineProps<{
  kind: "expert" | "plugin";
  size?: number;
  expertId?: string;
  pluginId?: string;
  name?: string;
}>(), { size: 20, expertId: "", pluginId: "", name: "" });

</script>

<template>
  <ExpertAvatar v-if="kind === 'expert'" :expert-id="expertId || name" :name="name" :size="size" />
  <PluginAvatar v-else :plugin-id="pluginId || name" :name="name" :size="size" />
</template>
