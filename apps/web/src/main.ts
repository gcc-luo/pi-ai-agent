import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { initializeBackendEndpoint, type BackendStartupStage } from "./api/endpoints.js";
import { createStartupErrorHtml } from "./startup-error.js";
import { useThemeStore } from "./stores/theme.js";
import "./styles/global.css";

const startupMessages: Record<BackendStartupStage, string> = {
  starting: "正在启动本地服务",
  checking: "正在确认本地服务",
  ready: "正在载入工作界面",
};

function updateStartupStage(stage: BackendStartupStage) {
  const screen = document.querySelector<HTMLElement>("[data-startup-screen]");
  if (!screen) return;

  screen.dataset.startupStage = stage;
  const message = screen.querySelector<HTMLElement>("[data-startup-message]");
  if (message) message.textContent = startupMessages[stage];

  const order: BackendStartupStage[] = ["starting", "checking", "ready"];
  screen.querySelectorAll<HTMLElement>("[data-startup-step]").forEach((step) => {
    const stepStage = step.dataset.startupStep as BackendStartupStage | undefined;
    if (!stepStage) return;

    const stepIndex = order.indexOf(stepStage);
    const activeIndex = order.indexOf(stage);
    const state = stepIndex < activeIndex ? "complete" : stepIndex === activeIndex ? "active" : "waiting";
    step.dataset.state = state;

    const indicator = step.querySelector<HTMLElement>(".startup-step-indicator");
    if (indicator) indicator.textContent = state === "complete" ? "✓" : String(stepIndex + 1);

    const status = step.querySelector<HTMLElement>(".startup-step-state");
    if (status) status.textContent = state === "complete" ? "已完成" : state === "active" ? "进行中" : "等待中";
  });
}

async function bootstrap() {
  try {
    await initializeBackendEndpoint(updateStartupStage);
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

void bootstrap();
