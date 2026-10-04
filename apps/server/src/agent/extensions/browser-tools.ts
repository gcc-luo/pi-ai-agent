import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
// The upstream package publishes JavaScript without declarations. Keep its tool schema untouched.
// @ts-expect-error upstream has no declaration file
import agentBrowserExtension from "pi-agent-browser-native/dist/extensions/agent-browser/index.js";
import { browserArtifacts } from "../../browser/browser-artifacts.js";

export default function browserTools(pi: ExtensionAPI) {
  const endpoint = process.env.PI_WEB_UI_BROWSER_PLUGIN_ENDPOINT;
  const token = process.env.PI_WEB_UI_BROWSER_PLUGIN_TOKEN;
  const sessionId = process.env.PI_WEB_UI_BROWSER_SESSION_ID;
  if (process.env.PI_WEB_UI_PLUGIN_TOKEN === token)
    delete process.env.PI_WEB_UI_PLUGIN_TOKEN;
  for (const key of [
    "PI_WEB_UI_BROWSER_PLUGIN_ENDPOINT",
    "PI_WEB_UI_BROWSER_PLUGIN_TOKEN",
    "PI_WEB_UI_BROWSER_SESSION_ID",
    "PI_WEB_UI_BROWSER_ENDPOINT",
    "PI_WEB_UI_BROWSER_TOKEN",
  ])
    delete process.env[key];

  async function host(
    action: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    if (!endpoint || !token || !sessionId)
      throw new Error("浏览器宿主配置缺失，请重新启用 Browser Use。");
    const response = await fetch(
      `${endpoint}/${encodeURIComponent(sessionId)}/browser-use/action`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pi-plugin-token": token,
        },
        body: JSON.stringify({ action, args }),
        signal,
      },
    );
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : `HTTP ${response.status}`,
      );
    return result;
  }

  // Delegate registration and all browser behavior to the published Pi extension.
  // Wrapping execute keeps SDK/RPC calls and future upstream tools on the same host boundary.
  const adapter = new Proxy(pi, {
    get(target, key) {
      if (key !== "registerTool") return Reflect.get(target, key);
      return (tool: ToolDefinition) =>
        target.registerTool({
          ...tool,
          executionMode: "sequential",
          async execute(toolCallId, params, signal, onUpdate, ctx) {
            const authorization = await host(
              "authorize",
              { toolCallId, toolName: tool.name, params },
              signal,
            );
            if (authorization.approved !== true)
              return {
                content: [
                  {
                    type: "text",
                    text: "用户未确认或确认已取消，浏览器操作未执行。",
                  },
                ],
                details: { denied: true },
                isError: true,
              };
            let result;
            try {
              result = await tool.execute(
                toolCallId,
                params,
                signal,
                onUpdate,
                ctx,
              );
              const details =
                result.details && typeof result.details === "object"
                  ? (result.details as Record<string, unknown>)
                  : {};
              const hostArtifacts = await browserArtifacts(
                details,
                ctx.cwd,
              ).catch(() => []);
              result = { ...result, details: { ...details, hostArtifacts } };
            } catch (error) {
              result = {
                content: [
                  {
                    type: "text" as const,
                    text:
                      error instanceof Error ? error.message : String(error),
                  },
                ],
                details: { error: "浏览器执行失败" },
                isError: true,
              };
            }
            // A reporting failure must not turn a completed click into a retryable execution error.
            try {
              const details = result.details as Record<string, unknown>;
              const data =
                details.data && typeof details.data === "object"
                  ? (details.data as Record<string, unknown>)
                  : {};
              await host(
                "complete",
                {
                  toolCallId,
                  toolName: tool.name,
                  isError:
                    ("isError" in result && result.isError === true) ||
                    details.resultCategory === "failure",
                  details: {
                    data: {
                      url: data.url,
                      closed: data.closed,
                      status: data.status,
                      tabs: Array.isArray(data.tabs)
                        ? data.tabs.map(() => ({}))
                        : undefined,
                    },
                    error: details.error,
                    managedSessionOutcome: details.managedSessionOutcome,
                  },
                },
                AbortSignal.timeout(5000),
              );
            } catch {
              /* The next call rechecks authorization; upstream retains full results. */
            }
            return result;
          },
        });
    },
  });
  agentBrowserExtension(adapter);
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n浏览器操作使用 agent_browser。截图、下载等交付文件保存到当前项目 browser/ 目录；已有同名文件时使用新文件名。宿主默认按对话隔离浏览器，请不要自行更换 session 或 namespace，除非用户明确要求连接既有浏览器。启动本地开发服务器应后台运行并重定向日志，确认 URL 可访问后再打开。`,
  }));
}
