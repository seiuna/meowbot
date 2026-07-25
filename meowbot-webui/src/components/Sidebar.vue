<template>
  <div style="width:220px;background:#fff;border-right:1px solid #e5e7eb;display:flex;flex-direction:column;height:100vh">
    <div style="padding: 24px 18px 18px; border-bottom: 1px solid #e5e7eb">
      <h2 style="margin: 0; font-size: 20px; font-weight: 600">MeowBot</h2>
      <p style="margin: 2px 0 0; font-size: 11px; color: #9ca3af; font-family: monospace">control panel</p>
    </div>
    <div style="flex:1;overflow:auto;padding:4px 8px">
      <NMenu :value="route.path" :options="menuOptions" @update:value="navigate" />
    </div>
    <div style="padding:12px 18px;border-top:1px solid #e5e7eb">
      <p style="font-size:11px;color:#9ca3af;font-family:monospace;margin:0">meowbot v1.0</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { h } from "vue";
import { useRouter, useRoute } from "vue-router";
import { NMenu } from "naive-ui";
import type { MenuOption } from "naive-ui";

const router = useRouter();
const route = useRoute();

function icon(path: string) {
  return () => h("svg", { xmlns: "http://www.w3.org/2000/svg", width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", innerHTML: path });
}

const menuOptions: MenuOption[] = [
  { label: "Dashboard", key: "/", icon: icon('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>') },
  { label: "Agents", key: "/agents", icon: icon('<path d="M12 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/><path d="M3 21v-2a7 7 0 0 1 14 0v2"/><circle cx="9" cy="8" r="1"/><circle cx="15" cy="8" r="1"/><path d="M9 12h6"/>') },
  { label: "Tools", key: "/tools", icon: icon('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>') },
  { label: "Workspace", key: "/workspace", icon: icon('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>') },
  { label: "Prompts", key: "/prompts", icon: icon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>') },
  { label: "Config", key: "/config", icon: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>') },
  { label: "Commands", key: "/commands", icon: icon('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>') },
];

function navigate(key: string) { router.push(key); }
</script>
