<template>
  <div class="page-content">
    <h3 class="page-heading">Tools</h3>
    <n-empty v-if="!providers.length" description="No tools loaded" style="padding:60px 0" />
    <div v-else>
      <div v-for="p in providers" :key="p.name" style="margin-bottom: 28px">
        <div style="margin-bottom:14px;display:flex;align-items:center;gap:8px">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          <div>
            <span style="font-weight:600;font-size:16px">{{ p.name }}</span>
            <span style="margin-left:8px;font-size:13px;color:#9ca3af">{{ p.description }}</span>
          </div>
        </div>
        <div class="tools-grid">
          <div v-for="t in p.tools" :key="t.name">
            <n-card size="small" hoverable>
              <template #header>
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="font-weight:600;font-size:14px;font-family:monospace">{{ t.name }}</span>
                </div>
              </template>
              <template #header-extra>
                <n-switch :value="t.isEnabled" @update:value="(v: boolean) => toggle(t.name, v)" size="small" />
              </template>
              <div style="font-size:13px;color:#6b7280;line-height:1.5;margin-bottom:8px">{{ t.description }}</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <n-tag v-for="perm in t.perms" :key="perm" size="tiny" type="warning" :bordered="false">{{ perm }}</n-tag>
                <n-tag v-if="t.required" size="tiny" type="error" :bordered="false">requires user</n-tag>
              </div>
            </n-card></div></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { NCard, NSwitch, NTag, NEmpty } from "naive-ui";

const providers = ref<any[]>([]);

async function load() { providers.value = await fetch("/api/tools").then(r => r.json()); }
async function toggle(name: string, enabled: boolean) {
  await fetch("/api/tools/toggle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, enabled }) });
  load();
}
onMounted(load);
</script>

<style scoped>
.tools-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1100px) { .tools-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 768px)  { .tools-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px)  { .tools-grid { grid-template-columns: 1fr; } }
</style>
