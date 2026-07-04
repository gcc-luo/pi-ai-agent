import { defineStore } from "pinia";

type ThemeMode = "light" | "dark";

export const useThemeStore = defineStore("theme", {
  state: () => ({
    mode: (localStorage.getItem("pi-theme") as ThemeMode) ??
      (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"),
  }),

  getters: {
    isDark: (state) => state.mode === "dark",
  },

  actions: {
    toggle() {
      this.mode = this.mode === "dark" ? "light" : "dark";
      this.apply();
    },
    set(mode: ThemeMode) {
      this.mode = mode;
      this.apply();
    },
    apply() {
      document.documentElement.setAttribute("data-theme", this.mode);
      localStorage.setItem("pi-theme", this.mode);
    },
  },
});
