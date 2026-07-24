<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import { NRadioGroup, NRadioButton, NRadio, NCheckbox, NInputNumber, NTag } from "naive-ui";
import { useI18n } from "../i18n/index.js";
import { getNextRuns } from "../utils/cron-helper.js";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();
const { t } = useI18n();

type FieldKey = "minute" | "hour" | "dom" | "month" | "dow";
type FieldMode = "every" | "specific" | "range" | "interval";

interface FieldState {
  mode: FieldMode;
  specifics: number[];
  rangeStart: number;
  rangeEnd: number;
  intervalStart: number;
  intervalStep: number;
}

const FIELD_KEYS: FieldKey[] = ["minute", "hour", "dom", "month", "dow"];

const fieldMeta: Record<FieldKey, { min: number; max: number; cols: number }> = {
  minute: { min: 0, max: 59, cols: 10 },
  hour:   { min: 0, max: 23, cols: 8 },
  dom:    { min: 1, max: 31, cols: 7 },
  month:  { min: 1, max: 12, cols: 4 },
  dow:    { min: 0, max: 6,  cols: 7 },
};

function defaultField(key: FieldKey): FieldState {
  const m = fieldMeta[key];
  return { mode: "every", specifics: [], rangeStart: m.min, rangeEnd: m.max, intervalStart: m.min, intervalStep: key === "minute" ? 5 : 1 };
}

const activeField = ref<FieldKey>("minute");

const fields = reactive<Record<FieldKey, FieldState>>({
  minute: defaultField("minute"),
  hour:   defaultField("hour"),
  dom:    defaultField("dom"),
  month:  defaultField("month"),
  dow:    defaultField("dow"),
});

// ─── Parse: cron string → field states ───

function expandToken(token: string, min: number, max: number): number[] {
  const vals = new Set<number>();
  for (const part of token.split(",")) {
    const stepMatch = part.match(/^(\d+|\*)-(\d+)\/(\d+)$/);
    if (stepMatch) {
      const start = stepMatch[1] === "*" ? min : Number(stepMatch[1]);
      const end = Number(stepMatch[2]);
      const step = Number(stepMatch[3]);
      for (let i = start; i <= end; i += step) vals.add(i);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      for (let i = start; i <= end; i++) vals.add(i);
      continue;
    }
    const intervalMatch = part.match(/^(\*|\d+)\/(\d+)$/);
    if (intervalMatch) {
      const start = intervalMatch[1] === "*" ? min : Number(intervalMatch[1]);
      const step = Number(intervalMatch[2]);
      for (let i = start; i <= max; i += step) vals.add(i);
      continue;
    }
    const n = Number(part);
    if (!isNaN(n) && n >= min && n <= max) vals.add(n);
  }
  return [...vals].sort((a, b) => a - b);
}

function parseFieldToken(token: string, key: FieldKey): FieldState {
  const m = fieldMeta[key];
  const def = defaultField(key);

  if (token === "*") return { ...def, mode: "every" };

  // Simple interval: */5 or 3/10
  const simpleInterval = token.match(/^(\d+)\/(\d+)$/);
  if (simpleInterval) {
    return { ...def, mode: "interval", intervalStart: Number(simpleInterval[1]), intervalStep: Number(simpleInterval[2]) };
  }
  // Star interval: */5
  const starInterval = token.match(/^\*\/(\d+)$/);
  if (starInterval) {
    return { ...def, mode: "interval", intervalStart: m.min, intervalStep: Number(starInterval[1]) };
  }

  // Simple range: 1-5
  const simpleRange = token.match(/^(\d+)-(\d+)$/);
  if (simpleRange) {
    return { ...def, mode: "range", rangeStart: Number(simpleRange[1]), rangeEnd: Number(simpleRange[2]) };
  }

  // Specific values or complex expression → expand to specific
  if (/^[\d*,/\-]+$/.test(token)) {
    const expanded = expandToken(token, m.min, m.max);
    if (expanded.length > 0) {
      // Normalize dow 7 → 0
      const normalized = key === "dow" ? expanded.map((v) => (v === 7 ? 0 : v)) : expanded;
      return { ...def, mode: "specific", specifics: [...new Set(normalized)] };
    }
  }

  return def;
}

function parseCron(expr: string): Record<FieldKey, FieldState> {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { minute: defaultField("minute"), hour: defaultField("hour"), dom: defaultField("dom"), month: defaultField("month"), dow: defaultField("dow") };
  }
  return {
    minute: parseFieldToken(parts[0]!, "minute"),
    hour:   parseFieldToken(parts[1]!, "hour"),
    dom:    parseFieldToken(parts[2]!, "dom"),
    month:  parseFieldToken(parts[3]!, "month"),
    dow:    parseFieldToken(parts[4]!, "dow"),
  };
}

// ─── Compose: field states → cron string ───

function fieldToToken(key: FieldKey): string {
  const f = fields[key];
  const m = fieldMeta[key];
  switch (f.mode) {
    case "every": return "*";
    case "interval": return `${f.intervalStart}/${f.intervalStep}`;
    case "range": return `${f.rangeStart}-${f.rangeEnd}`;
    case "specific": {
      if (f.specifics.length === 0) return "*";
      const sorted = [...f.specifics].sort((a, b) => a - b);
      // Check if all values are selected → treat as "*"
      if (sorted.length === m.max - m.min + 1) return "*";
      return sorted.join(",");
    }
    default: return "*";
  }
}

const cronExpression = computed(() => FIELD_KEYS.map(fieldToToken).join(" "));

// ─── Sync: modelValue ↔ fields (with guard to prevent infinite loop) ───

let syncing = false;

// Initialize from props
Object.assign(fields, parseCron(props.modelValue));

watch(() => props.modelValue, (val) => {
  if (syncing) return;
  if (val !== cronExpression.value) {
    syncing = true;
    Object.assign(fields, parseCron(val));
    syncing = false;
  }
});

watch(fields, () => {
  if (syncing) return;
  syncing = true;
  emit("update:modelValue", cronExpression.value);
  syncing = false;
}, { deep: true });

// ─── Next runs ───

const nextRuns = computed(() => getNextRuns(cronExpression.value, 6));

// ─── Checkbox grid helpers ───

function getValues(key: FieldKey): number[] {
  const m = fieldMeta[key];
  return Array.from({ length: m.max - m.min + 1 }, (_, i) => m.min + i);
}

function isChecked(key: FieldKey, val: number): boolean {
  return fields[key].specifics.includes(val);
}

function toggleSpecific(key: FieldKey, val: number, checked: boolean | string | number) {
  const arr = fields[key].specifics;
  if (checked) {
    if (!arr.includes(val)) arr.push(val);
  } else {
    const idx = arr.indexOf(val);
    if (idx >= 0) arr.splice(idx, 1);
  }
}

function setMode(key: FieldKey, mode: FieldMode) {
  fields[key].mode = mode;
}

// ─── Label helpers ───

function getFieldTabLabel(key: FieldKey): string {
  const map: Record<FieldKey, string> = {
    minute: t("cronPicker.minute"),
    hour: t("cronPicker.hour"),
    dom: t("cronPicker.dayOfMonth"),
    month: t("cronPicker.month"),
    dow: t("cronPicker.dayOfWeek"),
  };
  return map[key];
}

function getFieldLabel(key: FieldKey): string {
  const map: Record<FieldKey, string> = {
    minute: t("cronPicker.field.minute"),
    hour: t("cronPicker.field.hour"),
    dom: t("cronPicker.field.dom"),
    month: t("cronPicker.field.month"),
    dow: t("cronPicker.field.dow"),
  };
  return map[key];
}

function getValueLabel(key: FieldKey, val: number): string {
  if (key === "dow") return t(`cronPicker.dow.${val}`);
  if (key === "month") return t(`cronPicker.month.${val}`);
  return String(val);
}

function getIntervalUnit(key: FieldKey): string {
  if (key === "minute") return t("cronPicker.unit.minute");
  if (key === "hour") return t("cronPicker.unit.hour");
  return "";
}
</script>

<template>
  <div class="cron-picker">
    <!-- Field tab selector -->
    <NRadioGroup :value="activeField" size="small" class="cron-field-tabs" @update:value="(v: string) => activeField = v as FieldKey">
      <NRadioButton v-for="key in FIELD_KEYS" :key="key" :value="key" :label="getFieldTabLabel(key)" />
    </NRadioGroup>

    <!-- Active field panel -->
    <div class="cron-field-panel">
      <div class="cron-mode-group">
        <!-- Mode: Every -->
        <div class="cron-mode-option">
          <NRadio :checked="fields[activeField].mode === 'every'" @update:checked="() => setMode(activeField, 'every')">
            {{ t("cronPicker.every", { field: getFieldLabel(activeField) }) }}
          </NRadio>
        </div>

        <!-- Mode: Specific -->
        <div class="cron-mode-option">
          <NRadio :checked="fields[activeField].mode === 'specific'" @update:checked="() => setMode(activeField, 'specific')">
            {{ t("cronPicker.specific", { field: getFieldLabel(activeField) }) }}
          </NRadio>
        </div>
        <div
          v-if="fields[activeField].mode === 'specific'"
          class="cron-checkbox-grid"
          :style="{ gridTemplateColumns: `repeat(${fieldMeta[activeField].cols}, 1fr)` }"
        >
          <NCheckbox
            v-for="val in getValues(activeField)"
            :key="val"
            :checked="isChecked(activeField, val)"
            size="small"
            @update:checked="(c: boolean | string | number) => toggleSpecific(activeField, val, c)"
          >
            {{ getValueLabel(activeField, val) }}
          </NCheckbox>
        </div>

        <!-- Mode: Range -->
        <div class="cron-mode-option">
          <NRadio :checked="fields[activeField].mode === 'range'" @update:checked="() => setMode(activeField, 'range')">
            {{ t("cronPicker.range") }}
          </NRadio>
        </div>
        <div v-if="fields[activeField].mode === 'range'" class="cron-input-row">
          <span class="cron-input-label">{{ t("cronPicker.rangeFrom") }}</span>
          <NInputNumber v-model:value="fields[activeField].rangeStart" :min="fieldMeta[activeField].min" :max="fieldMeta[activeField].max" size="small" class="cron-num" />
          <span class="cron-input-label">{{ t("cronPicker.rangeTo") }}</span>
          <NInputNumber v-model:value="fields[activeField].rangeEnd" :min="fieldMeta[activeField].min" :max="fieldMeta[activeField].max" size="small" class="cron-num" />
        </div>

        <!-- Mode: Interval -->
        <div class="cron-mode-option">
          <NRadio :checked="fields[activeField].mode === 'interval'" @update:checked="() => setMode(activeField, 'interval')">
            {{ t("cronPicker.interval") }}
          </NRadio>
        </div>
        <div v-if="fields[activeField].mode === 'interval'" class="cron-input-row">
          <span class="cron-input-label">{{ t("cronPicker.intervalEvery") }}</span>
          <NInputNumber v-model:value="fields[activeField].intervalStep" :min="1" :max="fieldMeta[activeField].max" size="small" class="cron-num" />
          <span v-if="getIntervalUnit(activeField)" class="cron-input-label">{{ getIntervalUnit(activeField) }}</span>
          <span class="cron-input-label">{{ t("cronPicker.intervalStarting") }}</span>
          <NInputNumber v-model:value="fields[activeField].intervalStart" :min="fieldMeta[activeField].min" :max="fieldMeta[activeField].max" size="small" class="cron-num" />
        </div>
      </div>
    </div>

    <!-- Output: cron expression + next runs -->
    <div class="cron-output">
      <div class="cron-output-expr">
        <NTag size="small" :bordered="false" type="info">
          <code>{{ cronExpression }}</code>
        </NTag>
      </div>
      <div v-if="nextRuns.length" class="cron-next-section">
        <div class="cron-next-label">{{ t("cronPicker.nextRuns") }}</div>
        <ol class="cron-next-runs">
          <li v-for="(run, i) in nextRuns" :key="i">{{ run }}</li>
        </ol>
      </div>
      <div v-else class="cron-no-runs">{{ t("cronPicker.noNextRuns") }}</div>
    </div>
  </div>
</template>

<style scoped>
.cron-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cron-field-tabs {
  display: flex;
}

.cron-field-panel {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 12px;
  background: var(--background-panel);
}

.cron-mode-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cron-mode-option {
  display: flex;
  align-items: center;
}

.cron-checkbox-grid {
  display: grid;
  gap: 2px 4px;
  padding-left: 24px;
  max-height: 180px;
  overflow-y: auto;
}

.cron-checkbox-grid :deep(.n-checkbox) {
  min-width: 0;
}

.cron-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 24px;
  flex-wrap: wrap;
}

.cron-input-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.cron-num {
  width: 80px;
}

.cron-output {
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cron-output-expr code {
  font-family: var(--font-mono);
  font-size: 12px;
}

.cron-next-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cron-next-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.cron-next-runs {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  padding-left: 20px;
  line-height: 1.8;
}

.cron-no-runs {
  font-size: 12px;
  color: var(--text-faint);
  font-style: italic;
}
</style>
