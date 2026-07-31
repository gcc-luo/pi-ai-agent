import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import fs from "node:fs/promises";

const endpoint = process.env.PI_WEB_UI_PLUGIN_ENDPOINT;
const sessionId = process.env.PI_WEB_UI_SESSION_ID;
const token = process.env.PI_WEB_UI_PLUGIN_TOKEN;
for (const key of [
  "PI_WEB_UI_PLUGIN_ENDPOINT",
  "PI_WEB_UI_PLUGIN_TOKEN",
  "PI_WEB_UI_SESSION_ID",
]) {
  delete process.env[key];
}

async function invoke(
  action: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  if (!endpoint || !sessionId || !token) {
    return {
      content: [{ type: "text" as const, text: "Computer Use 配置缺失，请重新选择该插件。" }],
      details: { ok: false, error: "computer tool configuration missing" },
      isError: true,
    };
  }
  try {
    const response = await fetch(
      `${endpoint}/${encodeURIComponent(sessionId)}/computer-use/action`,
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
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof result.error === "string" ? result.error : `HTTP ${response.status}`;
      return {
        content: [{ type: "text" as const, text: `Computer Use 操作失败：${message}` }],
        details: result,
        isError: true,
      };
    }
    const textContent = { type: "text" as const, text: JSON.stringify(result, null, 2) };
    if (action === "screenshot" && typeof result.path === "string") {
      try {
        const imageBuffer = await fs.readFile(result.path);
        const base64 = imageBuffer.toString("base64");
        return {
          content: [
            textContent,
            { type: "image" as const, data: base64, mimeType: "image/png" },
          ],
          details: result,
        };
      } catch {
        // Fall through to text-only if the file can't be read
      }
    }
    return {
      content: [textContent],
      details: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `Computer Use 操作失败：${message}` }],
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

const point = {
  x: Type.Number({ description: "桌面绝对 X 坐标" }),
  y: Type.Number({ description: "桌面绝对 Y 坐标" }),
};

const intent = {
  intent: Type.String({
    description: "操作目的的简短说明，用于执行层风险审计，如“点击 Word 保存按钮”",
  }),
};

export default function computerTools(pi: ExtensionAPI) {
  const guidelines = [
    "Computer Use 适合操作 Word、微信、Navicat、系统设置等桌面应用；普通网页优先使用 Browser Use。",
    "操作前先调用 computer_list_windows 和 computer_screenshot，聚焦目标窗口后再使用坐标。",
    "每次关键操作后重新截图确认结果；坐标基于最近一次截图，不要凭空猜测。",
    "所有输入操作都要提供真实 intent；涉及发送、提交、删除、支付、覆盖或权限变更时，必须先获得用户明确确认。",
  ];

  pi.registerTool({
    name: "computer_screenshot",
    label: "截取桌面",
    description: "截取桌面或指定窗口，保存到工作区 computer/screenshots 并返回产物。",
    promptSnippet: "查看当前桌面或目标窗口",
    promptGuidelines: guidelines,
    parameters: Type.Object({
      windowId: Type.Optional(Type.String({ description: "computer_list_windows 返回的窗口 ID" })),
      name: Type.Optional(Type.String({ description: "截图文件名" })),
    }),
    executionMode: "sequential",
    execute: run("screenshot"),
  });

  pi.registerTool({
    name: "computer_list_windows",
    label: "列出窗口",
    description: "列出当前可见顶层窗口和屏幕坐标边界。",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: run("list_windows"),
  });

  pi.registerTool({
    name: "computer_focus_window",
    label: "聚焦窗口",
    description: "恢复并聚焦指定顶层窗口。",
    parameters: Type.Object({
      windowId: Type.String({ description: "computer_list_windows 返回的窗口 ID" }),
      ...intent,
    }),
    executionMode: "sequential",
    execute: run("focus_window"),
  });

  pi.registerTool({
    name: "computer_click",
    label: "点击桌面",
    description: "在桌面绝对坐标执行鼠标单击。",
    parameters: Type.Object({ ...point, ...intent }),
    executionMode: "sequential",
    execute: run("click"),
  });

  pi.registerTool({
    name: "computer_double_click",
    label: "双击桌面",
    description: "在桌面绝对坐标执行鼠标双击。",
    parameters: Type.Object({ ...point, ...intent }),
    executionMode: "sequential",
    execute: run("double_click"),
  });

  pi.registerTool({
    name: "computer_type",
    label: "输入文字",
    description: "向当前聚焦的桌面控件输入 Unicode 文本。",
    parameters: Type.Object({
      text: Type.String({ description: "要输入的完整文字" }),
      ...intent,
    }),
    executionMode: "sequential",
    execute: run("type"),
  });

  pi.registerTool({
    name: "computer_key",
    label: "执行按键",
    description: "执行 Enter、Escape、Control+S、Alt+F4 等按键或组合键。",
    parameters: Type.Object({
      key: Type.String({ description: "按键或加号连接的组合键" }),
      ...intent,
    }),
    executionMode: "sequential",
    execute: run("key"),
  });

  pi.registerTool({
    name: "computer_scroll",
    label: "滚动桌面",
    description: "在鼠标当前位置滚动，正数向上、负数向下。",
    parameters: Type.Object({
      delta: Type.Optional(Type.Number({ description: "滚轮增量，默认 -360" })),
      ...intent,
    }),
    executionMode: "sequential",
    execute: run("scroll"),
  });

  pi.registerTool({
    name: "computer_drag",
    label: "拖拽桌面",
    description: "从一个虚拟桌面坐标平滑拖拽到另一个坐标。",
    parameters: Type.Object({
      fromX: Type.Number(),
      fromY: Type.Number(),
      toX: Type.Number(),
      toY: Type.Number(),
      durationMs: Type.Optional(Type.Number({ minimum: 50, maximum: 5000 })),
      ...intent,
    }),
    executionMode: "sequential",
    execute: run("drag"),
  });

  pi.registerTool({
    name: "computer_wait",
    label: "等待界面",
    description: "等待桌面应用完成界面变化，最长 30 秒。",
    parameters: Type.Object({
      timeoutMs: Type.Optional(Type.Number({ minimum: 0, maximum: 30000 })),
    }),
    executionMode: "sequential",
    execute: run("wait"),
  });

  pi.registerTool({
    name: "computer_get_cursor_position",
    label: "读取鼠标位置",
    description: "读取鼠标当前在虚拟桌面中的绝对坐标。",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: run("get_cursor_position"),
  });
}
