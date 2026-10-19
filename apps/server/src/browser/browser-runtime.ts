import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const BROWSER_EXTENSION_VERSION = "0.6.10";
export const AGENT_BROWSER_VERSION = "0.37.0";

export function browserIdentity(sessionRoot: string, sessionId: string) {
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex").slice(0, 24);
  return {
    session: `web-${digest(sessionId).slice(0, 16)}`,
    namespace: `pi-web-${digest(path.resolve(sessionRoot)).slice(0, 8)}`,
  };
}

/** Use the packaged native executable directly, including on Windows (no npm/Node shim). */
export function browserBinary(): string {
  const root = path.dirname(require.resolve("agent-browser/package.json"));
  const arch =
    process.platform === "win32" && process.arch === "arm64"
      ? "x64"
      : process.arch;
  const report =
    process.platform === "linux"
      ? (process.report?.getReport() as {
          header?: { glibcVersionRuntime?: string };
        })
      : undefined;
  const platform =
    process.platform === "linux" && !report?.header?.glibcVersionRuntime
      ? "linux-musl"
      : process.platform;
  return path.join(
    root,
    "bin",
    `agent-browser-${platform}-${arch}${process.platform === "win32" ? ".exe" : ""}`,
  );
}

export function browserEnvironment(
  sessionRoot: string,
  sessionId: string,
): Record<string, string> {
  const root = path.join(sessionRoot, ".browser");
  const binDir = path.join(
    root,
    `bin-${AGENT_BROWSER_VERSION}-${process.platform}-${process.arch}`,
  );
  const executable = path.join(
    binDir,
    `agent-browser${process.platform === "win32" ? ".exe" : ""}`,
  );
  fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(executable)) {
    try {
      fs.copyFileSync(browserBinary(), executable, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (process.platform !== "win32") fs.chmodSync(executable, 0o700);
  }
  const identity = browserIdentity(sessionRoot, sessionId);
  const configPath = path.join(root, `${identity.session}.json`);
  // Explicit config prevents ambient shared-browser defaults from joining unrelated chats.
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      ...identity,
      // The browser panel is the user's surface for this session. Keep the
      // Chromium window hidden by default so opening the in-app tab does not
      // unexpectedly launch a separate desktop browser. Explicitly opt in to
      // a visible browser for debugging with PI_BROWSER_HEADED=true.
      headed: process.env.PI_BROWSER_HEADLESS !== "true"
        && process.env.PI_BROWSER_HEADED === "true",
    }),
    { mode: 0o600 },
  );
  return {
    PATH: [binDir, process.env.PATH].filter(Boolean).join(path.delimiter),
    AGENT_BROWSER_CONFIG: configPath,
    AGENT_BROWSER_SESSION: identity.session,
    AGENT_BROWSER_NAMESPACE: identity.namespace,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: "900000",
    // The in-app panel displays streamed JPEG frames. Use the highest encoder
    // quality so text and fine UI details stay sharp after transport.
    AGENT_BROWSER_STREAM_QUALITY: "100",
  };
}
