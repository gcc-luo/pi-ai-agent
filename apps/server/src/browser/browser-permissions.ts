/** Opaque scripts/batches require one confirmation of the whole call. */
export function browserCallNeedsConfirmation(
  params: Record<string, unknown>,
): boolean {
  if (
    Object.keys(params).some(
      (key) =>
        !["args", "timeoutMs", "sessionMode"].includes(key),
    )
  )
    return true;
  const args = params.args;
  if (
    !Array.isArray(args) ||
    !args.length ||
    args.some((arg) => typeof arg !== "string")
  )
    return true;
  const command = args[0]!.toLowerCase();
  if (
    command === "screenshot"
    && args.slice(1).some((arg) => !arg.startsWith("-"))
  ) {
    // The CLI accepts an explicit output path (optionally after a selector).
    return true;
  }
  if (
    command === "wait"
    && args.slice(1).some((arg) => arg === "-d" || /^--download(?:=|$)/.test(arg))
  ) {
    // Waiting for a download can persist a file even when no path is supplied.
    return true;
  }
  if (command === "open" || command === "navigate") {
    const target = args.slice(1).find((arg) => !arg.startsWith("-"));
    if (target) {
      try {
        const protocol = new URL(target).protocol;
        if (protocol !== "http:" && protocol !== "https:") return true;
      } catch {
        // Bare hostnames and local paths can be interpreted differently by the
        // browser runtime; require review unless the target is a valid web URL.
        return true;
      }
    }
  }
  if (
    args.some((arg) =>
      /^(--(?:all|fn|session|namespace|config|cdp|auto-connect|profile|executable-path|proxy|provider|allow-file-access|extension|browser-args|headers))(=|$)/.test(
        arg,
      ),
    )
  )
    return true;
  // Leading flags can change sessions or execution modes; avoid a second argv parser.
  return !new Set([
    "open",
    "navigate",
    "back",
    "forward",
    "reload",
    "snapshot",
    "screenshot",
    "get",
    "is",
    "wait",
    "scroll",
    "scrollintoview",
    "hover",
    "console",
    "errors",
    "close",
    "--help",
    "--version",
  ]).has(args[0]);
}
