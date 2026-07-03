<script setup lang="ts">
import { onMounted, ref } from "vue";
import { NLayout, NLayoutSider, NLayoutContent, NSelect, NEmpty, NButton } from "naive-ui";
import ChatPanel from "../components/ChatPanel.vue";
import FileTree from "../components/FileTree.vue";
import FileViewer from "../components/FileViewer.vue";
import { useProjectStore } from "../stores/project.js";
import { useSessionStore } from "../stores/session.js";

const props = defineProps<{ id: string }>();
const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const filePath = ref<string | null>(null);
const sessionId = ref<string | null>(null);

onMounted(async () => {
  await projectStore.loadOne(props.id);
  await sessionStore.loadForProject(props.id);
  if (!sessionStore.sessions.length) {
    const s = await sessionStore.create(props.id);
    sessionId.value = s.id;
  } else {
    sessionId.value = sessionStore.sessions[0]!.id;
  }
  if (sessionId.value) await sessionStore.open(sessionId.value);
});

async function newSession() {
  if (!projectStore.current) return;
  const s = await sessionStore.create(projectStore.current.id);
  sessionId.value = s.id;
  await sessionStore.open(s.id);
}
</script>

<template>
  <NLayout class="root" has-sider>
    <NLayoutSider :width="200" bordered>
      <h3>{{ projectStore.current?.name ?? "..." }}</h3>
      <NButton size="small" @click="newSession">+ Session</NButton>
      <NSelect
        :value="sessionId"
        :options="sessionStore.sessions.map(s => ({ label: s.title ?? s.id.slice(0, 8), value: s.id }))"
        @update:value="(v: string) => { sessionId = v; sessionStore.open(v); }"
      />
    </NLayoutSider>
    <NLayoutSider :width="240" bordered>
      <FileTree :project-id="id" @select="(p) => filePath = p" />
    </NLayoutSider>
    <NLayoutContent class="content">
      <div class="chat-wrap">
        <ChatPanel v-if="sessionId" :session-id="sessionId" />
        <NEmpty v-else description="No session" />
      </div>
      <div class="file-wrap">
        <FileViewer :project-id="id" :path="filePath" />
      </div>
    </NLayoutContent>
  </NLayout>
</template>

<style scoped>
.root { height: 100vh; }
.content { display: flex; flex-direction: column; }
.chat-wrap { flex: 1 1 60%; min-height: 0; }
.file-wrap { flex: 0 0 40%; border-top: 1px solid #eee; min-height: 0; }
</style>
