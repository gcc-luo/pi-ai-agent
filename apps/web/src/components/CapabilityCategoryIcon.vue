<script setup lang="ts">
defineProps<{
  name: "files" | "skills" | "connectors" | "plugins" | "experts" | "knowledge";
}>();
</script>

<template>
  <svg class="capability-category-icon" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path
      v-if="name === 'files'"
      d="M6.5 9.5v4a3.5 3.5 0 007 0V5a2.5 2.5 0 00-5 0v8.5a1.5 1.5 0 003 0V6"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
    <template v-else-if="name === 'skills'">
      <path d="M3 6l1.5-2.5h9L15 6M3 6v8a1 1 0 001 1h10a1 1 0 001-1V6M3 6h12M7 10h4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
    </template>
    <template v-else-if="name === 'plugins'">
      <path d="M6.2 3.2V1.8M11.8 3.2V1.8M5 6h8v4.2a4 4 0 01-4 4H8a3 3 0 01-3-3V6z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M9 14.2V16M4 6h10" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
    </template>
    <template v-else-if="name === 'connectors'">
      <path d="m7.1 10.9-1.3 1.3a2.5 2.5 0 0 1-3.5-3.5l2-2a2.5 2.5 0 0 1 3.5 0" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
      <path d="m10.9 7.1 1.3-1.3a2.5 2.5 0 0 1 3.5 3.5l-2 2a2.5 2.5 0 0 1-3.5 0" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
      <path d="m6.5 11.5 5-5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
    </template>
    <template v-else-if="name === 'knowledge'">
      <path d="M3 3h4a2 2 0 012 2v10a1.5 1.5 0 00-1.5-1.5H3V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M15 3h-4a2 2 0 00-2 2v10a1.5 1.5 0 011.5-1.5H15V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    </template>
    <template v-else-if="name === 'experts'">
      <circle cx="9" cy="6" r="3" stroke="currentColor" stroke-width="1.4"/>
      <path d="M3 16c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </template>
  </svg>
</template>

<style scoped>
.capability-category-icon {
  display: block;
  flex: 0 0 18px;
}
</style>
