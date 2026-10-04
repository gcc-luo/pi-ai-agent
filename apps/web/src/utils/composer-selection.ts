import type { ComposerResourceToken } from "./composer-tokens.js";
import type { usePluginStore } from "../stores/plugin.js";
import type { useSessionStore } from "../stores/session.js";
import type { useKbBindingStore } from "../stores/kb-binding.js";
import type { useConnectorStore } from "../stores/connector.js";

type SelectionStores = {
  plugins: ReturnType<typeof usePluginStore>;
  sessions: ReturnType<typeof useSessionStore>;
  kbBindings: ReturnType<typeof useKbBindingStore>;
  connectors: ReturnType<typeof useConnectorStore>;
};

/** Remove the backing selection when a composer resource chip is dismissed. */
export async function removeComposerSelection(
  token: ComposerResourceToken,
  sessionId: string,
  stores: SelectionStores,
): Promise<void> {
  const id = token.resourceId;
  if (!id) return;

  switch (token.kind) {
    case "plugin": {
      const selected = stores.plugins.selectedBySession[sessionId] ?? [];
      if (selected.includes(id)) {
        await stores.plugins.setSessionPlugins(sessionId, selected.filter((item) => item !== id));
      }
      break;
    }
    case "expert": {
      const session = stores.sessions.sessions.find((item) => item.id === sessionId)
        ?? (stores.sessions.current?.id === sessionId ? stores.sessions.current : null);
      if (session?.expertId === id) await stores.sessions.setExpert(sessionId, null);
      break;
    }
    case "knowledge_base": {
      const selected = stores.kbBindings.getForSession(sessionId);
      if (selected.some((item) => item.kbId === id)) {
        await stores.kbBindings.save(sessionId, selected
          .filter((item) => item.kbId !== id)
          .map((item) => ({ kbId: item.kbId, fileFilter: item.fileFilter })));
      }
      break;
    }
    case "connector": {
      const connector = stores.connectors.connectors.find((item) => item.id === id);
      if (connector?.enabled) await stores.connectors.update(id, { enabled: false });
      break;
    }
  }
}
