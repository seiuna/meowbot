import { watchPostEffect, onUnmounted } from 'vue'
import type { Ref } from 'vue'

/**
 * Signal to Puppeteer that Vue has finished rendering AND the browser has
 * actually painted the frame.
 *
 * Sets `window.__VUE_RENDERED__ = true` once the given reactive `ready`
 * ref becomes truthy.  Puppeteer's `waitForFunction` polls this flag
 * before taking a screenshot.
 *
 * **Why double `requestAnimationFrame` instead of `nextTick`?**
 * `nextTick` only guarantees the virtual DOM has been flushed to the real
 * DOM — it does NOT guarantee the browser has finished layout + paint.
 * The first `rAF` fires before the next style/layout pass; nesting a
 * second `rAF` fires AFTER the paint has been committed, ensuring the
 * screenshot captures the final visual state.
 *
 * **`document.fonts.ready`** — waits for any pending web fonts to load,
 * preventing screenshots with fallback/missing fonts.
 *
 * Usage in any generation page:
 * ```ts
 * const { loading, error, data } = useGenerationData<MyType>()
 * const ready = computed(() => !loading.value && (!!data.value || !!error.value))
 * useRenderSignal(ready)
 * ```
 */
export function useRenderSignal(ready: Ref<boolean>) {
  // Force initial state — guarantees Puppeteer sees a clean flag on mount
  ;(window as any).__VUE_RENDERED__ = false

  // watchPostEffect runs after Vue has flushed DOM updates (equivalent to
  // watch + flush: 'post'), so the DOM is already patched when we enter.
  const stopWatch = watchPostEffect(async () => {
    if (ready.value) {
      // 1. Wait for web fonts to finish loading — prevents font flicker
      //    in screenshots (Puppeteer captures mid-load otherwise).
      if ('fonts' in document) {
        await document.fonts.ready
      }

      // 2. Double rAF: the first queues before the next paint; the second
      //    fires after that paint has been committed to the screen.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ;(window as any).__VUE_RENDERED__ = true
        })
      })
    } else {
      // ready became false (e.g. __RENDER_PAGE__ pushed new data but Vue
      // hasn't re-rendered yet) — reset the signal so Puppeteer waits.
      ;(window as any).__VUE_RENDERED__ = false
    }
  })

  // HMR / component unmount cleanup
  onUnmounted(() => {
    stopWatch()
    delete (window as any).__VUE_RENDERED__
  })
}
