import { defineStore } from "pinia";

type AppMode = "office" | "coding";

export const useModeStore = defineStore("mode", {
  state: () => ({
    mode: (localStorage.getItem("pi-mode") as AppMode) ?? "office",
  }),

  getters: {
    isCoding: (state) => state.mode === "coding",
  },

  actions: {
    toggle() {
      this.mode = this.mode === "coding" ? "office" : "coding";
      this.apply();
    },
    set(mode: AppMode) {
      this.mode = mode;
      this.apply();
    },
    apply() {
      document.documentElement.setAttribute("data-mode", this.mode);
      localStorage.setItem("pi-mode", this.mode);
    },
  },
});
