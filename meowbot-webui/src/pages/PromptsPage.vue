<template>
  <div class="page-content">
    <h3 class="page-heading">Prompts</h3>
    <n-grid :cols="2" :x-gap="16" style="height: calc(100vh - 120px)">
      <n-gi>
        <n-card title="Templates" size="small" style="height:100%">
          <template #header-extra>
            <n-button size="tiny" type="primary" @click="newPrompt">New</n-button>
          </template>
          <div v-for="p in prompts" :key="p.name" style="padding:6px 0;cursor:pointer;border-bottom:1px solid #f0f0f0"
            @click="selectPrompt(p.name)">
            <div style="font-weight:500">{{ p.name }}</div>
            <div style="font-size:12px;color:#999">{{ p.preview }}</div>
          </div>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card size="small" style="height:100%">
          <template #header>
            <div style="display:flex;align-items:center;gap:8px">
              <span>{{ editing || "Select or create" }}</span>
              <n-button v-if="editing" size="tiny" type="primary" @click="savePrompt">Save</n-button>
            </div>
          </template>
          <n-input v-if="editing" v-model:value="content" type="textarea" :autosize="{ minRows: 20 }" style="font-family:monospace;font-size:13px" />
          <div v-else style="color:#999;text-align:center;padding-top:80px">Select a template to edit</div>
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { NCard, NInput, NButton, NGrid, NGi } from "naive-ui";

const prompts = ref<any[]>([]);
const editing = ref("");
const content = ref("");

async function load() { prompts.value = await fetch("/api/prompts").then(r => r.json()); }
async function selectPrompt(name: string) {
  const data = await fetch("/api/prompts/file?name=" + name).then(r => r.json());
  editing.value = name; content.value = data.content;
}
async function savePrompt() {
  await fetch("/api/prompts/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editing.value, content: content.value }) });
  load();
}
function newPrompt() { editing.value = "new-prompt"; content.value = ""; }
onMounted(load);
</script>
