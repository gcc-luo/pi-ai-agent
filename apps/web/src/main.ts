import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/global.css";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

import { useThemeStore } from "./stores/theme.js";
const themeStore = useThemeStore(pinia);
themeStore.apply();

app.mount("#app");
