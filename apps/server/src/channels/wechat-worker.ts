import { WeChatBot, type Credentials, type QrLoginCallbacks } from "@wechatbot/wechatbot";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import QRCode from "qrcode";
import { pino } from "pino";

const log = pino({ name: "wechat-worker" });

// WeChatBot's FileStorage persists the token here so a server restart
// can resume without re-scanning the QR code.
const SESSION_DIR = process.env.WECHATBOT_STORAGE_DIR
  ?? join(homedir(), ".pi-web-ui", "wechat-session");

export type WeChatLoginState =
  | { state: "idle" }
  | { state: "awaiting_scan"; qrUrl: string; qrDataUrl: string }
  | { state: "scanned" }
  | { state: "logged_in"; userId: string }
  | { state: "expired"; lastQrUrl?: string }
  | { state: "error"; error: string };

// Callbacks fired asynchronously during login(); mutate loginState in place.
const loginCallbacks: QrLoginCallbacks = {
  onQrUrl: (url) => {
    QRCode.toDataURL(url).then((dataUrl) => {
      loginState = { state: "awaiting_scan", qrUrl: url, qrDataUrl: dataUrl };
      log.info("wechat qr ready, awaiting scan");
    }).catch((err) => {
      log.error({ err: (err as Error).message }, "failed to render qr");
      loginState = { state: "error", error: "qr render failed" };
    });
  },
  onScanned: () => {
    loginState = { state: "scanned" };
    log.info("wechat qr scanned, awaiting confirm");
  },
  onExpired: () => {
    loginState = { state: "expired" };
    log.info("wechat qr expired");
  },
};

let bot: WeChatBot | null = null;
let loginState: WeChatLoginState = { state: "idle" };
let startPromise: Promise<void> | null = null;
let qrLoginPromise: Promise<void> | null = null;
let loginAttempt = 0;
let inboundHandler: ((input: { userId: string; text: string }) => Promise<string>) | null = null;

function ensureBot(): WeChatBot {
  if (bot) return bot;
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
  bot = new WeChatBot({
    storage: "file",
    storageDir: SESSION_DIR,
    logLevel: "info",
  });
  bot.onMessage(async (msg) => {
    const text = msg.text?.trim();
    log.debug({ from: msg.userId, text: text?.slice(0, 50) }, "wechat inbound");
    if (!text) {
      await bot?.reply(msg, "目前仅支持文本消息。");
      return;
    }
    if (!inboundHandler) {
      await bot?.reply(msg, "微信频道尚未配置处理项目，请先在 Pi 中完成频道配置。");
      return;
    }
    try {
      const response = await inboundHandler({ userId: msg.userId, text });
      await bot?.reply(msg, response);
    } catch (error: any) {
      log.error({ err: error?.message ?? String(error), userId: msg.userId }, "wechat inbound handling failed");
      await bot?.reply(msg, "抱歉，处理消息时出现错误，请稍后重试。");
    }
  });
  return bot;
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
      loginState = { state: "error", error: err?.message ?? String(err) };
      log.error({ err: err?.message ?? String(err) }, "wechat login failed");
    } finally {
      startPromise = null;
    }
  })();
  return startPromise;
}

/** Force a fresh QR login flow, ignoring cached creds. */
function startLogin(): void {
  const b = ensureBot();
  if (qrLoginPromise) return;
  const attempt = ++loginAttempt;
  loginState = { state: "idle" };
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
      loginState = { state: "error", error: err?.message ?? String(err) };
      log.error({ err: err?.message ?? String(err) }, "wechat qr login failed");
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
  startPromise = null;
  qrLoginPromise = null;
  loginState = { state: "idle" };
}

/** Current login state, including the QR data URL for rendering. */
function getStatus(): WeChatLoginState {
  return loginState;
}

function setInboundHandler(handler: ((input: { userId: string; text: string }) => Promise<string>) | null): void {
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
