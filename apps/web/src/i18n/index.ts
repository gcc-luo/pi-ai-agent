import { ref, computed } from "vue";
import { messages, type Locale } from "./messages";

const locale = ref<Locale>(
  (localStorage.getItem("pi-locale") as Locale) ?? "en",
);

export function useI18n() {
  // `t` is a plain function (not a ComputedRef<Function>) so it can be called
  // directly from both templates and render functions. Reactivity is preserved
  // because `locale.value` is read on every call.
  function t(key: string): string {
    const dict = messages[locale.value];
    return dict[key] ?? key;
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
