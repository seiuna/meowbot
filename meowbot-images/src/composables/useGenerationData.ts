import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'

/**
 * Unified data loader for generation routes.
 *
 * **Data sources (in priority order):**
 * 1. `window.__INITIAL_DATA__` — injected by Puppeteer `evaluateOnNewDocument` (zero latency)
 * 2. `window.__RENDER_PAGE__(data)` — called by Puppeteer on an already-loaded page
 *    to push new data without reloading (no `page.goto()`)
 * 3. `fetch('/generation?key=xxx')` — fetch from AppServer API (fallback)
 *
 * **Rendering signal responsibility:**
 * This composable only resets `__VUE_RENDERED__` to `false` when new data arrives.
 * Setting it back to `true` is the sole responsibility of `useRenderSignal`,
 * which uses `watchPostEffect` + double `requestAnimationFrame` to guarantee
 * the browser has actually painted before Puppeteer takes a screenshot.
 */
export function useGenerationData<T = any>() {
  const route = useRoute()
  const loading = ref(true)
  const error = ref('')
  const data = ref<T | null>(null)

  onMounted(async () => {
    // ── Register global re-render function for Puppeteer ──
    // Must be registered BEFORE any early-return branch so it's always
    // available when Puppeteer calls __RENDER_PAGE__ on a loaded page.
    ;(window as any).__RENDER_PAGE__ = async (newData: T) => {
// 1. 强制重置全局渲染信号，防止 Node.js 读到脏数据
  ;(window as any).__VUE_RENDERED__ = false

  // 2. 制造“心跳”：强行回到 loading 状态，清空旧数据
  loading.value = true
  data.value = null as any // 视你的泛型而定，或者不写这一行只改 loading

  // 3. 关键点：等待 Vue 将 loading=true 的状态推入真实 DOM
  // 此时组件里的 ready 会变成 false，触发一次无效的 watcher
  await nextTick()

  // 4. 塞入新数据并解除 loading
  // 此时 ready 会从 false 瞬间变成 true，完美且必然地触发 useRenderSignal 的 watcher！
  data.value = newData
  loading.value = false
  error.value = ''
    }

    // ── Channel A: injected by Puppeteer evaluateOnNewDocument ──
    const initial = (window as any).__INITIAL_DATA__ as T | undefined
    if (initial !== undefined) {
      data.value = initial
      loading.value = false
      return
    }

    // ── Channel B: fetch from API ──
    const key = route.query.key as string
    const api = route.query.api as string

    if (!key || !api) {
      error.value = '缺少 key 或 api 参数'
      loading.value = false
      return
    }

    try {
      const res = await fetch(`${api}/generation?key=${encodeURIComponent(key)}`)
      if (!res.ok) {
        const err = await res.json()
        error.value = err.error || '请求失败'
        loading.value = false
        return
      }
      data.value = await res.json()
    } catch (e: any) {
      error.value = e.message || '网络错误'
    } finally {
      loading.value = false
    }
  })

  // HMR cleanup: remove global side effects on unmount
  onUnmounted(() => {
    delete (window as any).__RENDER_PAGE__
  })

  return { loading, error, data }
}
