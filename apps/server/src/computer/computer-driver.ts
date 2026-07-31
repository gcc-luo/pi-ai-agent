import path from "node:path";
import type { Key, Window } from "@nut-tree-fork/nut-js";
import type { ComputerAction } from "./computer-session-manager.js";

type SupportedPlatform = "win32" | "darwin" | "linux";

interface WindowRecord {
  id: string;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
}

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(["win32", "darwin", "linux"]);
const SELF_WINDOW_PATTERN = /PI AI Agent/i;
type ComputerApi = typeof import("@nut-tree-fork/nut-js");
let computerApi: Promise<ComputerApi> | null = null;

function loadComputerApi(): Promise<ComputerApi> {
  computerApi ??= import("@nut-tree-fork/nut-js");
  return computerApi;
}

export function isComputerPlatformSupported(
  platform: NodeJS.Platform = process.platform,
): platform is SupportedPlatform {
  return SUPPORTED_PLATFORMS.has(platform);
}

function windowId(window: Window): string {
  const handle = Reflect.get(window, "windowHandle") as unknown;
  if (typeof handle !== "number" || !Number.isFinite(handle)) {
    throw new Error("桌面驱动未返回有效的窗口 ID");
  }
  return String(handle);
}

async function describeWindow(window: Window): Promise<WindowRecord | null> {
  try {
    const [title, region] = await Promise.all([window.getTitle(), window.getRegion()]);
    if (!title.trim() || region.width <= 0 || region.height <= 0) return null;
    return {
      id: windowId(window),
      title,
      bounds: {
        x: region.left,
        y: region.top,
        width: region.width,
        height: region.height,
      },
    };
  } catch {
    return null;
  }
}

async function listWindowRecords(): Promise<Array<{ window: Window; record: WindowRecord }>> {
  const { getWindows } = await loadComputerApi();
  const windows = await getWindows();
  const records = await Promise.all(windows.map(async (window) => {
    const record = await describeWindow(window);
    return record ? { window, record } : null;
  }));
  const visible = records.filter((item): item is { window: Window; record: WindowRecord } => item !== null);
  if (process.platform === "darwin" && windows.length > 0 && visible.length === 0) {
    throw new Error("无法读取窗口信息，请在 macOS 系统设置中授予辅助功能和屏幕录制权限");
  }
  return visible;
}

async function resolveWindow(id: string): Promise<{ window: Window; record: WindowRecord }> {
  const match = (await listWindowRecords()).find(({ record }) => record.id === id);
  if (!match) throw new Error("目标窗口已关闭、不可见或窗口 ID 已失效");
  if (SELF_WINDOW_PATTERN.test(match.record.title)) {
    throw new Error("为防止递归误操作，Computer Use 不允许控制 PI AI Agent 自身窗口");
  }
  return match;
}

function isPointInBounds(
  point: { x: number; y: number },
  bounds: WindowRecord["bounds"],
): boolean {
  return point.x >= bounds.x
    && point.x < bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y < bounds.y + bounds.height;
}

async function screenBounds(): Promise<WindowRecord["bounds"]> {
  const { screen } = await loadComputerApi();
  const [width, height] = await Promise.all([screen.width(), screen.height()]);
  return { x: 0, y: 0, width, height };
}

async function assertScreenPoint(point: { x: number; y: number }): Promise<void> {
  if (!isPointInBounds(point, await screenBounds())) {
    throw new Error(`坐标 (${point.x}, ${point.y}) 超出桌面范围`);
  }
}

async function assertInputTarget(
  expectedWindowId: string,
  point?: { x: number; y: number },
): Promise<void> {
  const { getActiveWindow } = await loadComputerApi();
  const active = await getActiveWindow();
  const activeTitle = await active.getTitle();
  if (SELF_WINDOW_PATTERN.test(activeTitle)) {
    throw new Error("为防止递归误操作，Computer Use 不允许控制 PI AI Agent 自身窗口");
  }
  if (!expectedWindowId) return;

  const expected = await resolveWindow(expectedWindowId);
  if (windowId(active) !== expectedWindowId) {
    throw new Error("前台窗口已变化，操作已取消");
  }
  if (point && !isPointInBounds(point, expected.record.bounds)) {
    throw new Error("坐标不在目标窗口范围内");
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} 不能为空`);
  return value.trim();
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} 必须是有效数字`);
  return value;
}

const KEY_ALIASES: Readonly<Record<string, string>> = {
  alt: "LeftAlt",
  option: "LeftAlt",
  control: "LeftControl",
  ctrl: "LeftControl",
  shift: "LeftShift",
  command: "LeftSuper",
  cmd: "LeftSuper",
  meta: "LeftSuper",
  super: "LeftSuper",
  win: "LeftSuper",
  windows: "LeftSuper",
  esc: "Escape",
  spacebar: "Space",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  pgup: "PageUp",
  pgdn: "PageDown",
  del: "Delete",
  ins: "Insert",
};

function namedKey(name: string, keyEnum: typeof Key): Key {
  const normalized = name.trim().toLowerCase().replace(/[\s_-]/g, "");
  const numberMatch = /^(?:num)?([0-9])$/.exec(normalized);
  const functionMatch = /^f([1-9]|1[0-9]|2[0-4])$/.exec(normalized);
  const keyNames = new Map(
    Object.keys(keyEnum)
      .filter((keyName) => Number.isNaN(Number(keyName)))
      .map((keyName) => [keyName.toLowerCase(), keyName]),
  );
  const enumName = KEY_ALIASES[normalized]
    ?? (numberMatch ? `Num${numberMatch[1]}` : undefined)
    ?? (functionMatch ? `F${functionMatch[1]}` : undefined)
    ?? keyNames.get(normalized);
  const value = enumName === undefined ? undefined : keyEnum[enumName as keyof typeof Key];
  if (typeof value !== "number") throw new Error(`不支持的按键: ${name}`);
  return value;
}

export async function parseComputerKeyCombo(value: string): Promise<Key[]> {
  const names = value.split("+").map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) throw new Error("按键不能为空");
  const { Key: keyEnum } = await loadComputerApi();
  return names.map((name) => namedKey(name, keyEnum));
}

function abortError(): Error {
  return new Error("Computer Use 操作已中断");
}

async function abortableDelay(timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, timeoutMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function platformError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (process.platform === "darwin" && /permission|accessibility|screen recording|not authorized/i.test(message)) {
    return new Error(`macOS 拒绝了桌面控制，请在系统设置中授予辅助功能和屏幕录制权限：${message}`);
  }
  if (process.platform === "linux" && /display|x11|wayland|connection|shared object|dlopen/i.test(message)) {
    return new Error(`Linux 桌面会话不可用，请确认 DISPLAY/WAYLAND_DISPLAY 与桌面权限：${message}`);
  }
  return error instanceof Error ? error : new Error(message);
}

async function releaseInputs(): Promise<void> {
  const { Button, Key, keyboard, mouse } = await loadComputerApi();
  await Promise.allSettled([
    mouse.releaseButton(Button.LEFT),
    keyboard.releaseKey(
      Key.LeftControl,
      Key.LeftShift,
      Key.LeftAlt,
      Key.LeftSuper,
      Key.RightControl,
      Key.RightShift,
      Key.RightAlt,
      Key.RightSuper,
    ),
  ]);
}

export async function runComputerAction(
  action: ComputerAction | "release_inputs",
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!isComputerPlatformSupported()) {
    throw new Error(`Computer Use 不支持当前平台：${process.platform}`);
  }
  if (signal?.aborted) throw abortError();

  try {
    const {
      Button,
      FileType,
      Point,
      getActiveWindow,
      keyboard,
      mouse,
      screen,
    } = await loadComputerApi();
    mouse.config.autoDelayMs = 30;
    keyboard.config.autoDelayMs = 10;

    if (action === "release_inputs") {
      await releaseInputs();
      return { ok: true };
    }
    if (action === "list_windows") {
      const bounds = await screenBounds();
      const windows = (await listWindowRecords()).map(({ record }) => record);
      return { ok: true, windows, screen: bounds };
    }
    if (action === "focus_window") {
      const id = requiredString(args.windowId, "windowId");
      const target = await resolveWindow(id);
      await target.window.restore();
      const focused = await target.window.focus();
      if (!focused || windowId(await getActiveWindow()) !== id) {
        throw new Error("系统拒绝聚焦目标窗口");
      }
      return { ok: true, windowId: id };
    }
    if (action === "screenshot") {
      const outputPath = requiredString(args.path, "path");
      const parsed = path.parse(outputPath);
      const bounds = await screenBounds();
      let capture = bounds;
      let savedPath: string;
      if (typeof args.windowId === "string" && args.windowId.trim()) {
        const target = await resolveWindow(args.windowId.trim());
        capture = target.record.bounds;
        savedPath = await screen.captureRegion(
          parsed.name,
          await target.window.getRegion(),
          FileType.PNG,
          parsed.dir,
        );
      } else {
        savedPath = await screen.capture(parsed.name, FileType.PNG, parsed.dir);
      }
      return { ok: true, path: savedPath, screen: bounds, capture };
    }

    const expectedWindowId = typeof args.expectedWindowId === "string" ? args.expectedWindowId : "";
    if (action === "click" || action === "double_click") {
      const point = new Point(requiredNumber(args.x, "x"), requiredNumber(args.y, "y"));
      await assertScreenPoint(point);
      await assertInputTarget(expectedWindowId, point);
      await mouse.setPosition(point);
      if (action === "double_click") await mouse.doubleClick(Button.LEFT);
      else await mouse.click(Button.LEFT);
      return { ok: true, x: point.x, y: point.y };
    }
    if (action === "type") {
      const text = typeof args.text === "string" ? args.text : "";
      await assertInputTarget(expectedWindowId);
      await keyboard.type(text);
      return { ok: true, textLength: text.length };
    }
    if (action === "key") {
      const key = requiredString(args.key, "key");
      await assertInputTarget(expectedWindowId);
      await keyboard.type(...await parseComputerKeyCombo(key));
      return { ok: true, key };
    }
    if (action === "scroll") {
      const delta = requiredNumber(args.delta, "delta");
      await assertInputTarget(expectedWindowId);
      const steps = Math.max(1, Math.round(Math.abs(delta) / 120));
      if (delta >= 0) await mouse.scrollUp(steps);
      else await mouse.scrollDown(steps);
      return { ok: true, delta };
    }
    if (action === "drag") {
      const from = new Point(requiredNumber(args.fromX, "fromX"), requiredNumber(args.fromY, "fromY"));
      const to = new Point(requiredNumber(args.toX, "toX"), requiredNumber(args.toY, "toY"));
      const durationMs = requiredNumber(args.durationMs, "durationMs");
      await assertScreenPoint(from);
      await assertScreenPoint(to);
      await assertInputTarget(expectedWindowId, from);
      await assertInputTarget(expectedWindowId, to);
      await mouse.setPosition(from);
      await mouse.pressButton(Button.LEFT);
      try {
        const steps = Math.max(2, Math.min(60, Math.round(durationMs / 16)));
        for (let index = 1; index <= steps; index++) {
          await abortableDelay(Math.max(1, Math.round(durationMs / steps)), signal);
          if (index === 1 || index === steps || index % 6 === 0) {
            await assertInputTarget(expectedWindowId);
          }
          await mouse.setPosition(new Point(
            from.x + ((to.x - from.x) * index) / steps,
            from.y + ((to.y - from.y) * index) / steps,
          ));
        }
      } finally {
        await mouse.releaseButton(Button.LEFT);
      }
      return { ok: true, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y };
    }
    if (action === "get_cursor_position") {
      const [point, bounds] = await Promise.all([mouse.getPosition(), screenBounds()]);
      return { ok: true, x: point.x, y: point.y, screen: bounds };
    }
    throw new Error(`不支持的 Computer Use 操作: ${action}`);
  } catch (error) {
    throw platformError(error);
  }
}
