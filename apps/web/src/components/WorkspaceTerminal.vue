<script setup lang="ts">
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { closeTerminalSession, createTerminalSocket, parseTerminalServerMessage } from "../api/workspace-tools.js";
import { useI18n } from "../i18n/index.js";
import "@xterm/xterm/css/xterm.css";

const props = defineProps<{ sessionId: string; projectId: string; active: boolean }>();
type State = "disconnected" | "connecting" | "connected" | "error" | "ended";
const { t } = useI18n();
const state = ref<State>("disconnected");
const error = ref("");
const terminalHost = ref<HTMLElement | null>(null);
const stateText = (value: State) => t(`workspaceTools.terminalStatus.${value}`);

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let resizeObserver: ResizeObserver | null = null;
let inputSubscription: { dispose(): void } | null = null;
let socket: WebSocket | null = null;
let generation = 0;
let disposed = false;
let disposal: Promise<void> | undefined;
let lastSize = "";
let hasConnected = false;

function send(message: Record<string, unknown>) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try { socket.send(JSON.stringify(message)); return true; }
  catch { return false; }
}

function reportSize() {
  if (!terminal || !fitAddon || !props.active) return;
  try { fitAddon.fit(); }
  catch { /* A hidden tab may have no measurable cells until selected. */ return; }
  const cols = Math.max(20, Math.min(300, Math.floor(terminal.cols)));
  const rows = Math.max(5, Math.min(100, Math.floor(terminal.rows)));
  const key = `${cols}x${rows}`;
  if (key === lastSize || !send({ type: "resize", cols, rows })) return;
  lastSize = key;
}

function disconnect() {
  generation++;
  const previous = socket;
  socket = null;
  if (previous && previous.readyState < WebSocket.CLOSING) {
    try { previous.close(1000, "terminal panel inactive"); } catch { /* Best effort. */ }
  }
}

async function connect() {
  if (!props.active || disposed || state.value === "ended") return;
  const isReconnect = hasConnected;
  disconnect();
  const attempt = generation;
  state.value = "connecting";
  error.value = "";
  try {
    const candidate = createTerminalSocket(props.sessionId);
    socket = candidate;
    candidate.binaryType = "arraybuffer";
    candidate.onopen = () => {
      if (candidate !== socket || attempt !== generation) return;
      if (isReconnect) terminal?.reset();
      lastSize = "";
      state.value = "connected";
      hasConnected = true;
      error.value = "";
      reportSize();
      terminal?.focus();
    };
    candidate.onmessage = (event) => {
      if (candidate !== socket || attempt !== generation) return;
      if (typeof event.data === "string") {
        const message = parseTerminalServerMessage(event.data);
        if (!message) return;
        state.value = "ended";
        error.value = t("workspaceTools.terminalExited", { exitCode: message.exitCode });
        return;
      }
      if (event.data instanceof ArrayBuffer) terminal?.write(new Uint8Array(event.data));
      else if (ArrayBuffer.isView(event.data)) terminal?.write(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength));
      else if (event.data instanceof Blob) void event.data.arrayBuffer().then((buffer) => {
        if (candidate === socket && attempt === generation) terminal?.write(new Uint8Array(buffer));
      });
    };
    candidate.onerror = () => {
      if (candidate !== socket || attempt !== generation) return;
      state.value = "error";
      error.value = t("workspaceTools.terminalConnectionFailed");
    };
    candidate.onclose = (event) => {
      if (candidate !== socket) return;
      socket = null;
      if (attempt !== generation || !props.active || disposed || state.value === "ended") return;
      state.value = "error";
      error.value = event.reason || t("workspaceTools.terminalConnectionFailed");
    };
  } catch (cause) {
    if (attempt !== generation || !props.active || disposed) return;
    state.value = "error";
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function restart() {
  if (disposed || !props.active) return;
  disconnect();
  state.value = "connecting";
  error.value = "";
  try {
    await closeTerminalSession(props.sessionId);
    await nextTick();
    await connect();
  } catch (cause) {
    state.value = "error";
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function setActive(active: boolean) {
  if (active) {
    if (!terminal && terminalHost.value) initializeTerminal();
    if (state.value !== "ended") {
      if (!socket) void connect();
      else reportSize();
    }
  }
}

function initializeTerminal() {
  if (!terminalHost.value || terminal) return;
  terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    scrollback: 5_000,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    theme: { background: "#101217", foreground: "#d8dee9", cursor: "#7aa2f7" },
  });
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalHost.value);
  inputSubscription = terminal.onData((data) => send({ type: "input", data }));
  resizeObserver = new ResizeObserver(() => reportSize());
  resizeObserver.observe(terminalHost.value);
  reportSize();
}

async function dispose(): Promise<void> {
  if (disposal) return disposal;
  disposed = true;
  send({ type: "close" });
  disconnect();
  state.value = "disconnected";
  disposal = closeTerminalSession(props.sessionId).then(() => undefined).catch((cause: unknown) => {
    disposal = undefined;
    error.value = cause instanceof Error ? cause.message : String(cause);
    throw cause;
  });
  return disposal;
}

watch(() => props.active, setActive);
onMounted(() => {
  initializeTerminal();
  if (props.active) void connect();
});
onBeforeUnmount(() => {
  disconnect();
  resizeObserver?.disconnect();
  inputSubscription?.dispose();
  fitAddon?.dispose();
  terminal?.dispose();
});
defineExpose({ dispose });
</script>

<template>
  <section class="workspace-terminal" data-test="workspace-terminal">
    <div class="terminal-statusline" aria-live="polite">
      <span class="terminal-status-dot" :class="state" />
      <span>{{ stateText(state) }}</span>
      <span v-if="error" class="terminal-error" role="alert">{{ error }}</span>
      <button v-if="state === 'error'" type="button" data-test="terminal-retry" @click="connect">{{ t("workspaceTools.terminalRetry") }}</button>
      <button v-if="state === 'ended' || state === 'error'" type="button" data-test="terminal-restart" @click="restart">{{ t("workspaceTools.terminalRestart") }}</button>
    </div>
    <div ref="terminalHost" class="terminal-host" data-test="terminal-host" />
  </section>
</template>

<style scoped>
.workspace-terminal { display:flex; flex:1; flex-direction:column; min-width:0; min-height:0; overflow:hidden; background:#101217; }
.terminal-statusline { display:flex; align-items:center; gap:8px; min-height:28px; padding:0 10px; border-bottom:1px solid var(--border-subtle); color:var(--text-muted); font-size:10px; flex-shrink:0; }
.terminal-status-dot { width:6px; height:6px; border-radius:50%; background:currentColor; }
.terminal-status-dot.connected { color:var(--green); }
.terminal-status-dot.connecting { color:var(--amber); }
.terminal-status-dot.error { color:var(--rose); }
.terminal-error { overflow:hidden; color:var(--rose); text-overflow:ellipsis; white-space:nowrap; }
.terminal-statusline button { padding:3px 7px; border:0; border-radius:var(--radius-sm); background:transparent; color:var(--accent); cursor:pointer; font-size:10px; }
.terminal-host { flex:1; min-width:0; min-height:0; padding:8px; overflow:hidden; }
.terminal-host :deep(.xterm) { height:100%; }
</style>
