import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const endpoint = process.env.PI_WEB_UI_CONNECTOR_ENDPOINT;
const token = process.env.PI_WEB_UI_CONNECTOR_TOKEN;
const sessionId = process.env.PI_WEB_UI_SESSION_ID;

async function request(path: string, body: unknown, signal?: AbortSignal) {
  if (!endpoint || !token || !sessionId) throw new Error("连接器网关未配置");
  const response = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-pi-connector-token": token },
    body: JSON.stringify(body),
    signal,
  });
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as any;
  if (!response.ok) throw new Error(result.error ?? `连接器请求失败：${response.status}`);
  return result;
}

function output(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: result };
}

export default function connectorTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "connector_search",
    label: "搜索连接器能力",
    description: "按关键词搜索当前工作空间中已启用连接器的能力。先搜索，再 describe，最后 call。不要因为一次搜索为空就断言没有连接器；改用连接器名称和动作关键词重试。腾讯文档只有标题时先搜索文档获取 ID；链接 /sheet/<id> 使用 sheet.*，/smartsheet/<id> 使用 smartsheet.*，file_id 必须保留路径中的完整 id。",
    parameters: Type.Object({
      query: Type.String({ description: "要完成的任务或能力关键词" }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
    }),
    execute: async (_id, params, signal) => output(await request(`/internal/connectors/${sessionId}/search`, params, signal)),
  });

  pi.registerTool({
    name: "connector_describe",
    label: "查看连接器能力",
    description: "查看某个连接器能力的输入结构和权限；调用前应先查看。",
    parameters: Type.Object({ tool: Type.String({ description: "connector_search 返回的完整 tool 标识" }) }),
    execute: async (_id, params, signal) => output(await request(`/internal/connectors/${sessionId}/describe`, params, signal)),
  });

  pi.registerTool({
    name: "connector_call",
    label: "调用连接器",
    description: "调用已启用的外部连接器能力。写入或高风险操作可能要求用户确认。",
    parameters: Type.Object({
      tool: Type.String({ description: "connector_search 返回的完整 tool 标识" }),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => output(await request(`/internal/connectors/${sessionId}/call`, params, signal)),
  });
}
