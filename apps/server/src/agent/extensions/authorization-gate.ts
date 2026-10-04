import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const CORE_TOOL_NAMES = ["bash", "read", "write", "edit", "grep", "find", "ls"] as const;
const REQUEST_TIMEOUT_MS = 125_000;

type AuthorizationResponse = { approved?: unknown; reason?: unknown };

function toolNameFor(event: ToolCallEvent): (typeof CORE_TOOL_NAMES)[number] | null {
  return CORE_TOOL_NAMES.find((name) => isToolCallEventType(name, event)) ?? null;
}

export default function authorizationGate(pi: ExtensionAPI) {
  const endpoint = process.env.PI_WEB_UI_AUTHORIZATION_ENDPOINT;
  const token = process.env.PI_WEB_UI_AUTHORIZATION_TOKEN;
  const sessionId = process.env.PI_WEB_UI_AUTHORIZATION_SESSION_ID;

  pi.on("tool_call", async (event, ctx) => {
    const toolName = toolNameFor(event);
    if (!toolName) return undefined;
    if (!endpoint || !token || !sessionId) {
      return { block: true, reason: "核心工具授权宿主配置缺失，已阻止执行。" };
    }
    if (ctx.signal?.aborted) {
      return { block: true, reason: "授权请求已取消，工具未执行。" };
    }

    const controller = new AbortController();
    const abortFromContext = () => controller.abort();
    const timeout = setTimeout(abortFromContext, REQUEST_TIMEOUT_MS);
    ctx.signal?.addEventListener("abort", abortFromContext, { once: true });
    try {
      const response = await fetch(
        `${endpoint}/${encodeURIComponent(sessionId)}/check`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-pi-authorization-token": token,
          },
          body: JSON.stringify({
            toolCallId: event.toolCallId,
            toolName,
            input: event.input,
          }),
          signal: controller.signal,
        },
      );
      const result = await response.json().catch(() => null) as AuthorizationResponse | null;
      if (!response.ok || !result || typeof result.approved !== "boolean") {
        return { block: true, reason: "无法确认核心工具授权状态，已阻止执行。" };
      }
      if (!result.approved) {
        return {
          block: true,
          reason: typeof result.reason === "string" ? result.reason : "用户未批准，工具未执行。",
        };
      }
      return undefined;
    } catch {
      return {
        block: true,
        reason: controller.signal.aborted
          ? "授权请求已取消或超时，工具未执行。"
          : "无法联系授权宿主，已阻止工具执行。",
      };
    } finally {
      clearTimeout(timeout);
      ctx.signal?.removeEventListener("abort", abortFromContext);
    }
  });
}
