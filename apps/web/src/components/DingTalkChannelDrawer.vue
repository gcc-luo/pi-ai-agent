<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NDrawer, NDropdown, NInput, NSwitch, useMessage } from "naive-ui";
import type { ChannelConfigDto, ProjectDto } from "@pi-web-ui/shared";
import { api } from "../api/client.js";
import { useChannelStore } from "../stores/channel.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{ show: boolean; config: ChannelConfigDto | null }>();
const emit = defineEmits<{ (e: "update:show", value: boolean): void; (e: "saved"): void }>();

const store = useChannelStore();
const { t } = useI18n();
const message = useMessage();
const projects = ref<ProjectDto[]>([]);
const name = ref("");
const projectId = ref<string | null>(null);
const clientId = ref("");
const clientSecret = ref("");
const robotCode = ref("");
const enabled = ref(true);
const saving = ref(false);

const projectOptions = computed(() => projects.value.map((project) => ({ label: project.name, value: project.id })));

const selectedProjectName = computed(() => {
  if (!projectId.value) return null;
  const p = projects.value.find((p) => p.id === projectId.value);
  return p?.name ?? null;
});

const projectDropdownOptions = computed(() =>
  projects.value.map((p) => ({ label: p.name, key: p.id })),
);

function onProjectSelect(key: string) {
  projectId.value = key;
}

async function load() {
  const config = props.config;
  name.value = config?.name ?? t("channel.dingtalk.label");
  projectId.value = typeof config?.config.projectId === "string" ? config.config.projectId : null;
  clientId.value = typeof config?.config.clientId === "string" ? config.config.clientId : "";
  clientSecret.value = "";
  robotCode.value = typeof config?.config.robotCode === "string" ? config.config.robotCode : "";
  enabled.value = config?.enabled ?? true;
  try { projects.value = await api.listProjects(); } catch { projects.value = []; }
}

async function save() {
  if (!name.value.trim() || !projectId.value || !clientId.value.trim() || (!props.config && !clientSecret.value.trim())) {
    message.warning(t("channel.dingtalk.requiredHint"));
    return;
  }
  saving.value = true;
  try {
    const config: Record<string, unknown> = {
      ...(props.config?.config ?? {}),
      projectId: projectId.value,
      clientId: clientId.value.trim(),
      robotCode: robotCode.value.trim(),
    };
    if (clientSecret.value.trim()) config.clientSecret = clientSecret.value.trim();
    if (props.config) {
      await store.update(props.config.id, { name: name.value.trim(), enabled: enabled.value, config });
    } else {
      await store.create({ type: "dingtalk", name: name.value.trim(), config });
    }
    message.success(t("channel.save"));
    emit("saved");
  } catch (error: any) {
    message.error(error?.message ?? t("channel.saveFailed"));
  } finally {
    saving.value = false;
  }
}

watch(() => props.show, (visible) => { if (visible) void load(); });
</script>

<template>
  <NDrawer placement="right" :show="show" :width="460" @update:show="(value: boolean) => emit('update:show', value)">
    <section class="dingtalk-drawer">
      <header class="drawer-header">
        <div>
          <h2>{{ t('channel.dingtalk.drawerTitle') }}</h2>
          <p>{{ t('channel.dingtalk.drawerDesc') }}</p>
        </div>
        <button class="drawer-close" type="button" @click="emit('update:show', false)">×</button>
      </header>

      <div class="drawer-body">
        <section class="drawer-section">
          <div class="section-heading">
            <h3>{{ t('channel.dingtalk.field.projectId') }}</h3>
            <NSwitch :value="enabled" @update:value="(value: boolean) => enabled = value" />
          </div>
          <NDropdown
            :options="projectDropdownOptions"
            :value="projectId"
            width="trigger"
            trigger="click"
            @select="onProjectSelect"
          >
            <NButton block class="project-picker-btn">
              {{ selectedProjectName ?? t('channel.dingtalk.field.projectId.placeholder') }}
            </NButton>
          </NDropdown>
          <p class="hint">{{ t('channel.dingtalk.projectHint') }}</p>
        </section>

        <section class="drawer-section">
          <div class="section-heading"><h3>{{ t('channel.dingtalk.credentials') }}</h3></div>
          <label class="field">
            <span>{{ t('channel.name') }}</span>
            <NInput v-model:value="name" :placeholder="t('channel.namePlaceholder')" />
          </label>
          <label class="field">
            <span>{{ t('channel.dingtalk.field.clientId') }}</span>
            <NInput v-model:value="clientId" :placeholder="t('channel.dingtalk.field.clientId.placeholder')" />
          </label>
          <label class="field">
            <span>{{ t('channel.dingtalk.field.clientSecret') }}</span>
            <NInput v-model:value="clientSecret" type="password" show-password-on="click" :placeholder="config ? t('channel.secretKeepPlaceholder') : ''" />
          </label>
          <label class="field">
            <span>{{ t('channel.dingtalk.field.robotCode') }}</span>
            <NInput v-model:value="robotCode" :placeholder="t('channel.dingtalk.field.robotCode.placeholder')" />
          </label>
          <p class="hint">{{ t('channel.dingtalk.streamHint') }}</p>
        </section>
      </div>

      <footer class="drawer-footer">
        <NButton @click="emit('update:show', false)">{{ t('channel.cancel') }}</NButton>
        <NButton type="primary" :loading="saving" @click="save">{{ t('channel.save') }}</NButton>
      </footer>
    </section>
  </NDrawer>
</template>

<style scoped>
.dingtalk-drawer { height: 100%; display: flex; flex-direction: column; background: var(--bg-deep); }
.drawer-header { display: flex; justify-content: space-between; gap: 16px; padding: 28px 28px 20px; border-bottom: 1px solid var(--border-default); }
.drawer-header h2, .drawer-header p, .section-heading h3 { margin: 0; }
.drawer-header h2 { color: var(--text-primary); font-size: 20px; }
.drawer-header p { margin-top: 6px; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.drawer-close { border: 0; background: transparent; color: var(--text-muted); font-size: 28px; line-height: 1; cursor: pointer; }
.drawer-body { flex: 1; overflow: auto; padding: 22px 28px; display: flex; flex-direction: column; gap: 18px; }
.drawer-section { padding: 16px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.section-heading h3 { color: var(--text-primary); font-size: 13px; }
.field { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.field span { color: var(--text-faint); font-family: var(--font-mono); font-size: 11px; font-weight: 600; }
.hint { margin: 8px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.project-picker-btn { justify-content: flex-start !important; font-weight: 500; }
.drawer-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 28px; border-top: 1px solid var(--border-default); }
</style>
