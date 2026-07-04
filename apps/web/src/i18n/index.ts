import { ref, computed } from "vue";
import { messages, type Locale } from "./messages";

const locale = ref<Locale>(
  (localStorage.getItem("pi-locale") as Locale) ?? "en",
);

export function useI18n() {
  const t = computed(() => {
    const dict = messages[locale.value];
    return (key: string): string => dict[key] ?? key;
  });

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
