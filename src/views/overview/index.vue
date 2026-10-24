<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import OverviewMapSnapshot from '../../components/overview/OverviewMapSnapshot.vue'
import { useRobotRuntimeStore } from '../../stores/robotRuntime'
import type { OverviewHealthStatus, OverviewLogLevel, OverviewTaskStatus } from '../../types'

const runtimeStore = useRobotRuntimeStore()
const { overviewDashboard: dashboard } = storeToRefs(runtimeStore)
const currentTime = ref(new Date())
const isTaskQueueExpanded = ref(false)

let clockTimer: number | undefined

const healthLabels: Record<OverviewHealthStatus, string> = {
  normal: '正常',
  warning: '注意',
  error: '异常',
}

const taskStatusLabels: Record<OverviewTaskStatus, string> = {
  running: '执行中',
  queued: '排队中',
  paused: '已暂停',
  unknown: '待核对',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
}

function statusClass(status: OverviewHealthStatus | OverviewTaskStatus | OverviewLogLevel) {
  return `is-${status}`
}

function metricToneClass(metricId: string) {
  const toneMap: Record<string, string> = {
    'forward-speed': 'is-green',
    'turning-speed': 'is-green',
    'motor-load': 'is-orange',
    'link-delay': 'is-blue',
  }

  return toneMap[metricId] ?? 'is-green'
}

function formatClock(date: Date) {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

onMounted(() => {
  clockTimer = window.setInterval(() => {
    currentTime.value = new Date()
  }, 1000)
})

onBeforeUnmount(() => {
  if (clockTimer) {
    window.clearInterval(clockTimer)
  }
})
</script>

<template>
  <section class="overview-page">
    <header class="overview-header">
      <div class="overview-header__heading">
        <div class="overview-header__eyebrow">
          <span>ROBOT CHASSIS CONTROL</span>
          <span>/</span>
          <strong>OVERVIEW</strong>
        </div>
        <h1 class="overview-header__title">Overview</h1>
      </div>

      <div class="overview-header__actions">
        <span class="clock">{{ formatClock(currentTime) }}</span>
        <span class="alarm-pill">告警 {{ dashboard.kpi.alarms.total }}</span>
        <span class="operator-pill">Operator</span>
      </div>
    </header>

    <section class="kpi-grid" aria-label="关键状态">
      <article class="dashboard-card kpi-card kpi-card--system">
        <span class="kpi-card__label">系统状态</span>
        <div class="kpi-card__main">
          <span class="status-dot is-normal"></span>
          <strong>{{ healthLabels[dashboard.kpi.systemStatus] }}</strong>
        </div>
        <p>{{ dashboard.kpi.systemMessage }}</p>
        <small>数据源：ROS 状态接口</small>
      </article>

      <article class="dashboard-card kpi-card">
        <span class="kpi-card__label">机器人在线</span>
        <div class="kpi-card__count">
          <strong>{{ dashboard.kpi.robotsOnline }}</strong>
          <span>/{{ dashboard.kpi.robotsTotal }}</span>
        </div>
        <p>{{ dashboard.robot.id }} · {{ dashboard.robot.status === 'online' ? '在线' : '离线' }}</p>
        <small>电量 {{ dashboard.robot.batteryPercent }}% · {{ dashboard.robot.signalLabel }}</small>
      </article>

      <article class="dashboard-card kpi-card">
        <span class="kpi-card__label">当前任务</span>
        <strong class="task-name">{{ dashboard.kpi.currentTask.name }} → {{ dashboard.kpi.currentTask.target }}</strong>
        <div class="progress-bar">
          <span :style="{ width: `${dashboard.kpi.currentTask.progressPercent}%` }"></span>
        </div>
        <p>{{ dashboard.kpi.currentTask.progressPercent }}% · 预计 {{ dashboard.kpi.currentTask.etaMinutes }} 分钟</p>
        <small>数据源：任务规划器</small>
      </article>

      <article class="dashboard-card kpi-card kpi-card--alarm">
        <span class="kpi-card__label">告警摘要</span>
        <div class="alarm-summary">
          <strong>{{ dashboard.kpi.alarms.total }}</strong>
          <span>活跃告警</span>
        </div>
        <p>{{ dashboard.kpi.alarms.critical }} 个严重 · {{ dashboard.kpi.alarms.warning }} 个警告</p>
        <small>数据源：告警管理</small>
      </article>
    </section>

    <section class="content-grid">
      <article class="dashboard-card map-card">
        <div class="card-head">
          <div>
            <h2>Map Snapshot</h2>
            <p>{{ dashboard.map.name }}</p>
          </div>
          <span class="live-pill">实时</span>
        </div>

        <div class="map-snapshot">
          <OverviewMapSnapshot :snapshot="dashboard.map" />
        </div>

        <div class="map-legend">
          <span><i class="legend-dot is-robot"></i>机器人</span>
          <span><i class="legend-dot is-target"></i>目标点</span>
          <span><i class="legend-line"></i>规划路径</span>
          <span><i class="legend-area is-keepout"></i>电子栅栏</span>
          <span><i class="legend-dot is-gray"></i>障碍物</span>
        </div>
      </article>

      <aside class="side-column">
        <article class="dashboard-card side-card task-queue-card" :class="{ 'is-expanded': isTaskQueueExpanded }">
          <div class="card-head">
            <div class="card-title-row">
              <h2>任务队列</h2>
              <span class="count-pill count-pill--primary">{{ dashboard.taskQueue.length }} 项</span>
            </div>
            <button class="queue-toggle" type="button" @click="isTaskQueueExpanded = !isTaskQueueExpanded">
              {{ isTaskQueueExpanded ? '收起' : `查看全部 ${dashboard.taskQueue.length} 项` }}
            </button>
          </div>

          <div class="task-list">
            <div v-for="task in dashboard.taskQueue" :key="task.id" class="task-row" :class="statusClass(task.status)">
              <div class="task-row__head">
                <strong>{{ task.name }} → {{ task.target }}</strong>
                <span class="task-status" :class="statusClass(task.status)">{{ taskStatusLabels[task.status] }}</span>
              </div>
              <div class="progress-bar">
                <span :class="statusClass(task.status)" :style="{ width: `${task.progressPercent}%` }"></span>
              </div>
            </div>
          </div>
        </article>

        <article class="dashboard-card side-card">
          <div class="card-head">
            <h2>实时指标</h2>
            <p>底盘反馈</p>
          </div>

          <div class="metric-grid">
            <div v-for="metric in dashboard.metrics" :key="metric.id" class="metric-item">
              <span>{{ metric.label }}</span>
              <strong :class="statusClass(metric.status)">{{ metric.value }}<small>{{ metric.unit }}</small></strong>
              <div class="progress-bar">
                <span :class="[statusClass(metric.status), metricToneClass(metric.id)]" :style="{ width: `${metric.percent}%` }"></span>
              </div>
            </div>
          </div>
        </article>

        <article class="dashboard-card side-card log-card">
          <div class="card-head">
            <h2>系统日志</h2>
            <p>最近事件</p>
          </div>

          <div class="log-list">
            <div v-for="log in dashboard.logs" :key="log.id" class="log-row">
              <span class="status-dot" :class="statusClass(log.level)"></span>
              <div>
                <strong>{{ log.message }}</strong>
                <small>{{ log.time }}</small>
              </div>
            </div>
          </div>
        </article>
      </aside>
    </section>
  </section>
</template>

<style scoped>
.overview-page {
  display: grid;
  grid-template-rows: 54px 136px minmax(0, 1fr);
  gap: 12px;
  height: 100%;
  overflow: hidden;
  color: var(--color-text);
}

.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 54px;
}

.overview-header__heading {
  display: grid;
  gap: 0;
}

.card-head p,
.kpi-card small,
.log-row small {
  margin: 0;
  color: var(--color-muted);
  font-size: 11px;
}

.overview-header__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-subtle);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.overview-header__eyebrow strong {
  color: var(--color-primary);
}

.overview-header__title {
  margin: 4px 0 0;
  color: var(--color-text);
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: 0;
}

.overview-header__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.clock,
.alarm-pill,
.operator-pill,
.live-pill,
.count-pill,
.task-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.clock {
  color: var(--color-muted);
  background: var(--color-page-bg);
  font-variant-numeric: tabular-nums;
}

.alarm-pill {
  color: var(--color-error);
  background: var(--color-error-bg);
}

.operator-pill,
.count-pill {
  color: var(--color-muted);
  background: var(--color-neutral-bg);
}

.count-pill--primary {
  min-height: 24px;
  padding: 0 9px;
  color: #ffffff;
  background: var(--color-primary);
  font-size: 11px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.dashboard-card {
  min-width: 0;
  border-radius: 18px;
  border: 1px solid #e2e8f0;
  background: var(--color-card);
  box-shadow:
    0 4px 6px -1px rgba(15, 23, 42, 0.05),
    0 2px 4px -2px rgba(15, 23, 42, 0.025),
    0 18px 36px rgba(15, 23, 42, 0.035);
}

.kpi-card {
  display: grid;
  align-content: center;
  gap: 8px;
  min-height: 136px;
  padding: 16px 20px;
}

.kpi-card:not(.kpi-card--alarm) {
  border-color: #d1fae5;
  background:
    linear-gradient(90deg, rgba(16, 185, 129, 0.08), rgba(255, 255, 255, 0.98) 58%),
    var(--color-card);
  box-shadow:
    0 4px 6px -1px rgba(11, 59, 46, 0.045),
    0 2px 4px -2px rgba(11, 59, 46, 0.025);
}

.kpi-card__label {
  color: var(--color-text);
  font-size: 11px;
  font-weight: 700;
}

.kpi-card__main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.kpi-card__main strong,
.kpi-card__count strong {
  color: var(--color-text);
  font-size: 30px;
  font-weight: 800;
  line-height: 1;
}

.kpi-card:not(.kpi-card--alarm) .kpi-card__main strong,
.kpi-card:not(.kpi-card--alarm) .kpi-card__count strong,
.kpi-card:not(.kpi-card--alarm) .kpi-card__count span,
.kpi-card:not(.kpi-card--alarm) .task-name {
  color: var(--color-primary-dark);
}

.kpi-card__count {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}

.kpi-card__count span {
  margin-bottom: 4px;
  color: var(--color-subtle);
  font-size: 16px;
}

.task-name {
  color: var(--color-text);
  font-size: 16px;
  font-weight: 800;
  line-height: 1.25;
}

.kpi-card .progress-bar {
  background: rgba(11, 59, 46, 0.12);
}

.kpi-card .progress-bar span {
  background: var(--color-primary-dark);
}

.kpi-card p,
.alarm-summary span {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
}

.alarm-summary {
  display: flex;
  align-items: center;
  gap: 12px;
}

.alarm-summary strong {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border: 0;
  border-radius: 50%;
  background: var(--color-error);
  color: var(--color-card);
  font-size: 24px;
}

.kpi-card--alarm {
  position: relative;
  overflow: hidden;
  border-color: #fecaca;
  background:
    linear-gradient(90deg, rgba(239, 68, 68, 0.09), rgba(255, 255, 255, 0.97) 58%),
    var(--color-card);
  box-shadow:
    0 4px 6px -1px rgba(239, 68, 68, 0.045),
    0 2px 4px -2px rgba(239, 68, 68, 0.025);
}

.kpi-card--alarm::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--color-error);
  content: '';
}

.kpi-card--alarm .alarm-summary strong {
  width: auto;
  min-width: 48px;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--color-error);
  color: #ffffff;
  font-size: 22px;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 320px);
  gap: 12px;
  align-items: stretch;
  min-height: 0;
  overflow: hidden;
}

.map-card,
.side-card {
  padding: 16px 18px;
}

.map-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 9px;
  height: 100%;
  min-height: 0;
  box-shadow:
    0 4px 6px -1px rgba(15, 23, 42, 0.05),
    0 2px 4px -2px rgba(15, 23, 42, 0.025),
    0 22px 44px rgba(11, 59, 46, 0.06);
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border-soft);
}

.card-head h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
}

.live-pill {
  gap: 6px;
  color: #ffffff;
  background: var(--color-primary-dark);
}

.live-pill::before {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.16);
  content: '';
  animation: live-pulse 1.45s ease-in-out infinite;
}

.map-snapshot {
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface-soft);
  background-image:
    linear-gradient(#e5e7eb 0.5px, transparent 0.5px),
    linear-gradient(90deg, #e5e7eb 0.5px, transparent 0.5px);
  background-size: 32px 32px;
  box-shadow: inset 0 0 0 1px rgba(11, 59, 46, 0.03);
}

.map-snapshot svg {
  display: block;
  width: 100%;
  height: 100%;
}

.map-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  color: var(--color-muted);
  font-size: 11px;
}

.map-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.legend-dot.is-robot {
  background: var(--color-primary-dark);
}

.legend-dot.is-target {
  background: var(--color-primary);
}

.legend-dot.is-gray {
  background: var(--color-subtle);
}

.legend-line {
  width: 18px;
  height: 2px;
  border-radius: 999px;
  background: var(--color-primary);
}

.legend-area {
  width: 14px;
  height: 10px;
  border-radius: 2px;
}

.legend-area.is-keepout {
  border: 1px solid rgba(219, 39, 119, 0.45);
  background: rgba(244, 114, 182, 0.48);
}

.side-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: stretch;
  align-self: start;
  height: auto;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
}

.side-card {
  display: block;
}

.side-card .card-head {
  margin-bottom: 12px;
}

.card-title-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.queue-toggle {
  flex: none;
  min-height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: var(--color-surface-soft);
  color: var(--color-primary-dark);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.queue-toggle:hover {
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.task-queue-card {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  max-height: 250px;
  min-height: 0;
}

.task-queue-card.is-expanded {
  max-height: 320px;
}

.task-list,
.log-list {
  display: grid;
  gap: 8px;
}

.task-queue-card .task-list {
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.task-queue-card .task-list::-webkit-scrollbar,
.log-card .log-list::-webkit-scrollbar {
  width: 6px;
}

.task-queue-card .task-list::-webkit-scrollbar-track,
.log-card .log-list::-webkit-scrollbar-track {
  background: transparent;
}

.task-queue-card .task-list::-webkit-scrollbar-thumb,
.log-card .log-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: #cbd5e1;
}

.task-row {
  position: relative;
  display: grid;
  gap: 6px;
  padding-left: 12px;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--color-border-soft);
}

.task-row::before {
  position: absolute;
  top: 2px;
  bottom: 9px;
  left: 0;
  width: 4px;
  border-radius: 999px;
  background: var(--color-primary);
  content: '';
}

.task-row.is-completed::before {
  background: var(--color-primary-dark);
}

.task-row.is-queued::before {
  background: var(--color-subtle);
}

.task-row.is-paused::before {
  background: var(--color-warning);
}

.task-row.is-unknown::before {
  background: var(--color-warning);
}

.task-row.is-failed::before,
.task-row.is-canceled::before {
  background: var(--color-error);
}

.task-row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.task-row:last-child::before {
  bottom: 0;
}

.task-row__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.task-row__head strong {
  min-width: 0;
  color: var(--color-text);
  font-size: 12px;
}

.task-status {
  min-height: 22px;
  padding: 0 8px;
  font-size: 10px;
}

.task-status.is-running {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.task-status.is-queued {
  color: var(--color-muted);
  background: var(--color-neutral-bg);
}

.task-status.is-completed {
  color: var(--color-primary-dark);
  background: var(--color-primary-bg);
}

.task-status.is-paused {
  color: var(--color-warning);
  background: var(--color-warning-bg);
}

.task-status.is-unknown {
  border-color: var(--color-warning-border);
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.task-status.is-failed,
.task-status.is-canceled {
  color: var(--color-error);
  background: var(--color-error-bg);
}

.progress-bar {
  width: 100%;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-border);
}

.progress-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
}

.progress-bar span.is-completed,
.progress-bar span.is-normal {
  background: var(--color-primary-dark);
}

.progress-bar span.is-queued {
  background: var(--color-subtle);
}

.progress-bar span.is-paused {
  background: var(--color-warning);
}

.progress-bar span.is-unknown {
  background: var(--color-warning);
}

.progress-bar span.is-failed,
.progress-bar span.is-canceled {
  background: var(--color-error);
}

.progress-bar span.is-warning {
  background: var(--color-warning);
}

.progress-bar span.is-error {
  background: var(--color-error);
}

.metric-item .progress-bar span.is-green {
  background: var(--color-primary);
}

.metric-item .progress-bar span.is-orange {
  background: var(--color-warning);
}

.metric-item .progress-bar span.is-blue {
  background: #3b82f6;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.metric-item {
  display: grid;
  gap: 5px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid var(--color-border-soft);
  background: var(--color-surface-soft);
}

.metric-item span {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 600;
}

.metric-item strong {
  color: var(--color-text);
  font-size: 21px;
  line-height: 1;
}

.metric-item strong.is-normal {
  color: var(--color-text);
}

.metric-item strong.is-warning {
  color: var(--color-text);
}

.metric-item strong.is-error {
  color: var(--color-text);
}

.metric-item small {
  margin-left: 2px;
  color: currentColor;
  font-size: 11px;
  font-weight: 500;
}

.log-card {
  flex: 0 0 auto;
  min-height: 0;
  overflow: hidden;
}

.log-card .log-list {
  max-height: 220px;
  overflow-y: auto;
  padding-right: 4px;
}

.log-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 9px;
  align-items: start;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--color-border-soft);
}

.log-row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.log-row strong {
  display: block;
  color: var(--color-text);
  font-size: 12px;
  line-height: 1.45;
}

.status-dot {
  width: 9px;
  height: 9px;
  margin-top: 4px;
  border-radius: 50%;
  background: var(--color-subtle);
}

.status-dot.is-normal,
.status-dot.is-info {
  background: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
}

.status-dot.is-warn,
.status-dot.is-warning {
  background: var(--color-warning);
}

.status-dot.is-error {
  background: var(--color-error);
}

.kpi-card--system .status-dot.is-normal {
  width: 9px;
  height: 9px;
  margin-top: 0;
  border: 0;
  background: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
}

.kpi-card--system .status-dot.is-normal::after {
  content: none;
}

.kpi-card--system .kpi-card__main strong {
  color: var(--color-primary-dark);
}

@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }

  50% {
    opacity: 0.55;
    transform: scale(0.78);
  }
}

@media (max-width: 1180px) {
  .kpi-grid,
  .content-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .map-card {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .overview-header,
  .overview-header__actions,
  .task-row__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .kpi-grid,
  .content-grid,
  .metric-grid {
    grid-template-columns: 1fr;
  }
}
</style>
