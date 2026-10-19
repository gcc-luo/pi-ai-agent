<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import type { WorkspacePreviewTarget } from "../stores/workspace-tools.js";
import { getWorkspacePreviewKind } from "./workspace-preview.js";

const props = defineProps<{ projectId: string; target: WorkspacePreviewTarget }>();
const FileViewer = defineAsyncComponent(() => import("./FileViewer.vue"));
const KbCitationViewer = defineAsyncComponent(() => import("./KbCitationViewer.vue"));
const previewKind = computed(() => getWorkspacePreviewKind(props.target));
const fileTarget = computed(() => props.target.kind === "file" ? props.target : null);
const citationTarget = computed(() => props.target.kind === "citation" ? props.target : null);
</script>

<template>
  <FileViewer
    v-if="previewKind === 'file' && fileTarget"
    :project-id="projectId"
    :path="fileTarget.path"
    hide-header
  />
  <KbCitationViewer v-else-if="citationTarget" :citation="citationTarget.citation" />
</template>
