<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { NInput, NButton, NEmpty } from "naive-ui";
import { useAgentStore } from "../stores/agent.js";
import { api } from "../api/client.js";

const props = defineProps<{ sessionId: string }>();
const agent = useAgentStore();
const input = ref("");

const messages = computed(() => agent.messagesFor(props.sessionId));
const persistedMessages = ref<{ id: string; role: string; content: string | null }[]>([]);

onMounted(async () => {
  persistedMessages.value = await api.listMessages(props.sessionId);
});

function send() {
  if (!input.value.trim()) return;
  agent.send(props.sessionId, input.value);
  input.value = "";
}
</script>

<template>
  <div class="chat-panel">
    <div class="messages">
      <div v-for="m in persistedMessages" :key="m.id" :class="['msg', m.role]">
        <div class="role">{{ m.role }}</div>
        <div class="content">{{ m.content ?? "" }}</div>
      </div>
      <div v-for="m in messages" :key="m.id" :class="['msg', m.role]">
        <div class="role">{{ m.role }}<span v-if="m.status === 'streaming'">…</span></div>
        <div class="content">{{ m.content }}</div>
      </div>
      <NEmpty v-if="!messages.length && !persistedMessages.length" description="No messages yet" />
    </div>
    <div class="composer">
      <NInput v-model:value="input" type="textarea" :rows="2" placeholder="Send a message..." @keydown.enter.exact.prevent="send" />
      <NButton type="primary" @click="send">Send</NButton>
    </div>
  </div>
</template>

<style scoped>
.chat-panel { display: flex; flex-direction: column; height: 100%; }
.messages { flex: 1; overflow-y: auto; padding: 12px; }
.msg { margin: 8px 0; padding: 8px 12px; border-radius: 6px; }
.msg.user { background: #e6f7ff; }
.msg.assistant { background: #f6ffed; }
.role { font-size: 0.75em; color: #888; text-transform: uppercase; }
.composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #eee; }
</style>
