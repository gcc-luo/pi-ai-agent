import { ChannelRegistry } from "@amaster.ai/pi-channels/registry";
import type { ChannelConfigDto, ChannelTestResult } from "@pi-web-ui/shared";
import { pino } from "pino";

const log = pino({ name: "channels" });

// Singleton registry — holds all configured channel adapters. The package's
// ChannelRegistry.loadAdapter() dispatches to the inner factory map keyed by
// config.type, so we don't need to register adapters manually.
class ChannelRegistryHolder {
  private static instance: ChannelRegistry | null = null;
  static get(): ChannelRegistry {
    if (!ChannelRegistryHolder.instance) {
      ChannelRegistryHolder.instance = new ChannelRegistry();
    }
    return ChannelRegistryHolder.instance;
  }
}

export function getRegistry(): ChannelRegistry {
  return ChannelRegistryHolder.get();
}

// Rebuild the in-memory registry from persisted DB rows. Enterprise channels
// start their native long connections only after a processing project has been
// selected; incomplete legacy configs remain available for outgoing tests.
export async function rebuildAdapters(configs: ChannelConfigDto[]): Promise<void> {
  const reg = getRegistry();
  try {
    await reg.stopAll();
  } catch (e) {
    // ignore — stopAll is best-effort
  }
  for (const c of reg.list()) {
    try {
      reg.unregister(c.name);
    } catch (e) {
      // ignore
    }
  }
  for (const cfg of configs) {
    if (!cfg.enabled) continue;
    // Personal WeChat uses its own QR worker and inbound Pi bridge rather than
    // the generic webhook adapter registry.
    if (cfg.type === "wechat") continue;
    const hasProject = typeof cfg.config.projectId === "string" && cfg.config.projectId.trim() !== "";
    const adapterConfig = {
      ...cfg.config,
      type: cfg.type,
      eventMode: hasProject ? (cfg.type === "dingtalk" ? "stream" : "websocket") : "off",
    };
    try {
      await reg.loadAdapter(cfg.id, adapterConfig as any, process.cwd());
      log.info({ channelId: cfg.id, type: cfg.type }, "channel adapter loaded");
    } catch (err: any) {
      log.error(
        { channelId: cfg.id, type: cfg.type, err: err?.message },
        "failed to load channel adapter",
      );
    }
  }
}

/** Starts long connections after their adapters and incoming handler exist. */
export async function startChannelListeners(): Promise<void> {
  await getRegistry().startListening();
}

export async function sendToChannel(
  channelId: string,
  text: string,
  recipient?: string,
  metadata?: Record<string, unknown>,
): Promise<ChannelTestResult> {
  const reg = getRegistry();
  const adapter = reg.getAdapter(channelId);
  if (!adapter) {
    return { ok: false, error: "channel adapter not loaded (check config or restart)" };
  }
  if (!adapter.send) {
    return { ok: false, error: "adapter does not support send" };
  }
  try {
    const result = await reg.send({
      adapter: channelId,
      recipient: recipient ?? "default",
      text,
      ...(metadata ? { metadata } : {}),
    });
    return result;
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
