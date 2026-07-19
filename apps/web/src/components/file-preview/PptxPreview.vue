<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from "vue";
import { api } from "../../api/client.js";
import { useI18n } from "../../i18n/index.js";

// .pptx → positioned HTML slides via JSZip + DOMParser. Parses the OOXML
// package in the browser: reads ppt/presentation.xml for slide order and
// canvas size, then for each slide extracts text runs and pictures with
// their DrawingML extents (EMU), rendering each shape with percentage-based
// absolute positioning so the layout roughly matches the original. JSZip
// is dynamically imported so the ~100KB lib only loads when a .pptx is
// opened. No server-side conversion is required.

const props = defineProps<{ projectId: string; path: string }>();

const { t } = useI18n();

interface Shape {
  type: "text" | "image";
  // position/size as percentages (0-100) of the slide canvas
  x: number; y: number; w: number; h: number;
  text?: string;
  imgSrc?: string;
  fontSizePt?: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
}
interface Slide { shapes: Shape[] }

const slides = ref<Slide[]>([]);
const aspect = ref(16 / 9);
const loading = ref(false);
const error = ref<string | null>(null);
const current = ref(0);
let blobUrls: string[] = [];

const currentSlide = computed(() => slides.value[current.value] ?? null);

function revoke() {
  for (const u of blobUrls) URL.revokeObjectURL(u);
  blobUrls = [];
}

async function load() {
  revoke();
  loading.value = true;
  error.value = null;
  slides.value = [];
  current.value = 0;
  try {
    const res = await fetch(api.rawFileUrl(props.projectId, props.path));
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const result = await parsePptx(zip);
    slides.value = result.slides;
    aspect.value = result.aspect;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

watch(() => [props.projectId, props.path], load, { immediate: true });
onUnmounted(revoke);

// EMU per inch; used to convert font sizes (pt) when needed.
const EMU_PER_PT = 12700;

function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const stack = baseDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") stack.pop();
    else if (seg === "." || seg === "") continue;
    else stack.push(seg);
  }
  return stack.join("/");
}

async function parsePptx(zip: any): Promise<{ aspect: number; slides: Slide[] }> {
  const presXml = await zip.file("ppt/presentation.xml")?.async("string");
  if (!presXml) throw new Error("ppt/presentation.xml not found");
  const pdoc = new DOMParser().parseFromString(presXml, "application/xml");

  const sldSz = pdoc.getElementsByTagName("p:sldSz")[0];
  const cx = sldSz ? Number(sldSz.getAttribute("cx")) || 9144000 : 9144000;
  const cy = sldSz ? Number(sldSz.getAttribute("cy")) || 6858000 : 6858000;

  const sldIds = Array.from(pdoc.getElementsByTagName("p:sldId"));
  const rids = sldIds
    .map((el) => el.getAttribute("r:id") || el.getAttribute("id") || "")
    .filter(Boolean);

  const relsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  const rels: Record<string, string> = {};
  if (relsXml) {
    const rdoc = new DOMParser().parseFromString(relsXml, "application/xml");
    for (const rel of Array.from(rdoc.getElementsByTagName("Relationship"))) {
      rels[rel.getAttribute("Id") || ""] = rel.getAttribute("Target") || "";
    }
  }

  const slides: Slide[] = [];
  for (const rid of rids) {
    const target = rels[rid];
    if (!target) continue;
    const slidePath = target.startsWith("/") ? target.slice(1) : "ppt/" + target;
    const slide = await parseSlide(zip, slidePath, cx, cy);
    slides.push(slide);
  }
  return { aspect: cx / cy, slides };
}

async function parseSlide(zip: any, slidePath: string, slideW: number, slideH: number): Promise<Slide> {
  const parts = slidePath.split("/");
  const name = parts.pop()!;
  const dir = parts.join("/"); // e.g. "ppt/slides"
  const relsPath = `${dir}/_rels/${name}.rels`;

  const rels: Record<string, string> = {};
  const relsFile = zip.file(relsPath);
  if (relsFile) {
    const relsXml = await relsFile.async("string");
    const rd = new DOMParser().parseFromString(relsXml, "application/xml");
    for (const rel of Array.from(rd.getElementsByTagName("Relationship"))) {
      rels[rel.getAttribute("Id") || ""] = rel.getAttribute("Target") || "";
    }
  }

  const slideXml = await zip.file(slidePath)?.async("string");
  if (!slideXml) return { shapes: [] };
  const sdoc = new DOMParser().parseFromString(slideXml, "application/xml");

  const pct = (v: number, base: number) => (v / base) * 100;
  const shapes: Shape[] = [];

  const collectText = (sp: Element) => {
    const xfrm = sp.getElementsByTagName("a:xfrm")[0];
    const off = xfrm?.getElementsByTagName("a:off")[0];
    const ext = xfrm?.getElementsByTagName("a:ext")[0];
    const x = off ? Number(off.getAttribute("x")) || 0 : 0;
    const y = off ? Number(off.getAttribute("y")) || 0 : 0;
    const w = ext ? Number(ext.getAttribute("cx")) || 0 : 0;
    const h = ext ? Number(ext.getAttribute("cy")) || 0 : 0;

    const paras = Array.from(sp.getElementsByTagName("a:p"));
    const lines: string[] = [];
    let fontSizePt: number | undefined;
    let bold = false;
    let align: "left" | "center" | "right" = "left";
    let color: string | undefined;

    for (const p of paras) {
      const pPr = p.getElementsByTagName("a:pPr")[0];
      if (pPr) {
        const algn = pPr.getAttribute("algn");
        if (algn === "ctr") align = "center";
        else if (algn === "r") align = "right";
      }
      const runs = Array.from(p.getElementsByTagName("a:r"));
      const lineParts: string[] = [];
      for (const r of runs) {
        const t = r.getElementsByTagName("a:t")[0]?.textContent ?? "";
        if (t) lineParts.push(t);
        const rPr = r.getElementsByTagName("a:rPr")[0];
        if (rPr) {
          const sz = rPr.getAttribute("sz");
          if (sz && !fontSizePt) fontSizePt = Number(sz) / 100;
          if (rPr.getAttribute("b") === "1") bold = true;
          const srgb = rPr.getElementsByTagName("a:srgbClr")[0];
          if (srgb && !color) color = "#" + (srgb.getAttribute("val") || "");
        }
      }
      // run-level color fallback: paragraph-level solidFill
      if (!color && pPr) {
        const srgb = pPr.getElementsByTagName("a:srgbClr")[0];
        if (srgb) color = "#" + (srgb.getAttribute("val") || "");
      }
      lines.push(lineParts.join(""));
    }

    if (w <= 0 || h <= 0) return;
    shapes.push({
      type: "text",
      x: pct(x, slideW), y: pct(y, slideH),
      w: pct(w, slideW), h: pct(h, slideH),
      text: lines.join("\n"),
      fontSizePt, bold, align, color,
    });
  };

  const collectPicture = async (pic: Element) => {
    const xfrm = pic.getElementsByTagName("a:xfrm")[0];
    const off = xfrm?.getElementsByTagName("a:off")[0];
    const ext = xfrm?.getElementsByTagName("a:ext")[0];
    const x = off ? Number(off.getAttribute("x")) || 0 : 0;
    const y = off ? Number(off.getAttribute("y")) || 0 : 0;
    const w = ext ? Number(ext.getAttribute("cx")) || 0 : 0;
    const h = ext ? Number(ext.getAttribute("cy")) || 0 : 0;
    const blip = pic.getElementsByTagName("a:blip")[0];
    const embed = blip?.getAttribute("r:embed") || blip?.getAttribute("embed") || "";
    if (!embed) return;
    const target = rels[embed];
    if (!target) return;
    const mediaPath = resolvePath(dir, target);
    const file = zip.file(mediaPath);
    if (!file) return;
    const blob = await file.async("arraybuffer");
    const url = URL.createObjectURL(new Blob([blob]));
    blobUrls.push(url);
    shapes.push({
      type: "image",
      x: pct(x, slideW), y: pct(y, slideH),
      w: pct(w, slideW), h: pct(h, slideH),
      imgSrc: url,
    });
  };

  // Top-level shapes only — group shapes (<p:grpSp>) are flattened for simplicity.
  const spTree = sdoc.getElementsByTagName("p:spTree")[0];
  if (!spTree) return { shapes };
  for (const child of Array.from(spTree.children)) {
    const tag = child.tagName;
    if (tag === "p:sp") collectText(child);
    else if (tag === "p:pic") await collectPicture(child);
    else if (tag === "p:grpSp") {
      // flatten one level deep — recurse into group's spTree
      const innerTree = child.getElementsByTagName("p:spTree")[0];
      if (!innerTree) continue;
      for (const gc of Array.from(innerTree.children)) {
        if (gc.tagName === "p:sp") collectText(gc);
        else if (gc.tagName === "p:pic") await collectPicture(gc);
      }
    }
  }

  return { shapes };
}

function textStyle(s: Shape): Record<string, string> {
  const style: Record<string, string> = {};
  if (s.fontSizePt) style["font-size"] = `${s.fontSizePt}pt`;
  if (s.bold) style["font-weight"] = "600";
  if (s.color) style["color"] = s.color;
  if (s.align === "center") style["text-align"] = "center";
  else if (s.align === "right") style["text-align"] = "right";
  return style;
}
</script>

<template>
  <div class="pptx-preview">
    <div v-if="loading" class="state">{{ t('viewer.rendering') }}</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <template v-else-if="slides.length">
      <div class="deck-toolbar">
        <span class="counter">{{ current + 1 }} / {{ slides.length }}</span>
        <button class="nav-btn" :disabled="current === 0" @click="current = Math.max(0, current - 1)">‹</button>
        <button class="nav-btn" :disabled="current === slides.length - 1" @click="current = Math.min(slides.length - 1, current + 1)">›</button>
      </div>
      <div class="slide-stage">
        <div class="slide-canvas" :style="{ aspectRatio: aspect }">
          <template v-for="(s, i) in (currentSlide?.shapes ?? [])" :key="i">
            <img
              v-if="s.type === 'image' && s.imgSrc"
              :src="s.imgSrc"
              class="slide-img"
              :style="{ left: s.x + '%', top: s.y + '%', width: s.w + '%', height: s.h + '%' }"
              alt=""
            />
            <div
              v-else-if="s.type === 'text' && s.text"
              class="slide-text"
              :style="{ left: s.x + '%', top: s.y + '%', width: s.w + '%', height: s.h + '%', ...textStyle(s) }"
            >{{ s.text }}</div>
          </template>
        </div>
      </div>
    </template>
    <div v-else class="state">{{ t('viewer.emptySlides') }}</div>
  </div>
</template>

<style scoped>
.pptx-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-void);
}
.deck-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-deep);
  flex-shrink: 0;
}
.counter {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  margin-right: auto;
}
.nav-btn {
  width: 26px;
  height: 22px;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.nav-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.slide-stage {
  flex: 1;
  overflow: auto;
  padding: 20px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.slide-canvas {
  position: relative;
  width: 100%;
  max-width: 960px;
  aspect-ratio: 16 / 9;
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
.slide-text {
  position: absolute;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  color: #111;
  font-family: "Sora", system-ui, sans-serif;
  font-size: 12pt;
  line-height: 1.2;
}
.slide-img {
  position: absolute;
  object-fit: fill;
}

.state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
}
.state.error { color: var(--rose); }
</style>
