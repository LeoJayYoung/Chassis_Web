<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import MapSnapshot from '../../components/overview/OverviewMapSnapshot.vue'
import { useRobotRuntimeStore } from '../../stores/robotRuntime'
import { routeToOverviewMapSnapshot } from '../../utils/dashboardAdapters'
import type {
  RuntimeRouteTemplate,
  RuntimeTaskRecord,
  RuntimeTaskStatus,
  RuntimeTaskTimelineStatus,
  RuntimeTaskType,
} from '../../types'

type TaskStatus = RuntimeTaskStatus
type TaskType = RuntimeTaskType
type TimelineStatus = RuntimeTaskTimelineStatus
type TaskTab = 'runs' | 'schedules' | 'routes'

const router = useRouter()
const runtimeStore = useRobotRuntimeStore()
const { runtime } = storeToRefs(runtimeStore)
const tasks = computed(() => runtime.value.taskRuns)
const schedules = computed(() => runtime.value.schedules)
const routeTemplates = computed(() => runtime.value.routeTemplates)
const activeTab = ref<TaskTab>('runs')
const taskTabs: Array<{ value: TaskTab; label: string }> = [
  { value: 'runs', label: '任务记录' },
  { value: 'schedules', label: '巡检计划' },
  { value: 'routes', label: '路线模板' },
]

function tabCount(tab: TaskTab) {
  if (tab === 'runs') return tasks.value.length
  if (tab === 'schedules') return schedules.value.length
  return routeTemplates.value.length
}

const selectedTaskId = ref('')
const draggedTaskIndex = ref<number | null>(null)
const pendingDeleteTask = ref<RuntimeTaskRecord | null>(null)

const selectedTask = computed(
  () => tasks.value.find((task) => task.id === selectedTaskId.value) ?? null,
)

const taskCounts = computed(() => ({
  Running: tasks.value.filter((task) => task.status === 'running').length,
  Pending: tasks.value.filter((task) => task.status === 'idle').length,
  Paused: tasks.value.filter((task) => task.status === 'paused').length,
  Unknown: tasks.value.filter((task) => task.status === 'unknown').length,
  Completed: tasks.value.filter((task) => task.status === 'completed').length,
  Failed: tasks.value.filter(
    (task) =>
      task.status === 'failed' ||
      task.status === 'canceled' ||
      task.status === 'unknown',
  ).length,
}))

const statCards = computed(() => [
  { label: '待执行', count: taskCounts.value.Pending, status: 'idle' as const },
  { label: '已完成', count: taskCounts.value.Completed, status: 'completed' as const },
  { label: '异常/待核对', count: taskCounts.value.Failed, status: 'failed' as const },
])

const tableHeaders = [
  '',
  '任务编号',
  '目标点',
  '执行方式',
  '任务类型',
  '状态',
  '计划时间',
  '创建时间',
  '完成时间',
  '操作',
]

const typeIcons: Record<TaskType, string> = {
  single_point_navigation: 'N',
  multi_point_cruise: 'M',
  return_home: 'R',
}

const typeLabels: Record<TaskType, string> = {
  single_point_navigation: '导航',
  multi_point_cruise: '巡航',
  return_home: '返航',
}

const statusLabels: Record<TaskStatus, string> = {
  idle: '待执行',
  running: '执行中',
  paused: '已暂停',
  unknown: '待核对',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
}

const scheduleStatusLabels = {
  pending: '等待触发',
  waiting: '等待前序任务',
  triggering: '正在触发',
  dispatched: '已下发',
  canceled: '已取消',
  missed: '已错过',
  failed: '调度失败',
} as const

const timelineLabels: Record<TimelineStatus, string> = {
  created: 'Created',
  idle: 'Pending',
  scheduled: 'Scheduled',
  triggered: 'Triggered',
  running: 'Running',
  paused: 'Paused',
  unknown: 'Needs Review',
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Cancelled',
  resumed: 'Resumed',
  retried: 'Retried',
}

function statusClass(status: TaskStatus | TimelineStatus) {
  if (status === 'idle') return 'is-pending'
  if (status === 'canceled') return 'is-cancelled'
  if (status === 'unknown') return 'is-unknown'
  return `is-${status}`
}

function taskTargetName(task: RuntimeTaskRecord) {
  return (
    task.targetName ??
    runtime.value.map.targets.find((target) => target.id === task.targetPointId)?.name ??
    (task.type === 'return_home' ? 'Home' : '待选择')
  )
}

function splitDateTime(value: string | null) {
  if (!value) return null

  const [date = '', time = ''] = value.split(' ')
  return { date, time }
}

function progressValue(task: RuntimeTaskRecord) {
  return `${task.progressPercent ?? 0}%`
}

function formatTimestamp(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')

  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    full: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  }
}

function taskDispatchLabel(task: RuntimeTaskRecord) {
  if (task.dispatchMode === 'scheduled') return '自动触发'
  if (task.dispatchMode === 'manual_schedule') return '手动执行计划'
  if (task.dispatchMode === 'retry') return '重新执行'
  return '立即'
}

function taskPlanTime(task: RuntimeTaskRecord) {
  return task.schedule ? formatTimestamp(task.schedule.scheduledAt) : null
}

function taskStatusText(task: RuntimeTaskRecord) {
  if (task.schedule && task.status === 'idle') {
    return scheduleStatusLabels[task.schedule.status]
  }

  return statusLabels[task.status]
}

function scheduleRuleText(schedule: (typeof schedules.value)[number]) {
  if (schedule.mode === 'interval') {
    return `每 ${schedule.intervalMinutes ?? '--'} 分钟`
  }
  if (schedule.mode === 'daily') {
    return `每天 ${schedule.timeOfDay ?? '--:--'}`
  }
  return schedule.scheduledAt
    ? formatTimestamp(schedule.scheduledAt).full
    : '指定日期'
}

function scheduleNextRun(schedule: (typeof schedules.value)[number]) {
  // 一次性计划的执行时间已在"执行规则"里体现，这里不再重复；
  // 只有启用中的间隔/每日计划才有有意义的"下次执行"。
  if (schedule.mode === 'once') return '—'
  if (schedule.status !== 'enabled' || !schedule.nextRunAt) return '—'
  return formatTimestamp(schedule.nextRunAt).full
}

const scheduleLifecycleLabels: Record<
  'enabled' | 'canceled' | 'completed' | 'expired',
  string
> = {
  enabled: '启用中',
  completed: '已完成',
  canceled: '已取消',
  expired: '已过期',
}

function scheduleStatusLabel(
  status: 'enabled' | 'canceled' | 'completed' | 'expired',
) {
  return scheduleLifecycleLabels[status]
}

function runScheduleNow(scheduleId: string) {
  runtimeStore.runScheduleNow(scheduleId)
}

function cancelSchedule(scheduleId: string) {
  runtimeStore.cancelSchedule(scheduleId)
}

function enableSchedule(scheduleId: string) {
  runtimeStore.enableSchedule(scheduleId)
}

function deleteSchedule(scheduleId: string) {
  runtimeStore.deleteSchedule(scheduleId)
}

const editingRouteId = ref('')
const editingRouteName = ref('')
const expandedRouteId = ref('')
const routePreviewCache = new Map<
  string,
  ReturnType<typeof routeToOverviewMapSnapshot>
>()
let routePreviewCacheKey = ''

function toggleRouteExpand(routeId: string) {
  expandedRouteId.value = expandedRouteId.value === routeId ? '' : routeId
}

function routePreview(route: RuntimeRouteTemplate) {
  const gridStamp = String(runtime.value.map.occupancyGrid?.stamp ?? 'no-grid')

  if (gridStamp !== routePreviewCacheKey) {
    routePreviewCacheKey = gridStamp
    routePreviewCache.clear()
  }

  const cached = routePreviewCache.get(route.id)
  if (cached) return cached

  const snapshot = routeToOverviewMapSnapshot(route.targets, runtime.value)
  routePreviewCache.set(route.id, snapshot)
  return snapshot
}

function startRenameRoute(route: RuntimeRouteTemplate) {
  editingRouteId.value = route.id
  editingRouteName.value = route.name
}

function cancelRenameRoute() {
  editingRouteId.value = ''
  editingRouteName.value = ''
}

function confirmRenameRoute(route: RuntimeRouteTemplate) {
  const name = editingRouteName.value.trim()
  if (!name) return

  runtimeStore.renameRoute(route.id, name)
  cancelRenameRoute()
}

async function handleDeleteRoute(route: RuntimeRouteTemplate) {
  if (!window.confirm(`确认删除路线模板「${route.name}」？`)) return

  const error = await runtimeStore.deleteRoute(route.id)
  if (error) {
    window.alert(`删除失败：${error}`)
  }
}

function runRouteImmediately(route: RuntimeRouteTemplate) {
  runtimeStore.reuseRouteImmediately(route.id)
}

const reuseRoute = ref<RuntimeRouteTemplate | null>(null)
const reuseMode = ref<'once' | 'interval' | 'daily'>('once')
const reuseScheduledAt = ref('')
const reuseInterval = ref(60)
const reuseTimeOfDay = ref('09:00')
const reuseError = ref('')

const reuseModeOptions: Array<{ value: 'once' | 'interval' | 'daily'; label: string }> = [
  { value: 'once', label: '一次性' },
  { value: 'interval', label: '间隔' },
  { value: 'daily', label: '每日' },
]

function toDatetimeLocalValue(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const reuseMinDateTime = computed(() => toDatetimeLocalValue(Date.now() + 60_000))

function openReuseRoute(route: RuntimeRouteTemplate) {
  reuseRoute.value = route
  reuseMode.value = 'once'
  reuseScheduledAt.value = toDatetimeLocalValue(Date.now() + 5 * 60_000)
  reuseInterval.value = 60
  reuseTimeOfDay.value = '09:00'
  reuseError.value = ''
}

function closeReuseRoute() {
  reuseRoute.value = null
  reuseError.value = ''
}

async function confirmReuseRoute() {
  const route = reuseRoute.value
  if (!route) return

  const input: {
    mode: 'once' | 'interval' | 'daily'
    scheduledAt?: number
    intervalMinutes?: number
    timeOfDay?: string
  } = { mode: reuseMode.value }

  if (reuseMode.value === 'once') {
    const timestamp = new Date(reuseScheduledAt.value).getTime()
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
      reuseError.value = '请选择晚于当前时间的执行时间'
      return
    }
    input.scheduledAt = timestamp
  } else if (reuseMode.value === 'interval') {
    if (!Number.isInteger(reuseInterval.value) || reuseInterval.value <= 0) {
      reuseError.value = '间隔分钟数必须是大于 0 的整数'
      return
    }
    input.intervalMinutes = reuseInterval.value
  } else {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reuseTimeOfDay.value)) {
      reuseError.value = '时间格式应为 HH:MM'
      return
    }
    input.timeOfDay = reuseTimeOfDay.value
  }

  const error = await runtimeStore.createScheduleFromRoute(route.id, input)
  if (error) {
    reuseError.value = error
    return
  }

  closeReuseRoute()
}

function selectTask(task: RuntimeTaskRecord) {
  selectedTaskId.value = task.id
  void runtimeStore.loadTaskDetail(task.id)
}

function goToMapWorkbench() {
  router.push('/map')
}

function startTask(task: RuntimeTaskRecord) {
  runtimeStore.startTask(task.id)
}

function pauseTask(task: RuntimeTaskRecord) {
  runtimeStore.pauseTask(task.id)
}

function continueTask(task: RuntimeTaskRecord) {
  runtimeStore.continueTask(task.id)
}

function cancelTask(task: RuntimeTaskRecord) {
  runtimeStore.cancelTask(task.id)
}

function retryTask(task: RuntimeTaskRecord) {
  runtimeStore.retryTask(task.id)
}

function requestDeleteTask(task: RuntimeTaskRecord) {
  pendingDeleteTask.value = task
}

function closeDeleteModal() {
  pendingDeleteTask.value = null
}

async function confirmDeleteTask() {
  if (!pendingDeleteTask.value) return

  const taskId = pendingDeleteTask.value.id
  const deleted = await runtimeStore.deleteTask(taskId)

  if (deleted) {
    selectedTaskId.value = ''
  }

  closeDeleteModal()
}

function dragStart(index: number) {
  draggedTaskIndex.value = index
}

function dragOver(index: number) {
  if (draggedTaskIndex.value === null || draggedTaskIndex.value === index) return

  runtimeStore.reorderTasks(draggedTaskIndex.value, index)
  draggedTaskIndex.value = index
}

function dragEnd() {
  draggedTaskIndex.value = null
}
</script>

<template>
  <section class="tasks-page">
    <header class="tasks-header">
      <div>
        <div class="tasks-header__eyebrow">
          <span>ROBOT CHASSIS CONTROL</span>
          <span>/</span>
          <strong>TASKS</strong>
        </div>
        <h1>Tasks</h1>
      </div>

      <div class="tasks-header__actions">
        <button class="toolbar-button" type="button">导入 / 导出</button>
        <button class="toolbar-button" type="button" @click="activeTab = 'routes'">
          路线模板
        </button>
        <button class="toolbar-button toolbar-button--primary" type="button" @click="goToMapWorkbench">
          新建任务
        </button>
      </div>
    </header>

    <nav class="task-tabs" aria-label="任务管理视图">
      <button
        v-for="tab in taskTabs"
        :key="tab.value"
        type="button"
        :class="{ 'is-active': activeTab === tab.value }"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
        <span>{{ tabCount(tab.value) }}</span>
      </button>
    </nav>

    <section v-if="activeTab === 'runs'" class="stats-grid" aria-label="Task statistics">
      <article class="stat-card stat-card--dark">
        <span>当前执行</span>
        <strong>{{ taskCounts.Running }}</strong>
        <small><i class="status-dot is-running"></i>Active tasks</small>
      </article>

      <article class="stat-card stat-card--dark-secondary">
        <span>任务总数</span>
        <strong>{{ tasks.length }}</strong>
        <small>This session</small>
      </article>

      <article
        v-for="stat in statCards"
        :key="stat.label"
        class="stat-card stat-card--light"
      >
        <span>{{ stat.label }}</span>
        <strong>{{ stat.count }}</strong>
        <i class="stat-card__dot" :class="statusClass(stat.status)"></i>
      </article>
    </section>

    <main v-if="activeTab === 'runs'" class="tasks-content">
      <section class="task-table-card" aria-label="Task list">
        <div class="task-table">
          <div class="task-row task-row--head">
            <div v-for="header in tableHeaders" :key="header">{{ header }}</div>
          </div>

          <TransitionGroup name="task-row-fade" tag="div" class="task-table__body">
            <div
              v-for="(task, index) in tasks"
              :key="task.id"
              class="task-row"
              :class="{ 'is-selected': selectedTaskId === task.id }"
              draggable="true"
              @click="selectTask(task)"
              @dragstart="dragStart(index)"
              @dragover.prevent="dragOver(index)"
              @dragend="dragEnd"
            >
              <div class="task-row__drag" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </div>

              <div>
                <span class="task-id">{{ task.id }}</span>
              </div>

              <div class="task-target">{{ taskTargetName(task) }}</div>

              <div>
                <span class="dispatch-badge" :class="{ 'is-scheduled': task.dispatchMode === 'scheduled' }">
                  {{ taskDispatchLabel(task) }}
                </span>
              </div>

              <div>
                <span class="type-badge">
                  <i>{{ typeIcons[task.type] }}</i>
                  {{ typeLabels[task.type] }}
                </span>
              </div>

              <div>
                <span class="status-badge" :class="statusClass(task.status)">
                  <i class="status-dot" :class="statusClass(task.status)"></i>
                  {{ task.transitioning ? 'Updating' : taskStatusText(task) }}
                </span>
              </div>

              <div class="time-cell">
                <template v-if="taskPlanTime(task)">
                  <strong>{{ taskPlanTime(task)?.time }}</strong>
                  <span>{{ taskPlanTime(task)?.date }}</span>
                </template>
                <span v-else class="empty-mark">-</span>
              </div>

              <div class="time-cell">
                <template v-if="splitDateTime(task.createdTime)">
                  <strong>{{ splitDateTime(task.createdTime)?.time }}</strong>
                  <span>{{ splitDateTime(task.createdTime)?.date }}</span>
                </template>
              </div>

              <div class="time-cell">
                <template v-if="splitDateTime(task.completedTime)">
                  <strong>{{ splitDateTime(task.completedTime)?.time }}</strong>
                  <span>{{ splitDateTime(task.completedTime)?.date }}</span>
                </template>
                <span v-else class="empty-mark">-</span>
              </div>

              <div class="task-actions" @click.stop>
                <button
                  v-if="task.status === 'idle'"
                  class="action-button is-success"
                  type="button"
                  :disabled="task.transitioning"
                  @click="startTask(task)"
                >
                  {{ task.schedule ? '立即执行' : '开始' }}
                </button>
                <button
                  v-if="task.status === 'idle' && task.schedule"
                  class="action-button is-danger"
                  type="button"
                  :disabled="task.transitioning"
                  @click="cancelTask(task)"
                >
                  取消定时
                </button>
                <template v-if="task.status === 'running'">
                  <button
                    class="action-button is-warning"
                    type="button"
                    :disabled="task.transitioning"
                    @click="pauseTask(task)"
                  >
                    暂停
                  </button>
                  <button
                    class="action-button is-danger"
                    type="button"
                    :disabled="task.transitioning"
                    @click="cancelTask(task)"
                  >
                    取消
                  </button>
                </template>
                <template v-if="task.status === 'paused'">
                  <button
                    class="action-button is-success"
                    type="button"
                    :disabled="task.transitioning"
                    @click="continueTask(task)"
                  >
                    继续
                  </button>
                  <button
                    class="action-button is-danger"
                    type="button"
                    :disabled="task.transitioning"
                    @click="cancelTask(task)"
                  >
                    取消
                  </button>
                </template>
                <button
                  v-if="task.status === 'unknown'"
                  class="action-button is-danger"
                  type="button"
                  :disabled="task.transitioning"
                  @click="cancelTask(task)"
                >
                  取消
                </button>
                <button
                  v-if="
                    task.status === 'failed' ||
                    task.status === 'canceled' ||
                    task.status === 'unknown'
                  "
                  class="action-button is-primary"
                  type="button"
                  :disabled="task.transitioning"
                  @click="retryTask(task)"
                >
                  {{ task.status === 'unknown' ? '重新执行' : '重试' }}
                </button>
                <span v-if="task.status === 'completed'" class="empty-mark">-</span>
                <button class="action-button is-ghost" type="button" @click="selectedTaskId = task.id">
                  详情
                </button>
              </div>
            </div>
          </TransitionGroup>
        </div>
      </section>

      <div
        v-if="selectedTask"
        class="drawer-backdrop"
        aria-label="任务详情遮罩"
        @click="selectedTaskId = ''"
      >
        <aside class="task-detail" aria-label="Task detail" @click.stop>
        <header class="task-detail__head">
          <div>
            <span>{{ selectedTask.id }}</span>
            <strong>{{ taskTargetName(selectedTask) }}</strong>
          </div>
          <button type="button" aria-label="Close task detail" @click="selectedTaskId = ''">x</button>
        </header>

        <section class="detail-section">
          <h2>Current Task Details</h2>
          <div class="detail-list">
            <div>
              <span>任务状态</span>
              <strong>
                <span class="status-badge" :class="statusClass(selectedTask.status)">
                  <i class="status-dot" :class="statusClass(selectedTask.status)"></i>
                  {{ taskStatusText(selectedTask) }}
                </span>
              </strong>
            </div>
            <div>
              <span>任务类型</span>
              <strong>{{ typeLabels[selectedTask.type] }}</strong>
            </div>
            <div>
              <span>目标点</span>
              <strong class="is-link">{{ taskTargetName(selectedTask) }}</strong>
            </div>
            <div>
              <span>执行方式</span>
              <strong>{{ taskDispatchLabel(selectedTask) }}</strong>
            </div>
            <div v-if="selectedTask.schedule">
              <span>计划时间</span>
              <strong>{{ taskPlanTime(selectedTask)?.full }}</strong>
            </div>
            <div v-if="selectedTask.schedule">
              <span>计划状态</span>
              <strong>{{ scheduleStatusLabels[selectedTask.schedule.status] }}</strong>
            </div>
            <div>
              <span>创建时间</span>
              <strong>{{ selectedTask.createdTime }}</strong>
            </div>
            <div v-if="selectedTask.completedTime">
              <span>完成时间</span>
              <strong>{{ selectedTask.completedTime }}</strong>
            </div>
          </div>

          <div class="detail-progress">
            <div>
              <span>任务进度</span>
              <strong>{{ progressValue(selectedTask) }}</strong>
            </div>
            <div class="progress-bar">
              <span :style="{ width: progressValue(selectedTask) }"></span>
            </div>
          </div>
        </section>

        <section class="detail-section">
          <h2>Execution Feedback</h2>
          <div class="feedback-box" :class="statusClass(selectedTask.status)">
            {{ selectedTask.feedback ?? 'No execution data.' }}
          </div>
          <div v-if="selectedTask.failureReason" class="failure-box">
            <strong>Failure Reason</strong>
            <p>{{ selectedTask.failureReason }}</p>
          </div>
        </section>

        <section class="detail-section">
          <h2>History Timeline</h2>
          <div class="timeline">
            <div
              v-for="(event, index) in selectedTask.timeline"
              :key="`${event.status}-${event.timestamp}`"
              class="timeline-item"
            >
              <i :class="statusClass(event.status)"></i>
              <div>
                <strong>{{ timelineLabels[event.status] }}</strong>
                <span v-if="event.note">{{ event.note }}</span>
                <small>{{ event.timestamp }}</small>
              </div>
              <b v-if="index !== selectedTask.timeline.length - 1"></b>
            </div>
          </div>
        </section>

        <footer class="task-detail__footer">
          <button class="delete-task-button" type="button" @click="requestDeleteTask(selectedTask)">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.7 11H7.7L7 9Zm3 2v7h1.5v-7H10Zm2.5 0v7H14v-7h-1.5Z" />
            </svg>
            删除此任务
          </button>
        </footer>
      </aside>
      </div>
    </main>

    <main v-else-if="activeTab === 'schedules'" class="management-list">
      <article
        v-for="schedule in schedules"
        :key="schedule.id"
        class="management-row"
      >
        <div class="management-row__main">
          <span class="management-row__eyebrow">SCHEDULE</span>
          <strong>{{ schedule.name }}</strong>
          <small>{{ schedule.routeName }}</small>
          <span class="schedule-status" :class="`is-${schedule.status}`">
            {{ scheduleStatusLabel(schedule.status) }}
          </span>
        </div>
        <div class="management-row__metric">
          <span>执行规则</span>
          <strong>{{ scheduleRuleText(schedule) }}</strong>
        </div>
        <div class="management-row__metric">
          <span>下次执行</span>
          <strong>{{ scheduleNextRun(schedule) }}</strong>
        </div>
        <div class="management-row__metric">
          <span>路线</span>
          <strong>{{ schedule.targetNames.join(' → ') || '未配置' }}</strong>
        </div>
        <div class="management-row__actions">
          <template v-if="schedule.status === 'enabled'">
            <button
              class="action-button is-success"
              type="button"
              @click="runScheduleNow(schedule.id)"
            >
              立即执行
            </button>
            <button
              class="action-button is-danger"
              type="button"
              @click="cancelSchedule(schedule.id)"
            >
              取消计划
            </button>
          </template>
          <template v-else-if="schedule.status === 'completed' || schedule.status === 'expired'">
            <button
              class="action-button is-danger"
              type="button"
              @click="deleteSchedule(schedule.id)"
            >
              删除
            </button>
          </template>
          <template v-else>
            <button
              class="action-button is-success"
              type="button"
              @click="enableSchedule(schedule.id)"
            >
              重新启用
            </button>
            <button
              class="action-button is-danger"
              type="button"
              @click="deleteSchedule(schedule.id)"
            >
              删除计划
            </button>
          </template>
        </div>
      </article>
      <div v-if="!schedules.length" class="management-empty">
        暂无巡检计划，请从 Map Control 创建。
      </div>
    </main>

    <main v-else class="route-template-grid">
      <article
        v-for="route in routeTemplates"
        :key="route.id"
        class="route-template-card"
        :class="{ 'is-expanded': expandedRouteId === route.id }"
      >
        <div
          class="route-template-card__title"
          title="双击标题可改名"
          @dblclick="startRenameRoute(route)"
        >
          <span>ROUTE TEMPLATE</span>
          <template v-if="editingRouteId === route.id">
            <input
              v-model="editingRouteName"
              class="route-rename-input"
              maxlength="40"
              aria-label="路线名称"
              @dblclick.stop
              @keyup.enter="confirmRenameRoute(route)"
              @keyup.esc="cancelRenameRoute"
            />
          </template>
          <template v-else>
            <strong>{{ route.name }}</strong>
          </template>
        </div>

        <div v-if="expandedRouteId === route.id" class="route-template-card__map">
          <MapSnapshot :snapshot="routePreview(route)" focus-waypoints />
        </div>

        <p>{{ route.targets.map((target) => target.name).join(' → ') }}</p>

        <footer>
          <span>{{ route.targets.length }} 个航点</span>
          <span>{{ formatTimestamp(route.createdAt).full }}</span>
        </footer>

        <div class="route-template-card__actions">
          <template v-if="editingRouteId === route.id">
            <button class="action-button is-success" type="button" @click="confirmRenameRoute(route)">
              保存
            </button>
            <button class="action-button is-ghost" type="button" @click="cancelRenameRoute">
              取消
            </button>
          </template>
          <template v-else>
            <button class="action-button is-success" type="button" @click="runRouteImmediately(route)">
              立即执行
            </button>
            <button class="action-button is-success" type="button" @click="openReuseRoute(route)">
              建计划
            </button>
            <button class="action-button is-ghost" type="button" @click="toggleRouteExpand(route.id)">
              {{ expandedRouteId === route.id ? '收起地图' : '展开地图' }}
            </button>
            <button class="action-button is-danger" type="button" @click="handleDeleteRoute(route)">
              删除
            </button>
          </template>
        </div>
      </article>
      <div v-if="!routeTemplates.length" class="management-empty">
        暂无路线模板，请在地图页选择目标点并保存模板。
      </div>
    </main>

    <Teleport to="body">
      <div v-if="pendingDeleteTask" class="confirm-backdrop" role="presentation" @click="closeDeleteModal">
        <section class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-task-title" @click.stop>
          <h2 id="delete-task-title">确认删除任务？</h2>
          <p>
            即将删除任务 {{ pendingDeleteTask.id }} ({{ taskTargetName(pendingDeleteTask) }})。此操作不可撤销，请确认。
          </p>
          <div class="confirm-actions">
            <button class="confirm-button confirm-button--ghost" type="button" @click="closeDeleteModal">
              取消
            </button>
            <button class="confirm-button confirm-button--danger" type="button" @click="confirmDeleteTask">
              确认删除
            </button>
          </div>
        </section>
      </div>

      <div v-if="reuseRoute" class="confirm-backdrop" role="presentation" @click="closeReuseRoute">
        <section class="reuse-modal" role="dialog" aria-modal="true" aria-labelledby="reuse-route-title" @click.stop>
          <h2 id="reuse-route-title">用此路线建计划</h2>
          <p>{{ reuseRoute.name }}（{{ reuseRoute.targets.length }} 个航点）</p>

          <div class="reuse-mode">
            <button
              v-for="option in reuseModeOptions"
              :key="option.value"
              type="button"
              :class="{ 'is-active': reuseMode === option.value }"
              @click="reuseMode = option.value"
            >
              {{ option.label }}
            </button>
          </div>

          <label v-if="reuseMode === 'once'" class="reuse-field">
            <span>执行时间</span>
            <input v-model="reuseScheduledAt" type="datetime-local" :min="reuseMinDateTime" />
          </label>

          <label v-if="reuseMode === 'interval'" class="reuse-field">
            <span>间隔（分钟）</span>
            <input v-model.number="reuseInterval" type="number" min="1" />
          </label>

          <label v-if="reuseMode === 'daily'" class="reuse-field">
            <span>每天时间</span>
            <input v-model="reuseTimeOfDay" type="time" />
          </label>

          <p v-if="reuseError" class="reuse-error">{{ reuseError }}</p>

          <div class="confirm-actions">
            <button class="confirm-button confirm-button--ghost" type="button" @click="closeReuseRoute">
              取消
            </button>
            <button class="confirm-button confirm-button--primary" type="button" @click="confirmReuseRoute">
              创建计划
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.tasks-page {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 20px;
  height: 100%;
  overflow: auto;
  padding: 16px 20px 24px;
  color: var(--color-text);
}

.task-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--color-border);
}

.task-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 750;
  cursor: pointer;
}

.task-tabs button.is-active {
  border-bottom-color: var(--color-primary);
  color: var(--color-primary-dark);
}

.task-tabs button span {
  min-width: 22px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--color-neutral-bg);
  color: var(--color-muted);
  font-size: 11px;
  text-align: center;
}

.task-tabs button.is-active span {
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.tasks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
}

.tasks-header h1 {
  margin: 4px 0 0;
  color: var(--color-text);
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: 0;
}

.tasks-header__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-subtle);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.tasks-header__eyebrow strong {
  color: var(--color-primary);
}

.tasks-header__actions,
.task-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.task-actions {
  justify-content: flex-end;
  width: 100%;
}

.toolbar-button,
.action-button {
  border: 1px solid var(--color-border);
  background: var(--color-card);
  color: var(--color-text-strong);
  font: inherit;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.toolbar-button {
  min-height: 40px;
  padding: 0 15px;
  border-radius: 12px;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);
  font-size: 13px;
  font-weight: 600;
}

.toolbar-button:hover,
.action-button:hover {
  border-color: var(--color-border-strong);
  background: var(--color-surface-soft);
}

.toolbar-button--primary {
  border-color: transparent;
  background: var(--color-primary);
  color: var(--color-card);
}

.toolbar-button--primary:hover {
  border-color: transparent;
  background: var(--color-primary-strong);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.stat-card {
  position: relative;
  display: grid;
  min-height: 112px;
  gap: 7px;
  padding: 18px;
  overflow: hidden;
  border-radius: 14px;
}

.stat-card span {
  color: inherit;
  opacity: 0.7;
  font-size: 12px;
  font-weight: 600;
}

.stat-card strong {
  font-size: 30px;
  line-height: 1;
}

.stat-card small {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 700;
}

.stat-card--dark,
.stat-card--dark-secondary {
  background: var(--color-sidebar);
  color: var(--color-card);
}

.stat-card--dark-secondary {
  background: var(--color-sidebar);
}

.stat-card--light {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border: 1px solid var(--color-border);
  background: var(--color-card);
  color: var(--color-text);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}

.stat-card--light span {
  grid-column: 1;
  color: var(--color-subtle);
  opacity: 1;
}

.stat-card--light strong {
  grid-column: 1;
  color: var(--color-text);
  font-size: 28px;
}

.stat-card__dot {
  grid-column: 2;
  grid-row: 1 / span 2;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: var(--color-surface-soft);
}

.tasks-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.task-table-card,
.task-detail {
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-card);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}

.task-table-card {
  position: relative;
  width: 100%;
  max-height: min(760px, calc(100vh - 300px));
  overflow: auto;
}

.task-table-card::after {
  position: sticky;
  bottom: 0;
  left: 0;
  display: block;
  width: 100%;
  height: 28px;
  margin-top: -28px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0), var(--color-card));
  pointer-events: none;
  content: '';
}

.task-table-card::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.task-table-card::-webkit-scrollbar-track {
  background: transparent;
}

.task-table-card::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: #cbd5e1;
}

.task-table-card::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

.task-table {
  width: 100%;
  min-width: 1460px;
}

.task-table__body {
  position: relative;
}

.task-row {
  display: grid;
  grid-template-columns:
    44px
    minmax(132px, 0.9fr)
    minmax(200px, 1.25fr)
    minmax(128px, 0.72fr)
    minmax(126px, 0.78fr)
    minmax(138px, 0.82fr)
    148px
    148px
    148px
    minmax(220px, 1.1fr);
  align-items: center;
  border-bottom: 1px solid var(--color-border-soft);
  color: var(--color-text-strong);
  font-size: 14px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-left-color 0.15s ease;
}

.task-row > div {
  min-width: 0;
  padding: 16px 18px;
}

.task-row > div:first-child {
  padding-right: 10px;
  padding-left: 10px;
}

.task-row > div:last-child {
  text-align: right;
}

.task-row:hover,
.task-row.is-selected {
  background: rgba(16, 185, 129, 0.045);
}

.task-row.is-selected {
  box-shadow: inset 2px 0 0 var(--color-primary);
}

.task-row-fade-move,
.task-row-fade-enter-active,
.task-row-fade-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.task-row-fade-enter-from,
.task-row-fade-leave-to {
  opacity: 0;
  transform: translateX(12px);
}

.task-row--head {
  position: sticky;
  top: 0;
  z-index: 10;
  color: var(--color-subtle);
  background: var(--color-card);
  box-shadow: 0 1px 0 var(--color-border-soft);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: default;
}

.task-row--head:hover {
  background: var(--color-card);
}

.task-row__drag {
  display: grid;
  justify-content: center;
  gap: 3px;
  color: var(--color-border-strong);
  cursor: grab;
}

.task-row__drag span {
  display: block;
  width: 14px;
  height: 2px;
  border-radius: 999px;
  background: currentColor;
}

.task-id {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface-soft);
  color: var(--color-text-tertiary);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 700;
}

.task-target {
  overflow: hidden;
  color: var(--color-text-strong);
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dispatch-badge,
.type-badge,
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 0 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.dispatch-badge {
  border: 1px solid var(--color-border);
  background: var(--color-surface-soft);
  color: var(--color-text-tertiary);
}

.dispatch-badge.is-scheduled {
  border-color: var(--color-warning-border);
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.type-badge {
  border-radius: 8px;
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.type-badge i {
  font-style: normal;
  font-size: 11px;
}

.status-badge {
  border: 1px solid transparent;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-subtle);
}

.status-badge.is-running {
  border-color: var(--color-primary-border);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.status-badge.is-pending {
  border-color: var(--color-border);
  background: var(--color-border-soft);
  color: var(--color-text-tertiary);
}

.status-badge.is-paused {
  border-color: var(--color-warning-border);
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.status-badge.is-unknown {
  border-color: var(--color-warning-border);
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.status-badge.is-completed {
  border-color: var(--color-primary-border);
  background: var(--color-primary-bg);
  color: var(--color-primary-deep);
}

.status-badge.is-failed,
.status-badge.is-cancelled {
  border-color: var(--color-error-border);
  background: var(--color-error-bg);
  color: var(--color-error-strong);
}

.status-dot.is-running,
.status-dot.is-completed,
.stat-card__dot.is-completed {
  background: var(--color-primary);
}

.status-dot.is-running {
  animation: pulse 1.2s ease-in-out infinite;
}

.status-dot.is-paused {
  background: var(--color-warning);
}

.status-dot.is-unknown {
  background: var(--color-warning);
}

.status-dot.is-failed,
.status-dot.is-cancelled,
.stat-card__dot.is-failed {
  background: var(--color-error);
}

.status-dot.is-pending,
.stat-card__dot.is-pending {
  background: var(--color-subtle);
}

.time-cell {
  color: var(--color-subtle);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.time-cell strong {
  display: block;
  color: var(--color-text-tertiary);
  font-size: 13px;
  font-weight: 600;
}

.empty-mark {
  color: var(--color-border-strong);
  font-size: 12px;
}

.action-button {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
}

.action-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.action-button.is-success,
.action-button.is-primary {
  border-color: var(--color-primary-border);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.action-button.is-warning {
  border-color: var(--color-warning-border);
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.action-button.is-danger {
  border-color: var(--color-error-border);
  background: var(--color-error-bg);
  color: var(--color-error-strong);
}

.action-button.is-ghost {
  border-color: var(--color-border);
  background: var(--color-surface-soft);
  color: var(--color-text-tertiary);
}

.drawer-backdrop {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  justify-content: flex-end;
  background: rgba(245, 247, 250, 0.68);
  backdrop-filter: blur(2px);
}

.task-detail {
  display: flex;
  flex-direction: column;
  width: min(420px, calc(100vw - 32px));
  height: 100%;
  overflow: hidden;
  border-top-right-radius: 16px;
  border-bottom-right-radius: 16px;
  animation: drawer-in 0.2s ease-out;
}

.task-detail__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--color-border-soft);
}

.task-detail__head div {
  display: grid;
  gap: 4px;
}

.task-detail__head span {
  color: var(--color-subtle);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
}

.task-detail__head strong {
  color: var(--color-text);
  font-size: 14px;
}

.task-detail__head button {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: var(--color-surface-soft);
  color: var(--color-subtle);
  font: inherit;
  font-size: 16px;
}

.task-detail__head button:hover {
  color: var(--color-text-strong);
  background: var(--color-border-soft);
}

.detail-section {
  padding: 16px 18px;
  border-bottom: 1px solid var(--color-border-soft);
}

.detail-section:last-of-type {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-bottom: 0;
}

.detail-section h2 {
  margin: 0 0 13px;
  color: var(--color-subtle);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.detail-list {
  display: grid;
  gap: 10px;
}

.detail-list div,
.detail-progress div:first-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.detail-list span,
.detail-progress span {
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.detail-list strong,
.detail-progress strong {
  color: var(--color-text-strong);
  font-size: 11px;
  font-weight: 700;
  text-align: right;
}

.detail-list .is-link {
  color: var(--color-primary-strong);
}

.detail-progress {
  display: grid;
  gap: 7px;
  margin-top: 14px;
}

.progress-bar {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-border-soft);
}

.progress-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width 0.25s ease;
}

.feedback-box,
.failure-box {
  padding: 12px;
  border-radius: 12px;
  color: var(--color-text-strong);
  font-size: 12px;
  line-height: 1.55;
}

.feedback-box {
  border: 1px solid var(--color-border);
  background: var(--color-surface-soft);
}

.feedback-box.is-running,
.feedback-box.is-completed {
  border-color: var(--color-primary-border);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.feedback-box.is-paused {
  border-color: var(--color-warning-border);
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.feedback-box.is-unknown {
  border-color: var(--color-warning-border);
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.feedback-box.is-failed,
.feedback-box.is-cancelled {
  border-color: var(--color-error-border);
  background: var(--color-error-bg);
  color: var(--color-error-strong);
}

.failure-box {
  margin-top: 10px;
  border: 1px solid var(--color-error-border);
  background: var(--color-error-bg);
  color: var(--color-error-deep);
}

.failure-box strong {
  display: block;
  margin-bottom: 5px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.failure-box p {
  margin: 0;
}

.timeline {
  display: grid;
}

.timeline-item {
  position: relative;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 10px;
}

.timeline-item i {
  position: relative;
  z-index: 1;
  width: 14px;
  height: 14px;
  margin-top: 3px;
  border: 3px solid var(--color-primary-bg);
  border-radius: 50%;
  background: var(--color-primary);
}

.timeline-item i.is-paused {
  border-color: var(--color-warning-bg);
  background: var(--color-warning);
}

.timeline-item i.is-unknown {
  border-color: var(--color-warning-bg);
  background: var(--color-warning);
}

.management-list {
  grid-row: 3 / -1;
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
}

.management-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.35fr) repeat(3, minmax(150px, 1fr)) auto;
  align-items: center;
  gap: 18px;
  padding: 18px 20px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-card);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.management-row__main,
.management-row__metric {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.management-row__eyebrow,
.management-row__metric span {
  color: var(--color-subtle);
  font-size: 11px;
  font-weight: 700;
}

.management-row__main strong {
  color: var(--color-text);
  font-size: 15px;
}

.management-row__main small {
  overflow: hidden;
  color: var(--color-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.management-row__metric strong {
  overflow: hidden;
  color: var(--color-text-strong);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.management-row__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.schedule-status {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.schedule-status.is-enabled {
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.schedule-status.is-completed {
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.schedule-status.is-canceled {
  background: var(--color-neutral-bg);
  color: var(--color-muted);
}

.schedule-status.is-expired {
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.route-template-grid {
  grid-row: 3 / -1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
}

.route-template-card {
  display: grid;
  gap: 16px;
  min-height: 170px;
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-card);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.route-template-card__title {
  display: grid;
  gap: 5px;
  cursor: pointer;
}

.route-template-card__title:hover strong {
  color: var(--color-primary-strong);
}

.route-template-card__title span {
  color: var(--color-subtle);
  font-size: 10px;
  font-weight: 800;
}

.route-template-card__title strong {
  color: var(--color-text);
  font-size: 16px;
}

.route-template-card__map {
  position: relative;
  height: 220px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface-soft);
}

.route-template-card__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.route-rename-input {
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  color: var(--color-text);
  font: inherit;
  font-size: 14px;
}

.route-template-card p {
  margin: 0;
  color: var(--color-text-strong);
  font-size: 13px;
  line-height: 1.6;
}

.route-template-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  color: var(--color-subtle);
  font-size: 11px;
}

.management-empty {
  display: grid;
  min-height: 220px;
  place-items: center;
  border: 1px dashed var(--color-border-strong);
  border-radius: 12px;
  color: var(--color-subtle);
  font-size: 13px;
}

.timeline-item i.is-failed,
.timeline-item i.is-cancelled {
  border-color: var(--color-error-bg);
  background: var(--color-error);
}

.timeline-item i.is-created {
  border-color: var(--color-surface-soft);
  background: var(--color-subtle);
}

.timeline-item i.is-scheduled,
.timeline-item i.is-triggered {
  border-color: var(--color-warning-bg);
  background: var(--color-warning);
}

.timeline-item b {
  position: absolute;
  top: 18px;
  bottom: 0;
  left: 6px;
  width: 1px;
  background: var(--color-border);
}

.timeline-item div {
  display: grid;
  gap: 3px;
  padding-bottom: 16px;
}

.timeline-item strong {
  color: var(--color-primary-strong);
  font-size: 12px;
}

.timeline-item span {
  color: var(--color-subtle);
  font-size: 10px;
}

.timeline-item small {
  color: var(--color-subtle);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
}

.task-detail__footer {
  margin-top: auto;
  padding: 16px 18px;
  border-top: 1px solid var(--color-border-soft);
  background: var(--color-card);
}

.delete-task-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--color-error);
  border-radius: 12px;
  background: var(--color-card);
  color: var(--color-error);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.delete-task-button:hover {
  background: var(--color-error-bg);
  color: var(--color-error-strong);
}

.delete-task-button svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.4);
}

.confirm-modal {
  width: min(420px, 100%);
  padding: 22px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-card);
  box-shadow:
    0 24px 54px rgba(15, 23, 42, 0.18),
    0 4px 12px rgba(15, 23, 42, 0.08);
}

.confirm-modal h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 18px;
  font-weight: 800;
}

.confirm-modal p {
  margin: 12px 0 0;
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.65;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
}

.confirm-button {
  min-height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
}

.confirm-button--ghost {
  border: 1px solid var(--color-border);
  background: var(--color-card);
  color: var(--color-muted);
}

.confirm-button--ghost:hover {
  background: var(--color-surface-soft);
  color: var(--color-text-strong);
}

.confirm-button--danger {
  border: 1px solid transparent;
  background: var(--color-error-strong);
  color: #ffffff;
}

.confirm-button--danger:hover {
  background: var(--color-error-deep);
}

.confirm-button--primary {
  border: 1px solid transparent;
  background: var(--color-primary);
  color: #ffffff;
}

.confirm-button--primary:hover {
  background: var(--color-primary-strong);
}

.reuse-modal {
  display: grid;
  gap: 12px;
  width: min(460px, 100%);
  padding: 22px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-card);
  box-shadow:
    0 24px 54px rgba(15, 23, 42, 0.18),
    0 4px 12px rgba(15, 23, 42, 0.08);
}

.reuse-modal h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 18px;
  font-weight: 800;
}

.reuse-modal p {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
}

.reuse-mode {
  display: flex;
  gap: 8px;
}

.reuse-mode button {
  flex: 1;
  min-height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.reuse-mode button.is-active {
  border-color: var(--color-primary-dark);
  background: var(--color-primary-dark);
  color: var(--color-card);
}

.reuse-field {
  display: grid;
  gap: 6px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}

.reuse-field input {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-card);
  color: var(--color-text);
  font: inherit;
}

.reuse-error {
  margin: 0;
  color: var(--color-error-strong);
  font-size: 13px;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.45;
  }
}

@keyframes drawer-in {
  from {
    opacity: 0;
    transform: translateX(18px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@media (max-width: 1280px) {
  .task-detail {
    width: min(400px, calc(100vw - 24px));
  }
}

@media (max-width: 960px) {
  .tasks-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .task-table-card {
    overflow-x: auto;
  }

  .management-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .management-row__main,
  .management-row__actions {
    grid-column: 1 / -1;
  }

  .management-row__actions {
    justify-content: flex-start;
  }

  .route-template-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .tasks-page {
    padding: 12px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .task-detail {
    width: 100vw;
    border-radius: 0;
  }

  .task-tabs {
    overflow-x: auto;
  }

  .task-tabs button {
    flex: none;
  }

  .management-row,
  .route-template-grid {
    grid-template-columns: 1fr;
  }
}
</style>
