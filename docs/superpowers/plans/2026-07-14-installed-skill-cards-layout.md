# 已安装技能卡片布局重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把技能商店「已安装」标签页的垂直行列表替换为 Naive UI `NGrid` 一行三列（容器响应式）卡片网格，复用市场页 `.ss-card` 视觉语言。

**Architecture:** 单文件改动 `apps/web/src/components/SkillStoreView.vue`：模板把 `<ul class="ss-installed-list">` 换成 `<NGrid responsive="self" cols="1 s:2 m:3">` + `<NGridItem>` 包裹的卡片；样式删除 `.ss-installed-list/-row/-info/-head/-name/-desc/-path` 旧规则，新增 `.ss-installed-card*` 系列复用市场页设计变量。`NGrid responsive="self"` 基于容器宽度断点（xs/s/m/l/xl/xxl），不引入 `@media` 或 `useBreakpoint`。

**Tech Stack:** Vue 3.4 SFC + `<script setup lang="ts">`，naive-ui 2.39.0（`NGrid`/`NGridItem`/`NButton` 等），Pinia store `useSkillStore` (`stores/skill.ts`)，vitest 1.6 + @vue/test-utils 2.4 测试。

## Global Constraints

- 仅改动 `apps/web/src/components/SkillStoreView.vue` 和新增测试文件 `apps/web/tests/unit/skill-store-view-installed.test.ts`。
- 不引入 `@media`、`useBreakpoint` 或新依赖。
- 不改 i18n key、store 数据流、卸载逻辑（`requestUninstall` → `ConfirmDialog` → `installed.remove(name)`）。
- 不改市场页 `.ss-card` 视觉；新卡片仅复用其 CSS 变量。
- `naive-ui@2.39.0`：`NGrid` 的 `responsive` 取 `"screen" | "self"`，`cols` 可为 `"1 s:2 m:3"` 形式响应式字符串；`NButton.block` 已存在（Boolean）。
- 现有 naive-ui 导入（第 3 行）：`import { NInput, NButton, NRadioGroup, NRadio, NSpin, NTag, NTabs, NTabPane } from "naive-ui";`
- `SkillDto` 形状（`packages/shared/src/types.ts:103`）：`{ name: string; description: string; path: string }`。
- 测试约定（参考 `apps/web/tests/unit/confirm-dialog.test.ts`）：用 `mount` + `global.stubs` 按 naive-ui 内部 `name` 桩（`Modal`/`Input`/`Tabs`/`TabPane`/`Grid`/`GridItem`/`Button` 等），`data-test='...'` 作选择器。

---

## Task 1: 用 NGrid 卡片网格替换已安装技能列表（TDD）

**Files:**
- Create: `apps/web/tests/unit/skill-store-view-installed.test.ts`
- Modify: `apps/web/src/components/SkillStoreView.vue:3`（import）、`:268-284`（模板）、`:586-641`（CSS）

**Interfaces:**
- Consumes: `useSkillStore()`（来自 `stores/skill.ts`）暴露 `skills: SkillDto[]`、`loading: boolean`、`loadAll()`、`remove(name)`；组件内 `requestUninstall(name: string)` 设置 `uninstallTarget` 并显示 `ConfirmDialog`。
- Produces: 新 CSS 类 `.ss-installed-card`、`.ss-installed-card-head`、`.ss-installed-card-name`、`.ss-installed-card-desc`、`.ss-installed-card-path`、`.ss-installed-card-foot`；模板新增 `data-test="installed-card"` 属性供测试选择。

- [ ] **Step 1: 写失败测试**

创建 `apps/web/tests/unit/skill-store-view-installed.test.ts`：

```ts
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { nextTick, defineComponent } from "vue";
import SkillStoreView from "../../src/components/SkillStoreView.vue";
import { useSkillStore } from "../../src/stores/skill.js";

const NTabsStub = defineComponent({
  props: ["value"],
  emits: ["update:value"],
  template: `
    <div>
      <button data-test="tab-market" @click="$emit('update:value', 'market')">market</button>
      <button data-test="tab-installed" @click="$emit('update:value', 'installed')">installed</button>
    </div>`,
});

function mountView() {
  return mount(SkillStoreView, {
    global: {
      stubs: {
        Tabs: NTabsStub,
        TabPane: { template: '<div><slot/></div>' },
        Grid: { template: '<div><slot/></div>' },
        GridItem: { template: '<div><slot/></div>' },
        Button: { template: '<button><slot/></button>' },
        Input: { template: '<input />' },
        RadioGroup: { template: '<div><slot/></div>' },
        Radio: { template: '<div><slot/></div>' },
        Tag: { template: '<div><slot/></div>' },
        Spin: { template: '<div></div>' },
        CreateSkillDialog: { template: '<div></div>' },
        ImportSkillDialog: { template: '<div></div>' },
        ConfirmDialog: { template: '<div></div>' },
      },
    },
  });
}

describe("SkillStoreView installed tab", () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("renders installed skills as cards when installed tab is active", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify([
          { name: "my-skill", description: "does X", path: "/a/b/my-skill" },
          { name: "other-skill", description: "does Y", path: "/c/other-skill" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const w = mountView();
    await flushPromises();
    await nextTick();

    await w.find('[data-test="tab-installed"]').trigger("click");
    await flushPromises();
    await nextTick();

    const cards = w.findAll('[data-test="installed-card"]');
    expect(cards.length).toBe(2);
    expect(cards[0]!.text()).toContain("my-skill");
    expect(cards[0]!.text()).toContain("does X");
    expect(cards[0]!.text()).toContain("/a/b/my-skill");
    expect(cards[1]!.text()).toContain("other-skill");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @pi-web-ui/web test -- skill-store-view-installed`
Expected: FAIL，断言 `cards.length` 为 0（因为当前模板渲染的是 `.ss-installed-row` 行项，没有 `data-test="installed-card"` 属性）。

- [ ] **Step 3: 修改模板 — 用 NGrid + 卡片替换 `<ul class="ss-installed-list">`**

在 `apps/web/src/components/SkillStoreView.vue` 中，定位第 268–284 行的 `<ul v-else class="ss-installed-list"> ... </ul>` 块，整体替换为：

```vue
<NGrid v-else responsive="self" cols="1 s:2 m:3" :x-gap="10" :y-gap="10" class="ss-installed-grid">
  <NGridItem v-for="s in installed.skills" :key="s.name">
    <article class="ss-installed-card" data-test="installed-card">
      <div class="ss-installed-card-head">
        <span class="ss-installed-card-name">{{ s.name }}</span>
      </div>
      <p class="ss-installed-card-desc">{{ s.description || '—' }}</p>
      <p class="ss-installed-card-path">{{ t('skillStore.pathLabel') }}: <code>{{ s.path }}</code></p>
      <div class="ss-installed-card-foot">
        <NButton size="tiny" type="error" ghost block @click="requestUninstall(s.name)">
          {{ t('skillStore.uninstall') }}
        </NButton>
      </div>
    </article>
  </NGridItem>
</NGrid>
```

要点：
- `v-else` 保留，对应上方 `v-if="installed.loading && !installed.skills.length"` 与 `v-else-if="!installed.skills.length"` 两个分支。
- `responsive="self"` 让 `NGrid` 基于容器宽度断点（非视口）。
- `cols="1 s:2 m:3"`：默认 1 列，`s` 断点 2 列，`m` 及以上 3 列；不设 `l:4`/`xl:4` 以守住"一行三列"。
- `:x-gap="10" :y-gap="10"` 与市场页 `.ss-card-list` 的 `gap: 10px` 一致。
- `data-test="installed-card"` 供测试选择。
- `NButton block` 让卸载按钮在 foot 内占满宽度。

- [ ] **Step 4: 修改 import — 补充 `NGrid`、`NGridItem`**

第 3 行，由：
```ts
import { NInput, NButton, NRadioGroup, NRadio, NSpin, NTag, NTabs, NTabPane } from "naive-ui";
```
改为：
```ts
import { NInput, NButton, NRadioGroup, NRadio, NSpin, NTag, NTabs, NTabPane, NGrid, NGridItem } from "naive-ui";
```

- [ ] **Step 5: 修改 CSS — 删除旧规则，新增卡片样式**

定位第 586–641 行（从 `.ss-installed-list {` 到 `.ss-installed-path code { ... }` 的整个块，含中间空行），整体替换为：

```css
.ss-installed-grid {
  /* NGrid handles layout; class kept as a hook for future tweaks. */
}
.ss-installed-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  transition: all var(--transition-fast);
  height: 100%;
}
.ss-installed-card:hover {
  border-color: var(--accent);
  background: var(--bg-elevated);
}
.ss-installed-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ss-installed-card-name {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.ss-installed-card-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ss-installed-card-path {
  margin: 0;
  font-size: 11px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  word-break: break-all;
}
.ss-installed-card-path code {
  font-family: inherit;
}
.ss-installed-card-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
```

保留其后的空行与 `/* ─── Slide transition ─── */` 注释及之后规则不变。

- [ ] **Step 6: 运行测试，确认通过**

Run: `pnpm --filter @pi-web-ui/web test -- skill-store-view-installed`
Expected: PASS — `cards.length === 2`，两张卡片均包含 name/description/path 文本。

- [ ] **Step 7: 跑全量 web 测试 + typecheck，确认无回归**

Run: `pnpm --filter @pi-web-ui/web test && pnpm --filter @pi-web-ui/web typecheck`
Expected: 全部 PASS，typecheck 无错误。

- [ ] **Step 8: 提交**

```bash
git add apps/web/src/components/SkillStoreView.vue apps/web/tests/unit/skill-store-view-installed.test.ts
git commit -m "feat(web): 已安装技能改为 NGrid 三列卡片布局"
```

---

## Task 2: 浏览器手动验证（视觉与响应式）

**Files:**
- 无文件改动；仅运行 dev 服务并在浏览器核验。

- [ ] **Step 1: 启动 dev 服务**

Run: `pnpm dev`（如已在运行则跳过）
Expected: Web `http://localhost:5173/`、Server `http://127.0.0.1:5174` 就绪。

- [ ] **Step 2: 在浏览器核验已安装标签页**

打开 `http://localhost:5173/`，进入技能商店，切到「已安装」标签页：
- 桌面宽度（窗口宽 > ~960px）：一行 3 列卡片。
- 拖窄窗口至中等：降为 2 列。
- 继续拖窄：降为 1 列。
- 卡片 hover 出现 accent 边框 + elevated 背景。
- 描述超长时 3 行截断、省略号。
- 卸载按钮贴底、占满 foot 宽度。
- 点击卸载按钮 → 弹出 `ConfirmDialog`，确认后技能从列表消失（与原行为一致）。
- 不同描述长度的卡片在同一行底部对齐。

- [ ] **Step 3: 若发现视觉/行为问题**

回到 Task 1 调整 CSS 或模板，重跑测试，再次手动核验。无需手动提交（Task 1 已提交；如本轮有改动，单独提交为 `fix(web): 已安装卡片布局微调`）。

---

## 验证清单（完成后回看）

- [ ] 单元测试 `skill-store-view-installed.test.ts` 通过。
- [ ] `pnpm --filter @pi-web-ui/web test` 全绿。
- [ ] `pnpm --filter @pi-web-ui/web typecheck` 无错。
- [ ] 浏览器手动核验：3 列 / 2 列 / 1 列响应式、hover、3 行截断、卸载弹窗与原行为一致、同行底对齐。
