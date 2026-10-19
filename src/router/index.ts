import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/overview',
    },
    {
      path: '/overview',
      name: 'overview',
      component: () => import('../views/overview/index.vue'),
    },
    {
      path: '/map',
      name: 'map',
      component: () => import('../views/map/index.vue'),
    },
    {
      path: '/task',
      name: 'task',
      component: () => import('../views/task/index.vue'),
    },
    {
      path: '/status',
      name: 'status',
      component: () => import('../views/status/index.vue'),
    },
    {
      path: '/log',
      name: 'log',
      component: () => import('../views/log/index.vue'),
    },
  ],
})

export default router
