<template>
  <div class="page-content">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <h3 class="page-heading">Config</h3>
      <n-button type="primary" @click="save">Save</n-button>
    </div>
    <n-card size="small">
      <n-input v-model:value="json" type="textarea" :autosize="{ minRows: 30 }" style="font-family:monospace;font-size:13px" />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { NCard, NInput, NButton } from "naive-ui";

const json = ref("");
onMounted(async () => { json.value = JSON.stringify(await fetch("/api/config").then(r => r.json()), null, 2); });
async function save() {
  await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: json.value });
  alert("Saved");
}
</script>
