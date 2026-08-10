import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { initializeBackendEndpoint } from "./api/endpoints.js";
import { createStartupErrorHtml } from "./startup-error.js";
import { useThemeStore } from "./stores/theme.js";
import "./styles/global.css";

void bootstrap();

async function bootstrap() {
  try {
    await initializeBackendEndpoint();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    document.querySelector<HTMLDivElement>("#app")!.innerHTML =
      await createStartupErrorHtml(detail);
    return;
  }

  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);

  const themeStore = useThemeStore(pinia);
  themeStore.apply();

  app.mount("#app");
}
