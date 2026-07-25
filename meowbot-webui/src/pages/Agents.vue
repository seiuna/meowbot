<template>
  <div class="page-content">
    <h3 class="page-heading">Agents</h3>
    <div v-if="agents.length" style="display:flex;flex-direction:column;gap:16px">
      <NCard v-for="a in agents" :key="a.id" size="small">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-weight:600;font-size:16px">{{ a.name }}</div>
            <div style="font-size:14px;color:#797979;margin-top:4px">{{ a.description }}</div>
          </div>
          <NTag type="success" size="small" round>{{ a.threads }} threads</NTag>
        </div>
      </NCard>
    </div>
    <n-empty v-if="!agents.length" description="No agents" style="padding:60px 0" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { NCard, NTag, NEmpty } from "naive-ui";
const agents = ref<any[]>([]);
onMounted(async () => { try { agents.value = await fetch("/api/agents").then(r => r.json()); } catch {} });
</script>
