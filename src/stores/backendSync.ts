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

export function backendRunToRuntime(run: BackendTaskRun): RuntimeTaskRecord {
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
    createdTime: formatTimestamp(run.started_at) ?? '',
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
  route?: BackendRoute,
): RuntimeScheduleRecord {
  return {
    id: schedule.id,
    name: schedule.name,
    routeId: schedule.route_id ?? '',
    routeName: route?.name ?? '巡检路线',
    mode: schedule.mode,
    enabled: Boolean(schedule.enabled),
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

  function updateAlarms() {
    const logs = runtime.value.logs
    runtime.value = {
      ...runtime.value,
      alarms: {
        total: logs.filter(
          (item) => item.level === 'warn' || item.level === 'error',
        ).length,
        warning: logs.filter((item) => item.level === 'warn').length,
        critical: logs.filter((item) => item.level === 'error').length,
      },
    }
  }

  function prependLog(log: BackendLog) {
    const record = backendLogToRuntime(log)
    if (runtime.value.logs.some((item) => item.id === record.id)) return

    runtime.value = {
      ...runtime.value,
      logs: [record, ...runtime.value.logs].slice(0, 500),
    }
    updateAlarms()
  }

  function upsertRun(run: BackendTaskRun) {
    const record = backendRunToRuntime(run)
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

    setTaskRuns(runs.map(backendRunToRuntime))
    runtime.value = {
      ...runtime.value,
      routeTemplates: routes.map(routeToRuntime),
      schedules: schedules
        .filter((schedule) => Boolean(schedule.enabled))
        .map((schedule) =>
          scheduleToRuntime(
            schedule,
            schedule.route_id
              ? routeById.get(schedule.route_id)
              : undefined,
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
