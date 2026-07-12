<script setup lang="ts">
// Plain-text / code preview — the original FileViewer behaviour, isolated
// here so the new dispatch logic can swap it in without touching its styling.
defineProps<{ content: string }>();
</script>

<template>
  <div class="code-block">
    <table class="code-table">
      <tbody>
        <tr v-for="(line, i) in content.split('\n')" :key="i">
          <td class="line-num">{{ i + 1 }}</td>
          <td class="line-content"><pre>{{ line }}</pre></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.code-block {
  flex: 1;
  overflow: auto;
  padding: 10px 0;
}
.code-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  tab-size: 2;
}
.code-table tr {
  transition: background var(--transition-fast);
}
.code-table tr:hover {
  background: var(--row-hover);
}
.line-num {
  width: 48px;
  padding: 0 12px 0 14px;
  text-align: right;
  color: var(--text-faint);
  user-select: none;
  vertical-align: top;
  font-variant-numeric: tabular-nums;
}
.line-content {
  padding-right: 14px;
  color: var(--text-primary);
  vertical-align: top;
}
.line-content pre {
  margin: 0;
  white-space: pre;
}
</style>
