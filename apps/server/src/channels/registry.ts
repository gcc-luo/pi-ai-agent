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

// Rebuild the in-memory registry from persisted DB rows. Called on server
// startup and whenever a config is created/updated/deleted. Adapters are
// loaded with eventMode 'off' so no long-lived stream/websocket connection
// is opened — this iteration is outgoing-only.
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
    const adapterConfig = {
      ...cfg.config,
      type: cfg.type,
      // Force outgoing-only mode — we don't run startListening().
      eventMode: "off",
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

export async function sendToChannel(
  channelId: string,
  text: string,
  recipient?: string,
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
    });
    return result;
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
