# 已安装技能卡片布局重设计

**日期**: 2026-07-14
**范围**: `apps/web/src/components/SkillStoreView.vue`（仅前端，单文件）

> **Update 2026-07-14（重定向）**：实现到 Task 1（NGrid 三列）后用户改口："调整为和市场搜索的那种卡片格式一模一样的，每行 4 列"。最终实现放弃 NGrid 方案，直接复用市场页 `.ss-card-list` + `.ss-card`（纯 CSS grid `repeat(auto-fill, minmax(280px, 1fr))`，桌面约 4 列、容器变窄自动降列），内容按 `SkillDto` 字段映射（name→`.ss-card-name`、path→`.ss-card-author` 行、description→`.ss-card-desc`、卸载按钮→`.ss-card-foot` 右对齐，前置空 `.ss-card-pop` 占位以匹配市场页按钮位置）。下方"设计"章节描述的 NGrid 方案仅作历史记录；以本注为准。

## 背景

技能商店「已安装」标签页（`<NTabPane name="installed">`）当前用垂直列表展示已安装技能：`.ss-installed-list` 为 `flex-direction: column`，每个 `.ss-installed-row` 是横向条目（左侧名称/描述/路径 + 右侧卸载按钮）。

市场页（`.ss-card-list`）已经用 `grid` + `auto-fill/minmax(280px, 1fr)` 展示卡片，视觉上是边框、圆角、hover 高亮的卡片。两个标签页的视觉语言不统一。

用户希望已安装技能改为「一行三列的动态布局」：按容器宽度自适应（容器宽时 3 列，变窄自动降列），并复用市场页卡片样式。

## 目标

- 已安装技能以卡片网格展示，宽容器下一行 3 列，容器变窄自动降为 2 列、1 列。
- 卡片视觉与市场页 `.ss-card` 一致（边框、圆角、hover、背景、字体）。
- 不引入新的断点约定（无 `@media`、无 `useBreakpoint`）；使用 Naive UI `NGrid` 的 `responsive="self"` 实现容器级响应。
- 不改动数据流、卸载逻辑、i18n key、市场页。

## 非目标

- 不调整市场页卡片。
- 不新增状态徽标（已安装卡片不显示「installed」徽标，因为整个列表本身就是已安装视图）。
- 不调整 store、API、`CreateSkillDialog`、`ImportSkillDialog`、`ConfirmDialog` 等周边逻辑。

## 设计

### 布局组件

将 `.ss-installed-list`（`<ul>` flex-column）替换为 Naive UI `NGrid`：

```vue
<NGrid responsive="self" cols="1 s:2 m:3" :x-gap="10" :y-gap="10">
  <NGridItem v-for="s in installed.skills" :key="s.name">
    <article class="ss-installed-card">
      <div class="ss-installed-card-head">
        <span class="ss-installed-card-name">{{ s.name }}</span>
      </div>
      <p class="ss-installed-card-desc">{{ s.description || '—' }}</p>
      <p class="ss-installed-card-path">
        {{ t('skillStore.pathLabel') }}: <code>{{ s.path }}</code>
      </p>
      <div class="ss-installed-card-foot">
        <NButton size="tiny" type="error" ghost block
          @click="requestUninstall(s.name)">
          {{ t('skillStore.uninstall') }}
        </NButton>
      </div>
    </article>
  </NGridItem>
</NGrid>
```

- `responsive="self"`：基于 `NGrid` 自身容器宽度触发断点（容器查询语义），而非视口。满足「按容器宽度自适应」。
- `cols="1 s:2 m:3"`：默认 1 列；`s` 断点 2 列；`m` 及以上 3 列。不设 `l:4` / `xl:4`，确保宽容器始终一行三列。
- `:x-gap="10" :y-gap="10"`：与市场页 `.ss-card-list` 的 `gap: 10px` 一致。
- 每个 `<NGridItem>` 内是一个 `<article class="ss-installed-card">`，flex 列布局，`height: 100%` 使同行的 NGridItem 等高。

### 卡片视觉

新增 `.ss-installed-card*` 系列样式，复用市场页 `.ss-card` 的设计变量（`--border-default`、`--radius-md`、`--bg-surface`、`--bg-elevated`、`--accent`、`--transition-fast`、`--font-mono`、`--text-primary/secondary/faint`）：

```css
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

要点：
- `margin-top: auto` 在 foot 上让卸载按钮贴底，使不同内容高度的卡片底部对齐。
- 卸载按钮 `block` 让按钮在 foot 内占满宽度，视觉更稳。
- `.ss-installed-card-desc` 用 `-webkit-line-clamp: 3` 截断，与市场页一致。

### 脚本变更

`SkillStoreView.vue` 的 `<script setup>` 中补充从 naive-ui 导入 `NGrid`、`NGridItem`（若现有 import 未含）。`installed`、`requestUninstall`、`t` 等已有，无需新增。

### 删除的旧 CSS

替换后不再使用的类，全部删除：
- `.ss-installed-list`
- `.ss-installed-row`、`.ss-installed-row:hover`
- `.ss-installed-info`
- `.ss-installed-head`
- `.ss-installed-name`
- `.ss-installed-desc`
- `.ss-installed-path`（及其 `code` 子规则）

保留：`.ss-installed-body`、`.ss-installed-actions`、`.ss-state`。

## 验证

- 容器宽（典型桌面）：3 列。
- 拖窄窗口至中等：降为 2 列。
- 继续拖窄：降为 1 列。
- 卡片 hover 出现 accent 边框 + elevated 背景。
- 描述超长时 3 行截断，省略号。
- 卸载按钮始终贴底、占满 foot 宽度；点击触发 `requestUninstall(s.name)`，弹窗与原行为一致。
- 不同描述长度的卡片在同一行底部对齐（`height: 100%` + `margin-top: auto`）。

## 风险

- `responsive="self"` 依赖 Naive UI 的 ResizeObserver；若该组件在容器初始宽度为 0 的场景下渲染（例如 tab 切换前），首屏可能错列。本视图在 `NTabPane` 内，切到「已安装」tab 时容器已有宽度，可接受。
- `NGrid` 的 `cols` 响应式字符串在不同 Naive UI 版本上语法略有差异；当前锁定 `naive-ui@2.39.0`，已验证 `responsive: "screen" | "self"` 与 `cols: string | number` 类型存在。
