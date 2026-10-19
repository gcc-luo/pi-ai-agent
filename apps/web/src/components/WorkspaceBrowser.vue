<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  backBrowserPanel,
  closeBrowserPanel,
  createBrowserSocket,
  forwardBrowserPanel,
  navigateBrowserPanel,
  openBrowserPanel,
  parseBrowserServerMessage,
  reloadBrowserPanel,
  scaleBrowserPoint,
  type BrowserClientMessage,
  type BrowserFrameMessage,
} from "../api/workspace-tools.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{
  sessionId: string;
  projectId: string;
  active: boolean;
}>();

type BrowserConnectionState = "disconnected" | "connecting" | "connected" | "error" | "missing";

const { t } = useI18n();
const connectionState = ref<BrowserConnectionState>("disconnected");
const address = ref("about:blank");
const frameSource = ref<string | null>(null);
const frameSize = ref({ width: 0, height: 0 });
const runtimeStatus = ref<{ screencasting?: boolean; engine?: string } | null>(null);
const errorMessage = ref("");
const pendingAction = ref(false);
const viewportRef = ref<HTMLElement | null>(null);
const connectionLabel = computed(() => t(`workspaceTools.browserStatus.${connectionState.value}`));
const retryAvailable = computed(() => props.active && connectionState.value === "error");

let socket: WebSocket | null = null;
let connectionGeneration = 0;
let frameGeneration = 0;
let disposed = false;
let disposal: Promise<void> | undefined;
const touchPointers = new Map<number, { x: number; y: number; force?: number }>();
let lastMousePoint: { x: number; y: number } | null = null;

function setError(message: string) {
  errorMessage.value = message;
  connectionState.value = "error";
}

function closeStream() {
  connectionGeneration++;
  const previous = socket;
  socket = null;
  if (previous && previous.readyState < WebSocket.CLOSING) {
    previous.close(1000, "browser panel inactive");
  }
  touchPointers.clear();
  lastMousePoint = null;
}

function send(message: BrowserClientMessage) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

async function renderFrame(message: BrowserFrameMessage, frameSocket: WebSocket) {
  const currentFrame = ++frameGeneration;
  const imageSource = `data:image/jpeg;base64,${message.data}`;
  const image = new Image();

  try {
    if (typeof image.decode === "function") {
      image.src = imageSource;
      await image.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not decode browser frame"));
        image.src = imageSource;
      });
    }

    if (currentFrame !== frameGeneration || frameSocket !== socket) return;
    const metadata = message.metadata;
    frameSize.value = {
      width: image.naturalWidth || (typeof metadata?.deviceWidth === "number" ? metadata.deviceWidth : 0),
      height: image.naturalHeight || (typeof metadata?.deviceHeight === "number" ? metadata.deviceHeight : 0),
    };
    frameSource.value = imageSource;
    await nextTick();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    if (currentFrame === frameGeneration && frameSocket === socket && frameSocket.readyState === WebSocket.OPEN) {
      send({ type: "ack", seq: message.seq });
    }
  } catch {
    if (currentFrame === frameGeneration) setError(t("workspaceTools.browserFrameDecodeFailed"));
  }
}

function onSocketMessage(event: MessageEvent, frameSocket: WebSocket) {
  const message = parseBrowserServerMessage(event.data);
  if (!message) {
    try {
      const candidate: unknown = typeof event.data === "string" ? JSON.parse(event.data) : null;
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)
        && (candidate as Record<string, unknown>).type === "frame") {
        frameGeneration++;
        setError(t("workspaceTools.browserFrameDecodeFailed"));
      }
    } catch {
      // Ignore unrelated malformed messages; only malformed frames can stall ACK pacing.
    }
    return;
  }

  if (message.type === "frame") {
    void renderFrame(message, frameSocket);
  } else if (message.type === "url") {
    address.value = message.url;
  } else if (message.type === "status") {
    runtimeStatus.value = {
      screencasting: typeof message.screencasting === "boolean" ? message.screencasting : undefined,
      engine: typeof message.engine === "string" ? message.engine : undefined,
    };
    if (message.error && typeof message.error === "string") errorMessage.value = message.error;
  }
}

function startConnection() {
  if (!props.active || disposed) return;
  const attempt = ++connectionGeneration;
  const previous = socket;
  socket = null;
  if (previous && previous.readyState < WebSocket.CLOSING) previous.close(1000, "browser panel reconnecting");
  errorMessage.value = "";
  connectionState.value = "connecting";
  runtimeStatus.value = null;

  void (async () => {
    try {
      await openBrowserPanel(props.sessionId);
      if (attempt !== connectionGeneration || !props.active || disposed) return;

      const candidate = createBrowserSocket(props.sessionId);
      socket = candidate;
      candidate.onopen = () => {
        if (candidate !== socket || attempt !== connectionGeneration) return;
        connectionState.value = "connected";
        errorMessage.value = "";
        send({ type: "config", pacing: "ack", maxFps: 10 });
      };
      candidate.onmessage = (event) => onSocketMessage(event, candidate);
      candidate.onerror = () => {
        if (candidate !== socket) return;
        setError(t("workspaceTools.browserConnectionFailed"));
        candidate.close();
      };
      candidate.onclose = (event) => {
        if (candidate !== socket) return;
        socket = null;
        if (attempt !== connectionGeneration || !props.active || disposed) return;
        if (event.code === 1008 && /session not found/i.test(event.reason)) {
          connectionState.value = "missing";
          errorMessage.value = t("workspaceTools.browserSessionMissing");
        } else {
          connectionState.value = "error";
          errorMessage.value = event.reason || t("workspaceTools.browserConnectionFailed");
        }
      };
    } catch (error) {
      if (attempt !== connectionGeneration || !props.active || disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      if (/session not found/i.test(message)) {
        connectionState.value = "missing";
        errorMessage.value = t("workspaceTools.browserSessionMissing");
      } else {
        setError(message || t("workspaceTools.browserConnectionFailed"));
      }
    }
  })();
}

function setActive(active: boolean) {
  if (active) {
    startConnection();
    return;
  }
  closeStream();
  connectionState.value = "disconnected";
  errorMessage.value = "";
}

function retryConnection() {
  if (!props.active || disposed) return;
  startConnection();
}

function normalizeAddress(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value === "about:blank") return value;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function navigate() {
  const target = normalizeAddress(address.value);
  if (!target) {
    errorMessage.value = t("workspaceTools.browserInvalidUrl");
    return;
  }
  pendingAction.value = true;
  errorMessage.value = "";
  try {
    await navigateBrowserPanel(props.sessionId, target);
    address.value = target;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    pendingAction.value = false;
  }
}

async function runNavigationAction(action: "back" | "forward" | "reload") {
  pendingAction.value = true;
  errorMessage.value = "";
  try {
    if (action === "back") await backBrowserPanel(props.sessionId);
    else if (action === "forward") await forwardBrowserPanel(props.sessionId);
    else await reloadBrowserPanel(props.sessionId);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    pendingAction.value = false;
  }
}

function modifiers(event: KeyboardEvent | PointerEvent | WheelEvent): number {
  return (event.altKey ? 1 : 0)
    | (event.ctrlKey ? 2 : 0)
    | (event.metaKey ? 4 : 0)
    | (event.shiftKey ? 8 : 0);
}

function browserPoint(event: PointerEvent | WheelEvent) {
  const rect = viewportRef.value?.getBoundingClientRect();
  if (!rect) return null;
  return scaleBrowserPoint(event.clientX, event.clientY, rect, frameSize.value.width, frameSize.value.height);
}

function onPointerDown(event: PointerEvent) {
  event.preventDefault();
  const point = browserPoint(event);
  if (!point) return;
  viewportRef.value?.focus();
  try { viewportRef.value?.setPointerCapture(event.pointerId); } catch {}
  if (event.pointerType === "touch") {
    touchPointers.set(event.pointerId, { ...point, force: event.pressure || undefined });
    send({ type: "input_touch", eventType: "touchStart", touchPoints: [...touchPointers.entries()].map(([id, position]) => ({ id, ...position })) });
    return;
  }

  lastMousePoint = point;
  const button = mouseButton(event.button);
  send({ type: "input_mouse", eventType: "mousePressed", ...point, button, clickCount: Math.max(1, Math.min(10, event.detail || 1)), modifiers: modifiers(event) });
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === "touch") {
    if (!touchPointers.has(event.pointerId)) return;
    const point = browserPoint(event);
    if (!point) return;
    touchPointers.set(event.pointerId, { ...point, force: event.pressure || undefined });
    send({ type: "input_touch", eventType: "touchMove", touchPoints: [...touchPointers.entries()].map(([id, position]) => ({ id, ...position })) });
    return;
  }

  const point = browserPoint(event);
  if (!point) return;
  lastMousePoint = point;
  const button = event.buttons & 1 ? "left" : event.buttons & 2 ? "right" : event.buttons & 4 ? "middle" : "none";
  send({ type: "input_mouse", eventType: "mouseMoved", ...point, button, modifiers: modifiers(event) });
}

function onPointerUp(event: PointerEvent) {
  try { viewportRef.value?.releasePointerCapture(event.pointerId); } catch {}
  if (event.pointerType === "touch") {
    touchPointers.delete(event.pointerId);
    send({ type: "input_touch", eventType: "touchEnd", touchPoints: [...touchPointers.entries()].map(([id, position]) => ({ id, ...position })) });
    return;
  }

  const point = browserPoint(event) ?? lastMousePoint;
  if (!point) return;
  send({ type: "input_mouse", eventType: "mouseReleased", ...point, button: mouseButton(event.button), modifiers: modifiers(event) });
  if (event.buttons === 0) lastMousePoint = null;
}

function onPointerCancel(event: PointerEvent) {
  if (event.pointerType !== "touch") return;
  touchPointers.delete(event.pointerId);
  send({ type: "input_touch", eventType: "touchCancel", touchPoints: [...touchPointers.entries()].map(([id, position]) => ({ id, ...position })) });
}

function onWheel(event: WheelEvent) {
  const point = browserPoint(event);
  if (!point) return;
  send({ type: "input_mouse", eventType: "mouseWheel", ...point, button: "none", deltaX: event.deltaX, deltaY: event.deltaY, modifiers: modifiers(event) });
}

function onKeyDown(event: KeyboardEvent) {
  event.preventDefault();
  send({
    type: "input_keyboard",
    eventType: "keyDown",
    key: event.key,
    code: event.code,
    ...(event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey ? { text: event.key } : {}),
    modifiers: modifiers(event),
  });
}

function onKeyUp(event: KeyboardEvent) {
  event.preventDefault();
  send({ type: "input_keyboard", eventType: "keyUp", key: event.key, code: event.code, modifiers: modifiers(event) });
}

function mouseButton(button: number): "left" | "right" | "middle" | "none" {
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "none";
}

function dispose(): Promise<void> {
  if (disposal) return disposal;
  disposed = true;
  closeStream();
  connectionState.value = "disconnected";
  disposal = closeBrowserPanel(props.sessionId).then(() => undefined).catch((error: unknown) => {
    disposal = undefined;
    errorMessage.value = error instanceof Error ? error.message : String(error);
    throw error;
  });
  return disposal;
}

watch(() => props.active, setActive, { immediate: true });
onBeforeUnmount(() => {
  if (!disposed) closeStream();
});

defineExpose({ dispose });
</script>

<template>
  <section class="workspace-browser" data-test="workspace-browser">
    <form class="browser-toolbar" @submit.prevent="navigate">
      <button
        type="button"
        class="browser-control"
        :aria-label="t('workspaceTools.browserBack')"
        :title="t('workspaceTools.browserBack')"
        :disabled="pendingAction"
        data-test="browser-back"
        @click="runNavigationAction('back')"
      >‹</button>
      <button
        type="button"
        class="browser-control"
        :aria-label="t('workspaceTools.browserForward')"
        :title="t('workspaceTools.browserForward')"
        :disabled="pendingAction"
        data-test="browser-forward"
        @click="runNavigationAction('forward')"
      >›</button>
      <button
        type="button"
        class="browser-control"
        :aria-label="t('workspaceTools.browserReload')"
        :title="t('workspaceTools.browserReload')"
        :disabled="pendingAction"
        data-test="browser-reload"
        @click="runNavigationAction('reload')"
      >↻</button>
      <input
        v-model="address"
        class="browser-address"
        type="text"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        :aria-label="t('workspaceTools.browserAddress')"
        :placeholder="t('workspaceTools.browserAddressPlaceholder')"
        data-test="browser-url"
      >
      <button type="submit" class="browser-go" :disabled="pendingAction" data-test="browser-go">
        {{ t('workspaceTools.browserGo') }}
      </button>
    </form>

    <div class="browser-statusline" aria-live="polite">
      <span class="browser-status-dot" :class="connectionState" />
      <span>{{ connectionLabel }}</span>
      <span v-if="runtimeStatus?.screencasting === true">{{ t('workspaceTools.browserStreaming') }}</span>
      <span v-else-if="runtimeStatus?.screencasting === false">{{ t('workspaceTools.browserWaiting') }}</span>
      <span v-if="runtimeStatus?.engine" class="browser-engine">{{ runtimeStatus.engine }}</span>
      <button v-if="retryAvailable" type="button" class="browser-retry" data-test="browser-retry" @click="retryConnection">
        {{ t('workspaceTools.browserRetry') }}
      </button>
      <span v-if="errorMessage" class="browser-error" role="alert">{{ errorMessage }}</span>
    </div>

    <div
      ref="viewportRef"
      class="browser-viewport"
      tabindex="0"
      role="application"
      :aria-label="t('workspaceTools.browserViewport')"
      data-test="browser-viewport"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @wheel.prevent="onWheel"
      @keydown="onKeyDown"
      @keyup="onKeyUp"
    >
      <img v-if="frameSource" class="browser-frame" :src="frameSource" :alt="t('workspaceTools.browserFrameAlt')" data-test="browser-frame">
      <div v-else class="browser-placeholder" data-test="browser-placeholder">
        {{ connectionState === 'connecting' ? t('workspaceTools.browserConnectingHint') : t('workspaceTools.browserEmptyHint') }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.workspace-browser {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-deep);
}

.browser-toolbar {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.browser-control,
.browser-go,
.browser-retry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 30px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
}

.browser-control {
  font-size: 17px;
  line-height: 1;
}

.browser-control:disabled,
.browser-go:disabled {
  opacity: 0.5;
  cursor: default;
}

.browser-address {
  flex: 1;
  min-width: 40px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  outline: none;
  background: var(--bg-void);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.browser-address:focus {
  border-color: var(--accent);
}

.browser-go {
  border-color: var(--accent);
  color: var(--accent);
  font-size: 11px;
}

.browser-statusline {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  padding: 0 10px;
  color: var(--text-muted);
  font-size: 10px;
  flex-shrink: 0;
}

.browser-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.browser-status-dot.connected { color: var(--green); }
.browser-status-dot.connecting { color: var(--amber); }
.browser-status-dot.error,
.browser-status-dot.missing { color: var(--rose); }

.browser-error {
  overflow: hidden;
  color: var(--rose);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-engine {
  margin-left: auto;
  color: var(--text-faint);
  font-family: var(--font-mono);
  text-transform: uppercase;
}

.browser-retry {
  min-width: 0;
  height: 22px;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 10px;
}

.browser-viewport {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  outline: none;
  background: #101217;
  touch-action: none;
  user-select: none;
}

.browser-viewport:focus-visible {
  box-shadow: inset 0 0 0 1px var(--accent);
}

.browser-frame {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.browser-placeholder {
  padding: 18px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}
</style>
