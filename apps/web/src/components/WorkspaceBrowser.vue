<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  backBrowserPanel,
  activateBrowserPanel,
  closeBrowserPanel,
  createBrowserSocket,
  forwardBrowserPanel,
  navigateBrowserPanel,
  openBrowserPanel,
  parseBrowserServerMessage,
  reloadBrowserPanel,
  scaleBrowserPoint,
  setBrowserPanelViewport,
  type BrowserClientMessage,
  type BrowserFrameMessage,
} from "../api/workspace-tools.js";
import {
  closeNativeBrowserView,
  createNativeBrowserSocket,
  navigateNativeBrowser,
  openNativeBrowserView,
  reloadNativeBrowser,
  runNativeBrowserScript,
  setNativeBrowserBounds,
  setNativeBrowserVisible,
} from "../api/native-browser.js";
import { executeNativeBrowserAction } from "../api/native-browser-actions.js";
import { useWorkspaceToolsStore } from "../stores/workspace-tools.js";
import { useI18n } from "../i18n/index.js";
import { isTauri } from "../utils/platform.js";

const props = withDefaults(defineProps<{
  sessionId: string;
  projectId: string;
  instanceId?: string;
  initialUrl?: string;
  active: boolean;
}>(), { instanceId: "browser", initialUrl: "about:blank" });

const emit = defineEmits<{
  "state-change": [state: { url: string; title?: string; favicon?: string }];
}>();

type BrowserConnectionState = "disconnected" | "connecting" | "connected" | "error" | "missing";

const { t } = useI18n();
const workspaceTools = useWorkspaceToolsStore();
const nativeHost = isTauri();
const connectionState = ref<BrowserConnectionState>("disconnected");
const address = ref(props.initialUrl || "about:blank");
const editingAddress = ref(false);
const addressDraft = ref(address.value);
const frameSource = ref<string | null>(null);
const frameSize = ref({ width: 0, height: 0 });
const errorMessage = ref("");
const pendingAction = ref(false);
const viewportRef = ref<HTMLElement | null>(null);
const addressRef = ref<HTMLInputElement | null>(null);
const connectionLabel = computed(() => t(`workspaceTools.browserStatus.${connectionState.value}`));
const retryAvailable = computed(() => props.active && connectionState.value === "error");
const secureAddress = computed(() => address.value.startsWith("https://"));

let socket: WebSocket | null = null;
let connectionGeneration = 0;
let frameGeneration = 0;
let disposed = false;
let disposal: Promise<void> | undefined;
let resizeObserver: ResizeObserver | null = null;
let viewportTimer: number | null = null;
let lastViewport = "";
let nativeBrowserOpened = false;
let nativeNavigationUnlisten: (() => void) | null = null;
let nativeNewTabUnlisten: (() => void) | null = null;
const touchPointers = new Map<number, { x: number; y: number; force?: number }>();
let lastMousePoint: { x: number; y: number } | null = null;

function setError(message: string) {
  errorMessage.value = message;
  connectionState.value = "error";
}

function publishPageState(url: string) {
  emit("state-change", { url, title: "", favicon: "" });
  if (!isTauri()) return;
  window.setTimeout(() => {
    if (disposed || !props.active) return;
    void runNativeBrowserScript<{ title?: string; favicon?: string }>(
      props.sessionId,
      props.instanceId,
      "({ title: document.title, favicon: document.querySelector('link[rel~=\\\"icon\\\"]')?.href || '' })",
    ).then((result) => {
      const title = typeof result?.title === "string" ? result.title : "";
      const rawFavicon = typeof result?.favicon === "string" ? result.favicon : "";
      let favicon: string | undefined;
      try {
        const parsed = new URL(rawFavicon, url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") favicon = parsed.href;
      } catch { /* invalid favicon URLs use the globe fallback */ }
      emit("state-change", { url, ...(title ? { title } : {}), ...(favicon ? { favicon } : {}) });
    }).catch(() => undefined);
  }, 350);
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
    if (!editingAddress.value) addressDraft.value = message.url;
  } else if (message.type === "status") {
    if (message.error && typeof message.error === "string") errorMessage.value = message.error;
  }
}

function startConnection() {
  if (!props.active || disposed) return;
  if (isTauri()) {
    if (socket) closeStream();
    const attempt = ++connectionGeneration;
    connectionState.value = "connecting";
    errorMessage.value = "";
    void nextTick().then(async () => {
      if (attempt !== connectionGeneration || !props.active || disposed) return;
      const rect = viewportRef.value?.getBoundingClientRect();
      if (!rect || rect.width < 1 || rect.height < 1) {
        connectionState.value = "error";
        errorMessage.value = t("workspaceTools.browserConnectionFailed");
        return;
      }
      try {
        const { listen } = await import("@tauri-apps/api/event");
        nativeNavigationUnlisten?.();
        nativeNavigationUnlisten = await listen<{
          sessionId: string;
          instanceId: string;
          url: string;
        }>("native-browser-navigation", (event) => {
          if (event.payload.sessionId !== props.sessionId || event.payload.instanceId !== props.instanceId) return;
          address.value = event.payload.url;
          if (!editingAddress.value) addressDraft.value = event.payload.url;
          publishPageState(event.payload.url);
        });
        nativeNewTabUnlisten?.();
        nativeNewTabUnlisten = await listen<{
          sessionId: string;
          sourceInstanceId: string;
          url: string;
        }>("native-browser-new-tab", (event) => {
          if (event.payload.sessionId !== props.sessionId || event.payload.sourceInstanceId !== props.instanceId) return;
          const target = normalizeAddress(event.payload.url);
          if (!target) return;
          try {
            const tabId = workspaceTools.openTool(props.sessionId, props.projectId, "browser");
            workspaceTools.updateToolMeta(props.sessionId, tabId, { url: target });
          } catch {
            errorMessage.value = t("workspaceTools.maxTabsReached");
          }
        });
        await openNativeBrowserView(
          props.sessionId,
          props.instanceId,
          address.value,
          { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        );
        nativeBrowserOpened = true;
        void setNativeBrowserVisible(props.sessionId, props.instanceId, true);
        const candidate = createNativeBrowserSocket(props.sessionId, props.instanceId);
        socket = candidate;
        candidate.onopen = () => {
          if (candidate !== socket || attempt !== connectionGeneration) return;
          connectionState.value = "connected";
          errorMessage.value = "";
        };
        candidate.onmessage = (event) => {
          if (candidate !== socket || typeof event.data !== "string") return;
          let message: unknown;
          try { message = JSON.parse(event.data); } catch { return; }
          if (!message || typeof message !== "object" || Array.isArray(message)) return;
          const request = message as Record<string, unknown>;
          if (request.type !== "agent-browser-action" || typeof request.requestId !== "string") return;
          void (async () => {
            try {
              const params = request.params;
              if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("invalid browser action");
              const result = await executeNativeBrowserAction(props.sessionId, props.instanceId, params as Record<string, unknown>);
              if (candidate.readyState === WebSocket.OPEN) candidate.send(JSON.stringify({ type: "agent-browser-result", requestId: request.requestId, result }));
            } catch (error) {
              if (candidate.readyState === WebSocket.OPEN) candidate.send(JSON.stringify({
                type: "agent-browser-result",
                requestId: request.requestId,
                error: error instanceof Error ? error.message : String(error),
              }));
            }
          })();
        };
        candidate.onerror = () => {
          if (candidate !== socket) return;
          setError(t("workspaceTools.browserConnectionFailed"));
          candidate.close();
        };
        candidate.onclose = (event) => {
          if (candidate !== socket) return;
          socket = null;
          if (attempt !== connectionGeneration || !props.active || disposed) return;
          setError(event.reason || t("workspaceTools.browserConnectionFailed"));
        };
      } catch (error) {
        if (attempt !== connectionGeneration || disposed) return;
        setError(error instanceof Error ? error.message : String(error));
      }
    });
    return;
  }
  const attempt = ++connectionGeneration;
  const previous = socket;
  socket = null;
  if (previous && previous.readyState < WebSocket.CLOSING) previous.close(1000, "browser panel reconnecting");
  errorMessage.value = "";
  connectionState.value = "connecting";
  frameSource.value = null;
  frameSize.value = { width: 0, height: 0 };

  void (async () => {
    try {
      await openBrowserPanel(props.sessionId, props.instanceId);
      if (attempt !== connectionGeneration || !props.active || disposed) return;
      await activateBrowserPanel(props.sessionId, props.instanceId);
      if (attempt !== connectionGeneration || !props.active || disposed) return;

      const candidate = createBrowserSocket(props.sessionId, props.instanceId);
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

function scheduleViewportUpdate() {
  if (viewportTimer !== null) window.clearTimeout(viewportTimer);
  if (!props.active || disposed) return;
  viewportTimer = window.setTimeout(() => {
    viewportTimer = null;
    const rect = viewportRef.value?.getBoundingClientRect();
    if (!rect || rect.width < 320 || rect.height < 240) return;
    const width = Math.min(4096, Math.round(rect.width));
    const height = Math.min(4096, Math.round(rect.height));
    if (isTauri()) {
      const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      if (!nativeBrowserOpened) {
        if (props.active) startConnection();
        return;
      }
      void setNativeBrowserBounds(props.sessionId, props.instanceId, bounds).catch((error: unknown) => {
        setError(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    const key = `${width}x${height}`;
    if (key === lastViewport) return;
    lastViewport = key;
    void setBrowserPanelViewport(props.sessionId, props.instanceId, width, height).catch(() => {
      lastViewport = "";
    });
  }, 180);
}

function setActive(active: boolean) {
  if (active) {
    startConnection();
    void nextTick().then(scheduleViewportUpdate);
    return;
  }
  if (isTauri()) {
    closeStream();
    if (nativeBrowserOpened) void setNativeBrowserVisible(props.sessionId, props.instanceId, false);
    connectionState.value = "disconnected";
    errorMessage.value = "";
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
  const target = normalizeAddress(addressDraft.value);
  if (!target) {
    errorMessage.value = t("workspaceTools.browserInvalidUrl");
    return;
  }
  editingAddress.value = false;
  addressDraft.value = target;
  pendingAction.value = true;
  errorMessage.value = "";
  try {
    if (isTauri()) await navigateNativeBrowser(props.sessionId, props.instanceId, target);
    else await navigateBrowserPanel(props.sessionId, target, props.instanceId);
    address.value = target;
    publishPageState(target);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    pendingAction.value = false;
  }
}

async function beginAddressEdit() {
  addressDraft.value = address.value === "about:blank" ? "" : address.value;
  editingAddress.value = true;
  await nextTick();
  addressRef.value?.focus();
  addressRef.value?.select();
}

function cancelAddressEdit() {
  addressDraft.value = address.value;
  editingAddress.value = false;
}

function finishAddressEdit() {
  if (normalizeAddress(addressDraft.value) === normalizeAddress(address.value)) {
    editingAddress.value = false;
    return;
  }
  void navigate();
}

function onAddressKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  cancelAddressEdit();
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (!props.active || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "l") return;
  event.preventDefault();
  void beginAddressEdit();
}

async function runNavigationAction(action: "back" | "forward" | "reload") {
  pendingAction.value = true;
  errorMessage.value = "";
  try {
    if (isTauri()) {
      if (action === "reload") await reloadNativeBrowser(props.sessionId, props.instanceId);
      else await runNativeBrowserScript(props.sessionId, props.instanceId, `history.${action}(); true`);
    } else if (action === "back") await backBrowserPanel(props.sessionId, props.instanceId);
    else if (action === "forward") await forwardBrowserPanel(props.sessionId, props.instanceId);
    else await reloadBrowserPanel(props.sessionId, props.instanceId);
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
  nativeNavigationUnlisten?.();
  nativeNavigationUnlisten = null;
  nativeNewTabUnlisten?.();
  nativeNewTabUnlisten = null;
  connectionState.value = "disconnected";
  if (isTauri()) {
    disposal = closeNativeBrowserView(props.sessionId, props.instanceId).then(() => undefined).catch((error: unknown) => {
      disposal = undefined;
      errorMessage.value = error instanceof Error ? error.message : String(error);
      throw error;
    });
    return disposal;
  }
  disposal = closeBrowserPanel(props.sessionId, props.instanceId).then(() => undefined).catch((error: unknown) => {
    disposal = undefined;
    errorMessage.value = error instanceof Error ? error.message : String(error);
    throw error;
  });
  return disposal;
}

watch(() => props.active, setActive, { immediate: true });
onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown);
  if (viewportRef.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(scheduleViewportUpdate);
    resizeObserver.observe(viewportRef.value);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
  resizeObserver?.disconnect();
  if (viewportTimer !== null) window.clearTimeout(viewportTimer);
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
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <button
        type="button"
        class="browser-control"
        :aria-label="t('workspaceTools.browserForward')"
        :title="t('workspaceTools.browserForward')"
        :disabled="pendingAction"
        data-test="browser-forward"
        @click="runNavigationAction('forward')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
      </button>
      <button
        type="button"
        class="browser-control"
        :aria-label="t('workspaceTools.browserReload')"
        :title="t('workspaceTools.browserReload')"
        :disabled="pendingAction"
        data-test="browser-reload"
        @click="runNavigationAction('reload')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.34-5.66L20 8" /><path d="M20 4v4h-4" /></svg>
      </button>
      <div class="browser-address-wrap" :class="{ editing: editingAddress }" :title="address">
        <svg class="browser-security-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path v-if="secureAddress" d="M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5z" />
          <path v-else d="M5 10h14v11H5zM8 10V7a4 4 0 0 1 7.7-1.5" />
        </svg>
        <input
          ref="addressRef"
          :value="editingAddress ? addressDraft : address === 'about:blank' ? '' : address"
          class="browser-address"
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          :readonly="!editingAddress"
          :aria-label="t('workspaceTools.browserAddress')"
          :placeholder="t('workspaceTools.browserAddressPlaceholder')"
          data-test="browser-url"
          @focus="!editingAddress && beginAddressEdit()"
          @input="addressDraft = ($event.target as HTMLInputElement).value"
          @keydown="onAddressKeydown"
          @blur="editingAddress && finishAddressEdit()"
        >
        <span class="browser-connection-dot" :class="connectionState" :title="connectionLabel" />
      </div>
      <button type="submit" class="browser-go" :disabled="pendingAction || !editingAddress" :aria-label="t('workspaceTools.browserGo')" :title="t('workspaceTools.browserGo')" data-test="browser-go" @mousedown.prevent>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </form>

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
      <img v-if="!nativeHost && frameSource" class="browser-frame" :src="frameSource" :alt="t('workspaceTools.browserFrameAlt')" data-test="browser-frame">
      <div v-else-if="!nativeHost" class="browser-placeholder" data-test="browser-placeholder">
        {{ connectionState === 'connecting' ? t('workspaceTools.browserConnectingHint') : t('workspaceTools.browserEmptyHint') }}
      </div>
      <div
        v-if="errorMessage || retryAvailable"
        class="browser-notice"
        aria-live="polite"
        @pointerdown.stop
        @pointermove.stop
        @pointerup.stop
        @wheel.stop
      >
        <span v-if="errorMessage" class="browser-error" role="alert">{{ errorMessage }}</span>
        <button v-if="retryAvailable" type="button" class="browser-retry" data-test="browser-retry" @click="retryConnection">
          {{ t('workspaceTools.browserRetry') }}
        </button>
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
  gap: 4px;
  min-height: 40px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  background: var(--bg-surface);
}

.browser-control,
.browser-go,
.browser-retry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 26px;
  min-width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.browser-control svg,
.browser-go svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.browser-control:hover:not(:disabled),
.browser-go:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.browser-control:disabled,
.browser-go:disabled {
  opacity: 0.5;
  cursor: default;
}

.browser-address-wrap {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 28px;
  gap: 7px;
  padding: 0 9px;
  border: 1px solid var(--border-default);
  border-radius: 999px;
  background: var(--bg-void);
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
}

.browser-address-wrap:hover,
.browser-address-wrap.editing,
.browser-address-wrap:focus-within {
  border-color: var(--accent);
  background: var(--bg-surface);
}

.browser-address-wrap.editing,
.browser-address-wrap:focus-within {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
}

.browser-security-icon {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  fill: none;
  stroke: var(--text-muted);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.browser-address {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
}

.browser-address[readonly] {
  cursor: text;
}

.browser-connection-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--text-faint);
}

.browser-connection-dot.connected { background: var(--green); }
.browser-connection-dot.connecting { background: var(--amber); }
.browser-connection-dot.error,
.browser-connection-dot.missing { background: var(--rose); }

.browser-connection-dot.disconnected {
  opacity: 0.35;
}

.browser-go {
  color: var(--text-secondary);
}

.browser-error {
  overflow: hidden;
  color: var(--rose);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-retry {
  width: auto;
  min-width: auto;
  height: 26px;
  padding: 0 9px;
  border: 0;
  background: var(--bg-surface);
  color: var(--accent);
  font-size: 11px;
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
  background: var(--bg-deep);
  touch-action: none;
  user-select: none;
}

.browser-notice {
  position: absolute;
  top: 12px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 24px);
  padding: 7px 10px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-surface);
  box-shadow: 0 4px 16px rgb(0 0 0 / 18%);
  transform: translateX(-50%);
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
