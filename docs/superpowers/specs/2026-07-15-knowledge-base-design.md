# 知识库功能设计文档

> 版本：V1.0
> 日期：2026-07-15
> 关联 PRD：`docs/prd/知识库功能_PRD_V1.1_知识库全局共享.md`
> 范围：覆盖 PRD V1 全部必做项；技术实现与 PRD「不限定技术实现」一节对齐。

---

## 1. 概述

pi-web-ui 服务端自建全栈知识库（KB），不安装 `pi-knowledge-extension`。数据存自己的 SQLite；服务端在 WebSocket `send` 链路上拦截，对会话绑定的 KB 跑关键词检索，命中块拼到 prompt 前发给 Pi。UI 层沿用现有 `skill-tips` 注入管线的形态——composer 里挂一个 KB 按钮，选中后服务端检索 + 哨兵包裹注入 prompt，UI 剥离 + 展示徽章/卡片/行内引用 chip。

### 1.1 与 PRD 的偏离点（必须显式知晓）

| PRD 原条目 | 本设计做法 | 理由 |
|---|---|---|
| 23.1「模型自己判断是否相关、需要时调用知识库搜索」 | 改为「会话绑了 KB 就每次发消息自动检索注入」 | 不装扩展、架构简单、复用 skill-tips 管线。代价：context 占用 + 偶尔无关检索。 |
| 「基于 pi-knowledge-extension 实现」 | 不安装该扩展 | 扩展注册的是 agent 可调用工具，与「服务端注入」架构不匹配。保留 skill 模式的注入管线（语义上等价于扩展的 `pantry_store` + `recipebook_cite`）。后续若要 agentic 检索，可升级为 extension。 |

### 1.2 四个子系统

1. **KB 元数据 + 文件 + 块 CRUD**（DB + 路由 + 前端 store），镜像现有 projects/skills 的 DB-backed CRUD 模式。
2. **解析管线**：上传 → 落盘 → 异步解析（TXT 原生 / marked 提 MD 结构 / mammoth 提 DOCX / unpdf 提 PDF + 页码）→ 切块 → 入 `kb_chunks` + FTS5 索引。
3. **检索**：FTS5 全文检索 + BM25 排序，UI 搜索测试 tab 与对话期注入共用同一 search service。
4. **对话集成**：composer KB 按钮 + `session_kb_bindings` 表 + WS send 拦截注入 + 新 `kb_search` 事件流 + 行内 `[chunk_id]` chip 渲染。

---

## 2. 数据模型

新增迁移 `005_knowledge_base`。沿用项目惯例（snake_case、TEXT PK 用 ULID、INTEGER 时间戳 ms、`ON DELETE CASCADE`、`idx_<table>_<cols>` 索引）。

### 2.1 `knowledge_bases`

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | ULID |
| name | TEXT UNIQUE NOT NULL | 1-100 字符，全局唯一（PRD 8.2） |
| description | TEXT | ≤500 字符，可空 |
| enabled | INTEGER NOT NULL DEFAULT 1 | 启用/禁用 |
| created_at, updated_at | INTEGER | ms |

统计字段（文件数 / 可检索文件数 / 失败文件数 / 块数）不落库，列表查询用子查询实时计算——V1 KB 数量级小，避免脏数据。

### 2.2 `kb_files`

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | ULID |
| kb_id | TEXT FK → knowledge_bases ON DELETE CASCADE | |
| name | TEXT NOT NULL | 文件名 |
| ext | TEXT NOT NULL | `txt` / `md` / `pdf` / `docx` |
| source | TEXT NOT NULL | `created` / `imported` |
| size | INTEGER NOT NULL | bytes |
| storage_path | TEXT NOT NULL | 相对 `data/kb-files/` 的路径 |
| status | TEXT NOT NULL DEFAULT 'pending' | `pending`/`parsing`/`ready`/`failed` |
| enabled | INTEGER NOT NULL DEFAULT 1 | 独立于 status 的用户开关 |
| parse_generation | INTEGER NOT NULL DEFAULT 0 | 当前可用块所属代；0 = 还无可用块 |
| fail_reason | TEXT | 状态码 + 简述 |
| char_count, page_count, chunk_count | INTEGER | 解析成功后填 |
| last_parsed_at | INTEGER | |
| created_at, updated_at | INTEGER | |

约束：`UNIQUE(kb_id, name)`（PRD 12.2 同 KB 内文件名唯一）。

`fail_reason` 码：`unsupported_type` / `too_large` / `read_failed` / `corrupted` / `pdf_encrypted` / `pdf_no_text` / `pdf_scanned` / `docx_invalid` / `timeout` / `unknown`。前端 i18n 映射成 PRD 15.3 中文提示。

### 2.3 `kb_chunks`

| 列 | 类型 | 说明 |
|---|---|---|
| rowid | INTEGER PK AUTOINCREMENT | 兼作公开 chunk_id（`[chunk_id]` 引用用） |
| kb_id, file_id | TEXT FK ON DELETE CASCADE | |
| generation | INTEGER NOT NULL | 所属解析代，对应 kb_files.parse_generation |
| seq | INTEGER NOT NULL | 文件内块序号 |
| title_path | TEXT | "第一章 > 1.1 用户权限" |
| page_start, page_end | INTEGER | PDF 专用 |
| content | TEXT NOT NULL | 块正文 |
| char_count | INTEGER | |
| created_at | INTEGER | |
| `UNIQUE(file_id, generation, seq)` | | 防重复 |

### 2.4 `kb_chunks_fts`（FTS5 外部内容虚表）

```sql
CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(
  content,
  content='kb_chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
```

**CJK 取舍**：`unicode61` 对中文按单字分词（"用户权限" → 用/户/权/限 4 token）。短语检索因为字符连续仍能命中；缺点是单字 query 会过匹配。V1 接受这个权衡，后续可换 jieba tokenizer。

块插入/删除要同步 FTS5 表（外部内容表不自动同步）——在 `KbChunkRepository` 里加 `insert` / `deleteByFile` / `deleteByGeneration` 钩子，手动 `INSERT INTO kb_chunks_fts(rowid, content) VALUES(?,?)` / `DELETE FROM kb_chunks_fts WHERE rowid=?`。

### 2.5 `session_kb_bindings`

| 列 | 类型 | 说明 |
|---|---|---|
| session_id | TEXT FK → sessions ON DELETE CASCADE | |
| kb_id | TEXT FK → knowledge_bases ON DELETE CASCADE | |
| enabled | INTEGER NOT NULL DEFAULT 1 | PRD 5.4 |
| file_filter | TEXT | JSON 数组 of file_id；null 或空 = 该 KB 全部可检索文件 |
| bound_at | INTEGER | |
| `PRIMARY KEY (session_id, kb_id)` | | 单会话单 KB 一行 |

≤10 KB / 会话在应用层校验，不在 DB 约束。

### 2.6 可检索性判定

检索 SQL 的 WHERE 条件综合判定一个块是否可被搜到：

```sql
WHERE kb.enabled = 1
  AND f.enabled = 1
  AND c.generation = f.parse_generation
  AND f.parse_generation > 0
```

- `parse_generation > 0` 排除从未成功解析过的文件（pending / 首次解析失败）。
- `c.generation = f.parse_generation` 自动只取当前生效代，re-parse 期间旧块可继续被检索。
- `enabled=0`（KB 或文件被禁用）一律排除。

---

## 3. 解析管线

### 3.1 落盘

上传 / 新建文件 → 写到 `data/kb-files/<kb_id>/<file_id>-<name>`（`file_id` 前缀防 rename 撞名）→ DB 插 `kb_files` 行（status=`pending`、parse_generation=0）→ 入队异步解析。

### 3.2 限制（PRD 13.2）

- 单文件 ≤ 50MB
- 单次导入 ≤ 20 个
- 扩展名 ∈ {txt, md, pdf, docx}
- 同 KB 文件名唯一
- 不自动覆盖同名（前端给取消/重命名/替换选项）
- 部分文件失败不影响其他文件

### 3.3 异步执行

每个文件一个独立 async 任务，`setImmediate` 起跑，互不阻塞、独立 try/catch（PRD 28.1/28.2）。HTTP 上传/新建请求立即返回 201，UI 轮询或通过 `kb_file_status` 事件拿状态。

### 3.4 四类解析器

| 扩展 | 库 | 输出 |
|---|---|---|
| txt | 原生 fs.readFile(utf8) | 纯文本，无结构 |
| md | `marked.lexer` 走 token 流 | 提取 heading 栈 + paragraph/code 块文本 |
| docx | `mammoth.convertToHtml` | 解析 HTML 拿 h1-h6 + p + table（table → 行文本） |
| pdf | `unpdf` (`extractText` 迭代器) | 逐页文本 + 页码 |

### 3.5 切块策略

目标 800–1200 字符 / 块，优先沿段落边界切（不硬切句子）。每个块带 `title_path`（当前 heading 栈 join）、`seq`（文件内递增）、PDF 块带 `page_start/page_end`（跨页时 N..N+1）。空块丢弃；同文件完全重复块去重（PRD 15.2）。

### 3.6 代际化重解析（核心机制，满足 PRD 17/18）

- 每次解析分配新 `generation` 整数（文件内递增）。
- **首次解析**：status `pending → parsing → ready`（成功）/ `failed`（失败）。成功时 `parse_generation = generation`，块入库；失败时 `parse_generation` 保持 0，无块。
- **重解析**（手动 / 编辑保存 / 文件替换）：status `ready → parsing`，**但 `parse_generation` 暂不更新**——新块以新 generation 入库，旧块以旧 generation 继续可被检索（PRD 18「旧可用内容继续可搜」）。
- **成功**：事务里 `DELETE FROM kb_chunks WHERE file_id=? AND generation<>?` + 更新 `parse_generation=新generation` + 同步 FTS5（删旧 rowid、插新 rowid）+ `status=ready` + 填 char_count/page_count/chunk_count + `last_parsed_at`。
- **失败**：删新 generation 的半成品块（含 FTS5 索引）、`status=failed` + `fail_reason`、`parse_generation` 不动，旧块继续可检索（PRD 18「失败不能清空旧可用内容」）。
- **解析中禁止重复触发**：status=`parsing` 期间拒绝新的 parse 请求（PRD 14）。

### 3.7 在线编辑（PRD 17，仅 txt/md）

- 编辑器打开 → 改名 / 改正文 → 保存 → 落盘覆盖原件 → 触发重解析（走 §3.6 代际化流程）。
- 解析期间 UI 显示「内容更新中」banner，旧块继续可检索。
- 新解析成功：旧块被替换；失败：保留新正文 + 旧块继续可检索 + 显示失败原因。
- pdf/docx 不显示编辑入口。

### 3.8 超时

单文件解析硬上限 60s（PRD 15.3 `timeout` 码），用 `AbortSignal.timeout(60000)` 包住 unpdf/mammoth 调用。

### 3.9 fail_reason 启发式

`unpdf` 抛的特定错误（加密、无文本）通过错误信息匹配映射到 `pdf_encrypted` / `pdf_no_text`；扫描件 PDF 目前 `unpdf` 能提取出空或极少文本，按字符数 / 页数 < 阈值 → `pdf_scanned`。

---

## 4. 检索服务

### 4.1 共享 search service

UI 搜索测试 tab 与对话期注入都调它。

```ts
class KbSearchService {
  search(input: {
    query: string;
    kbIds: string[];        // 必填，跨多个 KB 联合检索
    fileIds?: string[];     // 可选，文件级子筛选（并集，跨所有 kbIds）
    limit?: number;         // 默认 8，可选 5/8/10/20
  }): Promise<{
    hits: SearchHit[];
    durationMs: number;
  }>;
}

interface SearchHit {
  chunkId: number;          // kb_chunks.rowid
  kbId: string; kbName: string;
  fileId: string; fileName: string;
  seq: number;
  titlePath: string | null;
  pageStart: number | null; pageEnd: number | null;
  content: string;          // 块全文
  snippet: string;          // FTS5 snippet() 带高亮摘要
  score: number;            // bm25 分数（越低越相关）
}
```

### 4.2 FTS5 query 构造

用户输入按空白切 token，每个 token 转义内部 `"` 为 `""` 后用 `"..."` 包成短语，隐式 AND 拼接。

- 中文：`unicode61` 把 "用户权限" 切成 4 个单字 token，短语匹配要求 4 字连续出现，仍能命中。
- 英文：不区分大小写（`unicode61` 默认 lowercase）。
- 空关键词直接返回空集（PRD 20.2）。

示例：输入 `用户权限 系统` → FTS5 query `"用户权限" "系统"`。

### 4.3 主查询 SQL

```sql
SELECT
  c.rowid AS chunkId, c.kb_id, c.file_id, c.seq, c.title_path,
  c.page_start, c.page_end, c.content,
  bm25(kb_chunks_fts) AS score,
  snippet(kb_chunks_fts, 0, '<mark>', '</mark>', '…', 24) AS snippet,
  kb.name AS kbName, f.name AS fileName
FROM kb_chunks_fts
JOIN kb_chunks c ON c.rowid = kb_chunks_fts.rowid
JOIN kb_files f ON f.id = c.file_id
JOIN knowledge_bases kb ON kb.id = c.kb_id
WHERE kb_chunks_fts MATCH :query
  AND c.kb_id IN (:kbIds)
  AND c.generation = f.parse_generation
  AND f.parse_generation > 0
  AND f.enabled = 1
  AND kb.enabled = 1
  AND (:fileIds IS NULL OR c.file_id IN (:fileIds))
ORDER BY bm25(kb_chunks_fts), f.updated_at DESC
LIMIT :limit;
```

`ORDER BY ... f.updated_at DESC` 实现 PRD 20.2「相关度相同时较新文件优先」。

### 4.4 去重（PRD 21）

V1 只做「完全相同 content 不重复展示」——同内容多块只留一条，附 `alsoInFiles` 计数。连续高度相似块合并留作 V2，spec 显式标注为 V1 简化。

### 4.5 两个消费方差异

| | UI 搜索测试 | 对话期注入 |
|---|---|---|
| query | 用户在搜索框输入 | 用户消息正文 |
| kbIds | 当前 KB 或选中的多个 KB | 当前会话 `session_kb_bindings` 里的 KB |
| fileIds | UI 文件筛选 | 绑定的 `file_filter` 展开 |
| limit | 用户选 5/8/10/20 | 默认 5（控 token 预算） |
| 返回 | 完整 hits + 高亮 + 跳转 | top-N chunkId + content + 元数据 |

### 4.6 注入 prompt 的拼装（对话期）

```
<!-- kb-context:start -->
The following knowledge base passages have been retrieved for the user's question.
Use them to ground your answer. When you reference a passage, mark it as [N].
If the passages are insufficient, say so — do not fabricate content not present here.

[1] (KB: 产品资料 / File: 需求文档.md / 标题: 用户权限 / 页码: 12-12)
<chunk content>

[2] (KB: ... / File: ... / ...)
<chunk content>
<!-- kb-context:end -->
```

- 块 ID 用 1..N 的本地序号，简化 agent 标注；服务端维护 `localId → (chunkId, metadata)` 映射，回传给前端用于 chip 渲染。
- 哨兵 `<!-- kb-context:start/end -->` 用于 UI 剥离、消息持久化可选剥离、调试可见。
- 拼接逻辑封装在 `apps/server/src/kb/inject-context.ts`，与现有 `skill-tips` 的 `wrapTipBody` 同形态。

---

## 5. 对话集成

### 5.1 Composer KB 按钮 + 选择器

- ChatPanel composer 里、Skills 下拉右侧加一个「📚 知识库」按钮。形态与 Skills 完全同构（沿用 `skill-tips` 的 dropdown + banner 模式）。
- 点击 → 弹 KB picker（NPopover）：
  - 列出全部 `enabled=1` 的 KB（名称、描述、文件数、状态、勾选框）。
  - 每个 KB 行可展开，列出该 KB 的 `enabled=1 AND status='ready'` 文件（多选）。`file_filter` 空数组 = 该 KB 全部可检索文件；非空 = 仅选中的。
  - 单会话最多 10 个 KB（PRD 22），超了阻止再选并提示。
  - 已绑定但被禁用/删除的 KB，picker 里以灰色「已失效」展示，可取消勾选但不能重选。
- Composer 上方 banner：「已选 N 个知识库 / M 个文件」，点开重新打开 picker。未选时不展示 banner。

### 5.2 绑定持久化

- REST：`GET /api/sessions/:id/kb-bindings`（取该会话绑定列表）、`PUT /api/sessions/:id/kb-bindings`（整体替换，body 是 `[{kbId, fileFilter}]` 数组，全量覆盖）。
- 服务端把 `fileFilter` 存为 JSON 串进 `session_kb_bindings.file_filter`。
- KB 删除时 DB FK CASCADE 自动清掉绑定（PRD 4.8）。
- 切换会话时前端 fetch 对应绑定，恢复 picker 状态（PRD 22「切换会话时恢复」）。
- 绑定纯 session 级，无 workspace 字段，PRD 22「切换工作空间不影响」自然满足。

### 5.3 Send 链路拦截

当前流：`agent.send → WS send → server handleSend → Pi RPC prompt`。

新增：`handleSend` 在调 Pi 前插入 KB 检索子流程——

```
1. 取该 session 的 session_kb_bindings
2. 若空 → 直接走原流程，不注入
3. 若非空 →
   a. 先发 kb_search 事件 {phase: 'searching', query: 用户消息, kbIds, fileIds}
   b. 跑 KbSearchService.search({query, kbIds, fileIds, limit: 5})
   c. 成功有命中 → 发 kb_search {phase:'done', hits, chunkMap, durationMs}
                   → 拼 kb-context 块（§4.6）到 content 前 → 调 Pi RPC prompt
   d. 成功无命中 → 发 kb_search {phase:'empty'} → 走原流程（不注入）
   e. 失败 → 发 kb_search {phase:'failed', error} → 走原流程（不注入，UI 提示重试）
```

- `chunkMap: Record<localId, {chunkId, kbName, fileName, titlePath, pageStart, pageEnd}>` 同步回传，前端用于 chip 渲染 + 跳转。
- 整个检索子流程包在 try/catch 里——任何异常都不阻塞主对话流，降级为「不注入」+ UI 显示失败卡片。
- 检索耗时短（FTS5 本地查询，<50ms），不阻塞体感；UI 看到 `searching → done` 卡片切换。

### 5.4 kb_search 事件 + 调用卡片

新 ServerEvent：

```ts
| {
    type: "kb_search";
    sessionId: string;
    messageId: string;        // 关联的用户消息 ID
    phase: "searching" | "done" | "empty" | "failed";
    query: string;
    kbIds: string[];
    fileIds?: string[];
    hits?: SearchHit[];       // phase=done 时
    chunkMap?: Record<number, ChunkMeta>;  // phase=done 时
    durationMs?: number;
    error?: string;           // phase=failed 时
  }
```

ChatPanel 渲染调用卡片（PRD 24）挂在**用户消息气泡下方**：

| phase | 展示 |
|---|---|
| `searching` | spinner + 「正在检索知识库」+ query + scope（KB 名 / 文件数） |
| `done` | ✓ + 「命中 N 块 / M 文件 · 耗时 Xms」+ 可展开文件列表（文件名 + 块数） |
| `empty` | 「未找到与「query」相关的知识内容」+ 建议换词 |
| `failed` | ⚠ + 简短错误 + 「重试」按钮（仅重跑检索，不重发消息） |

### 5.5 行内引用 chip

- agent 流式回复里出现 `[N]`（N 是 localId），正则 `\[([1-9][0-9]*)\]` 匹配。
- 命中 chunkMap → 渲染为 inline chip：`📖 需求文档.md · 用户权限章节 · 第 12 页`，class `kb-citation-chip`。
- 点击 chip → 跳转 KB 详情页 / 文件 tab → 定位到对应块（高亮 + 滚动）。
- `[N]` 不在 chunkMap 范围内（agent 编造的）→ 保留原 `[N]` 文本，不渲染 chip（防误导）。
- 流式渲染策略：流式期 plain text 原样展示，`message_end` 后一次性扫全文做 `[N]` 替换 + 重排。避免流式中途部分数字被误匹配成 chip（agent 还没写完 `[12]` 时可能短暂出现 `[1` 等形态）。

### 5.6 元数据持久化（重载还原）

用户消息的 `metadata` 字段存：

```json
{
  "kbSearch": {
    "phase": "done",
    "query": "...",
    "kbIds": [...],
    "fileIds": [...],
    "hits": [{localId, chunkId, kbName, fileName, titlePath, pageStart, pageEnd}, ...],
    "durationMs": 23,
    "timestamp": 1721030400000
  }
}
```

会话重载（F5 / 切回会话）时，ChatPanel 从 message.metadata 重建调用卡片 + chunkMap，chip 重新渲染。

KB 或文件在重载前已被删除：chip 点击跳转时 404，UI 显示「该来源已不可用」。

### 5.7 边界情况

- **会话绑了 KB 但 KB 全被禁用**：picker 里灰显「已失效」；检索走原流程不注入；UI 展示「绑定已失效」提示。
- **解析中文件**：`parse_generation` 未更新，旧块仍可检索；调用卡片里文件列表展示「更新中」标签。
- **重解析失败但旧块可用**：检索继续返回旧块；UI 不感知失败（解析失败状态在 KB 详情页展示，不在对话卡片里）。
- **绑定超过 10 个 KB**：picker 阻止第 11 个勾选 + toast。
- **并发同一会话发消息**：后端按 WS 消息顺序处理，每条消息独立 kb_search 事件流，messageId 区分；不互相干扰。

---

## 6. UI 结构与代码组织

### 6.1 导航

NavRail 的 `activeNav` 联合类型加 `"knowledge-base"`，新增第 4 个按钮（图标用书堆 SVG，i18n key `nav.knowledgeBase`）。App.vue 里 `<KnowledgeBaseView v-else-if="activeNav === 'knowledge-base'" />`。

### 6.2 页面与组件

`KnowledgeBaseView.vue` 作为顶层视图，内部用 `selectedKbId` ref 在列表页 / 详情页间切换（沿用 SkillStoreView 的本地路由形态，不引 vue-router）。

新增 SFC（路径 `apps/web/src/components/`）：

| 组件 | 职责 |
|---|---|
| `KnowledgeBaseView.vue` | 顶层容器，list/detail 切换 |
| `KbListPage.vue` | KB 列表 + 名称搜索 + 状态筛选 + 新建/编辑/启停/删除 |
| `KbDetailPage.vue` | KB 详情头部（统计）+ 3 tab 容器 + 返回 |
| `KbFileTab.vue` | 文件列表 + 新建/导入入口 + 多维筛选 + 行操作 |
| `KbFileDetailDrawer.vue` | 文件元信息 + 预览 + 块列表（块序号/标题路径/页码/摘要/展开/上下块） |
| `KbFileEditorDrawer.vue` | txt/md 在线编辑器（改名 + 改正文 + 保存触发重解析） |
| `KbSearchTab.vue` | 搜索测试：关键词/返回数/类型/范围 + 结果列表（高亮 + 跳转） |
| `KbSettingsTab.vue` | KB 名称/描述/启停/删除 |
| `CreateKbDialog.vue` | 新建 + 编辑 KB（复用 ConfirmDialog 形态） |
| `ImportFilesDialog.vue` | 多文件选择 + 待导入列表 + 重名处理（取消/重命名/替换） |
| `ChatKbPicker.vue` | composer 里的 KB 选择 popover（KB 多选 + 文件子筛） |
| `ChatKbCallCard.vue` | 对话里检索中/完成/无结果/失败 四态卡片 |
| `ChatKbBanner.vue` | composer 上方「已选 N 个 KB / M 文件」banner（同 skill-tips banner） |

`ConfirmDialog.vue` 已存在，复用。

### 6.3 Pinia stores

| Store | 状态 |
|---|---|
| `kbStore.ts` | `knowledgeBases: KbDto[]`、`loading`、`current`（详情页选中），CRUD actions |
| `kbFileStore.ts` | `files: KbFileDto[]`（按 kbId 分组缓存）、CRUD + reparse actions |
| `kbBindingStore.ts` | `bindings: Record<sessionId, KbBinding[]>`、`load(sessionId)`、`save(sessionId, bindings)` |

### 6.4 服务端代码组织

```
apps/server/src/
├── db/
│   ├── migrations.ts                       # 新增 005_knowledge_base
│   └── repositories/
│       ├── knowledge-base.ts
│       ├── kb-file.ts
│       ├── kb-chunk.ts                     # 含 FTS5 同步钩子
│       └── session-kb-binding.ts
├── routes/
│   ├── knowledge-bases.ts                  # /api/knowledge-bases CRUD
│   ├── kb-files.ts                         # /api/knowledge-bases/:kbId/files CRUD + 上传 + reparse
│   ├── kb-search.ts                        # /api/knowledge-bases/search（UI 搜索测试用）
│   └── session-kb-bindings.ts              # /api/sessions/:id/kb-bindings GET/PUT
├── kb/
│   ├── search-service.ts                   # KbSearchService（§4）
│   ├── inject-context.ts                   # 拼 prompt 上下文 + 哨兵包裹
│   ├── parse-pipeline.ts                   # 异步解析编排（代际化、状态机）
│   ├── chunker.ts                          # 800-1200 字符切块 + 标题路径
│   └── parsers/
│       ├── txt.ts
│       ├── md.ts                           # marked.lexer 走 token
│       ├── pdf.ts                          # unpdf.extractText 逐页
│       └── docx.ts                         # mammoth.convertToHtml + 解析
└── ws/
    └── agent.ts                             # handleSend 里插 KB 拦截 + kb_search 事件
```

新增 fastify decorators（`apps/server/src/types/fastify.d.ts` + `wiring.ts`）：`app.knowledgeBases` / `app.kbFiles` / `app.kbChunks` / `app.kbBindings` / `app.kbSearch`。

### 6.5 共享类型（`packages/shared/src/types.ts`）

```ts
export interface KbDto {
  id: string; name: string; description: string | null; enabled: boolean;
  createdAt: number; updatedAt: number;
  fileCount: number; searchableFileCount: number; failedFileCount: number; chunkCount: number;
}
export interface KbFileDto {
  id: string; kbId: string; name: string; ext: string; source: string;
  size: number; status: string; enabled: boolean; parseGeneration: number;
  failReason: string | null; charCount: number | null; pageCount: number | null;
  chunkCount: number | null; lastParsedAt: number | null;
  createdAt: number; updatedAt: number;
}
export interface KbChunkDto {
  id: number; kbId: string; fileId: string; seq: number;
  titlePath: string | null; pageStart: number | null; pageEnd: number | null;
  content: string; charCount: number; createdAt: number;
}
export interface KbBindingDto {
  kbId: string; enabled: boolean; fileFilter: string[] | null; boundAt: number;
}
export interface KbSearchHitDto {
  chunkId: number; kbId: string; kbName: string; fileId: string; fileName: string;
  seq: number; titlePath: string | null; pageStart: number | null; pageEnd: number | null;
  content: string; snippet: string; score: number;
}
// ServerEvent 追加：
| {
    type: "kb_search"; sessionId: string; messageId: string;
    phase: "searching" | "done" | "empty" | "failed";
    query: string; kbIds: string[]; fileIds?: string[];
    hits?: KbSearchHitDto[]; chunkMap?: Record<number, ChunkMeta>;
    durationMs?: number; error?: string;
  }
```

### 6.6 i18n keys（新增一节，约 40 条，中英双语）

`nav.knowledgeBase`、`kb.title`、`kb.subtitle`、`kb.create`、`kb.name`、`kb.namePlaceholder`、`kb.description`、`kb.delete`、`kb.deleteConfirm`、`kb.empty`、`kb.fileCount`、`kb.searchableFileCount`、`kb.chunkCount`、`kb.failedFileCount`、`kb.enabled`、`kb.disabled`、`kb.tabFiles`、`kb.tabSearch`、`kb.tabSettings`、`kb.file.new`、`kb.file.import`、`kb.file.edit`、`kb.file.reparse`、`kb.file.delete`、`kb.file.status.pending`/`parsing`/`ready`/`failed`/`disabled`、`kb.file.fail.unsupported_type`/`too_large`/`read_failed`/`corrupted`/`pdf_encrypted`/`pdf_no_text`/`pdf_scanned`/`docx_invalid`/`timeout`/`unknown`、`kb.search.placeholder`、`kb.search.noResults`、`kb.search.returnCount`、`kb.search.fileType`、`kb.chat.banner`、`kb.chat.picker.title`、`kb.chat.picker.empty`、`kb.chat.picker.max`、`kb.chat.card.searching`/`done`/`empty`/`failed`、`kb.chat.citation.viewFile`。

---

## 7. V1 简化与未来工作

### 7.1 V1 显式简化

- **CJK 分词**：`unicode61` 单字分词，不引 jieba。短语检索可命中，单字 query 过匹配。后续可换 tokenizer。
- **去重**：只做完全相同 content 去重；连续高度相似块合并不做。
- **检索时机**：会话绑了 KB 就每次自动检索注入，不做「LLM 判断是否相关」前置过滤。
- **流式 chip 渲染**：流式期 plain text，message_end 后一次性替换重排（避免部分数字误匹配）。

### 7.2 V1 不做（与 PRD 3.2 对齐）

OCR / 图片音视频理解 / 网页 Git 云盘自动采集 / 多人协作权限 / 文件历史版本 / 知识图谱 / 自动摘要问答库 / Excel PPT 深度解析 / 工作空间级 KB 隔离 / 用户自定义检索算法和分块参数。

### 7.3 未来升级路径

- **Agentic 检索**：若后续要让模型自己决定何时检索，封装为 pi-knowledge-extension（vendor + 替换 storage backend 直读 pi-web-ui SQLite，工具接口 `pantry_search`/`recipebook_cite` 不变）。
- **语义检索**：在 FTS5 之上加 embedding 列 + sqlite-vec / 外部向量库，hybrid 检索。
- **多 KB 跨工作空间共享的细化权限**：当前所有工作空间看到同一套 KB，未来若需要 RBAC 再加。

---

## 8. 验收清单映射

PRD 第 30 章验收项 → 本设计覆盖位置：

| PRD 验收项 | 设计章节 |
|---|---|
| 知识库不归属工作空间、全局共享 | §2.1（无 workspace 字段）+ §5.2（绑定纯 session 级） |
| KB CRUD + 重名校验 | §2.1 + §6.2 `CreateKbDialog` |
| 列表展示文件数和块数 | §2.1 统计子查询 + §6.2 `KbListPage` |
| 删除后无法搜索/调用 + 解除会话绑定 | §2.1 FK CASCADE + §5.3 |
| 新建 TXT/MD + 导入 4 类型 | §3.1 + §6.2 `ImportFilesDialog` / `KbFileEditorDrawer` |
| 状态清晰 + 失败原因 | §2.2 status + fail_reason + §3.9 |
| 重新解析 + 启停 + 删除 | §3.6 + §6.2 行操作 |
| TXT/MD 在线编辑；PDF/DOCX 不可编辑 | §3.7 + §6.2 `KbFileEditorDrawer` |
| 删除后不再参与搜索 | §2.6 + §3.6 |
| 4 类文件解析 + 块化 + 来源追溯 | §3.4 + §3.5 + §2.3 |
| 空文件不进入可检索 | §3.5（空块丢弃）+ §2.6（parse_generation=0） |
| 重新解析成功后旧内容被替换 | §3.6 代际化 |
| 中英文关键词检索 + 块 + 来源 | §4 + §2.4 |
| 关键词高亮 + 相关度排序 | §4.3 snippet() + bm25 |
| 禁用/删除/失败文件不参与搜索 | §2.6 |
| 不同工作空间可检索同一套 | §2.1 + §5.2 |
| 会话选多 KB（≤10） | §5.1 + §2.5 |
| 模型调用已选 KB | §5.3（自动注入）+ §1.1 偏离点 |
| 模型无法访问未选 KB | §5.3（kbIds 来自 bindings） |
| 调用过程有工具卡片 | §5.4 |
| 回答有来源 + 引用可跳转 | §5.5 |
| 无结果时明确说明 | §5.4 empty phase |
| 禁用 KB 后立即停止调用 | §2.6 enabled=1 + §5.3 实时取 bindings |

PRD 第 31 章测试用例 1-10 全部由上述机制覆盖。

---

## 9. 实现顺序建议

虽然一个 spec 覆盖全 PRD，但实现按以下顺序分阶段提交、每段可独立验证：

1. **DB + repositories + migration 005**（§2 全部）——先跑通表结构与 repository 单元测试。
2. **KB CRUD 路由 + 前端 store + `KbListPage` + `CreateKbDialog`**（§6.2 部分）——KB 列表可用。
3. **文件 CRUD 路由 + 上传/落盘 + `KbFileTab` + `ImportFilesDialog`**——文件可上但还没解析。
4. **解析管线 + chunker + 4 个 parser + 代际化**（§3）——文件能解析成块。
5. **`KbFileDetailDrawer` + `KbFileEditorDrawer`**——块列表 + 在线编辑。
6. **search service + FTS5 query 构造 + `KbSearchTab`**（§4）——搜索可用。
7. **`session_kb_bindings` 路由 + `kbBindingStore` + `ChatKbPicker` + `ChatKbBanner`**（§5.1/§5.2）——composer 可选 KB。
8. **WS send 拦截 + `kb_search` 事件 + `ChatKbCallCard`**（§5.3/§5.4）——对话期注入打通。
9. **行内 chip 渲染 + 元数据持久化**（§5.5/§5.6）——引用展示 + 重载还原。
10. **i18n + 边界情况打磨 + 验收清单自测**（§6.6 + §5.7 + §8）。

---

## 10. 未决项

无遗留未决项。所有架构决策已拍板：服务端注入、磁盘+DB 存储、FTS5、unpdf、KB 级 + 文件级筛选、自动检索、行内 chip。
