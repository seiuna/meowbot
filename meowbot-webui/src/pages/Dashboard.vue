<template>
  <div class="page-content">
    <h3 class="page-heading">Dashboard</h3>
    <div class="stats-grid">
      <n-card v-for="s in statsCards" :key="s.label" hoverable>
        <n-statistic :label="s.label" :value="s.value" />
      </n-card>
    </div>
    <div class="panel-grid">
      <n-card title="Active Agents" hoverable>
        <div v-if="agents.length" style="display:flex;flex-direction:column;gap:10px">
          <div v-for="a in agents" :key="a.id" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f3f4f6">
            <div><div style="font-weight:500;font-size:14px">{{ a.name }}</div><div style="font-size:12px;color:#9ca3af">{{ a.description }}</div></div>
            <n-tag size="small" round :bordered="false">{{ a.threads }} threads</n-tag>
          </div>
        </div>
        <n-empty v-else description="No agents" style="padding:20px 0" />
      </n-card>
      <n-card title="Per Model" hoverable>
        <div v-if="models.length" style="display:flex;flex-direction:column;gap:8px;font-size:13px">
          <div v-for="m in models" :key="m.model" style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f3f4f6">
            <span style="font-weight:500">{{ m.model_name || m.model }}</span>
            <span style="color:#9ca3af;font-family:monospace;font-size:11px">{{ m.total_calls }} calls</span>
          </div>
        </div>
        <n-empty v-else description="No data" style="padding:20px 0" />
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { NCard, NStatistic, NTag, NEmpty } from "naive-ui";
const statsCards = ref<any[]>([
  { label: "Agents", value: 0 }, { label: "Tools", value: 0 },
  { label: "API Calls", value: 0 }, { label: "Tokens", value: "0" },
]);
const agents = ref<any[]>([]);
const models = ref<any[]>([]);
onMounted(async () => {
  try {
    const [s, a] = await Promise.all([fetch("/api/stats").then(r => r.json()), fetch("/api/agents").then(r => r.json())]);
    agents.value = a; models.value = s.by_model || [];
    const total = s.total_input + s.total_output;
    statsCards.value = [
      { label: "Agents", value: s.agents }, { label: "Tools", value: s.tools },
      { label: "API Calls", value: s.total_calls },
      { label: "Tokens", value: total >= 1000 ? (total / 1000).toFixed(1) + "k" : String(total) },
    ];
  } catch {}
});
</script>

<style scoped>
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
.panel-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
@media (max-width: 768px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .panel-grid { grid-template-columns: 1fr; }
}
</style>
