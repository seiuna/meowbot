<script setup lang="ts">
import { computed, nextTick, reactive, onMounted } from 'vue'
import { marked } from 'marked'

// ── Number of concurrent slot workers ──
const NUM_SLOTS = 10

marked.setOptions({ gfm: true, breaks: true })

// ── Per-slot reactive state ──

interface SlotState {
  loading: boolean
  error: string
  data: Record<string, unknown> | null
  rendered: boolean
}

const slots = reactive<Record<number, SlotState>>(
  Object.fromEntries(
    Array.from({ length: NUM_SLOTS }, (_, i) => [
      i,
      { loading: false, error: '', data: null, rendered: false },
    ]),
  ),
)

/** 0-indexed slot IDs for template iteration */
const slotIds = Array.from({ length: NUM_SLOTS }, (_, i) => i)

// ── Layout constants (must match screenshot-task.ts viewport calculation) ──
const SLOT_H = 850    // fixed slot height (generous for card content)
const GAP = 16        // vertical gap between slots
const PAD = 16        // page padding (p-4)

/** Absolute position for slot N: top = PAD + N × (SLOT_H + GAP) */
function slotStyle(slotId: number) {
  return {
    width: '800px',
    height: `${SLOT_H}px`,
    top: `${PAD + slotId * (SLOT_H + GAP)}px`,
  }
}

/** Total page height so the wrapper fills the viewport */
const pageStyle = {
  minHeight: `${PAD * 2 + NUM_SLOTS * SLOT_H + (NUM_SLOTS - 1) * GAP}px`,
}

// ── Theme mapping (shared with CardView) ──

function themeClasses(theme: string | undefined) {
  const maps: Record<string, Record<string, string>> = {
    indigo: {
      gradient: 'from-indigo-500/10 to-purple-500/5',
      accentBg: 'bg-indigo-50 dark:bg-indigo-950/30',
      accentText: 'text-indigo-600 dark:text-indigo-400',
      border: 'border-indigo-100 dark:border-indigo-900/50',
      bar: 'bg-indigo-600 dark:bg-indigo-500',
    },
    emerald: {
      gradient: 'from-emerald-500/10 to-teal-500/5',
      accentBg: 'bg-emerald-50 dark:bg-emerald-950/30',
      accentText: 'text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-100 dark:border-emerald-900/50',
      bar: 'bg-emerald-600 dark:bg-emerald-500',
    },
    rose: {
      gradient: 'from-rose-500/10 to-pink-500/5',
      accentBg: 'bg-rose-50 dark:bg-rose-950/30',
      accentText: 'text-rose-600 dark:text-rose-400',
      border: 'border-rose-100 dark:border-rose-900/50',
      bar: 'bg-rose-600 dark:bg-rose-500',
    },
    amber: {
      gradient: 'from-amber-500/10 to-orange-500/5',
      accentBg: 'bg-amber-50 dark:bg-amber-950/30',
      accentText: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-100 dark:border-amber-900/50',
      bar: 'bg-amber-600 dark:bg-amber-500',
    },
    sky: {
      gradient: 'from-sky-500/10 to-blue-500/5',
      accentBg: 'bg-sky-50 dark:bg-sky-950/30',
      accentText: 'text-sky-600 dark:text-sky-400',
      border: 'border-sky-100 dark:border-sky-900/50',
      bar: 'bg-sky-600 dark:bg-sky-500',
    },
  }
  return maps[theme ?? 'indigo'] ?? maps.indigo
}

// ── Computer markdown per slot ──
function slotHtml(slotId: number) {
  return computed(() => {
    const d = slots[slotId]?.data
    if (!d) return ''
    return marked((d as any).content || '') as string
  })
}
// Pre-compute for template
const slotHtmlMap: Record<number, ReturnType<typeof computed>> = {}
for (let i = 0; i < NUM_SLOTS; i++) {
  slotHtmlMap[i] = slotHtml(i)
}

// ══════════════════════════════════════════════════
// Global API — called by Puppeteer via page.evaluate
// ══════════════════════════════════════════════════

/**
 * Puppeteer calls this to push data into a slot and trigger rendering.
 *
 * The function:
 * 1. Fetches data from the server API
 * 2. Updates the reactive state for the specific slot
 * 3. Awaits nextTick() so the virtual DOM flushes to real DOM
 * 4. Sets data-render-done="true" on the slot DOM node
 *
 * Puppeteer then polls data-render-done before taking the screenshot.
 */
;(window as any).__RENDER_SLOT__ = async (slotId: number, apiUrl: string, key: string) => {
  const slot = slots[slotId]
  if (!slot) return

  slot.loading = true
  slot.rendered = false

  try {
    const res = await fetch(`${apiUrl}/generation?key=${encodeURIComponent(key)}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Fetch failed' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    slot.data = await res.json()
    slot.error = ''
  } catch (e: any) {
    slot.error = e.message || 'Unknown error'
    slot.data = null
  } finally {
    slot.loading = false
  }

  // Wait for Vue to flush virtual DOM → real DOM
  await nextTick()

  // Mark the specific slot DOM node as ready
  const el = document.querySelector(`#worker-slot-${slotId}`)
  if (el) {
    el.setAttribute('data-render-done', 'true')
  }
  slot.rendered = true
}

/**
 * Puppeteer calls this after screenshot to free the slot for reuse.
 */
;(window as any).__CLEAR_SLOT__ = (slotId: number) => {
  const slot = slots[slotId]
  if (slot) {
    slot.data = null
    slot.error = ''
    slot.loading = false
    slot.rendered = false
  }
  const el = document.querySelector(`#worker-slot-${slotId}`)
  if (el) {
    el.removeAttribute('data-render-done')
  }
}

// ── Signal that the global API is mounted ──
onMounted(() => {
  ;(window as any).__SLOT_API_READY__ = true
})
</script>

<template>
  <div class="relative bg-slate-900 p-4 antialiased" :style="pageStyle">
    <!--
      Slot workers — absolute positioning for deterministic coordinates.
      Slot N is at top = 16px (pad) + N × (SLOT_H + GAP).
      Viewport height is set by the backend to accommodate all slots.
    -->
    <div>
      <div
        v-for="slotId in slotIds"
        :id="`worker-slot-${slotId}`"
        :key="slotId"
        class="slot-worker absolute left-4 bg-slate-800/90 backdrop-blur-md border border-slate-700/60 rounded-3xl shadow-2xl overflow-hidden"
        :style="slotStyle(slotId)"
      >
        <!-- Placeholder when idle -->
        <div
          v-if="!slots[slotId].data && !slots[slotId].loading && !slots[slotId].error"
          class="flex items-center justify-center text-slate-500 text-sm select-none"
          style="height: 100%;"
        >
          <span class="i-lucide-image text-4xl opacity-30 mr-2" />
          Slot #{{ slotId }} — idle
        </div>

        <!-- Loading -->
        <div
          v-if="slots[slotId].loading"
          class="flex items-center justify-center text-slate-400 gap-3"
          style="height: 100%;"
        >
          <span class="i-lucide-loader-circle animate-spin text-2xl" />
          <span class="text-sm">Rendering slot #{{ slotId }}...</span>
        </div>

        <!-- Error -->
        <div
          v-if="slots[slotId].error"
          class="flex items-center justify-center text-rose-400 gap-2 p-8"
          style="height: 100%;"
        >
          <span class="i-lucide-alert-triangle text-xl" />
          <span class="text-sm">{{ slots[slotId].error }}</span>
        </div>

        <!-- Rendered card -->
        <div
          v-if="slots[slotId].data && !slots[slotId].loading"
          class="p-8 flex flex-col gap-6"
        >
          <div
            class="absolute inset-0 bg-gradient-to-br -z-10 pointer-events-none"
            :class="themeClasses((slots[slotId].data as any)?.theme).gradient"
          />

          <!-- Header: category + tags -->
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/50 pb-4">
            <div class="flex items-center gap-2">
              <span
                v-if="(slots[slotId].data as any)?.category"
                class="px-3 py-1 rounded-full text-xs font-semibold tracking-wider uppercase"
                :class="[
                  themeClasses((slots[slotId].data as any)?.theme).accentBg,
                  themeClasses((slots[slotId].data as any)?.theme).accentText,
                ]"
              >
                {{ (slots[slotId].data as any).category }}
              </span>
            </div>
            <div class="flex items-center gap-1.5">
              <span
                v-for="tag in (slots[slotId].data as any)?.tags"
                :key="tag"
                class="bg-slate-700/40 text-slate-300 text-xs px-2.5 py-0.5 rounded-md border border-slate-600/30"
              >
                #{{ tag }}
              </span>
            </div>
          </div>

          <!-- Title -->
          <h1 class="text-2xl font-black text-slate-100 tracking-tight leading-snug">
            {{ (slots[slotId].data as any).title }}
          </h1>

          <!-- Author -->
          <div
            v-if="(slots[slotId].data as any)?.author"
            class="flex items-center gap-3.5 bg-slate-700/20 p-3 rounded-xl border border-slate-700/40"
          >
            <img
              v-if="(slots[slotId].data as any).author.avatar"
              :src="(slots[slotId].data as any).author.avatar"
              class="w-11 h-11 rounded-xl bg-slate-600 shadow-inner"
              alt="avatar"
            />
            <div class="overflow-hidden">
              <h4 class="text-sm font-bold text-slate-200">
                {{ (slots[slotId].data as any).author.name }}
              </h4>
              <p
                v-if="(slots[slotId].data as any).author.bio"
                class="text-xs text-slate-400 truncate mt-0.5"
              >
                {{ (slots[slotId].data as any).author.bio }}
              </p>
            </div>
          </div>

          <!-- Metrics -->
          <div
            v-if="(slots[slotId].data as any)?.metrics?.length"
            class="grid grid-cols-2 gap-4"
          >
            <div
              v-for="item in (slots[slotId].data as any).metrics"
              :key="item.label"
              class="bg-slate-900/40 border border-slate-700/40 rounded-xl p-3.5 flex items-center justify-between"
            >
              <div>
                <p class="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {{ item.label }}
                </p>
                <p class="text-lg font-extrabold text-slate-100 mt-0.5">{{ item.value }}</p>
              </div>
              <div
                v-if="item.icon"
                class="text-xl opacity-80"
                :class="[themeClasses((slots[slotId].data as any)?.theme).accentText, item.icon]"
              />
            </div>
          </div>

          <!-- Progress -->
          <div
            v-if="(slots[slotId].data as any)?.progress"
            class="bg-slate-900/30 border p-4 rounded-xl flex flex-col gap-2"
            :class="themeClasses((slots[slotId].data as any)?.theme).border"
          >
            <div class="flex justify-between text-xs font-bold">
              <span class="text-slate-300">
                {{ (slots[slotId].data as any).progress.label }}
              </span>
              <span :class="themeClasses((slots[slotId].data as any)?.theme).accentText">
                {{ (slots[slotId].data as any).progress.percentage }}%
              </span>
            </div>
            <div class="w-full bg-slate-700 h-2.5 rounded-full overflow-hidden">
              <div
                class="h-full transition-all duration-500"
                :class="themeClasses((slots[slotId].data as any)?.theme).bar"
                :style="{ width: `${(slots[slotId].data as any).progress.percentage}%` }"
              />
            </div>
            <p
              v-if="(slots[slotId].data as any).progress.statusText"
              class="text-xs text-slate-400 mt-0.5 italic"
            >
              💡 {{ (slots[slotId].data as any).progress.statusText }}
            </p>
          </div>

          <!-- Markdown content -->
          <article
            class="prose prose-slate dark:prose-invert max-w-none text-slate-300 prose-sm prose-headings:text-slate-100 prose-headings:font-bold prose-strong:text-slate-100 prose-code:text-amber-400 prose-code:bg-slate-900 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-blockquote:border-l-4 prose-blockquote:border-slate-600 prose-blockquote:bg-slate-900/20 prose-blockquote:p-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg"
            v-html="slotHtmlMap[slotId].value"
          />
        </div>
      </div>
    </div>
  </div>
</template>
