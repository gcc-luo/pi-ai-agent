import {
  WeChatBot,
  type Credentials,
  type IncomingMessage,
  type QrLoginCallbacks,
} from "@wechatbot/wechatbot";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import QRCode from "qrcode";
import { pino } from "pino";
import type { WeChatAgentReply } from "./wechat-artifacts.js";

const log = pino({ name: "wechat-worker" });

// WeChatBot's FileStorage persists the token here so a server restart
// can resume without re-scanning the QR code.
const SESSION_DIR = process.env.WECHATBOT_STORAGE_DIR
  ?? join(homedir(), ".pi-web-ui", "wechat-session");

export type WeChatLoginState =
  | { state: "idle" }
  | { state: "requesting" }
  | { state: "awaiting_scan"; qrUrl: string; qrDataUrl: string }
  | { state: "scanned" }
  | { state: "logged_in"; userId: string }
  | { state: "expired"; lastQrUrl?: string }
  | { state: "error"; error: string };

// Callbacks fired asynchronously during login(); mutate loginState in place.
// Guarded by loginAttempt so stale callbacks from a cancelled login are ignored.
const loginCallbacks: QrLoginCallbacks = {
  onQrUrl: (url) => {
    const attempt = loginAttempt;
    QRCode.toDataURL(url).then((dataUrl) => {
      if (attempt !== loginAttempt) return;
      loginState = { state: "awaiting_scan", qrUrl: url, qrDataUrl: dataUrl };
      log.info("wechat qr ready, awaiting scan");
    }).catch((err) => {
      if (attempt !== loginAttempt) return;
      log.error({ err: (err as Error).message }, "failed to render qr");
      loginState = { state: "error", error: "二维码生成失败，请稍后重试" };
    });
  },
  onScanned: () => {
    loginState = { state: "scanned" };
    log.info("wechat qr scanned, awaiting confirm");
  },
  onExpired: () => {
    loginState = { state: "error", error: "二维码已过期，请点击重新扫码登录" };
    log.info("wechat qr expired");
  },
};

let bot: WeChatBot | null = null;
let loginState: WeChatLoginState = { state: "idle" };
let startPromise: Promise<void> | null = null;
let qrLoginPromise: Promise<void> | null = null;
let loginAttempt = 0;
let inboundHandler: ((input: { userId: string; text: string }) => Promise<WeChatAgentReply>) | null = null;
const inboundQueues = new Map<string, Promise<void>>();

function ensureBot(): WeChatBot {
  if (bot) return bot;
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
  const createdBot = new WeChatBot({
    storage: "file",
    storageDir: SESSION_DIR,
    logLevel: "info",
  });
  bot = createdBot;
  createdBot.onMessage((msg) => enqueueInbound(createdBot, msg));
  return createdBot;
}

function enqueueInbound(activeBot: WeChatBot, msg: IncomingMessage): Promise<void> {
  const key = msg.userId;
  const previous = inboundQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => {
      if (bot !== activeBot) return;
      return handleInbound(activeBot, msg);
    });
  inboundQueues.set(key, next);
  const clearQueue = () => {
    if (inboundQueues.get(key) === next) inboundQueues.delete(key);
  };
  void next.then(clearQueue, clearQueue);
  return next;
}

async function handleInbound(activeBot: WeChatBot, msg: IncomingMessage): Promise<void> {
  const text = msg.text?.trim();
  log.debug({ from: msg.userId, text: text?.slice(0, 50) }, "wechat inbound");
  if (!text) {
    await activeBot.reply(msg, "目前仅支持文本消息。");
    return;
  }
  if (!inboundHandler) {
    await activeBot.reply(msg, "微信频道尚未配置项目，请先在 Pi 中完成频道配置。");
    return;
  }
  try {
    const response = await inboundHandler({ userId: msg.userId, text });
    if (bot !== activeBot) return;
    await activeBot.reply(msg, response.text);
    const failedFiles = [...response.failedFiles];
    for (const file of response.files) {
      if (bot !== activeBot) return;
      try {
        await activeBot.reply(msg, { file: file.data, fileName: file.fileName });
      } catch (error: any) {
        failedFiles.push(file.fileName);
        log.error(
          { err: error?.message ?? String(error), userId: msg.userId, fileName: file.fileName },
          "wechat artifact delivery failed",
        );
      }
    }
    if (failedFiles.length > 0 && bot === activeBot) {
      const shown = failedFiles.slice(0, 10);
      const remaining = failedFiles.length - shown.length;
      const suffix = remaining > 0 ? ` 等 ${failedFiles.length} 个文件` : "";
      await activeBot.reply(msg, `以下文件发送失败：${shown.join("、")}${suffix}`);
    }
    if (response.failedDeclarations > 0 && bot === activeBot) {
      await activeBot.reply(
        msg,
        `有 ${response.failedDeclarations} 项产物声明无法解析，相关文件未发送。`,
      );
    }
  } catch (error: any) {
    log.error({ err: error?.message ?? String(error), userId: msg.userId }, "wechat inbound handling failed");
    if (bot === activeBot) {
      await activeBot.reply(msg, "抱歉，处理消息时出现错误，请稍后重试。");
    }
  }
}

/** Start (or reuse) the bot. Resolves once login() + start() chain kicks off. */
async function ensureStarted(): Promise<void> {
  const b = ensureBot();
  if (b.isRunning) return;
  if (startPromise) return startPromise;

  // Do not start a headless QR flow at server boot. It cannot render a QR for
  // the user and would race a later explicit “scan to login” request.
  if (!(await b.storage.has("credentials"))) return;

  startPromise = (async () => {
    try {
      // login() resolves immediately if cached creds are valid, otherwise
      // waits for QR scan + confirm. start() begins the long-poll loop
      // required for send() to work.
      const creds = await b.login({ callbacks: loginCallbacks });
      loginState = { state: "logged_in", userId: creds.userId };
      log.info({ userId: creds.userId }, "wechat logged in");
      await b.start();
    } catch (err: any) {
      const raw = err?.message ?? String(err);
      loginState = { state: "error", error: localizeError(raw) };
      log.error({ err: raw }, "wechat login failed");
    } finally {
      startPromise = null;
    }
  })();
  return startPromise;
}

/** Map known SDK error messages to user-friendly Chinese text. */
function localizeError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("timeout") || lower.includes("aborted")) {
    return "获取二维码超时，请检查网络连接后重试";
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("econnrefused") || lower.includes("enotfound")) {
    return "网络连接失败，无法访问微信服务器，请检查网络";
  }
  if (lower.includes("expired")) {
    return "二维码已过期，请重新扫码";
  }
  if (lower.includes("auth") || lower.includes("unauthorized")) {
    return "微信认证失败，请重新登录";
  }
  if (lower.includes("qr render")) {
    return "二维码生成失败，请稍后重试";
  }
  return raw;
}

/** Force a fresh QR login flow, ignoring cached creds. */
function startLogin(): void {
  const b = ensureBot();
  // Cancel any in-flight login so a new click always takes effect.
  const attempt = ++loginAttempt;
  qrLoginPromise = null;
  loginState = { state: "requesting" };
  log.info("wechat: requesting QR code from WeChat servers...");
  // Don't await — the QR flow blocks until scan. The state machine in
  // loginCallbacks reflects progress for the UI to poll.
  qrLoginPromise = b.login({ force: true, callbacks: loginCallbacks })
    .then(async (creds: Credentials) => {
      if (attempt !== loginAttempt || bot !== b) return;
      loginState = { state: "logged_in", userId: creds.userId };
      log.info({ userId: creds.userId }, "wechat logged in via qr");
      await b.start();
    })
    .catch((err: any) => {
      if (attempt !== loginAttempt || bot !== b) return;
      const raw = err?.message ?? String(err);
      loginState = { state: "error", error: localizeError(raw) };
      log.error({ err: raw }, "wechat qr login failed");
    })
    .finally(() => {
      if (attempt === loginAttempt) qrLoginPromise = null;
    });
}

/** Stop and reset the bot. */
function stop(): void {
  loginAttempt++;
  if (bot) {
    try { bot.stop(); } catch { /* best-effort */ }
  }
  bot = null;
  inboundQueues.clear();
  startPromise = null;
  qrLoginPromise = null;
  loginState = { state: "idle" };
}

/** Current login state, including the QR data URL for rendering. */
function getStatus(): WeChatLoginState {
  return loginState;
}

function setInboundHandler(handler: ((input: { userId: string; text: string }) => Promise<WeChatAgentReply>) | null): void {
  inboundHandler = handler;
}

/** Send a test message to a user by wxid. User must have messaged the bot first. */
async function sendTest(userId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const b = bot;
  if (!b) return { ok: false, error: "bot not initialized" };
  if (!b.isRunning) {
    try { await ensureStarted(); } catch (err: any) {
      return { ok: false, error: `bot not running: ${err?.message ?? err}` };
    }
  }
  const creds = b.getCredentials();
  if (!creds) return { ok: false, error: "not logged in — scan QR first" };
  try {
    await b.send(userId, text);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export const weChatWorker = {
  ensureStarted,
  startLogin,
  stop,
  getStatus,
  setInboundHandler,
  sendTest,
};

export function getWeChatWorker() {
  return weChatWorker;
}
