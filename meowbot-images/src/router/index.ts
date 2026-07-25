import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/generation',
      children: [
        {
          path: 'card',
          name: 'generation-card',
          component: () => import('../views/generation/CardView.vue'),
        },
        {
          path: 'slot',
          name: 'generation-slot',
          component: () => import('../views/generation/SlotView.vue'),
        },
        {
          path: 'github-card',
          name: 'generation-github-card',
          component: () => import('../views/generation/GithubCardView.vue'),
        },
      ],
    },
  ],
})

export default router
