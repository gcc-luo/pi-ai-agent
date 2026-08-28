# 更新公告弹窗实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将桌面端更新公告改造成可读的 Markdown 发布面板，并使用现有主题变量适配浅色、深色和灰色主题，同时保持更新安装流程不变。

**架构：** 仅改造 `UpdateDialog.vue` 的展示层：使用现有更新 store 作为数据源，使用现有 `renderMarkdown()` 生成安全 HTML，使用局部 scoped CSS 完成弹窗布局和三主题适配。更新检测、下载、安装、重启和错误状态继续由现有 store 与事件处理函数负责。

**技术栈：** Vue 3 `<script setup>`、Naive UI `NModal` / `NProgress`、Pinia、marked、DOMPurify、Vue Test Utils、Vitest、TypeScript。

---

## 文件清单

- 修改：`apps/web/src/components/UpdateDialog.vue`
  - 增加 Markdown 正文渲染、主题变量样式、响应式内容滚动和状态布局。
  - 保留现有 store 方法调用与状态分支。
- 修改：`apps/web/src/i18n/messages.ts`
  - 将更新弹窗标题调整为“更新公告 / Update announcement”；复用已有其余更新文案。
- 新增：`apps/web/src/components/UpdateDialog.test.ts`
  - 覆盖可用、空正文、下载中、就绪、错误和按钮事件行为。

## 任务 1：先建立更新公告组件的失败测试

**文件：**

- 创建：`apps/web/src/components/UpdateDialog.test.ts`
- 参考：`apps/web/tests/unit/confirm-dialog.test.ts`

- [ ] **步骤 1：创建组件测试夹具和失败断言**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import UpdateDialog from "./UpdateDialog.vue";

const mockStore = vi.hoisted(() => ({
  status: "available" as string,
  updateInfo: {
    version: "2.0.0",
    date: "2026-08-28",
    body: "## 更新重点\n\n- 主题适配\n- Markdown 公告",
  } as { version: string; date: string | null; body: string } | null,
  downloadProgress: 42,
  errorMessage: null as string | null,
  downloadAndInstall: vi.fn(),
  installAndRestart: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("../stores/update.js", () => ({
  useUpdateStore: () => mockStore,
}));

function mountDialog() {
  return mount(UpdateDialog, {
    props: { show: true },
    global: {
      stubs: {
        Modal: {
          name: "Modal",
          template: '<div v-if="show"><slot /></div>',
          props: ["show"],
        },
        Progress: {
          template: '<div data-test="progress">{{ percentage }}%</div>',
          props: ["percentage"],
        },
      },
    },
  });
}

describe("UpdateDialog", () => {
  beforeEach(() => {
    mockStore.status = "available";
    mockStore.updateInfo = {
      version: "2.0.0",
      date: "2026-08-28",
      body: "## 更新重点\n\n- 主题适配\n- Markdown 公告",
    };
    mockStore.downloadProgress = 42;
    mockStore.errorMessage = null;
    vi.clearAllMocks();
  });

  it("renders the version and formatted markdown release notes", () => {
    const wrapper = mountDialog();

    expect(wrapper.text()).toContain("v2.0.0");
    expect(wrapper.text()).toContain("2026-08-28");
    expect(wrapper.find(".update-notes-content h2").text()).toBe("更新重点");
    expect(wrapper.findAll(".update-notes-content li")).toHaveLength(2);
  });

  it("hides the release notes region when the body is empty", () => {
    mockStore.updateInfo!.body = "";

    const wrapper = mountDialog();

    expect(wrapper.find(".update-notes").exists()).toBe(false);
  });

  it("resets and closes when later is clicked", async () => {
    const wrapper = mountDialog();

    await wrapper.get("[data-test=update-later]").trigger("click");

    expect(mockStore.reset).toHaveBeenCalledOnce();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("starts the download when the primary action is clicked", async () => {
    const wrapper = mountDialog();

    await wrapper.get("[data-test=update-download]").trigger("click");

    expect(mockStore.downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("resets and closes when the modal requests a close", async () => {
    const wrapper = mountDialog();

    await wrapper.findComponent({ name: "Modal" }).vm.$emit("update:show", false);

    expect(mockStore.reset).toHaveBeenCalledOnce();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("renders download progress", () => {
    mockStore.status = "downloading";

    const wrapper = mountDialog();

    expect(wrapper.get("[data-test=progress]").text()).toBe("42%");
    expect(wrapper.text()).toContain("正在下载更新");
  });

  it("restarts from the ready state", async () => {
    mockStore.status = "ready";

    const wrapper = mountDialog();
    await wrapper.get("[data-test=update-restart]").trigger("click");

    expect(mockStore.installAndRestart).toHaveBeenCalledOnce();
  });

  it("shows the original error detail", () => {
    mockStore.status = "error";
    mockStore.errorMessage = "Download failed";

    const wrapper = mountDialog();

    expect(wrapper.text()).toContain("更新失败");
    expect(wrapper.text()).toContain("Download failed");
  });
});
```

- [ ] **步骤 2：运行新测试确认它因展示契约缺失而失败**

运行：

```bash
pnpm --filter @pi-web-ui/web test -- UpdateDialog.test.ts
```

预期：测试文件能够加载，但 Markdown 标题、`.update-notes-content` 和 `data-test` 按钮选择器等断言失败；不能接受导入错误或测试夹具错误作为失败原因。

## 任务 2：接入 Markdown 数据流并整理状态模板

**文件：**

- 修改：`apps/web/src/components/UpdateDialog.vue:1-150`

- [ ] **步骤 1：引入 `computed` 和既有 Markdown 渲染器**

在 `<script setup>` 中保留现有 store 处理函数，并加入：

```ts
import { computed } from "vue";
import { renderMarkdown } from "../utils/markdown.js";

const renderedNotes = computed(() =>
  renderMarkdown(updateStore.updateInfo?.body ?? ""),
);
```

不得修改 `useUpdateStore()` 的方法名、状态名或调用顺序。

- [ ] **步骤 2：将 `available` 模板改成可滚动正文 + 固定操作区**

将现有 `available` 分支替换为以下结构，确保测试选择器和语义节点稳定：

```vue
<div v-if="updateStore.status === 'available'" class="update-state update-state-available">
  <div class="update-scroll-area">
    <div class="update-version-row">
      <div class="update-release-meta">
        <span class="update-notes-label">{{ t('update.releaseNotes') }}</span>
        <span v-if="updateStore.updateInfo?.date" class="update-date">
          {{ updateStore.updateInfo.date }}
        </span>
      </div>
      <span class="update-version-badge">v{{ updateStore.updateInfo?.version }}</span>
    </div>

    <div v-if="updateStore.updateInfo?.body" class="update-notes">
      <div class="update-notes-content" v-html="renderedNotes" />
    </div>
  </div>

  <div class="update-actions">
    <button type="button" class="update-btn update-btn-secondary" data-test="update-later" @click="handleLater">
      {{ t('update.later') }}
    </button>
    <button type="button" class="update-btn update-btn-primary" data-test="update-download" @click="handleDownload">
      {{ t('update.downloadInstall') }}
    </button>
  </div>
</div>
```

- [ ] **步骤 3：让其他状态复用状态容器并补齐测试选择器**

保持下载、就绪、安装中和错误分支的现有条件与文案，只做以下展示层调整：

```vue
<div v-else-if="updateStore.status === 'downloading'" class="update-state">
  <div class="update-scroll-area update-status-area" aria-live="polite">
    <p class="update-status-text">{{ t('update.downloading') }}</p>
    <NProgress
      type="line"
      :percentage="updateStore.downloadProgress"
      :show-indicator="true"
      :height="8"
      :border-radius="4"
      color="var(--accent)"
      rail-color="var(--bg-hover)"
    />
    <p class="update-progress-text">{{ updateStore.downloadProgress }}%</p>
  </div>
</div>

<div v-else-if="updateStore.status === 'ready'" class="update-state">
  <div class="update-scroll-area update-status-area" aria-live="polite">
    <p class="update-status-text">{{ t('update.readyToInstall') }}</p>
    <p class="update-hint-text">{{ t('update.restartHint') }}</p>
  </div>
  <div class="update-actions">
    <button type="button" class="update-btn update-btn-secondary" data-test="update-later" @click="handleLater">
      {{ t('update.later') }}
    </button>
    <button type="button" class="update-btn update-btn-primary" data-test="update-restart" @click="handleRestart">
      {{ t('update.restartNow') }}
    </button>
  </div>
</div>

<div v-else-if="updateStore.status === 'installing'" class="update-state">
  <div class="update-scroll-area update-status-area" aria-live="polite">
    <p class="update-status-text">{{ t('update.installing') }}</p>
  </div>
</div>

<div v-else-if="updateStore.status === 'error'" class="update-state">
  <div class="update-scroll-area update-status-area" role="alert">
    <p class="update-status-text update-error-text">{{ t('update.error') }}</p>
    <p class="update-error-detail">{{ updateStore.errorMessage }}</p>
  </div>
  <div class="update-actions">
    <button type="button" class="update-btn update-btn-secondary" data-test="update-later" @click="handleLater">
      {{ t('update.close') }}
    </button>
  </div>
</div>
```

- [ ] **步骤 4：运行组件测试确认失败原因已经收敛到样式或文案**

运行：

```bash
pnpm --filter @pi-web-ui/web test -- UpdateDialog.test.ts
```

预期：Markdown、状态和按钮行为测试通过；若仍失败，只允许是尚未实现的 CSS 选择器或 `update.title` 文案差异，不得存在 store 方法调用错误。

- [ ] **步骤 5：提交数据流与模板变更**

```bash
git add apps/web/src/components/UpdateDialog.vue apps/web/src/components/UpdateDialog.test.ts
git commit -m "feat(web): 重构更新公告内容展示"
```

## 任务 3：实现三主题视觉适配和响应式布局

**文件：**

- 修改：`apps/web/src/components/UpdateDialog.vue:150-330`
- 修改：`apps/web/src/i18n/messages.ts` 中现有 `update.title` 条目

- [ ] **步骤 1：将弹窗改成语义变量驱动的发布面板**

替换 `UpdateDialog.vue` 的 scoped 样式，至少包含以下完整核心规则：

```css
.update-dialog {
  display: flex;
  flex-direction: column;
  width: min(760px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 32px));
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  box-shadow: 0 24px 60px rgba(var(--bg-deep-rgb), 0.45);
}

.update-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 20px 28px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.update-icon { flex-shrink: 0; color: var(--accent); }
.update-title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.update-state {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.update-scroll-area {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 26px 38px 22px;
}

.update-state-available .update-scroll-area { padding-top: 24px; }
.update-version-row { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.update-release-meta { display: flex; flex-direction: column; gap: 5px; }
.update-notes-label { color: var(--text-muted); font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; }
.update-version-badge { padding: 8px 12px; border-radius: var(--radius-md); background: var(--accent-dim); color: var(--accent); font-family: var(--font-mono); font-size: 13px; font-weight: 600; }
.update-date { color: var(--text-muted); font-size: 12px; }
.update-notes { margin-top: 22px; }

.update-notes-content {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
  word-break: break-word;
}

.update-notes-content :deep(p) { margin: 0 0 12px; }
.update-notes-content :deep(p:last-child) { margin-bottom: 0; }
.update-notes-content :deep(h1),
.update-notes-content :deep(h2),
.update-notes-content :deep(h3),
.update-notes-content :deep(h4) {
  margin: 24px 0 8px;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-weight: 600;
  line-height: 1.3;
}
.update-notes-content :deep(h1:first-child),
.update-notes-content :deep(h2:first-child),
.update-notes-content :deep(h3:first-child) { margin-top: 0; }
.update-notes-content :deep(h1) { font-size: 20px; }
.update-notes-content :deep(h2) { padding-bottom: 8px; border-bottom: 1px solid var(--border-subtle); font-size: 17px; }
.update-notes-content :deep(h3) { font-size: 15px; }
.update-notes-content :deep(ul),
.update-notes-content :deep(ol) { margin: 8px 0 14px; padding-left: 22px; }
.update-notes-content :deep(li) { margin: 4px 0; }
.update-notes-content :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.update-notes-content :deep(code) { padding: 2px 5px; border-radius: var(--radius-sm); background: var(--bg-elevated); color: var(--text-primary); font-family: var(--font-mono); font-size: .88em; }
.update-notes-content :deep(pre) { max-width: 100%; overflow-x: auto; padding: 12px 14px; border-left: 2px solid var(--accent); border-radius: var(--radius-sm); background: var(--bg-void); color: var(--text-primary); font-family: var(--font-mono); font-size: 12px; line-height: 1.5; }
.update-notes-content :deep(pre code) { padding: 0; background: transparent; }
.update-notes-content :deep(blockquote) { margin: 12px 0; padding-left: 14px; border-left: 2px solid var(--accent); color: var(--text-secondary); }

.update-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
  padding: 16px 28px 22px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}

.update-btn {
  min-height: 36px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), opacity var(--transition-fast);
}
.update-btn-secondary { border-color: var(--border-default); background: var(--bg-hover); color: var(--text-secondary); }
.update-btn-secondary:hover { border-color: var(--border-active); color: var(--text-primary); }
.update-btn-primary { background: var(--accent); color: var(--bg-void); }
.update-btn-primary:hover { background: var(--accent-hover); }
.update-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.update-status-area { display: flex; justify-content: center; }
.update-status-text { margin: 0; color: var(--text-primary); font-size: 14px; font-weight: 600; }
.update-progress-text { margin-top: 8px; color: var(--text-muted); font-family: var(--font-mono); font-size: 12px; text-align: center; }
.update-hint-text { margin-top: 8px; color: var(--text-muted); font-size: 12px; }
.update-error-text { color: var(--rose); }
.update-error-detail { margin-top: 8px; color: var(--text-muted); font-family: var(--font-mono); font-size: 12px; overflow-wrap: anywhere; }

@media (max-width: 560px) {
  .update-dialog { width: calc(100vw - 20px); max-height: calc(100vh - 20px); }
  .update-header { padding: 17px 18px 14px; }
  .update-title { font-size: 18px; }
  .update-scroll-area { padding: 22px 18px 18px; }
  .update-actions { flex-wrap: wrap; padding: 14px 18px 18px; }
  .update-btn { flex: 1 1 140px; }
}
```

不得在上述主题规则中新增固定白色、黑色、灰色或主题专属 hex 颜色；阴影使用 `--bg-deep-rgb`，文字、边框、表面和按钮使用现有语义变量。

- [ ] **步骤 2：更新标题文案而不增加新的运行时数据**

在 `apps/web/src/i18n/messages.ts` 中只改现有条目：

```ts
"update.title": "更新公告",
```

英文消息表对应改为：

```ts
"update.title": "Update announcement",
```

其余文案继续复用现有 `update.*` 条目，避免扩大翻译范围。

- [ ] **步骤 3：运行组件测试和类型检查**

运行：

```bash
pnpm --filter @pi-web-ui/web test -- UpdateDialog.test.ts
pnpm --filter @pi-web-ui/web typecheck
```

预期：新增组件测试全部通过，Vue 模板与 scoped CSS 不产生类型错误。

- [ ] **步骤 4：提交主题与响应式样式变更**

```bash
git add apps/web/src/components/UpdateDialog.vue apps/web/src/i18n/messages.ts
git commit -m "style(web): 优化更新公告主题适配"
```

## 任务 4：完成全量验证和主题人工检查

**文件：**

- 检查：`apps/web/src/components/UpdateDialog.vue`
- 检查：`apps/web/src/components/UpdateDialog.test.ts`
- 检查：`apps/web/src/stores/update.test.ts`

- [ ] **步骤 1：运行 Web 全量测试**

运行：

```bash
pnpm --filter @pi-web-ui/web test
```

预期：新增组件测试与已有 Web 测试全部通过，输出中没有失败测试。

- [ ] **步骤 2：运行 Web 构建**

运行：

```bash
pnpm --filter @pi-web-ui/web build
```

预期：`vue-tsc --noEmit` 和 Vite 生产构建均以退出码 0 完成。

- [ ] **步骤 3：启动开发环境检查三种主题和窄窗口**

运行：

```bash
pnpm --filter @pi-web-ui/web dev -- --host 127.0.0.1
```

按以下清单检查同一条更新内容：

1. `light`：弹窗使用浅色表面，正文、版本徽章和主按钮有清晰对比度。
2. `dark`：弹窗使用深色表面，绿色强调按钮和 Markdown 标题可读。
3. `gray`：弹窗与灰色主题层级一致，没有白色面板或黑色文字硬编码。
4. 视口宽度约 360px：正文可滚动、按钮换行或平分宽度、没有水平溢出。
5. 长 Markdown：正文区域滚动时底部操作区保持可见。
6. 下载中、就绪、安装中、错误状态：弹窗宽度与边界保持一致，状态文案不被裁剪。

- [ ] **步骤 4：完成最终需求核对**

确认以下事实后再报告完成：

- 只修改了更新公告的呈现层、局部文案和组件测试。
- `useUpdateStore` 的更新检测、下载、安装、重启方法没有改签名或调用顺序。
- 所有主题色均来自已有变量，没有引入新的全局主题规则。
- Markdown 正文经过 `renderMarkdown()`，没有新增不安全的 HTML 解析路径。
- 全量 Web 测试、类型检查和构建均有本轮命令输出作为证据。

- [ ] **步骤 5：提交最终变更（如工作区仍有未提交文件）**

```bash
git status --short
git diff --check
```

只有确认 diff 只包含本功能后，才按仓库规范创建最后一个提交；若前面任务已经分别提交且没有额外变更，则不重复提交。
