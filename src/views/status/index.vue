<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useRobotRuntimeStore } from '../../stores/robotRuntime'
import type { RuntimeHealthStatus } from '../../types'

type DiagnosticStatus = RuntimeHealthStatus

interface StatusRow {
  label: string
  value: string
  status: DiagnosticStatus
  mono?: boolean
  badge?: boolean
  muted?: boolean
}

interface TopicRow {
  topic: string
  value: string
  status: DiagnosticStatus
  badge?: string
  muted?: boolean
}

interface NavMetric {
  label: string
  value: string
}

const runtimeStore = useRobotRuntimeStore()
const { runtime } = storeToRefs(runtimeStore)

const NOT_CONNECTED = '未接入'

const statusLabels: Record<DiagnosticStatus, string> = {
  normal: '正常',
  warning: '警告',
  error: '异常',
}

const connectionLabels = {
  connected: '已连接',
  disconnected: '未连接',
} as const

const lastRefresh = computed(() => runtime.value.logs[0]?.time ?? '--')

const communicationStatus = computed<DiagnosticStatus>(() =>
  runtime.value.connection === 'connected' ? 'normal' : 'error',
)

const localizationStatus = computed<DiagnosticStatus>(() => {
  if (runtime.value.localization === 'ready') return 'normal'
  if (runtime.value.localization === 'initializing') return 'warning'
  return 'error'
})

const topicStatus = computed<DiagnosticStatus>(() => 'normal')

const navigationStatus = computed<DiagnosticStatus>(() =>
  runtime.value.map.routePoints.length > 1 ? 'normal' : 'warning',
)

const chassisStatus = computed<DiagnosticStatus>(() =>
  runtime.value.robot.status === 'online' ? 'normal' : 'error',
)

const subsystemCounts = computed(() => {
  const statuses = [
    communicationStatus.value,
    topicStatus.value,
    localizationStatus.value,
    navigationStatus.value,
    chassisStatus.value,
  ]

  return {
    normal: statuses.filter((status) => status === 'normal').length,
    warning: statuses.filter((status) => status === 'warning').length,
    error: statuses.filter((status) => status === 'error').length,
    total: statuses.length,
  }
})

const overallStatus = computed<DiagnosticStatus>(() => {
  if (subsystemCounts.value.error) return 'error'
  if (subsystemCounts.value.warning) return 'warning'
  return 'normal'
})

const systemHealthText = computed(() => {
  if (subsystemCounts.value.error) return '存在异常'
  return '运行良好'
})

const systemHealthNote = computed(
  () =>
    `${subsystemCounts.value.total} 个核心模块中，${subsystemCounts.value.normal} 个正常，` +
    `${subsystemCounts.value.warning} 个警告，${subsystemCounts.value.error} 个异常`,
)

const communicationRows = computed<StatusRow[]>(() => {
  const telemetry = runtime.value.telemetry?.communication
  const linkDelay = telemetry?.linkDelayMs ?? null

  return [
    {
      label: 'WebSocket',
      value: connectionLabels[runtime.value.connection],
      status: communicationStatus.value,
    },
    {
      label: '通信协议',
      value: 'ROS 2 / DDS',
      status: 'normal',
    },
    {
      label: '数据延迟',
      value:
        linkDelay == null ? NOT_CONNECTED : `${Math.round(linkDelay)} ms`,
      status: 'normal',
      mono: true,
      muted: linkDelay == null,
    },
    {
      label: '重连次数',
      value: `${telemetry?.reconnectCount ?? 0} 次`,
      status: 'normal',
      mono: true,
    },
    {
      label: '消息速率',
      value: NOT_CONNECTED,
      status: 'normal',
      mono: true,
      muted: true,
    },
  ]
})

const topicRows = computed<TopicRow[]>(() => [
  { topic: '/scan', value: NOT_CONNECTED, status: 'normal', muted: true },
  { topic: '/odom', value: NOT_CONNECTED, status: 'normal', muted: true },
  { topic: '/map', value: NOT_CONNECTED, status: 'normal', muted: true },
  { topic: '/plan', value: NOT_CONNECTED, status: 'normal', muted: true },
])

const localizationRows = computed<StatusRow[]>(() => [
  {
    label: '建图模式',
    value: NOT_CONNECTED,
    status: localizationStatus.value,
    muted: true,
  },
  {
    label: '空间坐标关系',
    value: runtime.value.localization === 'lost' ? '异常' : '正常',
    status: localizationStatus.value,
  },
  {
    label: '定位质量',
    value: runtime.value.localization === 'ready' ? '高' : '待稳定',
    status: localizationStatus.value,
    badge: true,
  },
  {
    label: '定位置信度',
    value: NOT_CONNECTED,
    status: localizationStatus.value,
    mono: true,
    muted: true,
  },
  {
    label: '地图坐标系',
    value: 'map -> base_link',
    status: localizationStatus.value,
    mono: true,
  },
])

const navigationLeftRows = computed<StatusRow[]>(() => [
  {
    label: '导航系统 (Nav2)',
    value: NOT_CONNECTED,
    status: 'normal',
    muted: true,
  },
  {
    label: '整体路线规划',
    value: NOT_CONNECTED,
    status: 'normal',
    muted: true,
  },
  {
    label: '实时避障控制',
    value: NOT_CONNECTED,
    status: 'normal',
    muted: true,
  },
])

const navigationRightRows = computed<StatusRow[]>(() => [
  {
    label: '路径状态',
    value: runtime.value.map.routePoints.length > 1 ? '有效' : '无路径',
    status: navigationStatus.value,
    badge: true,
  },
  {
    label: '目标状态',
    value: runtime.value.task.id,
    status: runtime.value.task.status === 'failed' ? 'error' : 'normal',
    mono: true,
  },
  {
    label: '异常脱困状态',
    value: runtime.value.task.status === 'failed' ? '需要处理' : '待命',
    status: runtime.value.task.status === 'failed' ? 'warning' : 'normal',
  },
])

const navigationMetrics = computed<NavMetric[]>(() => [
  { label: '路径长度', value: NOT_CONNECTED },
  { label: '预计到达', value: `${runtime.value.task.etaMinutes || 0} min` },
  { label: '障碍物', value: `${runtime.value.map.obstacles.length}` },
])

const chassisLeftRows = computed<StatusRow[]>(() => [
  {
    label: '底盘控制板 (STM32)',
    value: NOT_CONNECTED,
    status: 'normal',
    muted: true,
  },
  {
    label: '急停状态',
    value: NOT_CONNECTED,
    status: 'normal',
    muted: true,
  },
  {
    label: '驱动电机',
    value: NOT_CONNECTED,
    status: 'normal',
    muted: true,
  },
])

const chassisRightRows = computed<StatusRow[]>(() => [
  {
    label: '激光雷达',
    value: NOT_CONNECTED,
    status: 'normal',
    muted: true,
  },
  {
    label: '温度',
    value: NOT_CONNECTED,
    status: 'normal',
    mono: true,
    muted: true,
  },
  {
    label: '运行时长',
    value: NOT_CONNECTED,
    status: 'normal',
    mono: true,
    muted: true,
  },
])

function statusClass(status: DiagnosticStatus) {
  return `is-${status}`
}
</script>

<template>
  <section class="status-page">
    <header class="status-header">
      <div>
        <div class="status-header__eyebrow">
          <span>ROBOT CHASSIS CONTROL</span>
          <span>/</span>
          <strong>STATUS</strong>
        </div>
        <h1>Status</h1>
      </div>

      <div class="status-header__actions">
        <span class="last-updated">最后更新于 {{ lastRefresh }}</span>
        <button class="refresh-button" type="button">刷新状态</button>
      </div>
    </header>

    <section class="health-banner" :class="statusClass(overallStatus)">
      <div class="health-banner__icon" aria-hidden="true">
        <span></span>
      </div>
      <div class="health-banner__copy">
        <strong>整体状态：{{ systemHealthText }}</strong>
        <p>{{ systemHealthNote }}</p>
      </div>
      <div class="health-banner__counts" aria-label="子系统统计">
        <div>
          <strong>{{ subsystemCounts.normal }}</strong>
          <span>正常</span>
        </div>
        <div>
          <strong>{{ subsystemCounts.warning }}</strong>
          <span>警告</span>
        </div>
        <div>
          <strong>{{ subsystemCounts.error }}</strong>
          <span>异常</span>
        </div>
      </div>
    </section>

    <main class="diagnostic-grid">
      <section class="diagnostic-card" :class="statusClass(communicationStatus)">
        <div class="card-head">
          <span class="card-icon">信</span>
          <h2>通信状态</h2>
          <span class="status-badge" :class="statusClass(communicationStatus)">
            {{ statusLabels[communicationStatus] }}
          </span>
        </div>

        <div class="status-list">
          <div v-for="row in communicationRows" :key="row.label" class="status-row">
            <span>{{ row.label }}</span>
            <strong :class="{ 'is-mono': row.mono, 'is-muted': row.muted }">
              <i class="status-dot" :class="row.muted ? '' : statusClass(row.status)"></i>
              {{ row.value }}
            </strong>
          </div>
        </div>

      </section>

      <section class="diagnostic-card">
        <div class="card-head">
          <span class="card-icon">Hz</span>
          <h2>Topic 频率</h2>
          <span class="status-badge is-muted">未接入</span>
        </div>

        <div class="topic-list">
          <div v-for="topic in topicRows" :key="topic.topic" class="topic-row">
            <span>
              <i class="status-dot" :class="topic.muted ? '' : statusClass(topic.status)"></i>
              {{ topic.topic }}
            </span>
            <strong :class="topic.muted ? 'is-muted' : statusClass(topic.status)">
              {{ topic.value }}
              <b v-if="topic.badge">{{ topic.badge }}</b>
            </strong>
          </div>
        </div>
      </section>

      <section class="diagnostic-card" :class="statusClass(localizationStatus)">
        <div class="card-head">
          <span class="card-icon">位</span>
          <h2>定位状态</h2>
          <span class="status-badge" :class="statusClass(localizationStatus)">
            {{ statusLabels[localizationStatus] }}
          </span>
        </div>

        <div class="status-list">
          <div v-for="row in localizationRows" :key="row.label" class="status-row">
            <span>{{ row.label }}</span>
            <strong :class="{ 'is-mono': row.mono, 'is-pill': row.badge, 'is-muted': row.muted }">
              <i
                v-if="!row.badge"
                class="status-dot"
                :class="row.muted ? '' : statusClass(row.status)"
              ></i>
              {{ row.value }}
            </strong>
          </div>
        </div>

      </section>

      <section class="diagnostic-card diagnostic-card--wide" :class="statusClass(navigationStatus)">
        <div class="card-head">
          <span class="card-icon">航</span>
          <h2>导航状态</h2>
          <span class="status-badge" :class="statusClass(navigationStatus)">
            {{ statusLabels[navigationStatus] }}
          </span>
        </div>

        <div class="split-list">
          <div class="status-list">
            <div v-for="row in navigationLeftRows" :key="row.label" class="status-row">
            <span>{{ row.label }}</span>
              <strong :class="{ 'is-mono': row.mono, 'is-muted': row.muted }">
                <i class="status-dot" :class="row.muted ? '' : statusClass(row.status)"></i>
                {{ row.value }}
              </strong>
            </div>
          </div>
          <div class="status-list">
            <div v-for="row in navigationRightRows" :key="row.label" class="status-row">
              <span>{{ row.label }}</span>
              <strong :class="{ 'is-mono': row.mono, 'is-pill': row.badge, 'is-muted': row.muted }">
                <i
                  v-if="!row.badge"
                  class="status-dot"
                  :class="row.muted ? '' : statusClass(row.status)"
                ></i>
                {{ row.value }}
              </strong>
            </div>
          </div>
        </div>

        <div class="metric-strip">
          <div v-for="metric in navigationMetrics" :key="metric.label" class="metric-box">
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
          </div>
        </div>
      </section>

      <section
        class="diagnostic-card diagnostic-card--wide diagnostic-card--chassis"
      >
        <div class="card-head">
          <span class="card-icon">底</span>
          <h2>底盘状态</h2>
          <span class="status-badge is-muted">未接入</span>
        </div>

        <div class="split-list">
          <div class="status-list">
            <div v-for="row in chassisLeftRows" :key="row.label" class="status-row">
              <span>{{ row.label }}</span>
              <strong :class="{ 'is-mono': row.mono, 'is-muted': row.muted }">
                <i class="status-dot" :class="row.muted ? '' : statusClass(row.status)"></i>
                {{ row.value }}
              </strong>
            </div>
          </div>
          <div class="status-list">
            <div v-for="row in chassisRightRows" :key="row.label" class="status-row">
              <span>{{ row.label }}</span>
              <strong :class="{ 'is-mono': row.mono, 'is-muted': row.muted }">
                <i class="status-dot" :class="row.muted ? '' : statusClass(row.status)"></i>
                {{ row.value }}
              </strong>
            </div>
          </div>
        </div>

        <div class="battery-block">
          <div class="battery-block__head">
            <span>电池电量</span>
            <strong>{{ runtime.robot.batteryPercent }}%</strong>
          </div>
          <div class="battery-bar">
            <span :style="{ width: `${runtime.robot.batteryPercent}%` }"></span>
          </div>
          <div class="battery-block__foot">
            <span>预计剩余：约 3 小时 20 分钟</span>
            <strong>未充电</strong>
          </div>
        </div>

      </section>
    </main>
  </section>
</template>

<style scoped>
.status-page {
  display: grid;
  gap: 18px;
  height: 100%;
  overflow: auto;
  padding: 16px 20px 24px;
  color: var(--color-text);
}

.status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
}

.status-header h1 {
  margin: 4px 0 0;
  color: var(--color-text);
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: 0;
}

.status-header__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-subtle);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.status-header__eyebrow strong {
  color: var(--color-primary);
}

.status-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
}

.last-updated {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-card);
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.refresh-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 22px;
  border: 0;
  border-radius: 14px;
  background: var(--color-primary-dark);
  color: var(--color-card);
  box-shadow: 0 8px 18px rgba(11, 59, 46, 0.18);
  font: inherit;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
}

.health-banner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  min-height: 96px;
  padding: 20px 26px;
  border: 1px solid rgba(16, 185, 129, 0.24);
  border-radius: 18px;
  background: var(--color-primary-dark);
  color: var(--color-card);
  box-shadow: 0 14px 32px rgba(11, 59, 46, 0.12);
}

.health-banner__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: rgba(16, 185, 129, 0.16);
}

.health-banner__icon span {
  position: relative;
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-primary);
  border-radius: 50%;
}

.health-banner__icon span::after {
  content: '';
  position: absolute;
  left: 6px;
  top: 6px;
  width: 8px;
  height: 5px;
  border-bottom: 2px solid var(--color-primary);
  border-left: 2px solid var(--color-primary);
  transform: rotate(-45deg);
}

.health-banner__copy {
  min-width: 0;
}

.health-banner__copy strong {
  display: block;
  color: var(--color-card);
  font-size: 18px;
  line-height: 1.3;
}

.health-banner__copy p {
  margin: 6px 0 0;
  color: rgba(255, 255, 255, 0.56);
  font-size: 14px;
  line-height: 1.5;
}

.health-banner__counts {
  display: flex;
  align-items: center;
  gap: 22px;
}

.health-banner__counts div {
  display: grid;
  gap: 4px;
  text-align: center;
}

.health-banner__counts strong {
  color: var(--color-primary);
  font-size: 26px;
  line-height: 1;
}

.health-banner__counts div:nth-child(2) strong {
  color: var(--color-warning);
}

.health-banner__counts div:nth-child(3) strong {
  color: var(--color-error);
}

.health-banner__counts span {
  color: rgba(255, 255, 255, 0.44);
  font-size: 12px;
  font-weight: 700;
}

.diagnostic-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

.diagnostic-card {
  grid-column: span 2;
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-width: 0;
  min-height: 316px;
  padding: 22px 26px;
  border: 1px solid var(--color-border);
  border-top: 7px solid var(--color-primary);
  border-radius: 18px;
  background: var(--color-card);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
}

.diagnostic-card.is-warning {
  border-color: var(--color-warning-border);
  border-top-color: var(--color-warning);
  background: #fffbeb;
}

.diagnostic-card.is-error {
  border-color: var(--color-error-border);
  border-top-color: var(--color-error);
}

.diagnostic-card--wide {
  grid-column: span 3;
  min-height: 316px;
}

.diagnostic-card--chassis .split-list {
  flex: 1;
  min-height: 0;
}

.diagnostic-card--chassis .status-list {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.diagnostic-card--chassis .status-row {
  min-height: 46px;
}

.diagnostic-card--chassis .battery-block {
  margin-top: 2px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-soft);
}

.card-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
}

.card-head h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 18px;
  line-height: 1.25;
}

.card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--color-primary-bg);
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 900;
}

.is-warning .card-icon {
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
}

.status-badge.is-warning,
.topic-row strong.is-warning b {
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.status-badge.is-error {
  background: var(--color-error-bg);
  color: var(--color-error-strong);
}

.status-badge.is-muted {
  background: var(--color-neutral-bg);
  color: var(--color-muted);
}

.status-list,
.topic-list {
  display: grid;
  align-content: start;
}

.status-row,
.topic-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
  border-bottom: 1px solid var(--color-border-soft);
  color: var(--color-muted);
  font-size: 14px;
}

.status-row strong,
.topic-row strong {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
}

.status-row strong.is-mono,
.topic-row strong {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
}

.status-row strong.is-muted,
.topic-row strong.is-muted {
  color: var(--color-muted);
}

.status-row strong.is-pill {
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.topic-row span {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--color-muted);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
}

.topic-row strong.is-normal {
  color: var(--color-primary-strong);
}

.topic-row strong.is-warning {
  color: var(--color-warning-strong);
}

.topic-row strong b {
  min-height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: 11px;
  font-style: normal;
  line-height: 24px;
}

.warning-note {
  margin: auto 0 0;
  padding: 10px 12px;
  border: 1px solid var(--color-warning-border);
  border-radius: 12px;
  background: rgba(255, 251, 235, 0.72);
  color: var(--color-warning-strong);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
}

.split-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.metric-box {
  display: grid;
  align-content: center;
  justify-items: start;
  gap: 8px;
  min-height: 74px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface-soft);
  text-align: left;
}

.metric-box strong {
  color: var(--color-text);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 20px;
  line-height: 1;
}

.metric-box span {
  color: var(--color-subtle);
  font-size: 12px;
  font-weight: 800;
}

.battery-block {
  display: grid;
  gap: 10px;
}

.battery-block__head,
.battery-block__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.battery-block__head span {
  color: var(--color-muted);
  font-size: 15px;
}

.battery-block__head strong,
.battery-block__foot strong {
  color: var(--color-primary-strong);
}

.battery-block__foot {
  color: var(--color-subtle);
  font-size: 12px;
}

.battery-bar {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-border-soft);
}

.battery-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--color-subtle);
}

.status-dot.is-normal {
  background: var(--color-primary);
}

.status-dot.is-warning {
  background: var(--color-warning);
}

.status-dot.is-error {
  background: var(--color-error);
}

@media (max-width: 980px) {
  .diagnostic-card,
  .diagnostic-card--wide {
    grid-column: span 6;
    min-height: auto;
  }
}

@media (max-width: 760px) {
  .status-page {
    padding: 12px;
  }

  .status-header,
  .health-banner,
  .health-banner__counts,
  .split-list {
    grid-template-columns: 1fr;
  }

  .status-header,
  .health-banner__counts {
    align-items: flex-start;
  }

  .health-banner__counts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
  }

  .metric-strip {
    grid-template-columns: 1fr;
  }
}
</style>
