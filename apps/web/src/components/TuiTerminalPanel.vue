<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { webSocketUrl } from "../api/endpoints.js";

const props = defineProps<{ sessionId: string }>();

type TerminalStatus = "connecting" | "connected" | "disconnected" | "exited" | "error";
type TerminalServerEvent =
  | { type: "ready"; sessionId: string; pid: number }
  | { type: "output"; data: string }
  | { type: "exit"; code: number; signal?: number }
  | { type: "error"; code: string; message: string };

const container = ref<HTMLElement | null>(null);
const status = ref<TerminalStatus>("connecting");
const statusMessage = ref("Connecting to Pi TUI…");

let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let socket: WebSocket | undefined;
let resizeObserver: ResizeObserver | undefined;
let reconnectTimer: number | undefined;
let disposeInput: (() => void) | undefined;
let allowReconnect = true;

function socketUrl() {
  return webSocketUrl("/ws/terminal");
}

function send(event: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function fit() {
  if (!terminal || !fitAddon) return;
  try {
    fitAddon.fit();
    send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
  } catch {
    // The element may be hidden during a mode transition; the observer retries.
  }
}

function attach() {
  if (!terminal) return;
  send({ type: "attach", sessionId: props.sessionId, cols: terminal.cols, rows: terminal.rows });
}

function connect() {
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  status.value = "connecting";
  statusMessage.value = "Connecting to Pi TUI…";
  socket = new WebSocket(socketUrl());
  socket.onopen = () => attach();
  socket.onmessage = (message) => {
    let event: TerminalServerEvent;
    try { event = JSON.parse(message.data) as TerminalServerEvent; } catch { return; }
    if (event.type === "output") {
      terminal?.write(event.data);
    } else if (event.type === "ready") {
      status.value = "connected";
      statusMessage.value = `Pi TUI · PID ${event.pid}`;
      terminal?.focus();
    } else if (event.type === "exit") {
      status.value = "exited";
      statusMessage.value = `Pi TUI exited (${event.code})`;
      terminal?.writeln(`\r\n\x1b[90m[Pi TUI exited with code ${event.code}]\x1b[0m`);
    } else if (event.type === "error") {
      status.value = "error";
      statusMessage.value = event.message;
      terminal?.writeln(`\r\n\x1b[31m[${event.code}] ${event.message}\x1b[0m`);
    }
  };
  socket.onclose = () => {
    if (!allowReconnect || status.value === "exited") return;
    status.value = "disconnected";
    statusMessage.value = "Connection lost. Retrying…";
    reconnectTimer = window.setTimeout(connect, 1000);
  };
  socket.onerror = () => socket?.close();
}

function restart() {
  // The replayed terminal stream may include alternate-screen escape codes.
  // Resetting avoids carrying cursor/mode state from the previous attachment.
  terminal?.reset();
  connect();
}

function initialize() {
  if (!container.value) return;
  terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.35,
    scrollback: 10_000,
    theme: {
      background: "#111317",
      foreground: "#d7dce2",
      cursor: "#2dd4a8",
      selectionBackground: "rgba(45, 212, 168, 0.22)",
      black: "#111317",
      brightBlack: "#6b7280",
      green: "#2dd4a8",
      brightGreen: "#5eead4",
      blue: "#8ab4f8",
      brightBlue: "#b4d1ff",
      yellow: "#fbbf24",
      brightYellow: "#fcd34d",
      red: "#fb7185",
      brightRed: "#fda4af",
    },
  });
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container.value);
  const inputSubscription = terminal.onData((data) => send({ type: "input", data }));
  disposeInput = () => inputSubscription.dispose();
  resizeObserver = new ResizeObserver(() => fit());
  resizeObserver.observe(container.value);
  nextTick(() => {
    fit();
    connect();
  });
}

watch(() => props.sessionId, () => {
  terminal?.reset();
  if (socket?.readyState === WebSocket.OPEN) attach();
});

onMounted(initialize);
onBeforeUnmount(() => {
  allowReconnect = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  resizeObserver?.disconnect();
  disposeInput?.();
  socket?.close();
  terminal?.dispose();
});
</script>

<template>
  <section class="tui-terminal-panel" aria-label="Pi Coding TUI">
    <header class="tui-terminal-bar">
      <span class="tui-terminal-status" :class="status">
        <span class="tui-terminal-dot" />
        {{ statusMessage }}
      </span>
      <button class="tui-terminal-restart" type="button" @click="restart">Reconnect</button>
    </header>
    <div ref="container" class="tui-terminal" @click="terminal?.focus()" />
  </section>
</template>

<style scoped>
.tui-terminal-panel {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  background: #111317;
  color: #d7dce2;
}

.tui-terminal-bar {
  display: flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: #16191e;
  font-family: var(--font-mono);
  font-size: 11px;
}

.tui-terminal-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #9aa4b2;
}

.tui-terminal-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.tui-terminal-status.connected { color: #2dd4a8; }
.tui-terminal-status.connecting { color: #fbbf24; }
.tui-terminal-status.error { color: #fb7185; }

.tui-terminal-restart {
  margin-left: auto;
  padding: 3px 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: transparent;
  color: #9aa4b2;
  font: inherit;
  cursor: pointer;
}
.tui-terminal-restart:hover {
  border-color: #2dd4a8;
  color: #d7dce2;
}

.tui-terminal {
  flex: 1;
  min-height: 0;
  padding: 10px 12px;
  overflow: hidden;
}
.tui-terminal :deep(.xterm),
.tui-terminal :deep(.xterm-viewport) {
  height: 100%;
}
</style>
