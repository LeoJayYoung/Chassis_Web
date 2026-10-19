<script setup lang="ts">
const navItems = [
  { label: 'Overview', to: '/overview' },
  { label: 'Map Control', to: '/map' },
  { label: 'Tasks', to: '/task' },
  { label: 'Status', to: '/status' },
  { label: 'Logs', to: '/log' },
]
</script>

<template>
  <div class="main-layout">
    <aside class="main-layout__sidebar">
      <div class="main-layout__brand">
        <div class="main-layout__logo">农</div>
        <div>
          <span class="main-layout__eyebrow">Chassis Monitor</span>
          <h1 class="main-layout__title">底盘监控系统</h1>
        </div>
      </div>

      <span class="main-layout__section">NAVIGATION</span>

      <nav class="main-layout__nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="main-layout__link"
          active-class="main-layout__link--active"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <section class="main-layout__robot">
        <span class="main-layout__robot-title">机器人 · AMR-001</span>
        <div class="main-layout__robot-row">
          <strong>82%</strong>
          <span>信号稳定</span>
        </div>
        <div class="main-layout__battery">
          <span></span>
        </div>
      </section>
    </aside>

    <main class="main-layout__content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.main-layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
  background: var(--color-page-bg);
}

.main-layout__sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100vh;
  padding: 18px 12px 14px;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background: var(--color-sidebar);
  color: #ffffff;
  box-shadow: 8px 0 24px rgba(11, 59, 46, 0.08);
}

.main-layout__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 8px;
}

.main-layout__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 16px;
  font-weight: 800;
}

.main-layout__eyebrow {
  color: rgba(255, 255, 255, 0.48);
  font-size: 10px;
  font-weight: 500;
}

.main-layout__title {
  margin: 0 0 2px;
  color: #ffffff;
  font-size: 14px;
  line-height: 1.2;
}

.main-layout__section {
  padding: 0 8px;
  color: rgba(255, 255, 255, 0.42);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.main-layout__nav {
  display: grid;
  align-content: start;
  gap: 3px;
  flex: 1;
}

.main-layout__link {
  display: flex;
  align-items: center;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 13px;
  text-decoration: none;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.main-layout__link:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.88);
}

.main-layout__link--active {
  background: rgba(16, 185, 129, 0.18);
  color: var(--color-primary);
  font-weight: 700;
}

.main-layout__robot {
  display: grid;
  gap: 7px;
  padding: 12px;
  border: 1px solid rgba(16, 185, 129, 0.22);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
}

.main-layout__robot-title {
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  font-weight: 700;
}

.main-layout__robot-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.main-layout__robot-row strong {
  color: #ffffff;
  font-size: 16px;
}

.main-layout__robot-row span {
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 600;
}

.main-layout__battery {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
}

.main-layout__battery span {
  display: block;
  width: 82%;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
}

.main-layout__content {
  min-width: 0;
  height: 100vh;
  overflow: hidden;
  padding: 16px 20px;
  background: var(--color-page-bg);
}

@media (max-width: 900px) {
  .main-layout {
    grid-template-columns: 1fr;
  }

  .main-layout__sidebar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
    padding: 14px;
  }

  .main-layout__nav {
    display: flex;
    overflow-x: auto;
  }

  .main-layout__link {
    flex: none;
  }

  .main-layout__robot,
  .main-layout__section {
    display: none;
  }
}
</style>
