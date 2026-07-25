<template>
  <NConfigProvider :theme-overrides="themeOverrides">
    <div class="app-shell">
      <!-- Desktop sidebar -->
      <aside class="sidebar-dt"><Sidebar /></aside>

      <!-- Main content -->
      <main class="main-area">
        <RouterView v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </RouterView>
      </main>

      <!-- Mobile bottom nav -->
      <BottomNav />
    </div>
  </NConfigProvider>
</template>

<script setup lang="ts">
import { NConfigProvider } from "naive-ui";
import Sidebar from "./components/Sidebar.vue";
import BottomNav from "./components/BottomNav.vue";

const themeOverrides = {
  common: {
    primaryColor: "#3b82f6",
    primaryColorHover: "#60a5fa",
    borderRadius: "10px",
    fontSize: "15px",
  },
  Card: {
    borderRadius: "10px",
    borderColor: "#e5e7eb",
    paddingMedium: "16px",
  },
  Switch: { railColorActive: "#3b82f6" },
};
</script>

<style>
.app-shell {
  display: flex;
  height: 100vh;
  background: #f3f4f6;
}
.sidebar-dt { flex-shrink: 0; }
.main-area {
  flex: 1;
  overflow: auto;
  background: #f3f4f6;
}
/* Desktop: content width limit + centered */
.main-inner {
  max-width: 1200px;
  margin: 0 auto;
}
.bottom-nav-safe { display: none; }

@media (max-width: 768px) {
  .app-shell { flex-direction: column; }
  .sidebar-dt { display: none; }
  .main-area { flex: 1; }
  .main-inner { max-width: none; }
  .bottom-nav-safe { display: flex; }
}

.page-fade-enter-active,
.page-fade-leave-active { transition: opacity 0.15s ease; }
.page-fade-enter-from,
.page-fade-leave-to { opacity: 0; }
</style>
