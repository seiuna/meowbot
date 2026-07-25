<template>
  <div class="page-content">
    <h3 class="page-heading">Workspace</h3>
    <n-grid :cols="2" :x-gap="16" style="height: calc(100vh - 120px)">
      <n-gi>
        <n-card title="Files" size="small" style="height:100%">
          <template #header-extra>
            <n-button size="tiny" @click="loadTree">Refresh</n-button>
          </template>
          <n-tree
            :data="treeData"
            :default-expand-all="false"
            @update:selected-keys="onSelect"
            @load="onLoadDir"
            block-line
            selectable
            :virtual-scroll="false"
          />
        </n-card>
      </n-gi>
      <n-gi>
        <n-card size="small" style="height:100%">
          <template #header>
            <div style="display:flex;align-items:center;gap:8px">
              <span>{{ editingFile || "Select a file" }}</span>
              <n-button v-if="editingFile" size="tiny" type="primary" @click="saveFile">Save</n-button>
              <n-button v-if="editingFile" size="tiny" @click="downloadFile">Download</n-button>
            </div>
          </template>
          <n-input
            v-if="editingFile"
            v-model:value="fileContent"
            type="textarea"
            :autosize="{ minRows: 20 }"
            style="font-family:monospace;font-size:13px"
          />
          <n-empty v-else description="Click a file in the tree to edit" style="padding-top:60px" />
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { NCard, NTree, NInput, NButton, NGrid, NGi, NEmpty } from "naive-ui";
import type { TreeOption } from "naive-ui";

const treeData = ref<TreeOption[]>([]);
const editingFile = ref("");
const fileContent = ref("");

// Key format: "wsId::relativePath"
function parseKey(key: string): { ws: string; path: string } {
  const idx = key.indexOf("::");
  if (idx === -1) return { ws: key, path: "" };
  return { ws: key.substring(0, idx), path: key.substring(idx + 2) };
}

function makeKey(ws: string, filePath: string): string {
  return ws + "::" + filePath;
}

async function loadTree() {
  const res = await fetch("/workspace", { method: "POST" }).then(r => r.json());
  const workspaces: Array<{ id: string; name: string; description: string }> = res.workspaces || [];
  treeData.value = workspaces.map(ws => ({
    label: ws.name + (ws.description ? ` (${ws.description})` : ""),
    key: ws.id,
    isLeaf: false,
    children: undefined, // lazy-load on expand
  }));
}

async function onLoadDir(node: TreeOption) {
  // Only load for workspace-level nodes (no "::" in key means it's a workspace root)
  const { ws, path } = parseKey(node.key as string);
  const url = path ? `/workspace/${ws}/${path}` : `/workspace/${ws}`;
  const res = await fetch(url, { method: "POST" }).then(r => r.json());
  if (res.error || res.type !== "directory") return;

  const entries: any[] = res.entries || [];
  node.children = entries.map((e: any) => ({
    label: e.name,
    key: makeKey(ws, e.path),
    isLeaf: e.type === "file",
    children: e.type === "dir" ? undefined : undefined,
  }));
  // Return children so NTree updates
  return node.children;
}

async function onSelect(keys: string[]) {
  if (!keys.length) return;
  const key = keys[0];
  const { ws, path } = parseKey(key);
  if (!path) return; // workspace root, not a file

  const res = await fetch(`/workspace/${ws}/${path}`, { method: "POST" }).then(r => r.json());
  if (res.error || res.type !== "file") return;
  editingFile.value = key;
  fileContent.value = res.content || "";
}

async function saveFile() {
  const { ws, path } = parseKey(editingFile.value);
  await fetch(`/workspace/${ws}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: fileContent.value }),
  });
}

function downloadFile() {
  const { ws, path } = parseKey(editingFile.value);
  window.open(`/api/workspace/download?path=${encodeURIComponent(path)}`);
}

onMounted(loadTree);
</script>
