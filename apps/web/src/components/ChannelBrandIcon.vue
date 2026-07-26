<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ type: string; fallback: string; label: string }>();

const iconSrc = computed(() => ({
  dingtalk: "/channel-icons/dingtalk.png",
  wecom: "/channel-icons/wecom.png",
  wechat: "/channel-icons/wechat.png",
})[props.type]);
</script>

<template>
  <span class="brand-icon" :class="`brand-icon--${type}`" role="img" :aria-label="label">
    <img v-if="iconSrc" :src="iconSrc" alt="" aria-hidden="true" />
    <span v-else class="brand-icon__fallback" aria-hidden="true">{{ fallback }}</span>
  </span>
</template>

<style scoped>
.brand-icon { display: inline-flex; width: 34px; height: 34px; flex: 0 0 34px; }
.brand-icon img { width: 100%; height: 100%; display: block; object-fit: contain; }
.brand-icon__fallback { font-size: 28px; line-height: 1; }
</style>
