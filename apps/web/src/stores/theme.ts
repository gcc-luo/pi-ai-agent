import { defineStore } from "pinia";

export type ThemeMode = "light" | "dark" | "gray";

export const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "dark", label: "深色" },
  { value: "gray", label: "灰色" },
  { value: "light", label: "浅色" },
];

const VALID_MODES: Set<string> = new Set(["light", "dark", "gray"]);

export const useThemeStore = defineStore("theme", {
  state: () => ({
    mode: ((): ThemeMode => {
      const stored = localStorage.getItem("pi-theme");
      if (stored && VALID_MODES.has(stored)) return stored as ThemeMode;
      return "gray";
    })(),
  }),

  getters: {
    isDark: (state) => state.mode === "dark" || state.mode === "gray",
  },

  actions: {
    toggle() {
      const order: ThemeMode[] = ["light", "dark", "gray"];
      const index = order.indexOf(this.mode);
      this.mode = order[(index + 1) % order.length] ?? "light";
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
