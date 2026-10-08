<script setup lang="ts">
import { computed } from "vue";
import { connectorIconUrl } from "../utils/connector-icons.js";

const props = withDefaults(defineProps<{
  icon: string;
  builtinKey?: string | null;
  size?: number;
}>(), { builtinKey: null, size: 20 });

const imageUrl = computed(() => connectorIconUrl(props.builtinKey));
</script>

<template>
  <img
    v-if="imageUrl"
    class="connector-brand-icon"
    :src="imageUrl"
    alt=""
    aria-hidden="true"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
  <span v-else class="connector-brand-icon-fallback" aria-hidden="true">{{ icon }}</span>
</template>

<style scoped>
.connector-brand-icon {
  display: block;
  flex: 0 0 auto;
  object-fit: contain;
}

.connector-brand-icon-fallback {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}
</style>
