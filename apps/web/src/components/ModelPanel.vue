<script setup lang="ts">
import { ref, computed } from "vue";
import { NDrawer, NDrawerContent, NForm, NFormItem, NInput, NSelect, NCheckbox, NButton, NPopconfirm } from "naive-ui";
import { useAgentStore } from "../stores/agent.js";
import { useI18n } from "../i18n/index.js";
import { api } from "../api/client.js";

const agent = useAgentStore();
const { t } = useI18n();

const showDrawer = ref(false);
const editingId = ref<string | null>(null);
const testing = ref(false);
const testResult = ref<{ ok: boolean; error?: string } | null>(null);

// 卡片快捷测试状态
const cardTestingId = ref<string | null>(null);
const cardTestResult = ref<{ id: string; ok: boolean; error?: string } | null>(null);
let cardTestTimer: ReturnType<typeof setTimeout> | null = null;

const form = ref({
  id: "",
  label: "",
  provider: "openai",
  modelType: "text" as "text" | "multimodal" | "embedding",
  apiBaseUrl: "",
  apiKey: "",
  isDefault: false,
});

const providerOptions = [
  { label: "OpenAI Compatible", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
];

const providerLabels: Record<string, string> = {
  openai: "OpenAI Compatible",
  anthropic: "Anthropic",
};

const modelTypeOptions = [
  { label: "text", value: "text" },
  { label: "multimodal", value: "multimodal" },
  { label: "embedding", value: "embedding" },
];

const groupedModels = computed(() => {
  const groups: Record<string, typeof agent.modelDtos> = {};
  for (const m of agent.modelDtos) {
    (groups[m.provider] ??= []).push(m);
  }
  return groups;
});

function openAdd() {
  editingId.value = null;
  form.value = {
    id: "",
    label: "",
    provider: "openai",
    modelType: "text",
    apiBaseUrl: "",
    apiKey: "",
    isDefault: false,
  };
  testResult.value = null;
  showDrawer.value = true;
}

function openEdit(m: (typeof agent.modelDtos)[0]) {
  editingId.value = m.id;
  form.value = {
    id: m.id,
    label: m.label,
    provider: m.provider,
    modelType: m.modelType ?? "text",
    apiBaseUrl: m.apiBaseUrl ?? "",
    apiKey: m.apiKey ?? "",
    isDefault: m.isDefault,
  };
  testResult.value = null;
  showDrawer.value = true;
}

async function testConnection() {
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await api.testModel({
      id: editingId.value || undefined,
      provider: form.value.provider,
      modelType: form.value.modelType,
      apiBaseUrl: form.value.apiBaseUrl || undefined,
      apiKey: form.value.apiKey || undefined,
      modelId: form.value.id || undefined,
    });
  } catch (e: any) {
    testResult.value = { ok: false, error: e.message ?? String(e) };
  } finally {
    testing.value = false;
  }
}

async function quickTest(m: (typeof agent.modelDtos)[0]) {
  if (cardTestTimer) { clearTimeout(cardTestTimer); cardTestTimer = null; }
  cardTestingId.value = m.id;
  cardTestResult.value = null;
  try {
    const result = await api.testModel({
      id: m.id,
      provider: m.provider,
      modelType: m.modelType ?? "text",
      apiBaseUrl: m.apiBaseUrl || undefined,
      modelId: m.id,
    });
    cardTestResult.value = { id: m.id, ...result };
  } catch (e: any) {
    cardTestResult.value = { id: m.id, ok: false, error: e.message ?? String(e) };
  } finally {
    cardTestingId.value = null;
    // 5 秒后自动清除结果提示
    cardTestTimer = setTimeout(() => { cardTestResult.value = null; }, 5000);
  }
}

async function save() {
  const data: Record<string, unknown> = {
    id: form.value.id,
    label: form.value.label,
    provider: form.value.provider,
    modelType: form.value.modelType,
    isDefault: form.value.isDefault,
  };
  if (form.value.apiBaseUrl) data.apiBaseUrl = form.value.apiBaseUrl;
  if (form.value.apiKey) data.apiKey = form.value.apiKey;

  if (editingId.value) {
    const patch: Record<string, unknown> = {
      label: form.value.label,
      provider: form.value.provider,
      modelType: form.value.modelType,
      isDefault: form.value.isDefault,
    };
    if (form.value.apiBaseUrl) patch.apiBaseUrl = form.value.apiBaseUrl;
    if (form.value.apiKey) patch.apiKey = form.value.apiKey;
    await agent.updateModel(editingId.value, patch as any);
  } else {
    await agent.createModel(data as any);
  }
  showDrawer.value = false;
}

async function remove(id: string) {
  await agent.deleteModel(id);
}

function setDefault(id: string) {
  agent.switchModel(id);
}
</script>

<template>
  <div class="model-panel">
    <div class="model-header">
      <div class="model-header-row">
        <h1 class="model-title">{{ t('nav.model') }}</h1>
        <button class="add-btn" @click="openAdd">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          {{ t('model.add') }}
        </button>
      </div>
      <div v-if="agent.currentModel" class="current-model">
        <span class="current-label">{{ t('model.current') }}:</span>
        <span class="current-value">{{ agent.currentModelLabel }}</span>
      </div>
    </div>

    <div class="model-groups">
      <div v-for="(models, provider) in groupedModels" :key="provider" class="model-group">
        <div class="group-label">{{ providerLabels[provider] ?? provider }}</div>
        <div class="card-grid">
          <div
            v-for="m in models"
            :key="m.id"
            class="model-card"
            :class="{ default: m.isDefault }"
            @click="setDefault(m.id)"
          >
            <div class="card-top">
              <span class="card-label">{{ m.label }}</span>
              <div class="card-badges">
                <span v-if="m.isDefault" class="badge badge-default">★</span>
                <span class="badge" :class="m.hasApiKey ? 'badge-key' : 'badge-nokey'">
                  <svg v-if="m.hasApiKey" width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <rect x="3.5" y="5" width="5" height="4" rx="1" stroke="currentColor" stroke-width="0.8" />
                    <circle cx="6" cy="3.5" r="2" stroke="currentColor" stroke-width="0.8" />
                  </svg>
                  <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <rect x="3.5" y="5" width="5" height="4" rx="1" stroke="currentColor" stroke-width="0.8" />
                    <circle cx="6" cy="3.5" r="2" stroke="currentColor" stroke-width="0.8" />
                    <line x1="2" y1="8" x2="8" y2="2" stroke="currentColor" stroke-width="0.8" />
                  </svg>
                </span>
              </div>
            </div>
            <div class="card-id">{{ m.id }}</div>
            <div v-if="m.apiBaseUrl" class="card-url">{{ m.apiBaseUrl }}</div>
            <div class="card-actions">
              <button
                class="action-btn"
                :class="{ 'action-testing': cardTestingId === m.id }"
                :disabled="cardTestingId === m.id"
                :title="t('model.test')"
                @click.stop="quickTest(m)"
              >
                <svg v-if="cardTestingId === m.id" class="spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1a5 5 0 014.6 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                </svg>
                <svg v-else width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M4.5 2.5L2 5l2.5 2.5M7.5 4.5L10 7l-2.5 2.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M7 2L5 10" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
                </svg>
              </button>
              <button class="action-btn" @click.stop="openEdit(m)" :title="t('model.edit')">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M8.5 1.5l2 2-7 7H1.5V8.5l7-7z" stroke="currentColor" stroke-width="1" stroke-linejoin="round" />
                </svg>
              </button>
              <NPopconfirm @positive-click="remove(m.id)">
                <template #trigger>
                  <button class="action-btn action-delete" @click.stop :title="t('model.delete')">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 3h8M4.5 3V2h3v1M3 3l.5 7h5L9 3" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </button>
                </template>
                {{ t('model.deleteConfirm') }}
              </NPopconfirm>
            </div>
            <div
              v-if="cardTestResult && cardTestResult.id === m.id"
              class="card-test-result"
              :class="cardTestResult.ok ? 'result-ok' : 'result-fail'"
              :title="cardTestResult.ok ? '' : cardTestResult.error"
            >
              {{ cardTestResult.ok ? t('model.testOk') : t('model.testFail') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <NDrawer v-model:show="showDrawer" :width="380" placement="right">
      <NDrawerContent :title="editingId ? t('model.edit') : t('model.add')" :native-scrollbar="false">
        <NForm label-placement="top">
          <NFormItem :label="t('model.id')">
            <NInput v-model:value="form.id" :placeholder="t('model.idPlaceholder')" :disabled="!!editingId" />
          </NFormItem>
          <NFormItem :label="t('model.label')">
            <NInput v-model:value="form.label" :placeholder="t('model.labelPlaceholder')" />
          </NFormItem>
          <NFormItem :label="t('model.provider')">
            <NSelect v-model:value="form.provider" :options="providerOptions" />
          </NFormItem>
          <NFormItem :label="t('model.type')">
            <NSelect v-model:value="form.modelType" :options="modelTypeOptions" />
          </NFormItem>
          <NFormItem :label="t('model.apiBaseUrl')">
            <NInput v-model:value="form.apiBaseUrl" :placeholder="t('model.apiBaseUrlPlaceholder')" />
          </NFormItem>
          <NFormItem :label="t('model.apiKey')">
            <NInput v-model:value="form.apiKey" type="password" show-password-on="click" :placeholder="t('model.apiKeyPlaceholder')" />
          </NFormItem>
          <NFormItem>
            <NCheckbox v-model:checked="form.isDefault">{{ t('model.isDefault') }}</NCheckbox>
          </NFormItem>
        </NForm>
        <div v-if="testResult" class="test-result" :class="testResult.ok ? 'test-ok' : 'test-fail'">
          {{ testResult.ok ? t('model.testOk') : t('model.testFail') + ': ' + testResult.error }}
        </div>
        <template #footer>
          <div class="drawer-footer">
            <NButton :loading="testing" @click="testConnection" :disabled="!form.provider">
              {{ t('model.test') }}
            </NButton>
            <div class="footer-spacer" />
            <NButton @click="showDrawer = false">{{ t('model.cancel') }}</NButton>
            <NButton type="primary" @click="save" :disabled="!form.id || !form.label || !form.provider">{{ t('model.save') }}</NButton>
          </div>
        </template>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.model-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  overflow-y: auto;
  padding: 28px 32px;
}

.model-header {
  margin-bottom: 24px;
}

.model-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.model-title {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--border-active);
  border-radius: var(--radius-md);
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.add-btn:hover {
  background: var(--accent);
  color: var(--bg-void);
}

.current-model {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.current-label {
  color: var(--text-muted);
}
.current-value {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--accent);
}

.model-groups {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.group-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  margin-bottom: 8px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.model-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.model-card:hover {
  border-color: var(--border-active);
  box-shadow: var(--shadow-sm);
}
.model-card:hover .card-actions {
  opacity: 1;
}
.model-card.default {
  border-color: var(--accent);
  box-shadow: var(--shadow-glow);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  font-size: 10px;
}
.badge-default {
  color: var(--accent);
}
.badge-key {
  color: var(--green);
}
.badge-nokey {
  color: var(--text-faint);
  opacity: 0.5;
}

.card-id {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-url {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.action-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.action-delete:hover {
  color: var(--rose);
}
.action-testing {
  color: var(--accent);
  cursor: wait;
}

.spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.card-test-result {
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.result-ok {
  background: var(--green-dim);
  color: var(--green);
}
.result-fail {
  background: var(--rose-dim);
  color: var(--rose);
}

.test-result {
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  font-size: 12px;
  line-height: 1.5;
}
.test-ok {
  background: var(--green-dim);
  color: var(--green);
}
.test-fail {
  background: var(--rose-dim);
  color: var(--rose);
  word-break: break-all;
}

.drawer-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.footer-spacer {
  flex: 1;
}
</style>
