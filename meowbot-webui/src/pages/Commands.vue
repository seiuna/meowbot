<template>
  <div class="page-content">
    <h3 class="page-heading">Commands</h3>
    <n-grid v-if="commands.length" :cols="3" :x-gap="12" :y-gap="12">
      <n-gi v-for="c in commands" :key="c.path">
        <n-card size="small" :title="c.path">
          <div style="font-size:13px;color:#666;line-height:1.5;margin-bottom:8px">{{ c.description || "No description" }}</div>
          <div v-if="c.requiredPermissions.length" style="display:flex;gap:4px;flex-wrap:wrap">
            <n-tag v-for="p in c.requiredPermissions" :key="p" size="tiny" type="warning">{{ p }}</n-tag>
          </div>
        </n-card>
      </n-gi>
    </n-grid>
    <n-spin v-else />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { NCard, NTag, NGrid, NGi, NSpin } from "naive-ui";
const commands = ref<any[]>([]);
onMounted(async () => { try { commands.value = await fetch("/api/commands").then(r => r.json()); } catch {} });
</script>
