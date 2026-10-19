<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import MainLayout from './layouts/MainLayout.vue'
import { useRobotRuntimeStore } from './stores/robotRuntime'

const runtimeStore = useRobotRuntimeStore()

onMounted(async () => {
  await runtimeStore.initializeDataSource()

  if (runtimeStore.dataSourceMode === 'mock') {
    runtimeStore.startMockPoseStream()
  }
})

onBeforeUnmount(() => {
  runtimeStore.stopMockPoseStream()
  runtimeStore.stopDataSource()
})
</script>

<template>
  <MainLayout>
    <router-view />
  </MainLayout>
</template>

<style>
:root {
  --color-sidebar: #0b3b2e;
  --color-page-bg: #eef2f6;
  --color-surface-soft: #f8fafc;
  --color-card: #ffffff;
  --color-text: #1f2937;
  --color-text-strong: #334155;
  --color-muted: #6b7280;
  --color-subtle: #9ca3af;
  --color-text-tertiary: #64748b;
  --color-border: #e5e7eb;
  --color-border-strong: #cbd5e1;
  --color-border-soft: #f1f5f9;
  --color-primary: #10b981;
  --color-primary-dark: #0b3b2e;
  --color-primary-strong: #047857;
  --color-primary-deep: #065f46;
  --color-primary-border: #a7f3d0;
  --color-primary-bg: #ecfdf5;
  --color-warning: #f59e0b;
  --color-warning-strong: #b45309;
  --color-warning-border: #fde68a;
  --color-warning-bg: #fffbeb;
  --color-error: #ef4444;
  --color-error-strong: #dc2626;
  --color-error-deep: #b91c1c;
  --color-error-border: #fecaca;
  --color-error-bg: #fef2f2;
  --color-neutral-bg: #f3f4f6;
}

html,
body,
#app {
  margin: 0;
  height: 100%;
  overflow: hidden;
}

body {
  background: var(--color-page-bg);
  color: var(--color-text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
}

* {
  box-sizing: border-box;
}
</style>
