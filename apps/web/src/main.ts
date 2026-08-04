import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { initializeBackendEndpoint } from "./api/endpoints.js";
import { useThemeStore } from "./stores/theme.js";
import "./styles/global.css";

void bootstrap();

async function bootstrap() {
  try {
    await initializeBackendEndpoint();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
      <main style="display:grid;place-items:center;height:100vh;padding:24px;background:#202224;color:#f5f5f5;font-family:system-ui,sans-serif">
        <section style="max-width:680px;text-align:center">
          <h1 style="font-size:22px">后端服务无法启动</h1>
          <p style="color:#ff7b7b;line-height:1.6">${escapeHtml(detail)}</p>
          <p style="color:#aaa">请退出应用后重新打开；如果问题持续，请检查服务日志。</p>
        </section>
      </main>`;
    return;
  }

  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);

  const themeStore = useThemeStore(pinia);
  themeStore.apply();

  app.mount("#app");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}
