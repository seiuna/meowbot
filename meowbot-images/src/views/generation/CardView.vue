<script setup lang="ts">
import { computed } from 'vue'
import { z } from 'zod'
import { useGenerationData } from '@/composables/useGenerationData'
import { useRenderSignal } from '@/composables/useRenderSignal'
import { CardDataSchema, type CardData } from '@meowbot/shared'

type CardData = z.infer<typeof CardDataSchema>

const { loading, error, data } = useGenerationData<CardData>()

const languageColor = computed(() => {
  const theme = data.value?.theme || 'yellow'
  const maps: Record<string, string> = {
    yellow: 'bg-[#f1e05a]',    // JavaScript
    indigo: 'bg-indigo-500',   // TypeScript
    emerald: 'bg-emerald-500', // Vue
    rose: 'bg-rose-500',
    sky: 'bg-sky-500'
  }
  return maps[theme] || maps.yellow
})

const ready = computed(() => !loading.value && (!!data.value || !!error.value))
useRenderSignal(ready)
</script>

<template>
  <div class="bg-gray-50 flex items-center justify-center min-h-screen p-8 antialiased">
    
    <div v-if="loading" class="bg-white border border-gray-200 rounded-xl p-8 max-w-md w-full flex flex-col items-center gap-4 text-gray-500 shadow-sm">
      <span class="i-lucide-loader-circle animate-spin text-3xl text-gray-400" />
      <span class="text-sm font-medium tracking-wide">正在解析仓库数据...</span>
    </div>

    <div v-else-if="error" class="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md w-full shadow-sm flex items-start gap-4 text-red-600">
      <span class="i-lucide-alert-triangle text-xl shrink-0" />
      <div>
        <p class="font-bold text-sm">渲染失败</p>
        <p class="text-xs mt-1">{{ error }}</p>
      </div>
    </div>

    <div
      v-else-if="data"
      id="screenshot-target"
      class="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-300 p-5 font-sans"
    >
      
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center space-x-3">
          <img 
            v-if="data.author?.avatar" 
            class="w-9 h-9 rounded-full border border-gray-100 object-cover" 
            :src="data.author.avatar" 
            alt="Owner avatar" 
          />
          <div v-else class="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center">
            <span class="text-gray-400 text-xs font-bold">{{ data.author?.name?.charAt(0).toUpperCase() || 'O' }}</span>
          </div>

          <div>
            <h3 class="text-sm font-medium text-gray-500 flex items-center gap-1">
              <span>{{ data.author?.name || 'owner' }}</span>
              <span class="text-gray-300">/</span>
            </h3>
            <a href="#" class="text-base font-bold text-gray-900 hover:text-blue-600 transition-colors decoration-transparent">
              {{ data.title }}
            </a>
          </div>
        </div>
        
        <span class="px-2 py-0.5 text-xs font-semibold text-gray-600 bg-gray-100 rounded-full border border-gray-200">
          Public
        </span>
      </div>

      <p class="text-sm text-gray-600 line-clamp-2 mb-4 leading-relaxed">
        {{ data.content }}
      </p>

      <hr class="border-gray-100 mb-4" />

      <div class="flex items-center justify-between text-xs text-gray-500">
        
        <div class="flex items-center space-x-4">
          <div v-if="data.category" class="flex items-center space-x-1.5">
            <span class="w-3 h-3 rounded-full" :class="languageColor"></span>
            <span class="font-medium text-gray-700">{{ data.category }}</span>
          </div>

          <a 
            v-for="metric in data.metrics" 
            :key="metric.label"
            href="#" 
            class="flex items-center space-x-1 transition-colors hover:text-gray-800"
            :class="{
              'hover:text-yellow-600': metric.label.toLowerCase() === 'stars',
              'hover:text-green-600': metric.label.toLowerCase() === 'forks'
            }"
          >
            <svg v-if="metric.label.toLowerCase() === 'stars'" class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            <svg v-else-if="metric.label.toLowerCase() === 'forks'" class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>

            <span>{{ metric.value }}</span>
          </a>
        </div>

        <div class="text-gray-400 text-right">
          {{ data.updatedAt }}
        </div>
        
      </div>
    </div>
  </div>
</template>