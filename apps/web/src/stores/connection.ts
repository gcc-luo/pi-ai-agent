import { defineStore } from "pinia";
import { wsClient } from "../api/ws.js";

export const useConnectionStore = defineStore("connection", {
  state: () => ({ status: "disconnected" as "disconnected" | "connecting" | "connected" }),
  actions: {
    init() {
      wsClient.onStatusChange((s) => { this.status = s; });
      wsClient.connect();
    },
  },
});
