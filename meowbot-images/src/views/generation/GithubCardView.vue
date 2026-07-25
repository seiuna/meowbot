<script setup lang="ts">
import { computed } from 'vue'
import { useGenerationData } from '@/composables/useGenerationData'
import { useRenderSignal } from '@/composables/useRenderSignal'
import { type CardData } from '@meowbot/shared'

const { loading, error, data } = useGenerationData<CardData>()

const repoInfo = computed(() => {
  const title = data.value?.title ?? ''
  const idx = title.indexOf('/')
  if (idx > 0) {
    return { owner: title.slice(0, idx), repo: title.slice(idx + 1) }
  }
  return { owner: '', repo: title }
})

const timeAgo = computed(() => {
  const ts = data.value?.updatedAt
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const minutes = Math.floor(diff / (1000 * 60))
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (minutes < 60) return `Updated ${minutes} minutes ago`
  if (hours < 24) return `Updated ${hours} hours ago`
  if (days === 1) return 'Updated 1 day ago'
  return `Updated ${days} days ago`
})

// ── Language → GitHub color dot ──
const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Java: '#b07219',
  Go: '#00ADD8',
  Rust: '#dea584',
  Ruby: '#701516',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Vue: '#41b883',
}
const langColor = computed(() => LANG_COLORS[data.value?.category ?? ''] ?? '#6b7280')

// ── Random vibrant color for the repo link ──
function randomVibrantColor(): string {
  const hue = Math.floor(Math.random() * 360)
  const saturation = 70 + Math.floor(Math.random() * 30) // 70-100%
  const lightness = 40 + Math.floor(Math.random() * 20)  // 40-60%
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

const linkColor = computed(() => randomVibrantColor())

const ready = computed(() => !loading.value && (!!data.value || !!error.value))
useRenderSignal(ready)
</script>

<template>
  <div class="min-h-screen w-screen bg-gray-50  items-center justify-center p-5 font-sans antialiased">

    <!-- Loading -->
    <div v-if="loading"
      class="bg-white/80 backdrop-blur border border-gray-200 rounded-xl p-8 max-w-md w-full flex flex-col items-center gap-3 text-gray-400 shadow-sm">
      <div class="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
      <span class="text-sm font-medium tracking-wide">正在拉取 GitHub 仓库元数据...</span>
    </div>

    <!-- Error -->
    <div v-else-if="error"
      class="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md w-full shadow-sm flex items-start gap-3">
      <svg class="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <div>
        <p class="font-semibold text-red-700 text-sm">数据解析失败</p>
        <p class="text-xs text-red-500/80 mt-1 leading-relaxed">{{ error }}</p>
      </div>
    </div>

    <!-- Card -->
    <div
      v-else-if="data"
      id="screenshot-target"
      class="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-300 p-5 font-sans"
    >
      <!-- Header: avatar + owner/repo + badge -->
      <div class="flex items-start justify-between">
        <div class="flex items-center space-x-3">
          <img
            v-if="data.author?.avatar"
            :src="data.author.avatar"
            class="w-9 h-9 rounded-full border border-gray-100"
            alt="Owner avatar"
          />
          <div v-else class="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center">
            <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div>
            <h3 class="text-sm font-medium text-gray-500 flex items-center gap-1">
              <span>{{ repoInfo.owner || data.author?.name || 'Owner' }}</span>
              <span class="text-gray-300">/</span>
            </h3>
            <a
              class="text-base font-bold decoration-2 underline-offset-2 hover:underline"
              :style="{ color: linkColor, textDecorationColor: linkColor }"
            >
              {{ repoInfo.repo || data.title }}
            </a>
          </div>
        </div>

        <span class="px-2 py-0.5 text-xs font-semibold text-gray-600 bg-gray-100 rounded-full border border-gray-200">
          {{ data.category || 'Public' }}
        </span>
      </div>
      <!-- Description -->
      <p class="text-sm text-gray-600 line-clamp-2 overflow-hidden leading-relaxed my-4">
        {{ data.content }}
      </p>


      <!-- Bottom: language + metrics + time -->
      <div class="flex items-center justify-between text-xs text-gray-500">
        <div class="flex items-center gap-5">
          <!-- Language dot + name -->
          <div class="flex items-center gap-1.5">
            <span class="w-3 h-3 rounded-full shrink-0" :style="{ backgroundColor: langColor }"></span>
            <span class="font-medium text-gray-700">{{ data.category || 'Unknown' }}</span>
          </div>

          <!-- Stars -->
          <span v-if="data.metrics?.[0]" class="flex items-center gap-1">
            <svg aria-hidden="true" data-component="Octicon" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-star mr-2 tmp-mr-2 text-gray-300">
                 <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"></path>
            </svg>
            <span>{{ data.metrics[0].value }}</span>
          </span>

          <!-- Forks -->
          <span v-if="data.metrics?.[1]" class="flex items-center gap-1">
           <svg aria-hidden="true" data-component="Octicon" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-repo-forked mr-2 tmp-mr-2 text-gray-300">
                 <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"></path>
            </svg>
            <span>{{ data.metrics[1].value }}</span>
          </span>
        </div>

        <!-- Updated time -->
        <div v-if="timeAgo" class="text-gray-400 text-right shrink-0">
          {{ timeAgo }}
        </div>
      </div>
    </div>

  </div>
</template>

<style>
/* Reset global #app constraints so the generation page renders full-bleed */
#app {
  max-width: none;
  margin: 0;
  padding: 0;
  display: block;
}
body {
  display: block;
  place-items: unset;
}

a {
  text-decoration: none;
}

/* Scale up the card for high-quality screenshots */
#screenshot-target {
  transform: scale(2);
  transform-origin: left top;
}
</style>
