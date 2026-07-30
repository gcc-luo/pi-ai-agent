import {
  createBashToolDefinition,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const endpoint = process.env.PI_WEB_UI_BROWSER_ENDPOINT;
const sessionId = process.env.PI_WEB_UI_SESSION_ID;
const token = process.env.PI_WEB_UI_BROWSER_TOKEN;

const targetProperties = {
  ref: Type.Optional(Type.String({ description: "browser_snapshot 返回的短期元素引用，如 e2" })),
  role: Type.Optional(Type.String({ description: "ARIA role，如 button、link、textbox" })),
  name: Type.Optional(Type.String({ description: "元素的可访问名称，通常与 role 配合" })),
  text: Type.Optional(Type.String({ description: "元素可见文本" })),
  label: Type.Optional(Type.String({ description: "表单控件关联的 label 文本" })),
  placeholder: Type.Optional(Type.String({ description: "输入控件 placeholder" })),
  testId: Type.Optional(Type.String({ description: "data-testid 值" })),
  selector: Type.Optional(Type.String({ description: "仅在语义定位不可用时使用的稳定 CSS selector" })),
  exact: Type.Optional(Type.Boolean({ description: "文本定位是否精确匹配" })),
  timeoutMs: Type.Optional(Type.Number({ minimum: 0, maximum: 30000 })),
};

async function invoke(
  action: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  if (!endpoint || !sessionId || !token) {
    return {
      content: [{ type: "text" as const, text: "浏览器工具配置缺失，请关闭后重新启用浏览器能力。" }],
      details: { ok: false, error: "browser tool configuration missing" },
      isError: true,
    };
  }
  try {
    const response = await fetch(`${endpoint}/${encodeURIComponent(sessionId)}/action`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pi-browser-token": token,
      },
      body: JSON.stringify({ action, args }),
      signal,
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof result.error === "string" ? result.error : `HTTP ${response.status}`;
      return {
        content: [{ type: "text" as const, text: `浏览器操作失败：${message}` }],
        details: result,
        isError: true,
      };
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      details: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `浏览器操作失败：${message}` }],
      details: { ok: false, error: message },
      isError: true,
    };
  }
}

const run = (action: string) =>
  async (
    _toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ) => invoke(action, params, signal);

export default function browserTools(pi: ExtensionAPI) {
  const builtinBash = createBashToolDefinition(process.cwd());
  pi.registerTool({
    ...builtinBash,
    description: `${builtinBash.description} 未指定 timeout 时默认最多执行 120 秒。`,
    promptSnippet: "执行有界 Bash 命令；常驻开发服务必须后台启动并重定向日志",
    promptGuidelines: [
      "不要用 bash 在前台直接运行 pnpm dev、npm run dev、vite、next dev 等常驻服务；应后台启动并重定向输出，例如 `pnpm dev > browser/dev-server.log 2>&1 &`，随后轮询目标 URL。",
      "bash 未显式提供 timeout 时会在 120 秒后终止命令；确实需要更久的有限任务时必须显式设置 timeout。",
    ],
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return builtinBash.execute(
        toolCallId,
        { ...params, timeout: params.timeout ?? 120 },
        signal,
        onUpdate,
        ctx,
      );
    },
  });

  const guidelines = [
    "首次操作页面或页面明显变化后，调用 browser_snapshot 获取短期元素 ref。",
    "浏览器操作优先使用 ref、ARIA role、label 或可见文本，不要猜测复杂 CSS selector。",
    "需要启动本地 Web 项目时，使用后台 Bash 命令并重定向日志，确认服务 URL 可访问后再调用 browser_navigate；不要在前台执行常驻开发服务器。",
    "任何不可逆提交、发送、删除、支付或权限变更前，必须先获得用户明确确认。",
  ];

  pi.registerTool({
    name: "browser_open",
    label: "打开浏览器",
    description: "创建或恢复当前会话隔离的 Chromium 浏览器，返回当前页面状态。",
    promptSnippet: "打开或恢复当前会话的浏览器",
    promptGuidelines: guidelines,
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: run("open"),
  });

  pi.registerTool({
    name: "browser_navigate",
    label: "访问网页",
    description: "在当前标签页访问 http/https URL，返回标题、最终 URL 和响应状态。",
    parameters: Type.Object({
      url: Type.String({ description: "完整的 http 或 https URL" }),
      timeoutMs: Type.Optional(Type.Number({ minimum: 0, maximum: 30000 })),
    }),
    executionMode: "sequential",
    execute: run("navigate"),
  });

  pi.registerTool({
    name: "browser_snapshot",
    label: "读取页面",
    description: "返回精简的页面标题、URL 和可交互元素列表，并为元素生成 e1、e2 等短期引用。",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: run("snapshot"),
  });

  pi.registerTool({
    name: "browser_click",
    label: "点击元素",
    description: "通过快照 ref 或语义定位点击页面元素，并返回点击后页面和下载信息。",
    parameters: Type.Object({
      ...targetProperties,
      expectDownload: Type.Optional(Type.Boolean({
        description: "点击预期触发下载时设为 true，工具会等待文件保存完成",
      })),
      userConfirmed: Type.Optional(Type.Boolean({
        description: "仅当用户已在当前对话中明确确认危险操作时设为 true",
      })),
    }),
    executionMode: "sequential",
    execute: run("click"),
  });

  pi.registerTool({
    name: "browser_fill",
    label: "填写内容",
    description: "清空并填写输入框、文本域或可编辑元素。",
    parameters: Type.Object({
      ...targetProperties,
      value: Type.String({ description: "要填写的完整内容" }),
    }),
    executionMode: "sequential",
    execute: run("fill"),
  });

  pi.registerTool({
    name: "browser_select",
    label: "选择选项",
    description: "选择下拉框选项，或设置复选框、单选框的勾选状态。",
    parameters: Type.Object({
      ...targetProperties,
      value: Type.Optional(Type.String({ description: "select option 的 value" })),
      optionLabel: Type.Optional(Type.String({ description: "select option 的可见标签" })),
      checked: Type.Optional(Type.Boolean({ description: "复选框或单选框是否勾选，默认 true" })),
    }),
    executionMode: "sequential",
    execute: run("select"),
  });

  pi.registerTool({
    name: "browser_press",
    label: "按下按键",
    description: "在页面或指定元素上按下 Enter、Escape、Tab、Control+A 等键。",
    parameters: Type.Object({
      ...targetProperties,
      key: Type.String({ description: "Playwright 键名或组合键，如 Enter、Control+A" }),
      userConfirmed: Type.Optional(Type.Boolean({
        description: "仅当用户已在当前对话中明确确认危险提交时设为 true",
      })),
    }),
    executionMode: "sequential",
    execute: run("press"),
  });

  pi.registerTool({
    name: "browser_hover",
    label: "悬停元素",
    description: "将鼠标悬停在通过 ref 或语义方式定位的元素上。",
    parameters: Type.Object({ ...targetProperties }),
    executionMode: "sequential",
    execute: run("hover"),
  });

  pi.registerTool({
    name: "browser_scroll",
    label: "滚动页面",
    description: "滚动页面或指定的可滚动元素。",
    parameters: Type.Object({
      ...targetProperties,
      deltaX: Type.Optional(Type.Number({ description: "水平滚动量，默认 0" })),
      deltaY: Type.Optional(Type.Number({ description: "垂直滚动量，默认 600" })),
    }),
    executionMode: "sequential",
    execute: run("scroll"),
  });

  pi.registerTool({
    name: "browser_wait",
    label: "等待页面",
    description: "等待一段时间、页面加载、URL 变化或元素显示/隐藏，最长 30 秒。",
    parameters: Type.Object({
      ...targetProperties,
      condition: Type.Optional(Type.Union([
        Type.Literal("time"),
        Type.Literal("networkidle"),
        Type.Literal("domcontentloaded"),
        Type.Literal("load"),
        Type.Literal("url"),
        Type.Literal("visible"),
        Type.Literal("hidden"),
      ])),
      url: Type.Optional(Type.String({ description: "condition=url 时的 URL 或 glob" })),
    }),
    executionMode: "sequential",
    execute: run("wait"),
  });

  pi.registerTool({
    name: "browser_tabs",
    label: "管理标签页",
    description: "列出、新建、切换或关闭当前会话中的浏览器标签页。",
    parameters: Type.Object({
      action: Type.Optional(Type.Union([
        Type.Literal("list"),
        Type.Literal("new"),
        Type.Literal("switch"),
        Type.Literal("close"),
      ])),
      index: Type.Optional(Type.Number({ minimum: 0 })),
      url: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Number({ minimum: 0, maximum: 30000 })),
    }),
    executionMode: "sequential",
    execute: run("tabs"),
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "截取页面",
    description: "截取当前视口、整页或指定元素，文件保存到工作区 browser/screenshots。",
    parameters: Type.Object({
      ...targetProperties,
      name: Type.Optional(Type.String({ description: "截图文件名，自动补 .png" })),
      fullPage: Type.Optional(Type.Boolean({ description: "是否截取整页" })),
    }),
    executionMode: "sequential",
    execute: run("screenshot"),
  });

  pi.registerTool({
    name: "browser_console_errors",
    label: "读取控制台错误",
    description: "读取当前浏览器会话中去重后的 console.error 和未捕获页面异常。",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: run("console_errors"),
  });

  pi.registerTool({
    name: "browser_network_errors",
    label: "读取网络错误",
    description: "读取当前浏览器会话中去重后的失败请求及 HTTP 4xx/5xx 响应。",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: run("network_errors"),
  });

  pi.registerTool({
    name: "browser_close",
    label: "关闭浏览器",
    description: "关闭当前会话的 Chromium、上下文和标签页；浏览器能力设置仍保持启用，可再次打开。",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: run("close"),
  });
}
