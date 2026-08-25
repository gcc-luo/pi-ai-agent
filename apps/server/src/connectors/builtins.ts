import type { BuiltinConnectorDto, CreateConnectorInput } from "@pi-web-ui/shared";

export interface BuiltinConnectorManifest extends Omit<BuiltinConnectorDto, "connected" | "instanceId"> {
  tokenFieldPath: `headers.${string}`;
  createInput(token: string): CreateConnectorInput;
}

export const BUILTIN_CONNECTORS: BuiltinConnectorManifest[] = [
  {
    key: "tencent-docs",
    name: "腾讯文档",
    description: "搜索、读取、创建和管理腾讯文档",
    icon: "📄",
    category: "文档知识",
    authUrl: "https://docs.qq.com/open/auth/mcp.html",
    accountNote: "使用腾讯文档个人 Token 连接；部分能力可能需要腾讯文档会员。",
    capabilities: ["搜索和读取文档", "创建与编辑在线文档", "管理文件和文件夹", "操作智能表格与智能文档"],
    tokenFieldPath: "headers.Authorization",
    createInput: (token) => ({
      name: "腾讯文档",
      description: "搜索、读取、创建和管理腾讯文档",
      icon: "📄",
      scopeType: "user",
      lifecycle: "lazy",
      config: {
        transport: "streamable_http",
        url: "https://docs.qq.com/openapi/mcp",
        headers: { Authorization: { source: "credential", credentialId: "pending" } },
        timeoutMs: 30_000,
      },
      credentials: { "headers.Authorization": token },
    }),
  },
  {
    key: "tencent-meeting",
    name: "腾讯会议",
    description: "预约和管理会议，读取录制、转写与智能纪要",
    icon: "📅",
    category: "办公协作",
    authUrl: "https://meeting.tencent.com/ai-skill.html",
    accountNote: "个人版和专业版可直接使用；商业版、企业版目前需要申请开通。",
    capabilities: ["预约、修改和取消会议", "查询会议与参会成员", "获取录制和转写", "读取 AI 智能纪要"],
    tokenFieldPath: "headers.X-Tencent-Meeting-Token",
    createInput: (token) => ({
      name: "腾讯会议",
      description: "预约和管理会议，读取录制、转写与智能纪要",
      icon: "📅",
      scopeType: "user",
      lifecycle: "lazy",
      config: {
        transport: "streamable_http",
        url: "https://mcp.meeting.tencent.com/mcp/wemeet-open/v1",
        headers: {
          "X-Tencent-Meeting-Token": { source: "credential", credentialId: "pending" },
          "X-Skill-Version": { source: "literal", value: "v1.0.14" },
        },
        timeoutMs: 30_000,
      },
      credentials: { "headers.X-Tencent-Meeting-Token": token },
    }),
  },
];

export function builtinManifest(key: string): BuiltinConnectorManifest | null {
  return BUILTIN_CONNECTORS.find((item) => item.key === key) ?? null;
}
