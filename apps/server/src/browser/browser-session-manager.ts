import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Download,
  type Locator,
  type Page,
  type Response,
} from "playwright";
import type {
  ArtifactItem,
  BrowserCapabilityDto,
  PluginStatus,
} from "@pi-web-ui/shared";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_LOG_ENTRIES = 100;
const MAX_SNAPSHOT_ELEMENTS = 120;
const REF_ATTRIBUTE = "data-pi-browser-ref";

type BrowserAction =
  | "open"
  | "navigate"
  | "snapshot"
  | "click"
  | "fill"
  | "select"
  | "press"
  | "hover"
  | "scroll"
  | "wait"
  | "tabs"
  | "screenshot"
  | "console_errors"
  | "network_errors"
  | "close";

interface BrowserLogEntry {
  type: string;
  message: string;
  url?: string;
  timestamp: number;
}

interface BrowserArtifact extends ArtifactItem {
  absolutePath: string;
  createdAt: number;
  sessionId: string;
}

interface ManagedBrowserSession {
  sessionId: string;
  workdir: string;
  browser: Browser;
  context: BrowserContext;
  currentPage: Page;
  consoleErrors: BrowserLogEntry[];
  networkErrors: BrowserLogEntry[];
  downloads: BrowserArtifact[];
  status: "running" | "error" | "closed";
  error: string | null;
}

export interface BrowserSessionManagerOptions {
  logger: FastifyBaseLogger;
  headless?: boolean;
  launch?: typeof chromium.launch;
}

export interface BrowserActionInput {
  sessionId: string;
  workdir: string;
  action: BrowserAction;
  args?: Record<string, unknown>;
  signal?: AbortSignal;
}

function asString(value: unknown, name: string, required = false): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (required) throw new Error(`${name} 必须是非空字符串`);
  return undefined;
}

function asNumber(value: unknown, name: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} 必须是有效数字`);
  }
  return value;
}

function clampTimeout(value: unknown): number {
  const timeout = value === undefined
    ? DEFAULT_TIMEOUT_MS
    : asNumber(value, "timeoutMs");
  return Math.max(0, Math.min(timeout, MAX_TIMEOUT_MS));
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split("\n")[0] ?? "浏览器操作失败";
  }
  return String(error);
}

function validateUrl(raw: unknown): string {
  const value = asString(raw, "url", true)!;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`无效 URL：${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`不允许访问 ${parsed.protocol} 协议，仅支持 http 和 https`);
  }
  return parsed.toString();
}

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 120);
  return cleaned || "download";
}

function mimeForFile(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const known: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".zip": "application/zip",
  };
  return known[ext] ?? "application/octet-stream";
}

function pushUnique(target: BrowserLogEntry[], entry: BrowserLogEntry): void {
  const key = `${entry.type}\u0000${entry.message}\u0000${entry.url ?? ""}`;
  const duplicate = target.some(
    (item) => `${item.type}\u0000${item.message}\u0000${item.url ?? ""}` === key,
  );
  if (!duplicate) target.push(entry);
  if (target.length > MAX_LOG_ENTRIES) {
    target.splice(0, target.length - MAX_LOG_ENTRIES);
  }
}

function dangerousActionReason(summary: string): string | null {
  const normalized = summary.toLowerCase();
  const patterns: [RegExp, string][] = [
    [/\b(delete|remove|erase|destroy|revoke)\b|删除|移除|注销|撤销权限/, "删除或撤销操作"],
    [/\b(send|submit|publish|post|share)\b|发送|提交|发布|分享/, "提交或发布操作"],
    [/\b(pay|purchase|buy|checkout|transfer|order)\b|支付|购买|结账|转账|下单/, "支付或交易操作"],
    [/\b(upload|invite|grant|authorize)\b|上传|邀请|授权|授予/, "上传或权限操作"],
  ];
  return patterns.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

export class BrowserSessionManager {
  private readonly sessions = new Map<string, ManagedBrowserSession>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly log: FastifyBaseLogger;
  private readonly headless: boolean;
  private readonly launch: typeof chromium.launch;
  private readonly starting = new Set<string>();
  private readonly startupErrors = new Map<string, string>();
  private readonly downloadTasks = new WeakMap<Download, Promise<BrowserArtifact>>();

  constructor(options: BrowserSessionManagerOptions) {
    this.log = options.logger;
    this.headless = options.headless ?? process.env.PI_BROWSER_HEADLESS === "true";
    this.launch = options.launch ?? chromium.launch.bind(chromium);
  }

  status(sessionId: string, enabled: boolean): BrowserCapabilityDto {
    if (!enabled) {
      return {
        enabled: false,
        status: "disabled",
        pageCount: 0,
        currentUrl: null,
        error: null,
      };
    }
    if (this.starting.has(sessionId)) {
      return {
        enabled: true,
        status: "starting",
        pageCount: 0,
        currentUrl: null,
        error: null,
      };
    }
    const state = this.sessions.get(sessionId);
    if (state) {
      return {
        enabled: true,
        status: state.status,
        pageCount: state.context.pages().length,
        currentUrl: state.currentPage.isClosed() ? null : state.currentPage.url(),
        error: state.error,
      };
    }
    const startupError = this.startupErrors.get(sessionId);
    return {
      enabled: true,
      status: startupError ? "error" : "closed",
      pageCount: 0,
      currentUrl: null,
      error: startupError ?? null,
    };
  }

  runtimeStatus(): { status: PluginStatus; error: string | null } {
    if (this.starting.size > 0) return { status: "starting", error: null };
    if (this.sessions.size > 0) return { status: "running", error: null };
    const error = this.startupErrors.values().next().value as string | undefined;
    return error
      ? { status: "error", error }
      : { status: "enabled", error: null };
  }

  async open(sessionId: string, workdir: string): Promise<BrowserCapabilityDto> {
    return this.exclusive(sessionId, async () => {
      await this.openUnlocked(sessionId, workdir);
      return this.status(sessionId, true);
    });
  }

  async close(sessionId: string): Promise<void> {
    await this.exclusive(sessionId, () => this.closeUnlocked(sessionId));
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.sessions.keys()].map((id) => this.close(id)));
    this.sessions.clear();
    this.queues.clear();
    this.startupErrors.clear();
  }

  async execute(input: BrowserActionInput): Promise<Record<string, unknown>> {
    return this.exclusive(input.sessionId, async () => {
      const args = input.args ?? {};
      if (input.action === "close") {
        await this.closeUnlocked(input.sessionId);
        return { ok: true, status: "closed" };
      }

      const state = await this.openUnlocked(input.sessionId, input.workdir);
      const abort = () => {
        void state.browser.close().catch(() => undefined);
      };
      input.signal?.addEventListener("abort", abort, { once: true });
      try {
        switch (input.action) {
          case "open":
            return await this.pageInfo(state);
          case "navigate":
            return await this.navigate(state, args);
          case "snapshot":
            return await this.snapshot(state);
          case "click":
            return await this.click(state, args);
          case "fill":
            return await this.fill(state, args);
          case "select":
            return await this.select(state, args);
          case "press":
            return await this.press(state, args);
          case "hover":
            return await this.hover(state, args);
          case "scroll":
            return await this.scroll(state, args);
          case "wait":
            return await this.wait(state, args);
          case "tabs":
            return await this.tabs(state, args);
          case "screenshot":
            return await this.screenshot(state, args);
          case "console_errors":
            return { ok: true, errors: state.consoleErrors };
          case "network_errors":
            return { ok: true, errors: state.networkErrors };
        }
      } catch (error) {
        const message = normalizeError(error);
        throw new Error(
          `${message}（当前页面：${state.currentPage.url()}）。如页面已变化，请重新调用 browser_snapshot。`,
        );
      } finally {
        input.signal?.removeEventListener("abort", abort);
      }
    });
  }

  private async exclusive<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.queues.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(sessionId) === current) this.queues.delete(sessionId);
    }
  }

  private async openUnlocked(
    sessionId: string,
    workdir: string,
  ): Promise<ManagedBrowserSession> {
    const existing = this.sessions.get(sessionId);
    if (existing && existing.browser.isConnected() && !existing.currentPage.isClosed()) {
      return existing;
    }
    if (existing) await this.closeUnlocked(sessionId);

    this.starting.add(sessionId);
    this.startupErrors.delete(sessionId);
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    try {
      browser = await this.launch({ headless: this.headless });
      const downloadDir = this.artifactDirectory(workdir, "downloads");
      await fs.mkdir(downloadDir, { recursive: true });
      context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 900 },
      });
      context.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
      context.setDefaultNavigationTimeout(MAX_TIMEOUT_MS);
      const page = await context.newPage();
      const state: ManagedBrowserSession = {
        sessionId,
        workdir: path.resolve(workdir),
        browser,
        context,
        currentPage: page,
        consoleErrors: [],
        networkErrors: [],
        downloads: [],
        status: "running",
        error: null,
      };
      this.sessions.set(sessionId, state);
      this.attachContextEvents(state);
      browser.on("disconnected", () => {
        if (this.sessions.get(sessionId) !== state) return;
        state.status = "error";
        state.error = "Chromium 已意外退出，可再次调用 browser_open 恢复";
        this.sessions.delete(sessionId);
        this.startupErrors.set(sessionId, state.error);
      });
      this.log.info({ sessionId, headless: this.headless }, "browser session started");
      return state;
    } catch (error) {
      const message = normalizeError(error);
      await Promise.allSettled([
        context?.close(),
        browser?.close(),
      ].filter((operation): operation is Promise<void> => operation !== undefined));
      this.startupErrors.set(sessionId, message);
      this.log.error({ sessionId, err: message }, "browser session failed to start");
      throw new Error(`浏览器启动失败：${message}`);
    } finally {
      this.starting.delete(sessionId);
    }
  }

  private async closeUnlocked(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    this.startupErrors.delete(sessionId);
    if (!state) return;
    state.status = "closed";
    state.error = null;
    try {
      await state.context.close();
    } catch {
      // Browser may already have exited.
    }
    try {
      await state.browser.close();
    } catch {
      // Best-effort cleanup.
    }
    this.log.info({ sessionId }, "browser session closed");
  }

  private attachContextEvents(state: ManagedBrowserSession): void {
    state.context.on("page", (page) => {
      state.currentPage = page;
      this.attachPageEvents(state, page);
    });
    for (const page of state.context.pages()) this.attachPageEvents(state, page);
  }

  private attachPageEvents(state: ManagedBrowserSession, page: Page): void {
    page.on("console", (message: ConsoleMessage) => {
      if (message.type() !== "error") return;
      pushUnique(state.consoleErrors, {
        type: "console.error",
        message: message.text(),
        url: page.url(),
        timestamp: Date.now(),
      });
    });
    page.on("pageerror", (error) => {
      pushUnique(state.consoleErrors, {
        type: "pageerror",
        message: error.message,
        url: page.url(),
        timestamp: Date.now(),
      });
    });
    page.on("requestfailed", (request) => {
      pushUnique(state.networkErrors, {
        type: "requestfailed",
        message: request.failure()?.errorText ?? "请求失败",
        url: request.url(),
        timestamp: Date.now(),
      });
    });
    page.on("response", (response: Response) => {
      if (response.status() < 400) return;
      pushUnique(state.networkErrors, {
        type: `http_${response.status()}`,
        message: `${response.status()} ${response.statusText()}`,
        url: response.url(),
        timestamp: Date.now(),
      });
    });
    page.on("download", (download) => {
      void this.queueDownload(state, download).catch((error) => {
        pushUnique(state.networkErrors, {
          type: "download",
          message: normalizeError(error),
          url: page.url(),
          timestamp: Date.now(),
        });
      });
    });
  }

  private queueDownload(
    state: ManagedBrowserSession,
    download: Download,
  ): Promise<BrowserArtifact> {
    const existing = this.downloadTasks.get(download);
    if (existing) return existing;
    const task = this.saveDownload(state, download);
    this.downloadTasks.set(download, task);
    return task;
  }

  private async saveDownload(
    state: ManagedBrowserSession,
    download: Download,
  ): Promise<BrowserArtifact> {
    const directory = this.artifactDirectory(state.workdir, "downloads");
    await fs.mkdir(directory, { recursive: true });
    const suggested = safeFileName(download.suggestedFilename());
    const filename = `${Date.now()}-${suggested}`;
    const absolutePath = path.join(directory, filename);
    await download.saveAs(absolutePath);
    const relativePath = path.relative(state.workdir, absolutePath).replaceAll("\\", "/");
    const artifact: BrowserArtifact = {
      path: relativePath,
      name: filename,
      mimeType: mimeForFile(filename),
      absolutePath,
      createdAt: Date.now(),
      sessionId: state.sessionId,
    };
    state.downloads.push(artifact);
    return artifact;
  }

  private async pageInfo(state: ManagedBrowserSession): Promise<Record<string, unknown>> {
    return {
      ok: true,
      status: "running",
      title: await state.currentPage.title(),
      url: state.currentPage.url(),
      pageCount: state.context.pages().length,
    };
  }

  private async navigate(
    state: ManagedBrowserSession,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = validateUrl(args.url);
    const timeout = clampTimeout(args.timeoutMs);
    const response = await state.currentPage.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });
    return {
      ok: true,
      title: await state.currentPage.title(),
      url: state.currentPage.url(),
      loadState: "domcontentloaded",
      status: response?.status() ?? null,
    };
  }

  private async snapshot(state: ManagedBrowserSession): Promise<Record<string, unknown>> {
    const page = state.currentPage;
    await page.locator(`[${REF_ATTRIBUTE}]`).evaluateAll((elements, attribute) => {
      for (const element of elements) element.removeAttribute(attribute);
    }, REF_ATTRIBUTE);

    const candidates = page.locator([
      "a",
      "button",
      "input",
      "textarea",
      "select",
      "summary",
      "[role]",
      "[contenteditable='true']",
      "[tabindex]:not([tabindex='-1'])",
    ].join(","));
    const count = Math.min(await candidates.count(), MAX_SNAPSHOT_ELEMENTS * 3);
    const elements: Record<string, unknown>[] = [];
    for (let index = 0; index < count && elements.length < MAX_SNAPSHOT_ELEMENTS; index++) {
      const locator = candidates.nth(index);
      if (!await locator.isVisible().catch(() => false)) continue;
      const ref = `e${elements.length + 1}`;
      const info = await locator.evaluate((element, input) => {
        const html = element as HTMLElement;
        const field = element as HTMLInputElement;
        const tag = html.tagName.toLowerCase();
        const inputType = html.getAttribute("type")?.toLowerCase();
        const implicitRole =
          tag === "a" && html.hasAttribute("href") ? "link"
            : tag === "button" || tag === "summary" ? "button"
              : tag === "select" ? "combobox"
                : tag === "textarea" ? "textbox"
                  : tag === "input" && inputType === "checkbox" ? "checkbox"
                    : tag === "input" && inputType === "radio" ? "radio"
                      : tag === "input" && ["button", "submit", "reset"].includes(inputType ?? "") ? "button"
                        : tag === "input" ? "textbox"
                          : tag;
        const labels = "labels" in field && field.labels
          ? [...field.labels].map((label) => label.textContent?.trim()).filter(Boolean).join(" ")
          : "";
        html.setAttribute(input.attribute, input.ref);
        const rawText = html.innerText || html.textContent || "";
        return {
          ref: input.ref,
          tag,
          role: html.getAttribute("role") || implicitRole,
          name: html.getAttribute("aria-label") || labels || rawText.trim().replace(/\s+/g, " ").slice(0, 160),
          placeholder: html.getAttribute("placeholder"),
          type: html.getAttribute("type"),
          disabled: "disabled" in field ? Boolean(field.disabled) : html.getAttribute("aria-disabled") === "true",
          checked: "checked" in field ? Boolean(field.checked) : html.getAttribute("aria-checked"),
          value: "value" in field ? String(field.value).slice(0, 160) : undefined,
        };
      }, { attribute: REF_ATTRIBUTE, ref });
      elements.push(info);
    }
    return {
      ok: true,
      title: await page.title(),
      url: page.url(),
      elements,
      truncated: count > elements.length && elements.length >= MAX_SNAPSHOT_ELEMENTS,
    };
  }

  private resolveLocator(page: Page, args: Record<string, unknown>): Locator {
    const ref = asString(args.ref, "ref");
    if (ref) {
      if (!/^e\d+$/.test(ref)) throw new Error("ref 格式无效");
      return page.locator(`[${REF_ATTRIBUTE}="${ref}"]`);
    }
    const role = asString(args.role, "role");
    const name = asString(args.name, "name");
    if (role) {
      return page.getByRole(role as Parameters<Page["getByRole"]>[0], {
        name,
        exact: args.exact === true,
      });
    }
    const label = asString(args.label, "label");
    if (label) return page.getByLabel(label, { exact: args.exact === true });
    const placeholder = asString(args.placeholder, "placeholder");
    if (placeholder) return page.getByPlaceholder(placeholder, { exact: args.exact === true });
    const testId = asString(args.testId, "testId");
    if (testId) return page.getByTestId(testId);
    const text = asString(args.text, "text");
    if (text) return page.getByText(text, { exact: args.exact === true });
    const selector = asString(args.selector, "selector");
    if (selector) return page.locator(selector);
    throw new Error("需要提供 ref，或 role/name、label、placeholder、text、testId、selector 之一");
  }

  private async target(
    state: ManagedBrowserSession,
    args: Record<string, unknown>,
  ): Promise<Locator> {
    const locator = this.resolveLocator(state.currentPage, args).first();
    const timeout = clampTimeout(args.timeoutMs);
    await locator.waitFor({ state: "visible", timeout });
    return locator;
  }

  private async click(
    state: ManagedBrowserSession,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const beforeDownloads = state.downloads.length;
    const locator = await this.target(state, args);
    const targetSummary = await locator.evaluate((element) => {
      const html = element as HTMLElement;
      const form = "form" in element ? (element as HTMLInputElement).form : null;
      return [
        html.getAttribute("aria-label"),
        html.getAttribute("title"),
        html.innerText,
        html.textContent,
        html.getAttribute("value"),
        html.getAttribute("type"),
        form?.getAttribute("action"),
      ].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 500);
    });
    const riskReason = dangerousActionReason(targetSummary);
    if (riskReason && args.userConfirmed !== true) {
      this.log.warn({
        sessionId: state.sessionId,
        action: "click",
        url: state.currentPage.url(),
        riskReason,
        target: targetSummary.slice(0, 160),
        approved: false,
      }, "browser action requires user confirmation");
      return {
        ok: false,
        requiresConfirmation: true,
        riskReason,
        target: targetSummary.slice(0, 160),
        message: "该点击可能产生不可逆影响，需要用户在界面中明确确认后才能执行。",
        url: state.currentPage.url(),
      };
    }
    if (riskReason) {
      this.log.info({
        sessionId: state.sessionId,
        action: "click",
        url: state.currentPage.url(),
        riskReason,
        target: targetSummary.slice(0, 160),
        approved: true,
      }, "confirmed browser action");
    }
    const expectedDownload = args.expectDownload === true
      ? state.currentPage.waitForEvent("download", {
          timeout: clampTimeout(args.timeoutMs),
        }).then((download) => this.queueDownload(state, download))
      : null;
    await locator.click({ timeout: clampTimeout(args.timeoutMs) });
    if (expectedDownload) await expectedDownload;
    else await state.currentPage.waitForTimeout(250);
    return {
      ok: true,
      title: await state.currentPage.title(),
      url: state.currentPage.url(),
      downloads: state.downloads.slice(beforeDownloads),
    };
  }

  private async fill(
    state: ManagedBrowserSession,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const value = typeof args.value === "string" ? args.value : asString(args.value, "value", true)!;
    const locator = await this.target(state, args);
    await locator.fill(value, { timeout: clampTimeout(args.timeoutMs) });
    return { ok: true, url: state.currentPage.url(), valueLength: value.length };
  }

  private async select(
    state: ManagedBrowserSession,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const locator = await this.target(state, args);
    const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
    if (tag === "select") {
      const value = asString(args.value, "value");
      const label = asString(args.optionLabel, "optionLabel");
      if (!value && !label) throw new Error("下拉框需要 value 或 optionLabel");
      const selected = await locator.selectOption(value ? { value } : { label });
      return { ok: true, selected, url: state.currentPage.url() };
    }
    const checked = args.checked !== false;
    if (checked) await locator.check({ timeout: clampTimeout(args.timeoutMs) });
    else await locator.uncheck({ timeout: clampTimeout(args.timeoutMs) });
    return { ok: true, checked, url: state.currentPage.url() };
  }

  private async press(
    state: ManagedBrowserSession,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const key = asString(args.key, "key", true)!;
    const hasTarget = ["ref", "role", "label", "placeholder", "testId", "text", "selector"]
      .some((keyName) => args[keyName] !== undefined);
    const locator = hasTarget ? await this.target(state, args) : undefined;
    if (key.toLowerCase().includes("enter")) {
      const focused = locator ?? state.currentPage.locator(":focus").first();
      const targetSummary = await focused.evaluate((element) => {
        const html = element as HTMLElement;
        const form = "form" in element ? (element as HTMLInputElement).form : html.closest("form");
        return [
          html.getAttribute("aria-label"),
          html.getAttribute("title"),
          form?.innerText,
          form?.getAttribute("action"),
        ].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 500);
      }).catch(() => "");
      const riskReason = dangerousActionReason(targetSummary);
      if (riskReason && args.userConfirmed !== true) {
        this.log.warn({
          sessionId: state.sessionId,
          action: "press",
          key,
          url: state.currentPage.url(),
          riskReason,
          approved: false,
        }, "browser action requires user confirmation");
        return {
          ok: false,
          requiresConfirmation: true,
          riskReason,
          message: "该按键可能提交不可逆操作，需要用户在界面中明确确认后才能执行。",
          url: state.currentPage.url(),
        };
      }
    }
    if (locator) {
      await locator.press(key, { timeout: clampTimeout(args.timeoutMs) });
    } else {
      await state.currentPage.keyboard.press(key);
    }
    return { ok: true, key, url: state.currentPage.url() };
  }

  private async hover(
    state: ManagedBrowserSession,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const locator = await this.target(state, args);
    await locator.hover({ timeout: clampTimeout(args.timeoutMs) });
    return { ok: true, url: state.currentPage.url() };
  }

  private async scroll(
    state: ManagedBrowserSession,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const x = asNumber(args.deltaX, "deltaX", 0);
    const y = asNumber(args.deltaY, "deltaY", 600);
    const hasTarget = ["ref", "role", "label", "placeholder", "testId", "text", "selector"]
      .some((keyName) => args[keyName] !== undefined);
    if (hasTarget) {
      const locator = await this.target(state, args);
      await locator.evaluate((element, delta) => element.scrollBy(delta.x, delta.y), { x, y });
    } else {
      await state.currentPage.mouse.wheel(x, y);
    }
    return { ok: true, deltaX: x, deltaY: y, url: state.currentPage.url() };
  }

  private async wait(
    state: ManagedBrowserSession,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const timeout = clampTimeout(args.timeoutMs);
    const condition = asString(args.condition, "condition") ?? "time";
    if (condition === "time") {
      await state.currentPage.waitForTimeout(Math.min(timeout || 1_000, MAX_TIMEOUT_MS));
    } else if (condition === "networkidle" || condition === "domcontentloaded" || condition === "load") {
      await state.currentPage.waitForLoadState(condition, { timeout });
    } else if (condition === "url") {
      const url = asString(args.url, "url", true)!;
      await state.currentPage.waitForURL(url, { timeout });
    } else if (condition === "visible" || condition === "hidden") {
      const locator = this.resolveLocator(state.currentPage, args).first();
      await locator.waitFor({ state: condition, timeout });
    } else {
      throw new Error(`不支持的等待条件：${condition}`);
    }
    return { ok: true, condition, title: await state.currentPage.title(), url: state.currentPage.url() };
  }

  private async tabs(
    state: ManagedBrowserSession,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const action = asString(args.action, "action") ?? "list";
    if (action === "new") {
      const page = await state.context.newPage();
      state.currentPage = page;
      if (args.url !== undefined) {
        await page.goto(validateUrl(args.url), { waitUntil: "domcontentloaded", timeout: clampTimeout(args.timeoutMs) });
      }
    } else if (action === "switch") {
      const index = asNumber(args.index, "index");
      const pages = state.context.pages();
      if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
        throw new Error(`标签页索引超出范围：${index}`);
      }
      state.currentPage = pages[index]!;
      await state.currentPage.bringToFront();
    } else if (action === "close") {
      const pages = state.context.pages();
      const index = args.index === undefined
        ? pages.indexOf(state.currentPage)
        : asNumber(args.index, "index");
      if (pages.length <= 1) throw new Error("至少保留一个标签页");
      const target = pages[index];
      if (!target) throw new Error(`标签页索引超出范围：${index}`);
      await target.close();
      state.currentPage = state.context.pages()[Math.max(0, index - 1)]!;
      await state.currentPage.bringToFront();
    } else if (action !== "list") {
      throw new Error(`不支持的标签页操作：${action}`);
    }

    const pages = state.context.pages();
    return {
      ok: true,
      activeIndex: pages.indexOf(state.currentPage),
      tabs: await Promise.all(pages.map(async (page, index) => ({
        index,
        title: await page.title().catch(() => ""),
        url: page.url(),
      }))),
    };
  }

  private async screenshot(
    state: ManagedBrowserSession,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const directory = this.artifactDirectory(state.workdir, "screenshots");
    await fs.mkdir(directory, { recursive: true });
    const requestedName = asString(args.name, "name") ?? `screenshot-${Date.now()}.png`;
    const filename = safeFileName(requestedName.toLowerCase().endsWith(".png") ? requestedName : `${requestedName}.png`);
    const absolutePath = path.resolve(directory, filename);
    const relativeCheck = path.relative(directory, absolutePath);
    if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
      throw new Error("截图路径超出允许目录");
    }
    const hasTarget = ["ref", "role", "label", "placeholder", "testId", "text", "selector"]
      .some((keyName) => args[keyName] !== undefined);
    if (hasTarget) {
      const locator = await this.target(state, args);
      await locator.screenshot({ path: absolutePath, type: "png" });
    } else {
      await state.currentPage.screenshot({
        path: absolutePath,
        type: "png",
        fullPage: args.fullPage === true,
      });
    }
    const relativePath = path.relative(state.workdir, absolutePath).replaceAll("\\", "/");
    const artifact: BrowserArtifact = {
      path: relativePath,
      name: filename,
      mimeType: "image/png",
      absolutePath,
      createdAt: Date.now(),
      sessionId: state.sessionId,
    };
    return {
      ok: true,
      title: await state.currentPage.title(),
      url: state.currentPage.url(),
      artifact,
    };
  }

  private artifactDirectory(workdir: string, kind: "screenshots" | "downloads"): string {
    const root = path.resolve(workdir);
    const directory = path.resolve(root, "browser", kind);
    const relative = path.relative(root, directory);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("浏览器产物目录超出工作空间");
    }
    return directory;
  }
}
