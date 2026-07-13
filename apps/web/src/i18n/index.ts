import { ref, computed } from "vue";
import { messages, type Locale } from "./messages";

const locale = ref<Locale>(
  (localStorage.getItem("pi-locale") as Locale) ?? "en",
);

export function useI18n() {
  // `t` is a plain function (not a ComputedRef<Function>) so it can be called
  // directly from both templates and render functions. Reactivity is preserved
  // because `locale.value` is read on every call.
  function t(key: string, params?: Record<string, string | number>): string {
    const dict = messages[locale.value];
    let s = dict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return s;
  }

  function setLocale(l: Locale) {
    locale.value = l;
    localStorage.setItem("pi-locale", l);
  }

  function toggleLocale() {
    setLocale(locale.value === "en" ? "zh" : "en");
  }

  const currentLocale = computed(() => locale.value);

  return { t, setLocale, toggleLocale, currentLocale };
}
