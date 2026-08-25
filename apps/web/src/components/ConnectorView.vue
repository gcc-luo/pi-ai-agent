<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { NButton, NEmpty, NInput, NModal, NSelect, NSpin, NSwitch, NTag, createDiscreteApi } from "naive-ui";
import type { BuiltinConnectorDto, ConnectorDto, ConnectorToolPolicy, CreateConnectorInput, McpConnectorConfig } from "@pi-web-ui/shared";
import { api } from "../api/client.js";
import { useConnectorStore } from "../stores/connector.js";

const props = defineProps<{ projectId?: string | null }>();
const store = useConnectorStore();
const { message } = createDiscreteApi(["message"]);
const query = ref("");
const filter = ref<"all" | "connected">("all");
const showForm = ref(false);
const detail = ref<ConnectorDto | null>(null);
const editingId = ref<string | null>(null);
const testing = ref(false);
const saving = ref(false);
const builtinTarget = ref<BuiltinConnectorDto | null>(null);
const builtinToken = ref("");
const connectingBuiltin = ref(false);
const form = reactive({
  name: "", description: "", mode: "local" as "local" | "remote", transport: "stdio" as McpConnectorConfig["transport"],
  command: "", args: "", cwd: "", url: "", scopeType: "workspace" as "user" | "workspace",
  env: "", headers: "", timeoutMs: 30000, advanced: false,
});

const matchesQuery = (item: { name: string; description?: string | null; category?: string }) => {
  const needle = query.value.trim().toLowerCase();
  return !needle || `${item.name} ${item.description ?? ""} ${item.category ?? ""}`.toLowerCase().includes(needle);
};
const visibleOfficial = computed(() => store.catalog.filter((item) => (filter.value === "all" || item.connected) && matchesQuery(item)));
const visible = computed(() => store.connectors.filter((item) => !item.builtinKey && (() => {
  if (filter.value === "connected" && item.status !== "connected" && !item.lastConnectedAt) return false;
  return matchesQuery(item);
})()));

onMounted(() => store.load(props.projectId ?? undefined));

function resetForm() {
  Object.assign(form, { name: "", description: "", mode: "local", transport: "stdio", command: "", args: "", cwd: "", url: "", scopeType: props.projectId ? "workspace" : "user", env: "", headers: "", timeoutMs: 30000, advanced: false });
  editingId.value = null;
}

function openCreate() { resetForm(); showForm.value = true; }

function refsText(record: McpConnectorConfig["env"] | McpConnectorConfig["headers"]): string {
  return Object.entries(record ?? {}).map(([key, ref]) => ref.source === "literal" ? `${key}=${ref.value}` : ref.source === "env" ? `${key}=\${${ref.name}}` : `${key}=••••••`).join("\n");
}

function openEdit(item: ConnectorDto) {
  editingId.value = item.id;
  Object.assign(form, {
    name: item.name, description: item.description ?? "", mode: item.config.transport === "stdio" ? "local" : "remote",
    transport: item.config.transport, command: item.config.command ?? "", args: (item.config.args ?? []).join("\n"), cwd: item.config.cwd ?? "",
    url: item.config.url ?? "", scopeType: item.scopeType, env: refsText(item.config.env), headers: refsText(item.config.headers),
    timeoutMs: item.config.timeoutMs ?? 30000, advanced: true,
  });
  detail.value = null;
  showForm.value = true;
}

function parseKeyValues(text: string, group: "env" | "headers", previous?: Record<string, any>) {
  const refs: Record<string, any> = {};
  const credentials: Record<string, string> = {};
  for (const line of text.split("\n").map((value) => value.trim()).filter(Boolean)) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (value === "••••••" && previous?.[key]?.source === "credential") refs[key] = previous[key];
    else if (/^\$\{[^}]+\}$/.test(value)) refs[key] = { source: "env", name: value.slice(2, -1) };
    else if (/token|secret|password|authorization|cookie|api[_-]?key|access[_-]?key/i.test(key)) credentials[`${group}.${key}`] = value;
    else refs[key] = { source: "literal", value };
  }
  return { refs, credentials };
}

function inputForSave(): CreateConnectorInput {
  const current = editingId.value ? store.connectors.find((item) => item.id === editingId.value) : undefined;
  const env = parseKeyValues(form.env, "env", current?.config.env);
  const headers = parseKeyValues(form.headers, "headers", current?.config.headers);
  const transport = form.mode === "local" ? "stdio" : form.transport === "stdio" ? "streamable_http" : form.transport;
  return {
    name: form.name.trim(), description: form.description.trim(), scopeType: form.scopeType,
    scopeId: form.scopeType === "workspace" ? props.projectId : null,
    config: {
      transport, command: transport === "stdio" ? form.command.trim() : undefined,
      args: transport === "stdio" ? form.args.split("\n").map((value) => value.trim()).filter(Boolean) : undefined,
      cwd: transport === "stdio" ? form.cwd.trim() || undefined : undefined,
      url: transport !== "stdio" ? form.url.trim() : undefined,
      env: Object.keys(env.refs).length ? env.refs : undefined,
      headers: Object.keys(headers.refs).length ? headers.refs : undefined,
      timeoutMs: form.timeoutMs,
    },
    credentials: { ...env.credentials, ...headers.credentials },
  };
}

async function save() {
  saving.value = true;
  try {
    const input = inputForSave();
    const connector = editingId.value ? await store.update(editingId.value, input) : await store.create(input);
    showForm.value = false;
    message.success(editingId.value ? "连接器已更新" : "连接器已添加");
    await test(connector, false);
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  finally { saving.value = false; }
}

async function test(item: ConnectorDto, notify = true) {
  testing.value = true;
  try {
    const result = await api.testConnector(item.id);
    await store.loadTools(item.id);
    await store.load(props.projectId ?? undefined);
    if (notify) result.ok ? message.success(`连接成功，发现 ${result.toolCount} 项能力`) : message.error(result.error ?? "连接失败");
  } catch (error) { if (notify) message.error(error instanceof Error ? error.message : String(error)); }
  finally { testing.value = false; }
}

async function openDetail(item: ConnectorDto) { detail.value = item; await store.loadTools(item.id); }
function openBuiltin(item: BuiltinConnectorDto) {
  if (item.instanceId) {
    const instance = store.connectors.find((connector) => connector.id === item.instanceId);
    if (instance) void openDetail(instance);
    return;
  }
  builtinTarget.value = item;
  builtinToken.value = "";
}
async function connectBuiltin() {
  if (!builtinTarget.value || !builtinToken.value.trim()) return;
  connectingBuiltin.value = true;
  try {
    const connector = await store.connectBuiltin(builtinTarget.value.key, builtinToken.value);
    const name = builtinTarget.value.name;
    builtinTarget.value = null;
    builtinToken.value = "";
    const result = await api.testConnector(connector.id);
    await store.load(props.projectId ?? undefined);
    result.ok ? message.success(`${name}连接成功，发现 ${result.toolCount} 项能力`) : message.warning(`${name}已保存，但连接测试失败：${result.error ?? "请检查 Token"}`);
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  finally { connectingBuiltin.value = false; }
}
async function toggle(item: ConnectorDto, enabled: boolean) { try { await store.update(item.id, { enabled }); } catch (error) { message.error(String(error)); } }
async function updateTool(item: ConnectorDto, name: string, patch: { enabled?: boolean; policy?: ConnectorToolPolicy }) { await store.setTool(item.id, name, patch); }
async function remove(item: ConnectorDto) {
  if (!window.confirm(`确定解绑“${item.name}”？本地凭据将被删除，审计记录会保留。`)) return;
  await store.remove(item.id); detail.value = null; message.success("连接器已解绑");
}

function statusText(item: ConnectorDto) {
  if (!item.enabled) return "已连接，未启用";
  return ({ connected: "已连接", connecting: "连接中", auth_required: "需要重新授权", error: "连接异常", disconnected: item.lastConnectedAt ? "已连接，当前空闲" : "等待测试", not_configured: "未配置", degraded: "连接不稳定", disabled: "未启用" } as Record<string, string>)[item.status] ?? item.status;
}
</script>

<template>
  <main class="connector-view">
    <header class="view-header">
      <div><h1>连接器</h1><p>让 Agent 安全连接你的文档、项目系统和其他服务。</p></div>
      <NButton type="primary" @click="openCreate">自定义连接器</NButton>
    </header>
    <section class="toolbar">
      <NInput v-model:value="query" clearable placeholder="搜索连接器…" class="search" />
      <div class="filters"><button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button><button :class="{ active: filter === 'connected' }" @click="filter = 'connected'">已连接</button></div>
    </section>
    <NSpin :show="store.loading">
      <section class="body">
        <div v-if="store.error" class="error">{{ store.error }}</div>
        <NEmpty v-if="!visible.length && !visibleOfficial.length && !store.loading" description="没有匹配的连接器" />
        <template v-else>
        <h3 v-if="visibleOfficial.length" class="section-title">官方连接器</h3>
        <div v-if="visibleOfficial.length" class="grid">
          <article v-for="item in visibleOfficial" :key="item.key" class="card" @click="openBuiltin(item)">
            <div class="icon">{{ item.icon }}</div>
            <div class="card-main"><h2>{{ item.name }}</h2><p>{{ item.description }}</p><span v-if="item.connected" class="status connected"><i />已连接</span><span v-else class="category">{{ item.category }}</span></div>
            <template v-if="item.connected"><NSwitch :value="store.connectors.find(c => c.id === item.instanceId)?.enabled ?? true" @click.stop @update:value="item.instanceId && toggle(store.connectors.find(c => c.id === item.instanceId)!, $event)" /></template>
            <button v-else class="add-button" :aria-label="`连接${item.name}`" @click.stop="openBuiltin(item)">+</button>
          </article>
        </div>
        <h3 v-if="visible.length" class="section-title custom-title">自定义连接器</h3>
        <div v-if="visible.length" class="grid">
          <article v-for="item in visible" :key="item.id" class="card" @click="openDetail(item)">
            <div class="icon">{{ item.icon }}</div>
            <div class="card-main"><h2>{{ item.name }}</h2><p>{{ item.description || '通过外部服务扩展 Agent 能力' }}</p><span class="status" :class="item.status"><i />{{ statusText(item) }}</span></div>
            <NSwitch :value="item.enabled" @click.stop @update:value="toggle(item, $event)" />
          </article>
        </div>
        </template>
      </section>
    </NSpin>

    <NModal :show="showForm" preset="card" :title="editingId ? '编辑自定义连接器' : '添加自定义连接器'" :style="{ width: '640px', maxWidth: '94vw' }" @update:show="showForm = $event">
      <div class="form">
        <label>名称<NInput v-model:value="form.name" placeholder="例如：公司知识库" /></label>
        <label>说明<NInput v-model:value="form.description" placeholder="这个连接器能做什么" /></label>
        <label>连接方式<div class="segmented"><button :class="{ active: form.mode === 'local' }" @click="form.mode = 'local'; form.transport = 'stdio'">本地命令</button><button :class="{ active: form.mode === 'remote' }" @click="form.mode = 'remote'; form.transport = 'streamable_http'">远程地址</button></div></label>
        <template v-if="form.mode === 'local'">
          <label>启动命令<NInput v-model:value="form.command" placeholder="npx" /></label>
          <label>参数（每行一个）<NInput v-model:value="form.args" type="textarea" :rows="3" placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/Users/me/Documents" /></label>
        </template>
        <template v-else><label>MCP 地址<NInput v-model:value="form.url" placeholder="https://example.com/mcp" /></label></template>
        <label>作用范围<NSelect v-model:value="form.scopeType" :options="[{ label: '当前工作空间', value: 'workspace', disabled: !projectId }, { label: '所有工作空间', value: 'user' }]" /></label>
        <button class="advanced-toggle" @click="form.advanced = !form.advanced">{{ form.advanced ? '收起高级配置' : '高级配置' }}</button>
        <div v-if="form.advanced" class="advanced">
          <label v-if="form.mode === 'remote'">传输方式<NSelect v-model:value="form.transport" :options="[{ label: 'Streamable HTTP', value: 'streamable_http' }, { label: 'SSE', value: 'sse' }]" /></label>
          <label v-if="form.mode === 'local'">工作目录<NInput v-model:value="form.cwd" placeholder="可选" /></label>
          <label>环境变量（KEY=VALUE，每行一个）<NInput v-model:value="form.env" type="textarea" :rows="3" /></label>
          <label>请求头（KEY=VALUE，每行一个）<NInput v-model:value="form.headers" type="textarea" :rows="3" placeholder="Authorization=Bearer …" /></label>
        </div>
      </div>
      <template #footer><div class="modal-actions"><NButton @click="showForm = false">取消</NButton><NButton type="primary" :loading="saving" :disabled="!form.name.trim()" @click="save">{{ editingId ? '保存' : '添加并测试' }}</NButton></div></template>
    </NModal>

    <NModal :show="builtinTarget !== null" preset="card" :title="builtinTarget ? `连接${builtinTarget.name}` : ''" :style="{ width: '560px', maxWidth: '94vw' }" @update:show="(value: boolean) => { if (!value) builtinTarget = null }">
      <template v-if="builtinTarget">
        <div class="builtin-head"><div class="icon large">{{ builtinTarget.icon }}</div><div><strong>{{ builtinTarget.name }}</strong><p>{{ builtinTarget.description }}</p></div></div>
        <section class="authorization"><h3>连接后，Agent 可以：</h3><ul><li v-for="capability in builtinTarget.capabilities" :key="capability">✓ {{ capability }}</li></ul><p>高风险操作仍会根据权限设置要求确认。</p></section>
        <p class="account-note">{{ builtinTarget.accountNote }}</p>
        <a class="auth-link" :href="builtinTarget.authUrl" target="_blank" rel="noreferrer">前往官方页面获取 Token ↗</a>
        <label class="token-field">授权 Token<NInput v-model:value="builtinToken" type="password" show-password-on="click" autocomplete="off" placeholder="粘贴从官方页面获取的 Token" /></label>
      </template>
      <template #footer><div class="modal-actions"><NButton @click="builtinTarget = null">取消</NButton><NButton type="primary" :loading="connectingBuiltin" :disabled="!builtinToken.trim()" @click="connectBuiltin">连接并验证</NButton></div></template>
    </NModal>

    <NModal :show="detail !== null" preset="card" :title="detail?.name" :style="{ width: '720px', maxWidth: '94vw' }" @update:show="(value: boolean) => { if (!value) detail = null }">
      <template v-if="detail">
        <div class="detail-status"><span class="status" :class="detail.status"><i />{{ statusText(detail) }}</span><NSwitch :value="detail.enabled" @update:value="toggle(detail!, $event)" /></div>
        <p class="detail-description">{{ detail.description || '通过外部服务扩展 Agent 能力' }}</p>
        <div v-if="detail.lastError" class="error">{{ detail.lastError }}<small>{{ detail.lastErrorCode }}</small></div>
        <div class="detail-actions"><NButton :loading="testing" @click="test(detail!)">测试连接</NButton><NButton @click="openEdit(detail!)">编辑配置</NButton></div>
        <section class="tools"><h3>权限与能力 <span>{{ store.tools[detail.id]?.length ?? 0 }}</span></h3><p v-if="!store.tools[detail.id]?.length" class="muted">测试连接后会显示服务提供的能力。</p>
          <div v-for="tool in store.tools[detail.id]" :key="tool.name" class="tool-row">
            <NSwitch size="small" :value="tool.enabled" @update:value="updateTool(detail!, tool.name, { enabled: $event })" />
            <div class="tool-main"><strong>{{ tool.title || tool.name }}</strong><small>{{ tool.description || tool.name }}</small></div>
            <NTag size="small" :type="tool.riskLevel === 'high' ? 'error' : tool.riskLevel === 'medium' ? 'warning' : 'success'">{{ tool.riskLevel }}</NTag>
            <NSelect size="small" class="policy" :value="tool.policy" :options="[{ label: '允许', value: 'allow' }, { label: '询问', value: 'ask' }, { label: '禁止', value: 'deny' }]" @update:value="updateTool(detail!, tool.name, { policy: $event })" />
          </div>
        </section>
        <div class="danger-zone"><button @click="remove(detail!)">解绑连接器</button></div>
      </template>
    </NModal>
  </main>
</template>

<style scoped>
.connector-view{flex:1;min-width:0;overflow:auto;background:var(--bg-surface)}.view-header{display:flex;justify-content:space-between;align-items:flex-start;padding:32px 48px 24px;border-bottom:1px solid var(--border-color)}.view-header h1{margin:0 0 4px;font-size:24px;color:var(--text-primary)}.view-header p,.card p,.detail-description,.muted,.builtin-head p{margin:0;color:var(--text-secondary);font-size:13px}.toolbar{display:flex;align-items:center;gap:20px;padding:20px 48px 0}.search{max-width:420px}.filters{display:flex;padding:3px;background:var(--background-panel);border:1px solid var(--border-color);border-radius:9px}.filters button,.segmented button{border:0;background:transparent;color:var(--text-secondary);padding:6px 14px;border-radius:6px;cursor:pointer}.filters button.active,.segmented button.active{color:var(--primary-color);background:var(--background-selected)}.body{padding:20px 48px 48px}.section-title{margin:2px 0 12px;font-size:13px;color:var(--text-secondary);font-weight:600}.custom-title{margin-top:28px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}.card{display:flex;gap:14px;align-items:flex-start;padding:20px;border:1px solid var(--border-color);border-radius:12px;background:var(--background-panel);cursor:pointer;transition:.15s}.card:hover{border-color:var(--primary-color);box-shadow:var(--shadow-md)}.icon{display:grid;place-items:center;width:42px;height:42px;border-radius:10px;background:var(--background-selected);font-size:22px;flex-shrink:0}.icon.large{width:48px;height:48px;font-size:25px}.card-main{flex:1;min-width:0}.card h2{margin:0 0 5px;font-size:16px;color:var(--text-primary)}.card p{min-height:36px}.category{display:inline-block;margin-top:10px;color:var(--text-muted);font-size:12px}.add-button{display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--primary-color);border-radius:50%;background:transparent;color:var(--primary-color);font-size:21px;cursor:pointer}.status{display:inline-flex;align-items:center;gap:6px;margin-top:10px;color:var(--text-secondary);font-size:12px}.status i{width:7px;height:7px;border-radius:50%;background:currentColor}.status.connected{color:var(--green)}.status.error{color:var(--rose)}.status.auth_required,.status.connecting,.status.degraded{color:var(--amber)}.form{display:grid;gap:16px}.form label,.token-field{display:grid;gap:7px;color:var(--text-primary);font-size:13px}.segmented{display:flex;align-self:start;padding:3px;border:1px solid var(--border-color);border-radius:9px}.advanced-toggle{justify-self:start;border:0;background:none;color:var(--primary-color);cursor:pointer;padding:0}.advanced{display:grid;gap:14px;padding:14px;border:1px solid var(--border-color);border-radius:10px}.modal-actions,.detail-status,.detail-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px}.detail-status{justify-content:space-between}.detail-description{margin:12px 0}.error{padding:10px 12px;border:1px solid color-mix(in srgb,var(--rose) 40%,transparent);border-radius:8px;background:var(--rose-dim);color:var(--rose);font-size:13px}.error small{display:block;margin-top:4px}.tools{margin-top:22px}.tools h3{display:flex;gap:8px;margin:0 0 10px;font-size:15px}.tools h3 span{color:var(--text-muted);font-weight:400}.tool-row{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid var(--border-color)}.tool-main{display:grid;gap:3px;flex:1;min-width:0}.tool-main strong{font-size:13px}.tool-main small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)}.policy{width:92px}.danger-zone{margin-top:24px;padding-top:16px;border-top:1px solid var(--border-color)}.danger-zone button{border:0;background:none;color:var(--rose);cursor:pointer;padding:0}.builtin-head{display:flex;align-items:center;gap:13px}.builtin-head strong{display:block;margin-bottom:4px;font-size:16px}.authorization{margin:18px 0;padding:15px;border-radius:10px;background:var(--background-selected)}.authorization h3{margin:0 0 9px;font-size:14px}.authorization ul{display:grid;gap:6px;margin:0;padding:0;list-style:none;color:var(--text-secondary);font-size:13px}.authorization p,.account-note{margin:10px 0 0;color:var(--text-secondary);font-size:12px}.auth-link{display:inline-block;margin:2px 0 16px;color:var(--primary-color);text-decoration:none}
</style>
