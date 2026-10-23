<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRobotRuntimeStore } from '../../stores/robotRuntime'
import type { RuntimeLogEntry, RuntimeLogLevel, RuntimeLogModule } from '../../types'

type LevelFilter = 'all' | RuntimeLogLevel
type ModuleFilter = 'all' | RuntimeLogModule

const runtimeStore = useRobotRuntimeStore()
const { runtime } = storeToRefs(runtimeStore)

const search = ref('')
const levelFilter = ref<LevelFilter>('all')
const moduleFilter = ref<ModuleFilter>('all')
const autoScroll = ref(true)
const logViewport = ref<HTMLElement | null>(null)
const acknowledgedIds = ref<Set<string>>(new Set())
const expandedAlertIds = ref<Set<string>>(new Set())

const levelLabels: Record<RuntimeLogLevel, string> = {
  error: '错误',
  warn: '警告',
  info: '信息',
  debug: '调试',
}

const levelShortLabels: Record<RuntimeLogLevel, string> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
  debug: 'DEBUG',
}

const moduleLabels: Record<RuntimeLogModule, string> = {
  ros: 'ROS',
  nav2: 'Nav2',
  stm32: 'STM32',
  amcl: 'AMCL',
  costmap: 'Costmap',
  system: 'System',
}

const moduleOptions: Array<{ value: ModuleFilter; label: string }> = [
  { value: 'all', label: '全部模块' },
  { value: 'ros', label: 'ROS' },
  { value: 'nav2', label: 'Nav2' },
  { value: 'stm32', label: 'STM32' },
  { value: 'amcl', label: 'AMCL' },
  { value: 'costmap', label: 'Costmap' },
  { value: 'system', label: 'System' },
]

const levelOptions: Array<{ value: LevelFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'error', label: '错误' },
  { value: 'warn', label: '警告' },
  { value: 'info', label: '信息' },
  { value: 'debug', label: '调试' },
]

function inferModule(log: RuntimeLogEntry): RuntimeLogModule {
  if (log.module) return log.module

  if (/任务|路径|导航|目标点/.test(log.message)) return 'nav2'
  if (/急停|电机|底盘|电量/.test(log.message)) return 'stm32'
  if (/地图|通信|连接|Topic|话题/.test(log.message)) return 'ros'
  if (/定位|坐标|置信度/.test(log.message)) return 'amcl'
  return 'system'
}

function logModule(log: RuntimeLogEntry) {
  return moduleLabels[inferModule(log)]
}

function alertDetail(log: RuntimeLogEntry) {
  const module = inferModule(log)

  if (module === 'nav2') {
    return '导航系统已记录该事件，建议确认前方障碍物和当前路径是否满足继续运行条件。'
  }

  if (module === 'stm32') {
    return '底盘控制板上报了状态变化，请确认急停、驱动电机和底盘运行条件。'
  }

  if (module === 'ros') {
    return '通信或地图相关数据出现波动，建议结合 Status 页检查 Topic 频率和通信延迟。'
  }

  return '建议结合当前机器人状态和任务反馈进一步确认。'
}

function matchesSearchAndModule(log: RuntimeLogEntry) {
  const keyword = search.value.trim().toLowerCase()
  const module = inferModule(log)
  const matchesModule = moduleFilter.value === 'all' || module === moduleFilter.value
  const matchesSearch =
    !keyword ||
    `${log.message} ${moduleLabels[module]} ${levelLabels[log.level]}`
      .toLowerCase()
      .includes(keyword)

  return matchesModule && matchesSearch
}

function matchesAllFilters(log: RuntimeLogEntry) {
  return (
    matchesSearchAndModule(log) &&
    (levelFilter.value === 'all' || log.level === levelFilter.value)
  )
}

const eventLogs = computed(() => runtime.value.logs.filter(matchesAllFilters))

const alertRecords = computed(() =>
  runtime.value.logs
    .filter((log) => log.level === 'warn' || log.level === 'error')
    .map((log) => ({
      ...log,
      module: inferModule(log),
      acknowledged: acknowledgedIds.value.has(log.id),
    })),
)

const alerts = computed(() => alertRecords.value.filter(matchesAllFilters))

const unacknowledgedAlerts = computed(() => alerts.value.filter((alert) => !alert.acknowledged))

const levelCounts = computed<Record<LevelFilter, number>>(() => {
  const counts: Record<LevelFilter, number> = {
    all: 0,
    error: 0,
    warn: 0,
    info: 0,
    debug: 0,
  }

  for (const alert of alertRecords.value) {
    if (alert.acknowledged || !matchesSearchAndModule(alert)) continue

    counts.all += 1
    counts[alert.level] += 1
  }

  return counts
})

function levelClass(level: RuntimeLogLevel) {
  return `is-${level}`
}

function toggleAlert(id: string) {
  const next = new Set(expandedAlertIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expandedAlertIds.value = next
}

function acknowledgeAlert(id: string) {
  const next = new Set(acknowledgedIds.value)
  next.add(id)
  acknowledgedIds.value = next
}

function acknowledgeAll() {
  acknowledgedIds.value = new Set(alerts.value.map((alert) => alert.id))
}

function scrollLogsToNewest() {
  if (!autoScroll.value || !logViewport.value) return
  logViewport.value.scrollTop = 0
}

function handleLogScroll() {
  if (!logViewport.value || !autoScroll.value) return

  if (logViewport.value.scrollTop > 24) {
    autoScroll.value = false
  }
}

function escapeCsvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function exportCsv() {
  const header = ['时间', '级别', '模块', '消息']
  const rows = eventLogs.value.map((log) => [
    log.time,
    levelLabels[log.level],
    logModule(log),
    log.message,
  ])
  const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'robot-logs.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

watch(
  () => runtime.value.logs[0]?.id,
  (currentId, previousId) => {
    if (!currentId || currentId === previousId || !autoScroll.value) return
    window.requestAnimationFrame(scrollLogsToNewest)
  },
)

watch(autoScroll, (enabled) => {
  if (enabled) {
    window.requestAnimationFrame(scrollLogsToNewest)
  }
})
</script>

<template>
  <section class="logs-page">
    <header class="logs-header">
      <div>
        <div class="logs-header__eyebrow">
          <span>ROBOT CHASSIS CONTROL</span>
          <span>/</span>
          <strong>LOGS</strong>
        </div>
        <h1>Logs &amp; Alerts</h1>
      </div>

      <div class="logs-toolbar">
        <label class="search-field">
          <span class="sr-only">搜索日志</span>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5"></circle>
            <path d="m10.5 10.5 3 3"></path>
          </svg>
          <input v-model="search" type="search" placeholder="搜索日志..." />
        </label>

        <div class="level-filter" aria-label="按级别筛选">
          <button
            v-for="option in levelOptions"
            :key="option.value"
            class="filter-pill"
            :class="{ 'is-active': levelFilter === option.value }"
            type="button"
            :aria-pressed="levelFilter === option.value"
            @click="levelFilter = option.value"
          >
            <span>{{ option.label }}</span>
            <span
              v-if="levelCounts[option.value]"
              class="pill-count"
              :class="{
                'is-error': option.value === 'error',
                'is-warn': option.value === 'warn',
              }"
            >
              <i></i>
              {{ levelCounts[option.value] }}
            </span>
          </button>
        </div>

        <select v-model="moduleFilter" aria-label="按模块筛选">
          <option v-for="option in moduleOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>

        <label class="toggle-control">
          <input v-model="autoScroll" type="checkbox" />
          <span class="toggle-control__track"><span></span></span>
          <span>自动滚动</span>
        </label>

        <button class="export-button" type="button" @click="exportCsv">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 10.5v2.2c0 .7.6 1.3 1.3 1.3h7.4c.7 0 1.3-.6 1.3-1.3v-2.2"></path>
            <path d="M8 2v8"></path>
            <path d="m4.8 6.3 3.2 3.2 3.2-3.2"></path>
          </svg>
          导出 CSV
        </button>
      </div>
    </header>

    <section class="logs-section alarms-section">
      <div class="section-heading">
        <div class="section-heading__title">
          <h2>活动告警</h2>
          <span v-if="unacknowledgedAlerts.length" class="count-badge is-error">
            <i class="pulse-dot is-error"></i>
            {{ unacknowledgedAlerts.length }} 条待确认
          </span>
          <span v-else class="count-badge is-normal">暂无待处理告警</span>
        </div>
        <button
          v-if="unacknowledgedAlerts.length"
          class="text-button"
          type="button"
          @click="acknowledgeAll"
        >
          全部确认 →
        </button>
      </div>

      <div v-if="alerts.length" class="alarm-list">
        <article
          v-for="alert in alerts"
          :key="alert.id"
          class="alarm-card"
          :class="[levelClass(alert.level), { 'is-acknowledged': alert.acknowledged }]"
          @click="toggleAlert(alert.id)"
        >
          <div class="alarm-card__content">
            <div class="alarm-card__meta">
              <span class="severity-badge" :class="levelClass(alert.level)">
                {{ levelLabels[alert.level] }}
              </span>
              <span class="module-pill">{{ moduleLabels[alert.module] }}</span>
            </div>
            <p class="alarm-card__message">{{ alert.message }}</p>
            <p v-if="expandedAlertIds.has(alert.id)" class="alarm-card__detail">
              {{ alertDetail(alert) }}
            </p>
          </div>
          <div class="alarm-card__actions">
            <time>{{ alert.time }}</time>
            <div class="alarm-card__controls">
              <button
                v-if="!alert.acknowledged"
                class="ack-button"
                type="button"
                @click.stop="acknowledgeAlert(alert.id)"
              >
                确认
              </button>
              <span v-else class="acknowledged-label">已确认</span>
              <svg
                class="expand-icon"
                :class="{ 'is-expanded': expandedAlertIds.has(alert.id) }"
                viewBox="0 0 16 16"
              >
                <path d="m4 6 4 4 4-4"></path>
              </svg>
            </div>
          </div>
        </article>
      </div>
      <div v-else class="empty-state">暂无活动告警</div>
    </section>

    <section class="logs-section event-section">
      <div class="section-heading">
        <div class="section-heading__title">
          <h2>事件日志</h2>
          <span class="entry-count">{{ eventLogs.length }} 条记录</span>
        </div>
        <div class="stream-status">
          <i class="pulse-dot is-normal"></i>
          <span>实时日志流</span>
        </div>
      </div>

      <div class="event-log-card">
        <div class="event-log-grid event-log-grid--head">
          <span>时间</span>
          <span>级别</span>
          <span>模块</span>
          <span>消息</span>
        </div>

        <div
          ref="logViewport"
          class="event-log-body"
          @scroll.passive="handleLogScroll"
        >
          <div v-if="!eventLogs.length" class="empty-state">当前筛选条件下暂无日志</div>
          <div
            v-for="log in eventLogs"
            v-else
            :key="log.id"
            class="event-log-grid event-log-row"
            :class="levelClass(log.level)"
          >
            <time>{{ log.time }}</time>
            <span>
              <b class="level-badge" :class="levelClass(log.level)">
                {{ levelShortLabels[log.level] }}
              </b>
            </span>
            <span class="module-label">{{ logModule(log) }}</span>
            <span class="event-message">{{ log.message }}</span>
          </div>
        </div>

        <footer class="event-log-footer">
          <span>当前显示 {{ eventLogs.length }} / {{ runtime.logs.length }} 条日志</span>
          <span>数据来源：机器人事件流</span>
        </footer>
      </div>
    </section>
  </section>
</template>

<style scoped>
.logs-page {
  display: grid;
  gap: 16px;
  height: 100%;
  overflow: auto;
  padding: 16px 20px 24px;
  color: var(--color-text);
}

.logs-header,
.section-heading,
.logs-toolbar,
.section-heading__title,
.alarm-card__actions,
.alarm-card__controls,
.stream-status {
  display: flex;
  align-items: center;
}

.logs-header {
  justify-content: space-between;
  gap: 20px;
  min-height: 56px;
}

.logs-header__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-subtle);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.logs-header__eyebrow strong {
  color: var(--color-primary);
}

.logs-header h1 {
  margin: 4px 0 0;
  color: var(--color-text);
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: 0;
}

.logs-toolbar {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.search-field {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.search-field svg {
  position: absolute;
  left: 10px;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--color-subtle);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.4;
  pointer-events: none;
}

.search-field input,
.logs-toolbar select {
  min-height: 40px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-card);
  color: var(--color-text);
  font: inherit;
  font-size: 14px;
  outline: none;
}

.search-field input {
  width: 190px;
  padding: 0 10px 0 30px;
}

.level-filter {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.filter-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  background: var(--color-card);
  color: var(--color-muted);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03);
  font: inherit;
  font-size: 14px;
  font-weight: 750;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    color 0.15s ease;
}

.filter-pill:hover {
  background: var(--color-surface-soft);
}

.filter-pill.is-active {
  border-color: var(--color-primary-dark);
  background: var(--color-primary-dark);
  color: var(--color-card);
  box-shadow: 0 8px 18px rgba(11, 59, 46, 0.14);
  font-weight: 900;
}

.pill-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--color-neutral-bg);
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
}

.pill-count i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-subtle);
}

.pill-count.is-error {
  background: var(--color-error-bg);
  color: var(--color-error-strong);
}

.pill-count.is-error i {
  background: var(--color-error);
}

.pill-count.is-warn {
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.pill-count.is-warn i {
  background: var(--color-warning);
}

.filter-pill.is-active .pill-count {
  background: rgba(255, 255, 255, 0.16);
  color: var(--color-card);
}

.logs-toolbar select {
  min-width: 138px;
  padding: 0 12px;
  cursor: pointer;
}

.search-field input:focus,
.logs-toolbar select:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
}

.toggle-control {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  color: var(--color-muted);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
}

.toggle-control input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.toggle-control__track {
  display: inline-flex;
  align-items: center;
  width: 34px;
  height: 20px;
  padding: 2px;
  border-radius: 999px;
  background: var(--color-border-strong);
  transition: background-color 0.15s ease;
}

.toggle-control__track span {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-card);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18);
  transition: transform 0.15s ease;
}

.toggle-control input:checked + .toggle-control__track {
  background: var(--color-primary-dark);
}

.toggle-control input:checked + .toggle-control__track span {
  transform: translateX(14px);
}

.export-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--color-primary-dark);
  border-radius: 9px;
  background: var(--color-card);
  color: var(--color-primary-dark);
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.export-button svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.35;
}

.export-button:hover {
  background: var(--color-primary-dark);
  color: var(--color-card);
}

.logs-section {
  min-width: 0;
}

.alarms-section {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 270px;
  min-height: 270px;
}

.alarms-section > .empty-state {
  display: grid;
  place-items: center;
  min-height: 0;
}

.section-heading {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}

.section-heading__title {
  gap: 10px;
}

.section-heading h2 {
  margin: 0;
  color: var(--color-text-strong);
  font-size: 16px;
  font-weight: 800;
}

.count-badge,
.entry-count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
}

.count-badge.is-error {
  border-color: var(--color-error-border);
  background: var(--color-error-bg);
  color: var(--color-error-strong);
}

.count-badge.is-normal {
  border-color: var(--color-primary-border);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.entry-count {
  background: var(--color-neutral-bg);
  color: var(--color-muted);
}

.text-button {
  border: 0;
  background: transparent;
  color: var(--color-muted);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.text-button:hover {
  color: var(--color-text);
}

.alarm-list {
  display: grid;
  grid-auto-rows: 108px;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 3px;
}

.alarm-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0;
  height: 108px;
  min-height: 108px;
  overflow: hidden;
  padding: 16px 18px 16px 16px;
  border: 1px solid var(--color-border);
  border-left: 4px solid var(--color-warning);
  border-radius: 12px;
  background: var(--color-card);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    opacity 0.15s ease;
}

.alarm-card:hover {
  background: var(--color-surface-soft);
}

.alarm-card.is-error {
  border-color: var(--color-error-border);
  border-left-color: var(--color-error);
  background: var(--color-error-bg);
}

.alarm-card.is-error:hover {
  background: var(--color-error-bg);
}

.alarm-card.is-warn {
  border-color: var(--color-warning-border);
  border-left-color: var(--color-warning);
}

.alarm-card.is-acknowledged {
  opacity: 0.58;
}

.alarm-card__content {
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.alarm-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-bottom: 9px;
}

.severity-badge,
.level-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  font-weight: 900;
}

.severity-badge {
  min-height: 29px;
  padding: 4px 10px;
  border-radius: 7px;
  font-size: 13px;
}

.module-pill {
  display: inline-flex;
  align-items: center;
  min-height: 29px;
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-surface-soft);
  color: var(--color-muted);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  font-weight: 800;
}

.severity-badge.is-error,
.level-badge.is-error {
  border: 1px solid var(--color-error-border);
  background: var(--color-error-bg);
  color: var(--color-error-strong);
}

.severity-badge.is-warn,
.level-badge.is-warn {
  border: 1px solid var(--color-warning-border);
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.severity-badge.is-info,
.level-badge.is-info {
  border: 1px solid var(--color-primary-border);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.severity-badge.is-debug,
.level-badge.is-debug {
  border: 1px solid var(--color-border);
  background: var(--color-neutral-bg);
  color: var(--color-muted);
}

.alarm-card__message {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 750;
  line-height: 1.5;
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  min-height: 22px;
  max-height: 45px;
}

.alarm-card__detail {
  overflow: hidden;
  margin: 8px 0 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alarm-card__actions {
  align-items: flex-end;
  flex: 0 0 142px;
  flex-direction: column;
  flex: none;
  gap: 10px;
  justify-content: center;
  margin-left: 24px;
  text-align: right;
}

.alarm-card__controls {
  justify-content: flex-end;
  gap: 10px;
}

.alarm-card__actions time,
.event-log-row time,
.event-log-footer span:first-child {
  color: var(--color-subtle);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 14px;
}

.ack-button {
  min-height: 34px;
  padding: 0 16px;
  border: 1px solid var(--color-primary-dark);
  border-radius: 999px;
  background: var(--color-card);
  color: var(--color-primary-dark);
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

.ack-button:hover {
  background: var(--color-primary-dark);
  color: var(--color-card);
}

.acknowledged-label {
  color: var(--color-subtle);
  font-size: 14px;
  font-weight: 700;
}

.expand-icon {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: var(--color-subtle);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.4;
  transition: transform 0.15s ease;
}

.expand-icon.is-expanded {
  transform: rotate(180deg);
}

.stream-status {
  gap: 7px;
  color: var(--color-subtle);
  font-size: 13px;
  font-weight: 700;
}

.pulse-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-subtle);
}

.pulse-dot.is-normal {
  background: var(--color-primary);
}

.pulse-dot.is-error {
  background: var(--color-error);
}

.event-log-card {
  display: grid;
  grid-template-rows: 50px minmax(0, 1fr) 40px;
  height: 390px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-card);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
}

.event-log-grid {
  display: grid;
  grid-template-columns: 106px 96px 110px minmax(0, 1fr);
  align-items: center;
}

.event-log-grid--head {
  min-height: 50px;
  border-bottom: 1px solid var(--color-border-soft);
  background: rgba(248, 250, 252, 0.88);
  color: var(--color-subtle);
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.event-log-grid--head span,
.event-log-row > * {
  min-width: 0;
  padding: 16px;
}

.event-log-body {
  min-height: 0;
  overflow-y: auto;
}

.event-log-body > .empty-state {
  display: grid;
  height: 100%;
  place-items: center;
  padding: 16px;
}

.event-log-row {
  min-height: 58px;
  border-bottom: 1px solid var(--color-border-soft);
  transition: background-color 0.15s ease;
}

.event-log-row:last-child {
  border-bottom: 0;
}

.event-log-row:hover {
  background: var(--color-surface-soft);
}

.level-badge {
  min-height: 29px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
  letter-spacing: 0.04em;
}

.module-label {
  overflow: hidden;
  color: var(--color-muted);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-message {
  overflow: hidden;
  color: var(--color-text-strong);
  font-size: 15px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-log-row.is-error .event-message {
  color: var(--color-error-deep);
}

.event-log-row.is-warn .event-message {
  color: var(--color-warning-strong);
}

.event-log-row.is-debug .event-message {
  color: var(--color-muted);
}

.event-log-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 40px;
  padding: 0 14px;
  border-top: 1px solid var(--color-border-soft);
  background: rgba(248, 250, 252, 0.62);
}

.event-log-footer span:last-child {
  color: var(--color-subtle);
  font-size: 13px;
  font-weight: 700;
}

.empty-state {
  padding: 32px 16px;
  color: var(--color-subtle);
  font-size: 13px;
  text-align: center;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 1120px) {
  .logs-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .logs-toolbar {
    justify-content: flex-start;
    width: 100%;
  }
}

@media (max-width: 760px) {
  .logs-page {
    padding: 12px;
  }

  .logs-toolbar {
    align-items: stretch;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .search-field,
  .search-field input,
  .logs-toolbar select,
  .export-button {
    width: 100%;
  }

  .level-filter {
    grid-column: span 2;
  }

  .toggle-control {
    grid-column: span 2;
  }

  .event-log-grid {
    grid-template-columns: 70px 66px 72px minmax(0, 1fr);
  }

  .event-log-grid--head span,
  .event-log-row > * {
    padding: 12px 9px;
  }

  .alarm-card {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
    height: auto;
    min-height: 108px;
    overflow: visible;
  }

  .alarms-section {
    height: auto;
    min-height: 0;
  }

  .alarm-list {
    grid-auto-rows: auto;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }

  .alarm-card__actions {
    align-items: center;
    flex: none;
    flex-direction: row;
    width: 100%;
    justify-content: space-between;
    margin-left: 0;
    text-align: left;
  }

  .alarm-card__controls {
    justify-content: flex-end;
  }

  .event-log-footer {
    align-items: flex-start;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 9px 14px;
  }

  .event-log-card {
    grid-template-rows: 50px minmax(220px, 1fr) auto;
    height: 390px;
  }
}
</style>
