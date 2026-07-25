<template>
  <nav class="bottom-nav-safe" style="background:#fff;border-top:1px solid #e5e7eb;display:flex;justify-content:space-around;align-items:center;padding:6px 0 8px 0">
    <button v-for="item in items" :key="item.key" @click="$router.push(item.key)"
      :style="{
        display:'flex',flexDirection:'column',alignItems:'center',gap:'2px',
        background:'none',border:'none',cursor:'pointer',padding:'6px 10px',borderRadius:'8px',
        color: $route.path === item.key ? '#3b82f6' : '#9ca3af',
        fontWeight: $route.path === item.key ? 600 : 400,
        fontSize:'11px',minWidth:'56px',
      }"
    >
      <span v-html="item.icon" style="display:flex;alignItems:center"></span>
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { useRoute } from "vue-router";
const $route = useRoute();

function svg(d: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

const items = [
  { key: "/", label: "Home", icon: svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>') },
  { key: "/agents", label: "Agents", icon: svg('<path d="M12 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/><path d="M3 21v-2a7 7 0 0 1 14 0v2"/>') },
  { key: "/tools", label: "Tools", icon: svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>') },
  { key: "/workspace", label: "Files", icon: svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>') },
  { key: "/config", label: "Config", icon: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>') },
];
</script>
