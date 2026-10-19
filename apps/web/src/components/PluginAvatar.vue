<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  pluginId?: string;
  name?: string;
  size?: number;
}>(), { pluginId: "", name: "", size: 24 });

const palettes = [
  ["#087f72", "#18b89b", "#d8fff4"],
  ["#3562a9", "#6f9cf4", "#e4edff"],
  ["#a84b38", "#f08c65", "#ffeadf"],
  ["#7050a7", "#aa83df", "#f0e6ff"],
  ["#277d59", "#64bd83", "#e1f8e9"],
  ["#a06c12", "#e9b548", "#fff3d1"],
] as const;

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

const seed = computed(() => hash(props.pluginId || props.name || "plugin"));
const variant = computed(() => seed.value % 4);
const iconKind = computed(() => {
  const identity = `${props.pluginId} ${props.name}`.toLowerCase();
  if (identity.includes("computer") || identity.includes("电脑")) return "computer";
  if (identity.includes("browser") || identity.includes("浏览器")) return "browser";
  return "generic";
});
const style = computed(() => {
  const palette = iconKind.value === "computer"
    ? palettes[0]
    : iconKind.value === "browser"
      ? palettes[1]
      : palettes[seed.value % palettes.length]!;
  return {
    width: `${props.size}px`,
    height: `${props.size}px`,
    "--plugin-dark": palette[0],
    "--plugin-bright": palette[1],
    "--plugin-pale": palette[2],
  };
});
</script>

<template>
  <span class="plugin-avatar" :class="[`variant-${variant}`, `kind-${iconKind}`]" :style="style" role="img" :aria-label="`${name || '插件'}图标`">
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <template v-if="iconKind === 'computer'">
        <rect class="computer-frame" x="4.5" y="4.5" width="23" height="17" rx="2.5" />
        <rect class="computer-display" x="7" y="7" width="18" height="12" rx="1" />
        <path class="computer-window" d="M9 9.5h6v6H9zM17 10h5M17 12h5M17 14h3" />
        <path class="computer-stand" d="M13 25h6M16 21.5V25M10 27h12" />
      </template>
      <template v-else-if="iconKind === 'browser'">
        <rect class="browser-frame" x="5" y="5.5" width="22" height="21" rx="3" />
        <path d="M5.5 11.5h21" />
        <circle class="browser-dot" cx="9" cy="8.5" r=".7" />
        <circle class="browser-dot" cx="12" cy="8.5" r=".7" />
        <circle class="browser-dot" cx="15" cy="8.5" r=".7" />
        <circle class="browser-globe" cx="16" cy="18.5" r="4.3" />
        <path d="M11.8 18.5h8.4M16 14.2c1.2 1.2 1.8 2.6 1.8 4.3s-.6 3.1-1.8 4.3c-1.2-1.2-1.8-2.6-1.8-4.3s.6-3.1 1.8-4.3Z" />
        <path class="extension-mark" d="M22 19v1.2a1.7 1.7 0 1 1-3.4 0V19H17v-2h1.6v-1.2a1.7 1.7 0 1 1 3.4 0V17h1.6v2H22Z" />
      </template>
      <template v-else-if="variant === 0">
        <path d="M10 7.5v4.1a2.9 2.9 0 1 0 5.8 0V7.5h4.7a2 2 0 0 1 2 2v4.2h2.2a2.8 2.8 0 1 1 0 5.6h-2.2V24a2 2 0 0 1-2 2h-4.2v-2.2a2.8 2.8 0 1 0-5.6 0V26H10a2 2 0 0 1-2-2v-4.7h2.2a2.8 2.8 0 1 0 0-5.6H8V9.5a2 2 0 0 1 2-2Z" />
      </template>
      <template v-else-if="variant === 1">
        <path d="m12.5 10-5 6 5 6M19.5 10l5 6-5 6M18 8l-4 16" />
      </template>
      <template v-else-if="variant === 2">
        <path d="M18.3 5.5 9.2 17h5.7l-1.2 9.5L23 14.8h-5.8l1.1-9.3Z" />
      </template>
      <template v-else>
        <rect x="7" y="7" width="7" height="7" rx="2" />
        <rect x="18" y="7" width="7" height="7" rx="2" />
        <rect x="7" y="18" width="7" height="7" rx="2" />
        <path d="M21.5 18v7M18 21.5h7" />
      </template>
    </svg>
    <i class="plugin-glint" />
  </span>
</template>

<style scoped>
.plugin-avatar {
  position: relative;
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--plugin-dark) 18%, white);
  border-radius: 30%;
  background: linear-gradient(145deg, var(--plugin-pale), white 78%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 90%), 0 1px 3px rgb(29 46 67 / 12%);
}

.plugin-avatar::before {
  position: absolute;
  right: -35%;
  bottom: -43%;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: color-mix(in srgb, var(--plugin-bright) 22%, transparent);
  content: "";
}

.plugin-avatar svg {
  position: relative;
  z-index: 1;
  width: 69%;
  height: 69%;
  overflow: visible;
  fill: none;
  stroke: var(--plugin-dark);
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.kind-computer svg,
.kind-browser svg { width: 82%; height: 82%; }
.kind-computer .computer-frame { fill: var(--plugin-dark); stroke: var(--plugin-dark); stroke-width: 1.5; }
.kind-computer .computer-display { fill: var(--plugin-pale); stroke: none; }
.kind-computer .computer-window { fill: var(--plugin-bright); stroke: none; }
.kind-computer .computer-stand { stroke: var(--plugin-dark); stroke-width: 2.2; }
.kind-browser .browser-frame { fill: white; stroke: var(--plugin-dark); stroke-width: 1.9; }
.kind-browser .browser-dot { fill: var(--plugin-bright); stroke: none; }
.kind-browser .browser-globe { fill: var(--plugin-pale); stroke: var(--plugin-bright); stroke-width: 1.5; }
.kind-browser .extension-mark { fill: var(--plugin-bright); stroke: white; stroke-width: 1; }

.kind-generic.variant-0 svg path { fill: var(--plugin-bright); stroke: white; stroke-width: 1.2; }
.kind-generic.variant-2 svg path { fill: var(--plugin-bright); stroke: white; stroke-width: 1.5; }
.kind-generic.variant-3 svg rect { fill: var(--plugin-bright); stroke: white; stroke-width: 1.2; }
.kind-generic.variant-3 svg path { stroke: var(--plugin-dark); }

.plugin-glint {
  position: absolute;
  z-index: 2;
  top: 17%;
  right: 17%;
  width: 12%;
  height: 12%;
  border-radius: 50%;
  background: white;
  opacity: .85;
}
</style>
