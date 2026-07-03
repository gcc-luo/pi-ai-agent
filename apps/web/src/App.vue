<script setup lang="ts">
import { NConfigProvider, NMessageProvider } from "naive-ui";
</script>

<template>
  <NConfigProvider>
    <NMessageProvider>
      <div class="app">
        <h1>pi-web-ui</h1>
        <p>Hello from the skeleton.</p>
      </div>
    </NMessageProvider>
  </NConfigProvider>
</template>
