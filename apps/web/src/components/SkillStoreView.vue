<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NInput, NButton, NRadioGroup, NRadio, NSpin, NTag, NTabs, NTabPane } from "naive-ui";
import { useSkillStoreStore } from "../stores/skill-store.js";
import { useSkillStore } from "../stores/skill.js";
import { useI18n } from "../i18n/index.js";
import { renderMarkdown } from "../utils/markdown.js";
import type { SkillSearchResult, SkillPreviewAudit } from "@pi-web-ui/shared";
import CreateSkillDialog from "./CreateSkillDialog.vue";
import ImportSkillDialog from "./ImportSkillDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const store = useSkillStoreStore();
const installed = useSkillStore();
const { t } = useI18n();

const localName = ref<string>("");
const installError = ref<string | null>(null);

const activeTab = ref<"market" | "installed">("market");

const showCreateSkill = ref(false);
const showImportZip = ref(false);
const uninstallTarget = ref<string | null>(null);

// 已安装技能模糊搜索
const installedQuery = ref("");
const filteredInstalledSkills = computed(() => {
  const q = installedQuery.value.trim().toLowerCase();
  if (!q) return installed.skills;
  return installed.skills.filter((s) => s.name.toLowerCase().includes(q));
});

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function providerLabel(p: string): string {
  if (p === "skills-sh") return "skills.sh";
  if (p === "skillsmp") return "SkillsMP";
  if (p === "github") return "GitHub";
  return p;
}

function auditTone(a: SkillPreviewAudit): "success" | "warning" | "error" | "default" {
  if (a.status === "pass") return "success";
  if (a.status === "warning") return "warning";
  if (a.status === "fail") return "error";
  return "default";
}

function openPreview(skill: SkillSearchResult) {
  localName.value = "";
  installError.value = null;
  store.openPreview(skill);
}

async function handleInstall(skill: SkillSearchResult) {
  installError.value = null;
  try {
    await store.install(skill, localName.value.trim() || undefined);
    await installed.loadAll();
  } catch (e: any) {
    installError.value = e?.message ?? t("skillStore.installFailed");
  }
}

function requestUninstall(name: string) {
  uninstallTarget.value = name;
}

async function confirmUninstall() {
  if (!uninstallTarget.value) return;
  try {
    await installed.remove(uninstallTarget.value);
  } catch (e: any) {
    alert(e?.message ?? "uninstall failed");
  } finally {
    uninstallTarget.value = null;
  }
}

const previewHtml = computed(() => {
  const body = store.preview?.data.body ?? "";
  return body ? renderMarkdown(body) : "";
});

const previewTitle = computed(() => store.preview?.data.title ?? store.preview?.skill.name ?? "");

onMounted(() => {
  installed.loadAll();
});

watch(activeTab, (tab) => {
  if (tab === "installed") installed.loadAll();
});
</script>

<template>
  <main class="skill-store-view">
    <!-- Header -->
    <header class="ss-header">
      <div class="ss-header-text">
        <h1 class="ss-title">{{ t('skillStore.title') }}</h1>
        <p class="ss-subtitle">{{ t('skillStore.subtitle') }}</p>
      </div>
      <NTabs v-model:value="activeTab" type="line" size="small" class="ss-tabs">
        <NTabPane name="market" :tab="t('skillStore.tabMarket')" />
        <NTabPane name="installed" :tab="t('skillStore.tabInstalled')" />
      </NTabs>
    </header>

    <!-- Market tab -->
    <div v-if="activeTab === 'market'" class="ss-body">
      <section class="ss-results">
        <div class="ss-search-row">
          <NInput
            v-model:value="store.query"
            size="small"
            :placeholder="t('skillStore.searchPlaceholder')"
            class="ss-search-input"
            @keydown.enter="store.search()"
            clearable
          />
          <NRadioGroup v-model:value="store.mode" name="ss-mode" size="small">
            <NRadio value="keyword">{{ t('skillStore.modeKeyword') }}</NRadio>
          </NRadioGroup>
          <NButton
            type="primary"
            size="small"
            :loading="store.loading"
            :disabled="!store.query.trim()"
            @click="store.search()"
          >{{ store.loading ? t('skillStore.searching') : t('skillStore.search') }}</NButton>
        </div>

        <div v-if="store.loading" class="ss-state"><NSpin size="small" /></div>
        <div v-else-if="store.errors.length" class="ss-state error">
          <ul>
            <li v-for="(e, i) in store.errors" :key="i">
              {{ t('skillStore.providerError', { provider: e.provider, message: e.message }) }}
            </li>
          </ul>
        </div>
        <div v-else-if="!store.results.length && !store.query.trim()" class="ss-state empty">{{ t('skillStore.empty') }}</div>
        <div v-else-if="!store.results.length" class="ss-state empty">{{ t('skillStore.noResults') }}</div>
        <ul v-else class="ss-card-list">
          <li
            v-for="r in store.results"
            :key="r.id"
            class="ss-card"
            :class="{ active: store.preview?.skill.id === r.id }"
            @click="openPreview(r)"
          >
            <div class="ss-card-head">
              <span class="ss-card-name truncate">{{ r.name }}</span>
              <NTag size="tiny" :type="r.provider === 'skills-sh' ? 'success' : r.provider === 'skillsmp' ? 'info' : 'default'" round>
                {{ providerLabel(r.provider) }}
              </NTag>
            </div>
            <p class="ss-card-author">{{ t('skillStore.author') }}: {{ r.author || '—' }}</p>
            <p class="ss-card-desc">{{ r.description || '' }}</p>
            <div class="ss-card-foot">
              <span class="ss-card-pop">{{ t('skillStore.popularity', { n: fmt(r.popularity) }) }}</span>
              <NButton
                v-if="store.installedIds.has(r.id)"
                size="tiny"
                type="success"
                ghost
                disabled
              >{{ t('skillStore.installed') }}</NButton>
              <NButton
                v-else
                size="tiny"
                type="primary"
                ghost
                :loading="store.installingId === r.id"
                @click.stop="handleInstall(r)"
              >{{ store.installingId === r.id ? t('skillStore.installing') : t('skillStore.install') }}</NButton>
            </div>
          </li>
        </ul>
      </section>

      <Transition name="ss-preview-slide">
        <aside v-if="store.preview || store.previewLoading" class="ss-preview">
          <div class="ss-preview-header">
            <span class="ss-preview-title truncate">{{ previewTitle }}</span>
            <button class="ss-preview-close" @click="store.closePreview()">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              </svg>
            </button>
          </div>

          <div v-if="store.previewLoading" class="ss-preview-state"><NSpin size="small" /></div>
          <div v-else-if="store.preview" class="ss-preview-body">
            <dl class="ss-meta-list">
              <div class="ss-meta-row">
                <dt>{{ t('skillStore.openSource') }}</dt>
                <dd>
                  <a v-if="store.preview.skill.sourceUrl" :href="store.preview.skill.sourceUrl" target="_blank" rel="noopener noreferrer">{{ store.preview.skill.sourceUrl }}</a>
                  <span v-else>—</span>
                </dd>
              </div>
              <div class="ss-meta-row">
                <dt>{{ t('skillStore.author') }}</dt>
                <dd>{{ store.preview.skill.author || '—' }}</dd>
              </div>
              <div class="ss-meta-row">
                <dt>{{ t('skillStore.weeklyInstalls') }}</dt>
                <dd>{{ fmt(store.preview.data.metadata.weeklyInstalls) }}</dd>
              </div>
              <div class="ss-meta-row">
                <dt>{{ t('skillStore.githubStars') }}</dt>
                <dd>{{ fmt(store.preview.data.metadata.githubStars) }}</dd>
              </div>
              <div class="ss-meta-row" v-if="store.preview.data.metadata.securityAudits.length">
                <dt>{{ t('skillStore.audits') }}</dt>
                <dd class="ss-audits">
                  <NTag
                    v-for="(a, i) in store.preview.data.metadata.securityAudits"
                    :key="i"
                    size="tiny"
                    :type="auditTone(a)"
                  >{{ a.label }}: {{ a.status }}</NTag>
                </dd>
              </div>
            </dl>

            <div class="ss-preview-install">
              <NInput
                v-model:value="localName"
                size="small"
                :placeholder="store.preview.skill.name"
              />
              <NButton
                type="primary"
                size="small"
                :loading="store.installingId === store.preview.skill.id"
                :disabled="store.installedIds.has(store.preview.skill.id)"
                @click="handleInstall(store.preview.skill)"
              >{{ store.installedIds.has(store.preview.skill.id) ? t('skillStore.installed') : (store.installingId === store.preview.skill.id ? t('skillStore.installing') : t('skillStore.install')) }}</NButton>
            </div>
            <p v-if="installError" class="ss-install-error">{{ installError }}</p>

            <p v-if="store.preview.data.limitation" class="ss-preview-limitation">{{ store.preview.data.limitation }}</p>

            <div class="ss-preview-md" v-html="previewHtml" />
          </div>
        </aside>
      </Transition>
    </div>

    <!-- Installed tab -->
    <div v-else class="ss-installed-body">
      <div class="ss-installed-actions">
        <NInput
          v-model:value="installedQuery"
          size="small"
          :placeholder="t('skillStore.searchPlaceholder')"
          clearable
          class="ss-installed-search"
        />
        <div class="ss-installed-spacer" />
        <NButton size="small" type="primary" @click="showCreateSkill = true">
          + {{ t('skillStore.importManual') }}
        </NButton>
        <NButton size="small" @click="showImportZip = true">
          {{ t('skillStore.importZip') }}
        </NButton>
      </div>

      <div v-if="installed.loading && !installed.skills.length" class="ss-state"><NSpin size="small" /></div>
      <div v-else-if="!installed.skills.length" class="ss-state empty">{{ t('skillStore.installedEmpty') }}</div>
      <div v-else-if="!filteredInstalledSkills.length" class="ss-state empty">{{ t('skillStore.noResults') }}</div>
      <ul v-else class="ss-card-list">
        <li
          v-for="s in filteredInstalledSkills"
          :key="s.name"
          class="ss-card"
          data-test="installed-card"
        >
          <div class="ss-card-head">
            <span class="ss-card-name truncate">{{ s.name }}</span>
          </div>
          <p class="ss-card-author">{{ t('skillStore.pathLabel') }}: {{ s.path }}</p>
          <p class="ss-card-desc">{{ s.description || '—' }}</p>
          <div class="ss-card-foot">
            <span class="ss-card-pop" />
            <NButton
              size="tiny"
              type="error"
              ghost
              @click="requestUninstall(s.name)"
            >{{ t('skillStore.uninstall') }}</NButton>
          </div>
        </li>
      </ul>
    </div>

    <CreateSkillDialog :show="showCreateSkill" @close="showCreateSkill = false" />
    <ImportSkillDialog :show="showImportZip" @close="showImportZip = false" />
    <ConfirmDialog
      :show="uninstallTarget !== null"
      :title="t('skillStore.uninstallConfirmTitle')"
      :message="t('skillStore.uninstallConfirmMessage')"
      :confirm-label="t('skillStore.uninstall')"
      :cancel-label="t('skillStore.close')"
      :danger="true"
      @close="uninstallTarget = null"
      @confirm="confirmUninstall"
    />
  </main>
</template>

<style scoped>
.skill-store-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-void);
}

/* ─── Header ─── */
.ss-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 28px 0;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-deep);
  flex-shrink: 0;
}
.ss-header-text { display: flex; flex-direction: column; gap: 4px; }
.ss-title {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}
.ss-subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
.ss-tabs {
  margin-top: 4px;
}
.ss-tabs :deep(.n-tabs-nav) {
  margin-bottom: 0;
}
.ss-tabs :deep(.n-tab-pane) {
  padding: 0;
}

/* ─── Body ─── */
.ss-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.ss-results {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ss-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}
.ss-state.error { color: var(--rose); }
.ss-state.error ul { list-style: none; padding: 0; }

.ss-search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ss-search-input { max-width: 360px; flex: 1 1 240px; }

.ss-card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}
.ss-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.ss-card:hover {
  border-color: var(--accent);
  background: var(--bg-elevated);
}
.ss-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent) inset;
}
.ss-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ss-card-name {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
}
.ss-card-author {
  margin: 0;
  font-size: 11px;
  color: var(--text-faint);
}
.ss-card-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ss-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.ss-card-pop {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

/* ─── Preview drawer ─── */
.ss-preview {
  width: 480px;
  max-width: 50vw;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border-default);
  background: var(--bg-deep);
  overflow: hidden;
}
.ss-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.ss-preview-title {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.ss-preview-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.ss-preview-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.ss-preview-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ss-preview-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ss-meta-list {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: 11.5px;
}
.ss-meta-row { display: contents; }
.ss-meta-list dt {
  color: var(--text-faint);
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ss-meta-list dd {
  margin: 0;
  color: var(--text-secondary);
  word-break: break-all;
}
.ss-meta-list dd a {
  color: var(--accent);
  text-decoration: none;
}
.ss-meta-list dd a:hover { text-decoration: underline; }
.ss-audits { display: flex; flex-wrap: wrap; gap: 4px; }

.ss-preview-install {
  display: flex;
  gap: 6px;
  align-items: center;
}
.ss-install-error {
  margin: 0;
  font-size: 11px;
  color: var(--rose);
}
.ss-preview-limitation {
  margin: 0;
  font-size: 11px;
  color: var(--text-faint);
  font-style: italic;
}
.ss-preview-md {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-secondary);
  word-wrap: break-word;
}
.ss-preview-md :deep(pre) {
  background: var(--bg-void);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 11px;
}
.ss-preview-md :deep(code) {
  font-family: var(--font-mono);
  font-size: 11px;
}
.ss-preview-md :deep(h1),
.ss-preview-md :deep(h2),
.ss-preview-md :deep(h3) {
  color: var(--text-primary);
  margin: 0.6em 0 0.3em;
  font-weight: 600;
}
.ss-preview-md :deep(a) {
  color: var(--accent);
}

/* ─── Installed tab ─── */
.ss-installed-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--bg-void);
}
.ss-installed-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ss-installed-search {
  width: 220px;
  flex: 0 1 220px;
}
.ss-installed-spacer {
  flex: 1;
}

/* ─── Slide transition ─── */
.ss-preview-slide-enter-active,
.ss-preview-slide-leave-active {
  transition: transform var(--transition-slow), opacity var(--transition-slow);
}
.ss-preview-slide-enter-from,
.ss-preview-slide-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>
