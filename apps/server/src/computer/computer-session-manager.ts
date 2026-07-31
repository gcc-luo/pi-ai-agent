import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { FastifyBaseLogger } from "fastify";
import type { ArtifactItem, PluginStatus } from "@pi-web-ui/shared";

export type ComputerAction =
  | "screenshot"
  | "list_windows"
  | "focus_window"
  | "click"
  | "double_click"
  | "type"
  | "key"
  | "scroll"
  | "drag"
  | "wait"
  | "get_cursor_position";

interface ComputerSessionState {
  sessionId: string;
  targetWindow: string | null;
  lastScreenshot: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  history: Array<{ action: ComputerAction; at: number; success: boolean }>;
  status: "enabled" | "starting" | "running" | "error";
  error: string | null;
}

export interface ComputerActionInput {
  sessionId: string;
  workdir: string;
  action: ComputerAction;
  args?: Record<string, unknown>;
  signal?: AbortSignal;
}

const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$piComputerReferences = @(
  [System.Windows.Forms.Form].Assembly.Location,
  [System.Drawing.Bitmap].Assembly.Location
)
Add-Type -ReferencedAssemblies $piComputerReferences -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public static class PiComputerNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags;
    public uint time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags;
    public uint time; public UIntPtr dwExtraInfo;
  }

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);

  public static object[] Windows() {
    var result = new List<object>();
    EnumWindows((handle, value) => {
      if (!IsWindowVisible(handle)) return true;
      int length = GetWindowTextLength(handle);
      if (length <= 0) return true;
      var title = new StringBuilder(length + 1);
      GetWindowText(handle, title, title.Capacity);
      RECT rect;
      if (!GetWindowRect(handle, out rect) || rect.Right <= rect.Left || rect.Bottom <= rect.Top) return true;
      uint pid;
      GetWindowThreadProcessId(handle, out pid);
      string process = "";
      try { process = Process.GetProcessById((int)pid).ProcessName; } catch {}
      result.Add(new {
        id = handle.ToInt64().ToString(),
        title = title.ToString(),
        process,
        processId = pid,
        bounds = new { x = rect.Left, y = rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top }
      });
      return true;
    }, IntPtr.Zero);
    return result.ToArray();
  }

  public static object ForegroundWindow() {
    IntPtr handle = GetForegroundWindow();
    int length = GetWindowTextLength(handle);
    var title = new StringBuilder(Math.Max(1, length + 1));
    GetWindowText(handle, title, title.Capacity);
    uint pid;
    GetWindowThreadProcessId(handle, out pid);
    string process = "";
    try { process = Process.GetProcessById((int)pid).ProcessName; } catch {}
    return new { id = handle.ToInt64().ToString(), title = title.ToString(), process, processId = pid };
  }

  public static RECT WindowRect(string id) {
    var handle = new IntPtr(long.Parse(id));
    RECT rect;
    if (!GetWindowRect(handle, out rect)) throw new InvalidOperationException("无法读取窗口边界");
    return rect;
  }

  public static void Focus(string id) {
    var handle = new IntPtr(long.Parse(id));
    ValidateWindow(handle, false, null, null);
    uint targetPid;
    uint targetThread = GetWindowThreadProcessId(handle, out targetPid);
    uint currentThread = GetCurrentThreadId();
    bool attached = targetThread != 0 && targetThread != currentThread
      && AttachThreadInput(currentThread, targetThread, true);
    ShowWindow(handle, 9);
    bool focused = SetForegroundWindow(handle);
    BringWindowToTop(handle);
    SetFocus(handle);
    if (attached) AttachThreadInput(currentThread, targetThread, false);
    if (!focused && GetForegroundWindow() != handle) throw new InvalidOperationException("系统拒绝聚焦目标窗口");
  }

  private static void ValidateWindow(IntPtr handle, bool requireForeground, int? x, int? y) {
    if (handle == IntPtr.Zero || !IsWindow(handle) || !IsWindowVisible(handle)) {
      throw new InvalidOperationException("目标窗口已关闭或不可见");
    }
    int length = GetWindowTextLength(handle);
    var title = new StringBuilder(Math.Max(1, length + 1));
    GetWindowText(handle, title, title.Capacity);
    if (title.ToString().IndexOf("PI AI Agent", StringComparison.OrdinalIgnoreCase) >= 0) {
      throw new InvalidOperationException("为防止递归误操作，Computer Use 不允许控制 PI AI Agent 自身窗口");
    }
    if (requireForeground && GetForegroundWindow() != handle) {
      throw new InvalidOperationException("前台窗口已变化，操作已取消");
    }
    if (x.HasValue && y.HasValue) {
      RECT rect;
      if (!GetWindowRect(handle, out rect)
        || x.Value < rect.Left || x.Value >= rect.Right
        || y.Value < rect.Top || y.Value >= rect.Bottom) {
        throw new InvalidOperationException("坐标不在目标窗口范围内");
      }
    }
  }

  private static IntPtr InputTarget(string expectedWindowId, int? x, int? y) {
    IntPtr handle = String.IsNullOrWhiteSpace(expectedWindowId)
      ? GetForegroundWindow()
      : new IntPtr(long.Parse(expectedWindowId));
    ValidateWindow(handle, true, x, y);
    return handle;
  }

  public static void Click(string expectedWindowId, int x, int y, bool twice) {
    InputTarget(expectedWindowId, x, y);
    if (!SetCursorPos(x, y)) throw new InvalidOperationException("无法移动鼠标");
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    if (twice) {
      System.Threading.Thread.Sleep(80);
      mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
      mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    }
  }

  public static void Scroll(string expectedWindowId, int delta) {
    InputTarget(expectedWindowId, null, null);
    mouse_event(0x0800, 0, 0, delta, UIntPtr.Zero);
  }

  public static void Drag(string expectedWindowId, int fromX, int fromY, int toX, int toY, int durationMs) {
    InputTarget(expectedWindowId, fromX, fromY);
    InputTarget(expectedWindowId, toX, toY);
    SetCursorPos(fromX, fromY);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    try {
      int steps = Math.Max(2, Math.Min(60, durationMs / 16));
      for (int i = 1; i <= steps; i++) {
        InputTarget(expectedWindowId, null, null);
        SetCursorPos(fromX + (toX - fromX) * i / steps, fromY + (toY - fromY) * i / steps);
        System.Threading.Thread.Sleep(Math.Max(1, durationMs / steps));
      }
    } finally {
      mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    }
  }

  public static void TypeText(string expectedWindowId, string value) {
    InputTarget(expectedWindowId, null, null);
    foreach (char character in value) {
      var down = new INPUT { type = 1, U = new InputUnion { ki = new KEYBDINPUT { wScan = character, dwFlags = 0x0004 } } };
      var up = new INPUT { type = 1, U = new InputUnion { ki = new KEYBDINPUT { wScan = character, dwFlags = 0x0004 | 0x0002 } } };
      var inputs = new INPUT[] { down, up };
      if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2) throw new InvalidOperationException("键盘输入失败");
    }
  }

  private static byte KeyCode(string name) {
    string normalized = name.Trim().Replace("Ctrl", "Control").Replace("Cmd", "LWin").Replace("Meta", "LWin");
    if (normalized.Equals("Control", StringComparison.OrdinalIgnoreCase)) return 0x11;
    if (normalized.Equals("Shift", StringComparison.OrdinalIgnoreCase)) return 0x10;
    if (normalized.Equals("Alt", StringComparison.OrdinalIgnoreCase)) return 0x12;
    if (normalized.Equals("LWin", StringComparison.OrdinalIgnoreCase)
      || normalized.Equals("Win", StringComparison.OrdinalIgnoreCase)) return 0x5B;
    Keys key;
    if (!Enum.TryParse<Keys>(normalized, true, out key)) throw new ArgumentException("不支持的按键: " + name);
    return (byte)key;
  }

  public static void Key(string expectedWindowId, string combo) {
    InputTarget(expectedWindowId, null, null);
    string[] names = combo.Split(new char[] {'+'}, StringSplitOptions.RemoveEmptyEntries);
    if (names.Length == 0) throw new ArgumentException("按键不能为空");
    var codes = new List<byte>();
    foreach (string name in names) codes.Add(KeyCode(name));
    foreach (byte code in codes) keybd_event(code, 0, 0, UIntPtr.Zero);
    for (int i = codes.Count - 1; i >= 0; i--) keybd_event(codes[i], 0, 0x0002, UIntPtr.Zero);
  }

  public static void ReleaseInputs() {
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    foreach (byte code in new byte[] { 0x11, 0x10, 0x12, 0x5B, 0x5C }) {
      keybd_event(code, 0, 0x0002, UIntPtr.Zero);
    }
  }
}
'@

$action = $env:PI_COMPUTER_ACTION
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:PI_COMPUTER_ARGS_BASE64))
$inputArgs = $json | ConvertFrom-Json
$virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen

function Assert-Point([int]$x, [int]$y) {
  if ($x -lt $virtual.Left -or $x -ge $virtual.Right -or $y -lt $virtual.Top -or $y -ge $virtual.Bottom) {
    throw "坐标 ($x, $y) 超出虚拟桌面范围"
  }
}

$result = switch ($action) {
  "list_windows" {
    @{ ok = $true; windows = [PiComputerNative]::Windows(); screen = @{ x = $virtual.Left; y = $virtual.Top; width = $virtual.Width; height = $virtual.Height } }
  }
  "foreground_window" {
    @{ ok = $true; window = [PiComputerNative]::ForegroundWindow() }
  }
  "focus_window" {
    [PiComputerNative]::Focus([string]$inputArgs.windowId)
    @{ ok = $true; windowId = [string]$inputArgs.windowId }
  }
  "screenshot" {
    $capture = $virtual
    if ($inputArgs.windowId) {
      $rect = [PiComputerNative]::WindowRect([string]$inputArgs.windowId)
      $capture = New-Object System.Drawing.Rectangle($rect.Left, $rect.Top, ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
    }
    $bitmap = New-Object System.Drawing.Bitmap($capture.Width, $capture.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($capture.Left, $capture.Top, 0, 0, $capture.Size)
      $bitmap.Save([string]$inputArgs.path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
    @{ ok = $true; path = [string]$inputArgs.path; screen = @{ x = $virtual.Left; y = $virtual.Top; width = $virtual.Width; height = $virtual.Height }; capture = @{ x = $capture.Left; y = $capture.Top; width = $capture.Width; height = $capture.Height } }
  }
  "click" {
    Assert-Point ([int]$inputArgs.x) ([int]$inputArgs.y)
    [PiComputerNative]::Click([string]$inputArgs.expectedWindowId, [int]$inputArgs.x, [int]$inputArgs.y, $false)
    @{ ok = $true; x = [int]$inputArgs.x; y = [int]$inputArgs.y }
  }
  "double_click" {
    Assert-Point ([int]$inputArgs.x) ([int]$inputArgs.y)
    [PiComputerNative]::Click([string]$inputArgs.expectedWindowId, [int]$inputArgs.x, [int]$inputArgs.y, $true)
    @{ ok = $true; x = [int]$inputArgs.x; y = [int]$inputArgs.y }
  }
  "type" {
    [PiComputerNative]::TypeText([string]$inputArgs.expectedWindowId, [string]$inputArgs.text)
    @{ ok = $true; textLength = ([string]$inputArgs.text).Length }
  }
  "key" {
    [PiComputerNative]::Key([string]$inputArgs.expectedWindowId, [string]$inputArgs.key)
    @{ ok = $true; key = [string]$inputArgs.key }
  }
  "scroll" {
    [PiComputerNative]::Scroll([string]$inputArgs.expectedWindowId, [int]$inputArgs.delta)
    @{ ok = $true; delta = [int]$inputArgs.delta }
  }
  "drag" {
    Assert-Point ([int]$inputArgs.fromX) ([int]$inputArgs.fromY)
    Assert-Point ([int]$inputArgs.toX) ([int]$inputArgs.toY)
    [PiComputerNative]::Drag([string]$inputArgs.expectedWindowId, [int]$inputArgs.fromX, [int]$inputArgs.fromY, [int]$inputArgs.toX, [int]$inputArgs.toY, [int]$inputArgs.durationMs)
    @{ ok = $true; fromX = [int]$inputArgs.fromX; fromY = [int]$inputArgs.fromY; toX = [int]$inputArgs.toX; toY = [int]$inputArgs.toY }
  }
  "get_cursor_position" {
    $point = New-Object PiComputerNative+POINT
    if (-not [PiComputerNative]::GetCursorPos([ref]$point)) { throw "无法读取鼠标位置" }
    @{ ok = $true; x = $point.X; y = $point.Y; screen = @{ x = $virtual.Left; y = $virtual.Top; width = $virtual.Width; height = $virtual.Height } }
  }
  "release_inputs" {
    [PiComputerNative]::ReleaseInputs()
    @{ ok = $true }
  }
  default { throw "不支持的 Computer Use 操作: $action" }
}
$result | ConvertTo-Json -Depth 8 -Compress
`;

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 120);
  return cleaned || `desktop-${Date.now()}.png`;
}

function asFiniteNumber(value: unknown, name: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} 必须是有效数字`);
  }
  return value;
}

export function computerRisk(
  action: ComputerAction,
  args: Record<string, unknown>,
): { level: "normal" | "sensitive" | "destructive"; reason: string | null } {
  const intent = typeof args.intent === "string" ? args.intent.toLowerCase() : "";
  const key = typeof args.key === "string" ? args.key.toLowerCase() : "";
  const destructive = /\b(delete|remove|erase|destroy|shutdown|format|overwrite)\b|删除|移除|清空|关机|覆盖|格式化/;
  const sensitive = /\b(send|submit|publish|pay|purchase|transfer|upload|password|permission|save)\b|发送|提交|发布|支付|购买|转账|上传|密码|权限|保存/;
  if (destructive.test(intent) || /alt\+f4|shift\+delete/.test(key)) {
    return { level: "destructive", reason: "该桌面操作可能删除、覆盖或关闭重要内容" };
  }
  if (sensitive.test(intent)) {
    return { level: "sensitive", reason: "该桌面操作可能提交、发送或处理敏感内容" };
  }
  if (action === "key" && /delete|enter/.test(key) && intent) {
    return { level: "sensitive", reason: "该按键可能触发提交或删除" };
  }
  return { level: "normal", reason: null };
}

export class ComputerSessionManager {
  private readonly sessions = new Map<string, ComputerSessionState>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly activeChildren = new Map<ReturnType<typeof spawn>, string>();
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly sessionGenerations = new Map<string, number>();
  private generation = 0;

  constructor(private readonly log: FastifyBaseLogger) {}

  available(): { available: boolean; error: string | null } {
    return process.platform === "win32"
      ? { available: true, error: null }
      : { available: false, error: "Computer Use 第一版仅支持 Windows" };
  }

  runtimeStatus(): { status: PluginStatus; error: string | null } {
    const availability = this.available();
    if (!availability.available) return { status: "unavailable", error: availability.error };
    const states = [...this.sessions.values()];
    if (states.some((state) => state.status === "starting")) return { status: "starting", error: null };
    if (states.some((state) => state.status === "running")) return { status: "running", error: null };
    const failed = states.find((state) => state.status === "error");
    return failed
      ? { status: "error", error: failed.error }
      : { status: "enabled", error: null };
  }

  sessionStatus(sessionId: string): ComputerSessionState | null {
    return this.sessions.get(sessionId) ?? null;
  }

  async execute(input: ComputerActionInput): Promise<Record<string, unknown>> {
    const generation = this.generation;
    const sessionGeneration = this.sessionGenerations.get(input.sessionId) ?? 0;
    const current = this.queue.catch(() => undefined).then(() => {
      if (
        generation !== this.generation
        || sessionGeneration !== (this.sessionGenerations.get(input.sessionId) ?? 0)
      ) {
        throw new Error("Computer Use 会话已被释放");
      }
      if (input.signal?.aborted) throw new Error("Computer Use 操作已中断");
      const controller = new AbortController();
      const abort = () => controller.abort();
      input.signal?.addEventListener("abort", abort, { once: true });
      this.activeControllers.set(input.sessionId, controller);
      return this.executeUnlocked({ ...input, signal: controller.signal }).finally(() => {
        input.signal?.removeEventListener("abort", abort);
        if (this.activeControllers.get(input.sessionId) === controller) {
          this.activeControllers.delete(input.sessionId);
        }
      });
    });
    this.queue = current;
    return current;
  }

  closeSession(sessionId: string): void {
    this.sessionGenerations.set(
      sessionId,
      (this.sessionGenerations.get(sessionId) ?? 0) + 1,
    );
    this.activeControllers.get(sessionId)?.abort();
    for (const [child, childSessionId] of this.activeChildren) {
      if (childSessionId === sessionId) child.kill();
    }
    this.sessions.delete(sessionId);
  }

  async shutdown(): Promise<void> {
    this.generation++;
    for (const controller of this.activeControllers.values()) controller.abort();
    this.activeControllers.clear();
    this.sessions.clear();
    for (const child of this.activeChildren.keys()) child.kill();
    this.activeChildren.clear();
    await this.queue.catch(() => undefined);
  }

  private async executeUnlocked(input: ComputerActionInput): Promise<Record<string, unknown>> {
    const availability = this.available();
    if (!availability.available) throw new Error(availability.error!);
    const state = this.sessions.get(input.sessionId) ?? {
      sessionId: input.sessionId,
      targetWindow: null,
      lastScreenshot: null,
      screenWidth: null,
      screenHeight: null,
      history: [],
      status: "enabled" as const,
      error: null,
    };
    this.sessions.set(input.sessionId, state);
    state.status = "starting";
    state.error = null;
    const args = { ...(input.args ?? {}) };
    try {
      if (input.signal?.aborted) throw new Error("Computer Use 操作已中断");
      let result: Record<string, unknown>;
      if (input.action === "wait") {
        const timeoutMs = Math.max(0, Math.min(
          asFiniteNumber(args.timeoutMs, "timeoutMs", 1_000),
          30_000,
        ));
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, timeoutMs);
          input.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Computer Use 操作已中断"));
          }, { once: true });
        });
        result = { ok: true, waitedMs: timeoutMs };
      } else {
        if (input.action === "screenshot") {
          const directory = path.resolve(input.workdir, "computer", "screenshots");
          const root = path.resolve(input.workdir);
          const relative = path.relative(root, directory);
          if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error("Computer Use 产物目录超出工作空间");
          }
          await fs.mkdir(directory, { recursive: true });
          const requested = typeof args.name === "string" && args.name.trim()
            ? args.name.trim()
            : `desktop-${Date.now()}.png`;
          const filename = safeFileName(requested.toLowerCase().endsWith(".png") ? requested : `${requested}.png`);
          args.path = path.join(directory, filename);
        }
        if (input.action === "drag") {
          args.durationMs = Math.max(50, Math.min(
            asFiniteNumber(args.durationMs, "durationMs", 500),
            5_000,
          ));
        }
        if (input.action === "scroll") {
          args.delta = asFiniteNumber(args.delta, "delta", -360);
        }
        if (new Set<ComputerAction>([
          "click", "double_click", "type", "key", "scroll", "drag",
        ]).has(input.action)) {
          args.expectedWindowId = state.targetWindow ?? "";
        }
        result = await this.runPowerShell(
          input.action,
          args,
          input.signal,
          input.sessionId,
        );
      }

      if (input.action === "focus_window") state.targetWindow = String(args.windowId);
      const screen = result.screen as { width?: unknown; height?: unknown } | undefined;
      if (typeof screen?.width === "number") state.screenWidth = screen.width;
      if (typeof screen?.height === "number") state.screenHeight = screen.height;
      if (input.action === "screenshot" && typeof result.path === "string") {
        state.lastScreenshot = result.path;
        const artifact: ArtifactItem & { absolutePath: string } = {
          path: path.relative(input.workdir, result.path).replaceAll("\\", "/"),
          name: path.basename(result.path),
          mimeType: "image/png",
          absolutePath: result.path,
        };
        result = { ...result, artifact };
      }
      state.status = "running";
      state.history.push({ action: input.action, at: Date.now(), success: true });
      if (state.history.length > 100) state.history.shift();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.status = "error";
      state.error = message;
      state.history.push({ action: input.action, at: Date.now(), success: false });
      this.log.error({ sessionId: input.sessionId, action: input.action, err: message }, "computer action failed");
      throw error;
    }
  }

  private runPowerShell(
    action: ComputerAction | "release_inputs",
    args: Record<string, unknown>,
    signal?: AbortSignal,
    sessionId = "__runtime",
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Computer Use 操作已中断"));
        return;
      }
      const child = spawn(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", POWERSHELL_SCRIPT],
        {
          windowsHide: true,
          env: {
            ...process.env,
            PI_COMPUTER_ACTION: action,
            PI_COMPUTER_ARGS_BASE64: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      this.activeChildren.set(child, sessionId);
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      const abort = () => child.kill();
      signal?.addEventListener("abort", abort, { once: true });
      child.once("error", (error) => {
        this.activeChildren.delete(child);
        reject(error);
      });
      child.once("exit", (code) => {
        this.activeChildren.delete(child);
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) {
          if (action !== "release_inputs") {
            void this.runPowerShell("release_inputs", {}, undefined, "__recovery").catch((error) => {
              this.log.warn({ err: error }, "failed to release interrupted computer inputs");
            });
          }
          reject(new Error("Computer Use 操作已中断"));
          return;
        }
        if (code !== 0) {
          reject(new Error(stderr.trim() || `PowerShell 操作失败（退出码 ${code}）`));
          return;
        }
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
        if (!line) {
          reject(new Error("Computer Use 未返回结果"));
          return;
        }
        try {
          resolve(JSON.parse(line) as Record<string, unknown>);
        } catch {
          reject(new Error(`Computer Use 返回了无效结果：${line.slice(0, 200)}`));
        }
      });
    });
  }
}
