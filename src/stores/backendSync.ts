import type { Ref } from 'vue'
import type {
  BackendClient,
  BackendLog,
  BackendRoute,
  BackendSchedule,
  BackendTaskRun,
} from '../api'
import type {
  RuntimeDashboardSnapshot,
  RuntimeLogModule,
  RuntimeRouteTemplate,
  RuntimeScheduleRecord,
  RuntimeTaskRecord,
  RuntimeTaskStatus,
  RuntimeTaskTimelineStatus,
} from '../types'

function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
}

function formatTimestamp(timestamp: number | null | undefined) {
  if (!timestamp) return null

  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function logLevel(level: string): RuntimeDashboardSnapshot['logs'][number]['level'] {
  if (level === 'error' || level === 'warn' || level === 'debug') return level
  return 'info'
}

function logModule(module: string | null): RuntimeLogModule {
  if (
    module === 'ros' ||
    module === 'nav2' ||
    module === 'stm32' ||
    module === 'amcl' ||
    module === 'costmap' ||
    module === 'system'
  ) {
    return module
  }
  return 'system'
}

export function backendLogToRuntime(
  log: BackendLog,
): RuntimeDashboardSnapshot['logs'][number] {
  return {
    id: `backend-log-${log.id}`,
    time: new Date(log.ts).toLocaleTimeString('zh-CN', { hour12: false }),
    level: logLevel(log.level),
    module: logModule(log.module),
    message: log.message,
  }
}

function taskStatus(run: BackendTaskRun): RuntimeTaskStatus {
  if (run.status === 'paused') return 'paused'
  if (run.status === 'unknown') return 'unknown'
  if (run.status === 'completed') return 'completed'
  if (run.status === 'canceled') return 'canceled'
  if (run.status === 'failed') return 'failed'
  return 'running'
}

function taskFeedback(run: BackendTaskRun) {
  if (run.status === 'pausing') return '暂停请求已发送，等待 Nav2 确认。'
  if (run.status === 'canceling') return '取消请求已发送，等待 Nav2 确认。'
  if (run.status === 'unknown') {
    return run.failure_reason || '任务状态未知，请人工核对。'
  }
  if (run.status === 'completed') return '任务已完成。'
  if (run.status === 'canceled') return '任务已取消。'
  if (run.status === 'failed') return run.failure_reason || '任务执行失败。'

  const parts = ['任务执行中']
  if (run.distance_remaining != null) {
    parts.push(`剩余 ${run.distance_remaining.toFixed(1)} m`)
  }
  if (run.poses_remaining != null) {
    parts.push(`剩余 ${run.poses_remaining} 个航点`)
  }
  return `${parts.join('，')}。`
}

function eventStatus(event: string): RuntimeTaskTimelineStatus {
  if (event === 'created') return 'created'
  if (event === 'paused' || event === 'pause_requested') return 'paused'
  if (event === 'resumed') return 'resumed'
  if (event === 'completed') return 'completed'
  if (event === 'canceled' || event === 'cancel_requested') return 'canceled'
  if (event === 'failed') return 'failed'
  if (event === 'interrupted' || event === 'connection_lost') return 'unknown'
  return 'running'
}

export function backendRunToRuntime(
  run: BackendTaskRun,
  scheduleCreatedAt?: Map<string, number>,
): RuntimeTaskRecord {
  const status = taskStatus(run)
  const targetIds = run.targets.map((target) => target.id)
  const progressPercent =
    status === 'completed'
      ? 100
      : run.targets.length
        ? Math.round((run.next_target_index / run.targets.length) * 100)
        : 0
  const dispatchMode =
    run.schedule_id && run.dispatched_by === 'schedule'
      ? 'scheduled'
      : run.schedule_id
        ? 'manual_schedule'
        : run.dispatched_by === 'retry'
          ? 'retry'
          : 'immediate'
  // 「创建时间」：计划触发的任务用计划本身被创建的时刻；手动任务用实际下发时刻。
  const scheduleCreated = run.schedule_id
    ? scheduleCreatedAt?.get(run.schedule_id)
    : undefined

  return {
    id: run.task_no || run.id,
    backendRunId: run.id,
    name: run.type === 'multi_point_cruise' ? '多点巡航' : '单点导航',
    targetName: run.targets.map((target) => target.name).join(' → '),
    type:
      run.type === 'multi_point_cruise'
        ? 'multi_point_cruise'
        : 'single_point_navigation',
    status,
    dispatchMode,
    targetPointId: targetIds.at(-1),
    targetPointIds: targetIds,
    nextTargetIndex: run.next_target_index,
    activeGoalStartIndex: run.active_goal_start_index,
    // 计划时间：后端 task_runs.scheduled_for 是计划触发的时刻，
    // 不映射的话前端「计划时间」列永远是空的。
    schedule: run.scheduled_for
      ? {
          mode: 'once',
          scheduledAt: run.scheduled_for,
          timezone: localTimezone(),
          status: 'dispatched',
          createdAt: run.started_at,
        }
      : undefined,
    createdTime: formatTimestamp(scheduleCreated ?? run.started_at) ?? '',
    completedTime: formatTimestamp(run.completed_at),
    progressPercent,
    etaMinutes:
      run.estimated_time_remaining_sec == null
        ? 0
        : Math.max(0, Math.ceil(run.estimated_time_remaining_sec / 60)),
    feedback: taskFeedback(run),
    failureReason: run.failure_reason ?? undefined,
    transitioning: ['dispatching', 'pausing', 'canceling'].includes(run.status),
    timeline:
      run.events?.map((event) => ({
        status: eventStatus(event.event),
        timestamp: formatTimestamp(event.ts) ?? '',
        note: event.note ?? event.event,
      })) ?? [
        {
          status,
          timestamp: formatTimestamp(run.started_at) ?? '',
        },
      ],
  }
}

function routeToRuntime(route: BackendRoute): RuntimeRouteTemplate {
  return {
    id: route.id,
    name: route.name,
    mapId: route.map_id ?? undefined,
    createdAt: route.created_at,
    targets: route.targets.map((target) => ({
      id: target.id,
      name: target.name,
      x: target.x,
      y: target.y,
      done: false,
      saved: true,
    })),
  }
}

function scheduleToRuntime(
  schedule: BackendSchedule,
  route: BackendRoute | undefined,
  firedScheduleKeys: Set<string>,
): RuntimeScheduleRecord {
  // 一次性计划到点触发后后端会置 enabled=0；用执行记录区分"已完成"和"被取消"。
  // 已取消且时间已过的一次性计划，重新启用会被后端拒绝，单独标为"已过期"。
  let status: RuntimeScheduleRecord['status'] = 'enabled'

  if (!schedule.enabled) {
    if (
      schedule.mode === 'once' &&
      schedule.scheduled_at &&
      firedScheduleKeys.has(`${schedule.id}:${schedule.scheduled_at}`)
    ) {
      status = 'completed'
    } else if (
      schedule.mode === 'once' &&
      schedule.scheduled_at &&
      schedule.scheduled_at <= Date.now()
    ) {
      status = 'expired'
    } else {
      status = 'canceled'
    }
  }

  return {
    id: schedule.id,
    name: schedule.name,
    routeId: schedule.route_id ?? '',
    routeName: route?.name ?? '巡检路线',
    mode: schedule.mode,
    enabled: Boolean(schedule.enabled),
    status,
    scheduledAt: schedule.scheduled_at ?? undefined,
    nextRunAt: schedule.next_run_at ?? undefined,
    intervalMinutes: schedule.interval_minutes ?? undefined,
    timeOfDay: schedule.time_of_day ?? undefined,
    createdAt: schedule.created_at,
    targetNames: route?.targets.map((target) => target.name) ?? [],
  }
}

interface BackendSyncOptions {
  runtime: Ref<RuntimeDashboardSnapshot>
  backendClient: BackendClient
  backendError: Ref<string | null>
  setTaskRuns: (records: RuntimeTaskRecord[]) => void
}

export function createBackendSync(options: BackendSyncOptions) {
  const { runtime, backendClient, backendError, setTaskRuns } = options
  let stopSubscription: (() => void) | undefined
  let scheduleCreatedAt = new Map<string, number>()

  function updateAlarms() {
    const logs = runtime.value.logs
    // 只改 alarms 字段，不替换整个 runtime 对象
    runtime.value.alarms = {
      total: logs.filter(
        (item) => item.level === 'warn' || item.level === 'error',
      ).length,
      warning: logs.filter((item) => item.level === 'warn').length,
      critical: logs.filter((item) => item.level === 'error').length,
    }
  }

  function prependLog(log: BackendLog) {
    const record = backendLogToRuntime(log)
    if (runtime.value.logs.some((item) => item.id === record.id)) return

    // 原地修改 logs 数组（而不是 {...runtime, logs: [...]}）。
    // 替换整个 runtime 会连带让地图等所有依赖它的计算属性重算、重绘，
    // 日志一多就会明显卡顿。
    runtime.value.logs.unshift(record)
    if (runtime.value.logs.length > 500) {
      runtime.value.logs.splice(500)
    }
    updateAlarms()
  }

  function upsertRun(run: BackendTaskRun) {
    const record = backendRunToRuntime(run, scheduleCreatedAt)
    setTaskRuns([
      record,
      ...runtime.value.taskRuns.filter(
        (task) => task.backendRunId !== run.id,
      ),
    ])
  }

  async function refresh() {
    const [logs, runs, routes, schedules] = await Promise.all([
      backendClient.listLogs(),
      backendClient.listTaskRuns(),
      backendClient.listRoutes(),
      backendClient.listSchedules(),
    ])
    const routeById = new Map(routes.map((route) => [route.id, route]))
    scheduleCreatedAt = new Map(
      schedules.map((schedule) => [schedule.id, schedule.created_at]),
    )
    const firedScheduleKeys = new Set(
      runs
        .filter((run) => run.schedule_id && run.scheduled_for)
        .map((run) => `${run.schedule_id}:${run.scheduled_for}`),
    )

    setTaskRuns(runs.map((run) => backendRunToRuntime(run, scheduleCreatedAt)))
    runtime.value = {
      ...runtime.value,
      routeTemplates: routes.map(routeToRuntime),
      // 计划列表包含已完成/已取消的，方便查看与重新启用
      schedules: schedules.map((schedule) =>
        scheduleToRuntime(
          schedule,
          schedule.route_id
            ? routeById.get(schedule.route_id)
            : undefined,
          firedScheduleKeys,
        ),
      ),
      logs: logs.map(backendLogToRuntime),
    }
    updateAlarms()
    backendError.value = null
  }

  function start() {
    if (stopSubscription) return

    stopSubscription = backendClient.subscribe(
      (event) => {
        if (event.type === 'log') {
          prependLog(event.data)
          return
        }
        if (event.type === 'task-run') {
          upsertRun(event.data)
          return
        }
        void refresh().catch((error: unknown) => {
          backendError.value =
            error instanceof Error ? error.message : '刷新后端数据失败'
        })
      },
      (error) => {
        backendError.value = error.message
      },
      () => {
        backendError.value = null
      },
    )
  }

  function stop() {
    stopSubscription?.()
    stopSubscription = undefined
    backendClient.disconnect()
  }

  async function loadTaskDetail(taskId: string) {
    const task = runtime.value.taskRuns.find((item) => item.id === taskId)
    if (!task?.backendRunId) return

    try {
      upsertRun(await backendClient.getTaskRun(task.backendRunId))
    } catch (error) {
      backendError.value =
        error instanceof Error ? error.message : '加载任务详情失败'
    }
  }

  return {
    refresh,
    start,
    stop,
    upsertRun,
    loadTaskDetail,
  }
}
