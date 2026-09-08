# Token 用量弹框标签页实施计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不改变当前 Token 用量入口、统计口径和居中弹框行为的前提下，将弹框内容改造成“概览 / 调用明细”两个标签页。

**架构：** 继续由 `TokenUsage.vue` 从现有 `TokenUsageSummary` 读取数据。组件新增一个本地标签页状态，概览页以指标卡和辅助信息呈现汇总，调用明细页独立呈现现有调用表格；关闭、遮罩和 Esc 仍复用当前弹框逻辑。没有服务端、数据库或统计工具函数改动。

**技术栈：** Vue 3 `<script setup>`、Teleport、TypeScript、现有 CSS 语义变量、Vue Test Utils、Vitest、vue-tsc、Vite。

---

## 文件清单

- 修改：`apps/web/src/components/TokenUsage.vue`
  - 增加概览 / 调用明细标签状态与可访问属性。
  - 将汇总卡片、辅助统计、最近调用和压缩操作放入概览页。
  - 将逐次调用表格和空状态放入调用明细页。
  - 保留当前 Teleport、关闭按钮、遮罩、Esc 和焦点返回逻辑。
- 修改：`apps/web/src/i18n/messages.ts`
  - 为概览标签、调用明细标签和无调用状态增加中英文文案。
- 修改：`apps/web/tests/unit/token-usage.test.ts`
  - 覆盖默认概览、标签切换、调用明细空状态及关闭行为。
- 修改：`apps/web/tests/unit/chat-panel-running-input.test.ts`
  - 保持当前入口位置断言，并继续验证累计统计数字。
- 参考：`docs/superpowers/specs/2026-09-08-token-usage-tabs-design.md`

## 任务 1：先补充标签页和空状态的失败测试

**文件：** `apps/web/tests/unit/token-usage.test.ts`

- [ ] **步骤 1：增加无调用用量夹具和 mount 辅助方法**

```ts
function mountUsage(value = usage) {
  return mount(TokenUsage, { props: { usage: value, busy: false } });
}

const emptyUsage = summarizeTokenUsage([
  { id: "u1", role: "user", metadata: null },
]);
```

- [ ] **步骤 2：增加默认概览和切换调用明细测试**

测试先断言 `[role=tab][aria-selected=true]` 为“概览”、`[data-panel=overview]` 可见且调用面板不存在；点击 `[data-tab=calls]` 后断言调用标签选中、概览隐藏、调用表格展示模型调用数据。

```ts
it("starts on overview and switches to call details", async () => {
  const wrapper = mountUsage();
  expect(wrapper.get("[role=tab][aria-selected=true]").text()).toContain("概览");
  expect(wrapper.get("[data-panel=overview]").text()).toContain("1.2K");
  expect(wrapper.find("[data-panel=calls]").exists()).toBe(false);
  await wrapper.get("[data-tab=calls]").trigger("click");
  expect(wrapper.get("[role=tab][aria-selected=true]").text()).toContain("调用明细");
  expect(wrapper.find("[data-panel=overview]").exists()).toBe(false);
  expect(wrapper.get("[data-panel=calls] table").text()).toContain("—");
  wrapper.unmount();
});
```

- [ ] **步骤 3：增加无调用空状态测试**

点击无调用夹具的调用明细标签，断言面板显示“暂无调用明细”，且不渲染空表格。

```ts
it("shows an empty state instead of an empty table", async () => {
  const wrapper = mountUsage(emptyUsage);
  await wrapper.get("[data-tab=calls]").trigger("click");
  expect(wrapper.get("[data-panel=calls]").text()).toContain("暂无调用明细");
  expect(wrapper.find("[data-panel=calls] table").exists()).toBe(false);
  wrapper.unmount();
});
```

- [ ] **步骤 4：运行新增测试确认它们先失败**

```bash
pnpm --filter @pi-web-ui/web exec vitest run tests/unit/token-usage.test.ts
```

预期：现有关闭测试通过，新增标签选择器测试因组件尚无标签页结构而失败。

## 任务 2：增加文案并实现 TokenUsage 内容分层

**文件：** `apps/web/src/i18n/messages.ts`、`apps/web/src/components/TokenUsage.vue`

- [ ] **步骤 1：增加中英文文案键**

英文区增加 `chat.usageOverview: "Overview"`、`chat.usageCallDetailsTab: "Call details"`、`chat.usageNoCalls: "No call details for this request"`；中文区对应增加 `概览`、`调用明细`、`暂无调用明细`。

- [ ] **步骤 2：增加本地标签页状态并在打开时重置**

```ts
type UsageTab = "overview" | "calls";
const activeTab = ref<UsageTab>("overview");

function openDetails() {
  activeTab.value = "overview";
  showDetails.value = true;
  document.addEventListener("keydown", handleKeydown);
  void nextTick(() => closeButton.value?.focus());
}
```

保留 `closeDetails()` 的关闭、事件解绑和焦点返回逻辑；不持久化跨打开的标签选择。

- [ ] **步骤 3：替换弹框正文结构**

在说明文字后增加 `role="tablist"` 和两个原生 `button[role="tab"]`。两个按钮分别使用 `data-tab="overview"` / `data-tab="calls"`、`aria-selected` 和 `aria-controls`。概览面板使用 `data-panel="overview"`，包含四个指标卡、缓存和模型/工具调用辅助统计、最近调用和压缩操作；调用面板使用 `data-panel="calls"`，仅在选中时渲染现有逐次调用表格。无调用时渲染 `chat.usageNoCalls` 空状态。

```vue
<div class="token-usage-tabs" role="tablist">
  <button type="button" class="token-usage-tab" role="tab" data-tab="overview" aria-controls="usage-overview-panel" :aria-selected="activeTab === 'overview'" @click="activeTab = 'overview'">{{ t('chat.usageOverview') }}</button>
  <button type="button" class="token-usage-tab" role="tab" data-tab="calls" aria-controls="usage-calls-panel" :aria-selected="activeTab === 'calls'" @click="activeTab = 'calls'">{{ t('chat.usageCallDetailsTab') }} <span>{{ usage.calls.length }}</span></button>
</div>
<section v-if="activeTab === 'overview'" id="usage-overview-panel" data-panel="overview" role="tabpanel" tabindex="0">
  <div class="usage-metric-grid">
    <article class="usage-metric-card"><span>{{ t('chat.usageCurrent') }} · {{ t('chat.usageInput') }}</span><strong class="token-in">{{ count(usage.current.prompt) }}</strong></article>
    <article class="usage-metric-card"><span>{{ t('chat.usageCurrent') }} · {{ t('chat.usageOutput') }}</span><strong class="token-out">{{ count(usage.current.output) }}</strong></article>
    <article class="usage-metric-card"><span>{{ t('chat.usageSession') }} · {{ t('chat.usageInput') }}</span><strong class="token-in">{{ count(usage.session.prompt) }}</strong></article>
    <article class="usage-metric-card"><span>{{ t('chat.usageSession') }} · {{ t('chat.usageOutput') }}</span><strong class="token-out">{{ count(usage.session.output) }}</strong></article>
  </div>
  <div class="usage-facts"><div><span>{{ t('chat.usageCacheRead') }}</span><b>{{ count(usage.current.cacheRead) }} / {{ count(usage.session.cacheRead) }}</b></div><div><span>{{ t('chat.usageCacheWrite') }}</span><b>{{ count(usage.current.cacheWrite) }} / {{ count(usage.session.cacheWrite) }}</b></div><div><span>{{ t('chat.usageModels') }}</span><b>{{ usage.current.modelCalls }} / {{ usage.session.modelCalls }}</b></div><div><span>{{ t('chat.usageTools') }}</span><b>{{ usage.current.toolCalls }} / {{ usage.session.toolCalls }}</b></div></div>
  <p v-if="usage.latest">{{ t('chat.usageLatest') }}: <TokenCounts :input="usage.latest.prompt" :output="usage.latest.output" /> · {{ usage.latest.model }}</p>
  <button type="button" class="compact-context-btn" :disabled="busy || !usage.session.modelCalls" @click="emit('compact')">{{ t('chat.compactContext') }}</button>
  <p>{{ t('chat.compactContextHint') }}</p>
</section>
<section v-else id="usage-calls-panel" data-panel="calls" role="tabpanel" tabindex="0">
  <div v-if="usage.calls.length" class="usage-table-scroll">
    <table><thead><tr><th>#</th><th>{{ t('chat.usageModel') }}</th><th>↑</th><th>↓</th><th>{{ t('chat.usageCacheRead') }}</th><th>{{ t('chat.usageCacheWrite') }}</th><th>{{ t('chat.usageTools') }}</th></tr></thead><tbody><tr v-for="(call, index) in usage.calls" :key="call.id"><td>{{ index + 1 }}</td><td>{{ call.model }}</td><td class="token-in">{{ count(call.prompt) }}</td><td class="token-out">{{ count(call.output) }}</td><td>{{ count(call.cacheRead) }}</td><td>{{ count(call.cacheWrite) }}</td><td>{{ call.toolCalls }}</td></tr></tbody></table>
  </div>
  <p v-else class="usage-empty-state">{{ t('chat.usageNoCalls') }}</p>
</section>
```

调用表格字段、`count()` 格式化和 `TokenCounts` 使用保持现有实现不变，只移除外层嵌套 `<details>`。

- [ ] **步骤 4：增加标签、指标卡和空状态的 scoped CSS**

```css
.token-usage-tabs { display: flex; gap: 22px; margin: 0 -20px 16px; padding: 0 20px; border-bottom: 1px solid var(--border-default); }
.token-usage-tab { position: relative; padding: 9px 1px; border: 0; background: transparent; color: var(--text-muted); cursor: pointer; font: inherit; }
.token-usage-tab[aria-selected="true"] { color: var(--accent); }
.token-usage-tab[aria-selected="true"]::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; background: var(--accent); content: ""; }
.usage-metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.usage-metric-card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--bg-elevated); }
.usage-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.usage-empty-state { padding: 28px 8px; text-align: center; color: var(--text-muted); }
@media (max-width: 520px) { .usage-metric-grid, .usage-facts { grid-template-columns: 1fr; } }
```

继续使用现有 `.token-in`、`.token-out`、`.usage-table-scroll`、`.compact-context-btn` 和主题语义变量，保持三种主题的视觉一致性。

## 任务 3：验证标签交互并保持入口行为

**文件：** `apps/web/tests/unit/token-usage.test.ts`、`apps/web/tests/unit/chat-panel-running-input.test.ts`

- [ ] **步骤 1：扩展关闭测试验证每次打开回到概览**

在调用明细页点击关闭后再次点击当前入口，断言概览重新选中；保留右上角关闭按钮、遮罩点击和 Esc 测试。

- [ ] **步骤 2：保持 ChatPanel 入口断言不变**

```ts
const total = wrapper.get(".composer-token-usage .token-usage-summary");
expect(total.get(".token-in").text()).toBe("↑12.0K");
expect(total.get(".token-out").text()).toBe("↓1.2K");
```

不新增底部常驻入口，不修改 `summarizeTokenUsage()` 或消息合并逻辑。

- [ ] **步骤 3：运行 Web 全量测试**

```bash
pnpm --filter @pi-web-ui/web test
```

预期：所有现有和新增测试通过；允许已有 Naive UI 测试警告，但不能出现新增失败。

## 任务 4：类型、构建和差异检查

- [ ] **步骤 1：运行类型检查**

```bash
pnpm --filter @pi-web-ui/web typecheck
```

预期：`vue-tsc --noEmit` 成功退出。

- [ ] **步骤 2：运行生产构建**

```bash
pnpm --filter @pi-web-ui/web build
```

预期：Vite 构建成功；已有 chunk size warning 不作为本次失败。

- [ ] **步骤 3：检查差异范围**

```bash
git diff --check
git status --short
```

预期：无空白错误；用户已有的 `token-usage-prototype.html` 不加入本次提交。

## 任务 5：提交并推送实现

- [ ] **步骤 1：按仓库规范提交实现改动**

```bash
git add apps/web/src/components/TokenUsage.vue apps/web/src/i18n/messages.ts apps/web/tests/unit/token-usage.test.ts apps/web/tests/unit/chat-panel-running-input.test.ts
git commit -m "feat(web): 新增 Token 用量标签页交互"
```

- [ ] **步骤 2：推送当前分支**

```bash
git push origin release/v1.0
```

预期：远程 `release/v1.0` 更新到实现提交，工作区保留用户已有但未跟踪的 `token-usage-prototype.html`。
