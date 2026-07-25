import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import "./index.css";

// Register service worker for PWA
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: () => import("./pages/Dashboard.vue") },
    { path: "/agents", component: () => import("./pages/Agents.vue") },
    { path: "/tools", component: () => import("./pages/Tools.vue") },
    { path: "/workspace", component: () => import("./pages/Workspace.vue") },
    { path: "/prompts", component: () => import("./pages/PromptsPage.vue") },
    { path: "/config", component: () => import("./pages/Config.vue") },
    { path: "/commands", component: () => import("./pages/Commands.vue") },
  ],
});

createApp(App).use(router).mount("#root");
