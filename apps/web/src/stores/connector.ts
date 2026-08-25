import { defineStore } from "pinia";
import type { BuiltinConnectorDto, ConnectorDto, ConnectorToolDto, ConnectorToolPolicy, CreateConnectorInput } from "@pi-web-ui/shared";
import { api } from "../api/client.js";

export const useConnectorStore = defineStore("connectors", {
  state: () => ({
    connectors: [] as ConnectorDto[],
    catalog: [] as BuiltinConnectorDto[],
    tools: {} as Record<string, ConnectorToolDto[]>,
    loading: false,
    error: null as string | null,
  }),
  actions: {
    async load(workspaceId?: string) {
      this.loading = true;
      this.error = null;
      try { [this.connectors, this.catalog] = await Promise.all([api.listConnectors(workspaceId), api.listConnectorCatalog()]); }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); }
      finally { this.loading = false; }
    },
    merge(connector: ConnectorDto) {
      const index = this.connectors.findIndex((item) => item.id === connector.id);
      if (index >= 0) this.connectors.splice(index, 1, connector); else this.connectors.unshift(connector);
    },
    async create(input: CreateConnectorInput) { const result = await api.createConnector(input); this.merge(result); return result; },
    async connectBuiltin(key: string, token: string) {
      const result = await api.connectBuiltinConnector(key, token);
      this.merge(result);
      const item = this.catalog.find((entry) => entry.key === key);
      if (item) { item.connected = true; item.instanceId = result.id; }
      return result;
    },
    async update(id: string, patch: Partial<CreateConnectorInput> & { enabled?: boolean }) { const result = await api.updateConnector(id, patch); this.merge(result); return result; },
    async remove(id: string) {
      const removed = this.connectors.find((item) => item.id === id);
      await api.deleteConnector(id);
      this.connectors = this.connectors.filter((item) => item.id !== id);
      if (removed?.builtinKey) { const catalog = this.catalog.find((item) => item.key === removed.builtinKey); if (catalog) { catalog.connected = false; catalog.instanceId = null; } }
      delete this.tools[id];
    },
    async loadTools(id: string) { const result = await api.listConnectorTools(id); this.tools[id] = result; return result; },
    async setTool(id: string, name: string, patch: { enabled?: boolean; policy?: ConnectorToolPolicy }) {
      const updated = await api.updateConnectorTool(id, name, patch);
      const list = this.tools[id] ?? [];
      const index = list.findIndex((tool) => tool.name === name);
      if (index >= 0) list.splice(index, 1, updated); else list.push(updated);
      return updated;
    },
  },
});
