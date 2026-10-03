import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const pluginEndpoint = process.env.PI_WEB_UI_PLUGIN_ENDPOINT;
const sessionId = process.env.PI_WEB_UI_SESSION_ID;
const token = process.env.PI_WEB_UI_WECHAT_FILE_TRANSFER_TOKEN
  ?? process.env.PI_WEB_UI_PLUGIN_TOKEN;
const serverToken = process.env.PI_WEB_UI_AUTH_TOKEN;
for (const key of [
  "PI_WEB_UI_PLUGIN_ENDPOINT",
  "PI_WEB_UI_PLUGIN_TOKEN",
  "PI_WEB_UI_SESSION_ID",
  "PI_WEB_UI_WECHAT_FILE_TRANSFER_TOKEN",
  "PI_WEB_UI_AUTH_TOKEN",
]) {
  delete process.env[key];
}

type SendFilesResult = {
  sent: string[];
  failed: Array<{ path: string; error: string }>;
};

async function sendFiles(filePaths: string[], signal?: AbortSignal) {
  if (!pluginEndpoint || !sessionId || !token) {
    return {
      content: [{ type: "text" as const, text: "微信文件发送工具未配置。" }],
      details: { sent: [], failed: filePaths.map((filePath) => ({ path: filePath, error: "工具未配置" })) },
      isError: true,
    };
  }

  try {
    const response = await fetch(
      `${pluginEndpoint}/${encodeURIComponent(sessionId)}/wechat-file-transfer/action`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pi-plugin-token": token,
          ...(serverToken ? { authorization: `Bearer ${serverToken}` } : {}),
        },
        body: JSON.stringify({ action: "sendFiles", args: { filePaths } }),
        signal,
      },
    );
    const result = await response.json() as SendFilesResult & { error?: string };
    if (!response.ok) {
      throw new Error(typeof result.error === "string" ? result.error : `HTTP ${response.status}`);
    }

    const lines = [
      ...result.sent.map((fileName) => `成功：${fileName}`),
      ...result.failed.map((file) => `失败：${file.path}（${file.error}）`),
    ];
    const sentCount = result.sent.length;
    return {
      content: [{
        type: "text" as const,
        text: lines.join("\n") || "没有文件发送。",
      }],
      details: result,
      isError: sentCount === 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `微信文件发送失败：${message}` }],
      details: { sent: [], failed: filePaths.map((filePath) => ({ path: filePath, error: message })) },
      isError: true,
    };
  }
}

export default function wechatFileTransfer(pi: ExtensionAPI) {
  pi.registerTool({
    name: "send_file_to_wechat",
    label: "发送文件到微信",
    description: "把当前项目目录内的一个或多个文件发给当前微信用户。只接受相对项目工作目录的普通文件路径，不支持目录。",
    promptSnippet: "send_file_to_wechat — 向当前微信用户发送项目中已有的文件。",
    parameters: Type.Object({
      filePaths: Type.Array(Type.String({ minLength: 1 }), {
        description: "相对于当前项目工作目录的文件路径",
        minItems: 1,
        maxItems: 10,
      }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      return sendFiles(params.filePaths as string[], signal);
    },
  });
}
