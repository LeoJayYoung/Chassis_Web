import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  BackendClient,
  createRuntimeDataSource,
  runtimeApiConfig,
} from '../api'
import { mockRuntimeDashboard } from '../mock/runtime'
import {
  canvasPointToRosPoint,
  type Point2D,
  type RosMapTransform,
} from '../utils/mapCoordinates'
import { toMapDashboardSnapshot, toOverviewDashboardSnapshot } from '../utils'
import type {
  RuntimeDashboardSnapshot,
  RuntimeMapPoint,
  RuntimePathPoint,
  RuntimeRobotPose,
  RuntimeTaskRecord,
  RuntimeTaskState,
  RuntimeTaskStatus,
  RuntimeTaskTimelineStatus,
  RuntimeTaskType,
} from '../types'
import { createBackendSync } from './backendSync'
import { createBackendTaskCommands } from './taskCommands'
import { createMockRuntimeController } from './mock'

const taskTypeNames: Record<RuntimeTaskType, string> = {
  single_point_navigation: '单点导航',
  multi_point_cruise: '多点巡航',
  return_home: '返航',
}

const terminalTaskStatuses: RuntimeTaskStatus[] = ['completed', 'failed', 'canceled']

export interface CreateTaskInput {
  type: RuntimeTaskType
  targetPointId?: string
  targetPointIds?: string[]
  dispatchMode?: 'immediate' | 'scheduled'
  scheduleMode?: 'once' | 'interval' | 'daily'
  scheduledAt?: number
  intervalMinutes?: number
  timeOfDay?: string
  routeTemplateId?: string
  routeTemplateName?: string
}

function nowText() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function padTimeUnit(value: number) {
  return String(value).padStart(2, '0')
}

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp)

  return [
    `${date.getFullYear()}-${padTimeUnit(date.getMonth() + 1)}-${padTimeUnit(date.getDate())}`,
    `${padTimeUnit(date.getHours())}:${padTimeUnit(date.getMinutes())}:${padTimeUnit(date.getSeconds())}`,
  ].join(' ')
}

function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
}

function mockScheduleTimestamp(input: CreateTaskInput) {
  if ((input.scheduleMode ?? 'once') === 'interval') {
    return Date.now() + (input.intervalMinutes ?? 60) * 60_000
  }
  if (input.scheduleMode === 'daily' && input.timeOfDay) {
    const [hours = 0, minutes = 0] = input.timeOfDay.split(':').map(Number)
    const date = new Date()
    date.setHours(hours, minutes, 0, 0)
    if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1)
    return date.getTime()
  }
  return input.scheduledAt ?? Date.now() + 5 * 60_000
}

function toRosMapTransform(map: RuntimeDashboardSnapshot['map']): RosMapTransform {
  return {
    canvasWidth: map.width,
    canvasHeight: map.height,
    widthCells: map.ros.widthCells,
    heightCells: map.ros.heightCells,
    resolution: map.ros.resolution,
    originX: map.ros.originX,
    originY: map.ros.originY,
    originYawRad: map.ros.originYawRad,
  }
}

function taskStateFromRecord(record: RuntimeTaskRecord): RuntimeTaskState {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    status: record.status,
    feedback: record.feedback ?? '暂无任务反馈',
    targetPointId: record.targetPointId,
    targetPointIds: record.targetPointIds,
    nextTargetIndex: record.nextTargetIndex,
    activeGoalStartIndex: record.activeGoalStartIndex,
    progressPercent: record.progressPercent,
    etaMinutes: record.etaMinutes,
  }
}

function emptyTaskState(): RuntimeTaskState {
  return {
    id: '',
    name: '暂无任务',
    type: 'single_point_navigation',
    status: 'idle',
    feedback: '暂无任务反馈',
    progressPercent: 0,
    etaMinutes: 0,
  }
}

function isTaskActive(status: RuntimeTaskStatus) {
  return status === 'running' || status === 'paused' || status === 'unknown'
}

function mergeRosbridgeSnapshot(
  current: RuntimeDashboardSnapshot,
  incoming: RuntimeDashboardSnapshot,
): RuntimeDashboardSnapshot {
  return {
    ...current,
    connection: incoming.connection,
    navigationMode: incoming.navigationMode,
    localization: incoming.localization,
    robot: {
      ...current.robot,
      status: incoming.robot.status,
      batteryPercent: incoming.robot.batteryPercent,
      signalLabel: incoming.robot.signalLabel,
    },
    systemStatus: incoming.systemStatus,
    systemMessage: incoming.systemMessage,
    alarms: runtimeApiConfig.backendEnabled ? current.alarms : incoming.alarms,
    metrics: incoming.metrics,
    telemetry: incoming.telemetry,
    map: {
      ...current.map,
      width: incoming.map.width,
      height: incoming.map.height,
      ros: incoming.map.ros,
      occupancyGrid: incoming.map.occupancyGrid ?? current.map.occupancyGrid,
      keepoutMask: incoming.map.keepoutMask ?? current.map.keepoutMask,
      robotPose: incoming.map.robotPose,
      robotPoseReceived:
        incoming.map.robotPoseReceived ?? current.map.robotPoseReceived,
      routePoints: incoming.map.routePoints,
    },
  }
}

export const useRobotRuntimeStore = defineStore('robotRuntime', () => {
  const runtime = ref<RuntimeDashboardSnapshot>(structuredClone(mockRuntimeDashboard))
  const dataSource = createRuntimeDataSource()
  const backendClient = runtimeApiConfig.backendEnabled
    ? new BackendClient()
    : null
  const backendEnabled = Boolean(backendClient) && dataSource.mode !== 'mock'
  const dataSourceMode = dataSource.mode
  const dataSourceError = ref<string | null>(null)
  const backendError = ref<string | null>(null)
  let stopDataSourceSubscription: (() => void) | undefined
  let dataSourceInitialized = false
  let nextTaskNumber = 1
  let nextTargetNumber = 6

  const mapDashboard = computed(() => toMapDashboardSnapshot(runtime.value))
  const overviewDashboard = computed(() => toOverviewDashboardSnapshot(runtime.value))

  const backendSync =
    backendClient &&
    createBackendSync({
      runtime,
      backendClient,
      backendError,
      setTaskRuns,
    })
  const backendCommands =
    backendClient &&
    backendSync &&
    createBackendTaskCommands({
      runtime,
      backendClient,
      backendError,
      refresh: backendSync.refresh,
      upsertRun: backendSync.upsertRun,
      updateTask: updateTaskRecord,
      setTaskRuns,
    })
  const mockController = createMockRuntimeController({
    runtime,
    updateTask: updateTaskRecord,
    setTaskRuns,
    startTask,
    appendLog,
    nowText,
  })

  async function initializeDataSource() {
    if (dataSourceInitialized) return

    dataSourceInitialized = true

    if (dataSource.mode === 'mock') {
      runtime.value = await dataSource.loadSnapshot()
      mockController.startScheduleTimer()
      return
    }

    try {
      runtime.value = await dataSource.loadSnapshot()
      dataSourceError.value = null
    } catch (error) {
      dataSourceError.value =
        error instanceof Error ? error.message : '真实数据初始加载失败'
    }

    if (backendEnabled) {
      try {
        await backendSync?.refresh()
        backendSync?.start()
      } catch (error) {
        backendError.value =
          error instanceof Error ? error.message : '业务后端连接失败'
      }
    } else {
      backendError.value = '真实环境必须启用业务后端'
    }

    stopDataSourceSubscription = dataSource.subscribe(
      (snapshot) => {
        runtime.value =
          dataSource.mode === 'rosbridge'
            ? mergeRosbridgeSnapshot(runtime.value, snapshot)
            : snapshot
        dataSourceError.value = null
      },
      (error) => {
        dataSourceError.value = error.message
      },
    )
  }

  function stopDataSource() {
    stopDataSourceSubscription?.()
    backendSync?.stop()
    mockController.stopScheduleTimer()
    stopDataSourceSubscription = undefined
    dataSource.disconnect()
    dataSourceInitialized = false
  }

  function setRuntimeSnapshot(snapshot: RuntimeDashboardSnapshot) {
    runtime.value = snapshot
  }

  function setTaskRuns(
    records: RuntimeTaskRecord[],
    currentTaskId = runtime.value.task.id,
  ) {
    const currentRecord =
      records.find((record) => record.id === currentTaskId) ??
      records.find((record) => isTaskActive(record.status)) ??
      records[0]

    runtime.value = {
      ...runtime.value,
      taskRuns: records,
      task: currentRecord ? taskStateFromRecord(currentRecord) : emptyTaskState(),
    }
  }

  function appendLog(level: RuntimeDashboardSnapshot['logs'][number]['level'], message: string) {
    if (backendEnabled) return

    runtime.value = {
      ...runtime.value,
      logs: [
        {
          id: `log-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          level,
          message,
        },
        ...runtime.value.logs,
      ].slice(0, 12),
    }
  }

  function updateRobotPose(pose: RuntimeRobotPose) {
    runtime.value = {
      ...runtime.value,
      map: {
        ...runtime.value.map,
        robotPose: pose,
      },
    }
  }

  function setActiveTarget(targetId?: string) {
    const target = targetId
      ? runtime.value.map.targets.find((item) => item.id === targetId)
      : undefined

    if (targetId && !target) return false

    runtime.value = {
      ...runtime.value,
      map: {
        ...runtime.value.map,
        activeTargetId: targetId,
      },
    }
    return true
  }

  function clearActiveTarget() {
    setActiveTarget(undefined)
  }

  function saveTargetFromCanvas(point: Point2D, name?: string) {
    const map = runtime.value.map
    const transform = toRosMapTransform(map)
    const targetId = `point-custom-${String(nextTargetNumber).padStart(2, '0')}`
    const targetName = name?.trim() || `P${String(nextTargetNumber).padStart(2, '0')}`
    const rosPoint = canvasPointToRosPoint(point, transform)
    const target = {
      id: targetId,
      name: targetName,
      ...rosPoint,
      done: false,
      saved: true,
    }

    nextTargetNumber += 1
    runtime.value = {
      ...runtime.value,
      map: {
        ...map,
        targets: [...map.targets, target],
        activeTargetId: targetId,
      },
    }
    appendLog('info', `目标点 ${targetName} 已保存`)
    return target
  }

  function deleteTarget(targetId: string) {
    const target = runtime.value.map.targets.find((item) => item.id === targetId)
    if (!target) return false

    const referencedByActiveTask = runtime.value.taskRuns.some(
      (task) =>
        (task.targetPointId === targetId || task.targetPointIds?.includes(targetId)) &&
        !terminalTaskStatuses.includes(task.status),
    )

    if (referencedByActiveTask) {
      appendLog('warn', `目标点 ${target.name} 正被任务引用，暂不能删除`)
      return false
    }

    const activeTargetId =
      runtime.value.map.activeTargetId === targetId
        ? undefined
        : runtime.value.map.activeTargetId

    runtime.value = {
      ...runtime.value,
      map: {
        ...runtime.value.map,
        targets: runtime.value.map.targets.filter((item) => item.id !== targetId),
        activeTargetId,
      },
    }
    appendLog('info', `目标点 ${target.name} 已移除`)
    return true
  }

  function setRouteToTarget(targetId?: string) {
    setRouteToTargets(targetId ? [targetId] : [])
  }

  function setRouteToTargets(targetIds: string[]) {
    const targets = targetIds.flatMap((targetId) => {
      const target = runtime.value.map.targets.find((item) => item.id === targetId)

      return target ? [target] : []
    })

    if (!targets.length) return

    const robotPose = runtime.value.map.robotPose
    const routePoints: RuntimePathPoint[] = [
      { x: robotPose.x, y: robotPose.y },
      ...targets.map((target) => ({ x: target.x, y: target.y })),
    ]

    runtime.value = {
      ...runtime.value,
      map: {
        ...runtime.value.map,
        routePoints,
        activeTargetId: targets.at(-1)?.id,
      },
    }
    mockController.resetPoseProgress(runtime.value.task.progressPercent)
  }

  function updateTaskRecord(
    taskId: string,
    updater: (task: RuntimeTaskRecord) => RuntimeTaskRecord,
  ) {
    const target = runtime.value.taskRuns.find((task) => task.id === taskId)
    if (!target) return false

    const records = runtime.value.taskRuns.map((task) =>
      task.id === taskId ? updater(task) : task,
    )
    setTaskRuns(records)
    return true
  }

  function transitionTask(
    taskId: string,
    status: RuntimeTaskStatus,
    feedback: string,
    eventStatus: RuntimeTaskTimelineStatus = status,
  ) {
    const changed = updateTaskRecord(taskId, (task) => ({ ...task, transitioning: true }))
    if (!changed) return

    window.setTimeout(() => {
      const timestamp = nowText()

      updateTaskRecord(taskId, (task) => ({
        ...task,
        status,
        transitioning: false,
        completedTime: terminalTaskStatuses.includes(status) ? timestamp : task.completedTime,
        feedback,
        timeline: [...task.timeline, { status: eventStatus, timestamp }],
      }))

      appendLog('info', `${taskId} 状态更新为 ${status}`)
    }, 260)
  }

  function taskTargetIds(task: RuntimeTaskRecord) {
    if (task.targetPointIds?.length) return task.targetPointIds
    return task.targetPointId ? [task.targetPointId] : []
  }

  async function createTask(input: CreateTaskInput) {
    const requestedTargetIds =
      input.type === 'multi_point_cruise'
        ? [...new Set(input.targetPointIds ?? [])]
        : input.targetPointId
          ? [input.targetPointId]
          : []

    const usesTemplate =
      input.dispatchMode === 'scheduled' && Boolean(input.routeTemplateId)

    if (
      !usesTemplate &&
      input.type === 'multi_point_cruise' &&
      requestedTargetIds.length < 2
    ) {
      appendLog('warn', '多点巡航至少需要选择两个已保存目标点')
      return null
    }

    if (
      !usesTemplate &&
      input.type !== 'return_home' &&
      !requestedTargetIds.length
    ) {
      appendLog('warn', '请先选择并保存目标点，再下发任务')
      return null
    }

    const isScheduled = input.dispatchMode === 'scheduled'
    if (isScheduled) {
      const mode = input.scheduleMode ?? 'once'
      if (
        mode === 'once' &&
        (!input.scheduledAt || input.scheduledAt <= Date.now())
      ) {
        appendLog('warn', '指定日期任务的执行时间必须晚于当前时间')
        return null
      }
      if (
        mode === 'daily' &&
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.timeOfDay ?? '')
      ) {
        appendLog('warn', '每日计划需要有效的 HH:MM 时间')
        return null
      }
      if (
        mode === 'interval' &&
        (!Number.isInteger(input.intervalMinutes) ||
          Number(input.intervalMinutes) <= 0)
      ) {
        appendLog('warn', '间隔计划需要大于 0 的整数分钟数')
        return null
      }
    }

    const timestamp = nowText()
    const id = `TASK-${String(nextTaskNumber).padStart(4, '0')}`
    nextTaskNumber += 1
    const targets = requestedTargetIds.flatMap((targetId) => {
      const target = runtime.value.map.targets.find((item) => item.id === targetId)

      return target ? [target] : []
    })

    if (
      !usesTemplate &&
      input.type !== 'return_home' &&
      targets.length !== requestedTargetIds.length
    ) {
      appendLog('warn', '部分巡航目标点不存在，请重新选择')
      return null
    }

    if (backendEnabled && backendCommands) {
      try {
        return await backendCommands.createTask(input, targets)
      } catch (error) {
        backendError.value =
          error instanceof Error ? error.message : '后端创建任务失败'
        return null
      }
    }

    const target = targets[0]
    const localScheduledAt = isScheduled
      ? mockScheduleTimestamp(input)
      : undefined
    const currentIsBusy = isTaskActive(runtime.value.task.status)
    const status: RuntimeTaskStatus = isScheduled || currentIsBusy ? 'idle' : 'running'
    const task: RuntimeTaskRecord = {
      id,
      name: taskTypeNames[input.type],
      targetName:
        input.type === 'multi_point_cruise'
          ? targets.map((item) => item.name).join(' → ')
          : target?.name ?? (input.type === 'return_home' ? 'Home' : '待选择'),
      type: input.type,
      status,
      dispatchMode: isScheduled ? 'scheduled' : 'immediate',
      schedule: isScheduled
        ? {
            mode: input.scheduleMode ?? 'once',
            scheduledAt: localScheduledAt as number,
            timezone: localTimezone(),
            status: 'pending',
            createdAt: Date.now(),
            intervalMinutes: input.intervalMinutes,
            timeOfDay: input.timeOfDay,
          }
        : undefined,
      targetPointId:
        input.type === 'multi_point_cruise'
          ? requestedTargetIds.at(-1)
          : input.targetPointId,
      targetPointIds:
        input.type === 'multi_point_cruise' ? requestedTargetIds : undefined,
      nextTargetIndex: input.type === 'multi_point_cruise' ? 0 : undefined,
      activeGoalStartIndex: input.type === 'multi_point_cruise' ? 0 : undefined,
      createdTime: timestamp,
      completedTime: null,
      progressPercent: 0,
      etaMinutes: input.type === 'return_home' ? 6 : 8,
      feedback: isScheduled
        ? `定时任务已创建，将于 ${formatDateTime(localScheduledAt as number)} 执行。`
        : status === 'running'
          ? '任务已下发，正在前往目标点。'
          : '任务已创建，等待执行。',
      timeline: [
        { status: 'created', timestamp },
        ...(isScheduled
          ? [
              {
                status: 'scheduled' as const,
                timestamp,
                note: formatDateTime(localScheduledAt as number),
              },
            ]
          : []),
        ...(status === 'running' ? [{ status: 'running' as const, timestamp }] : []),
      ],
    }

    const nextTasks = [task, ...runtime.value.taskRuns]
    setTaskRuns(nextTasks, status === 'running' ? id : runtime.value.task.id)

    if (requestedTargetIds.length) {
      setActiveTarget(requestedTargetIds.at(-1))
      if (status === 'running') {
        setRouteToTargets(requestedTargetIds)
      }
    }

    appendLog(
      'info',
      isScheduled
        ? `定时任务 ${id} 已创建：${task.targetName}，计划 ${formatDateTime(localScheduledAt as number)}`
        : `任务 ${id} 已下发：${task.targetName}`,
    )

    return id
  }

  function startTask(taskId: string) {
    const task = runtime.value.taskRuns.find((item) => item.id === taskId)
    if (!task) return

    if (backendEnabled) return

    const currentTask = runtime.value.taskRuns.find(
      (item) => item.id === runtime.value.task.id,
    )
    let records = runtime.value.taskRuns

    if (currentTask && currentTask.id !== taskId && currentTask.status === 'running') {
      const timestamp = nowText()
      records = records.map((item) =>
        item.id === currentTask.id
          ? {
              ...item,
              status: 'paused',
              feedback: '任务已暂停，等待其他任务完成。',
              timeline: [...item.timeline, { status: 'paused', timestamp, note: 'Task switch' }],
            }
          : item,
      )
    }

    records = records.map((item) =>
      item.id === taskId
        ? {
            ...item,
            status: 'running',
            transitioning: true,
            schedule: item.schedule
              ? {
                  ...item.schedule,
                  status:
                    item.schedule.status === 'pending' || item.schedule.status === 'waiting'
                      ? 'triggering'
                      : item.schedule.status,
                  triggeredAt: item.schedule.triggeredAt ?? Date.now(),
                }
              : item.schedule,
            feedback: '任务已开始，正在前往目标点。',
            timeline: [...item.timeline, { status: 'running' as const, timestamp: nowText() }],
          }
        : item,
    )
    setTaskRuns(records, taskId)

    if (taskTargetIds(task).length) {
      setRouteToTargets(taskTargetIds(task))
    }

    window.setTimeout(() => {
      updateTaskRecord(taskId, (item) => ({ ...item, transitioning: false }))
    }, 260)
  }

  function pauseTask(taskId: string) {
    const task = runtime.value.taskRuns.find((item) => item.id === taskId)
    if (!task) return

    if (backendEnabled && backendCommands) {
      void backendCommands.pause(task)
      return
    }

    transitionTask(taskId, 'paused', '任务已由操作员暂停。')
  }

  function continueTask(taskId: string) {
    const task = runtime.value.taskRuns.find((item) => item.id === taskId)
    if (!task) return

    if (backendEnabled && backendCommands) {
      void backendCommands.resume(task)
      return
    }

    setTaskRuns(
      runtime.value.taskRuns.map((item) =>
        item.id === taskId ? { ...item, status: 'running', transitioning: true } : item,
      ),
      taskId,
    )
    const remainingTargetIds =
      task.type === 'multi_point_cruise'
        ? taskTargetIds(task).slice(task.nextTargetIndex ?? 0)
        : taskTargetIds(task)

    if (remainingTargetIds.length) {
      setRouteToTargets(remainingTargetIds)
    }

    window.setTimeout(() => {
      const timestamp = nowText()
      updateTaskRecord(taskId, (item) => ({
        ...item,
        transitioning: false,
        feedback: '任务已继续，正在从上次位置恢复执行。',
        timeline: [...item.timeline, { status: 'resumed', timestamp }],
      }))
    }, 260)
  }

  function cancelTask(taskId: string) {
    const task = runtime.value.taskRuns.find((item) => item.id === taskId)

    if (backendEnabled && backendCommands && task) {
      void backendCommands.cancel(task)
      return
    }

    if (task?.schedule && task.status === 'idle') {
      updateTaskRecord(taskId, (item) => ({
        ...item,
        status: 'canceled',
        completedTime: nowText(),
        schedule: item.schedule
          ? { ...item.schedule, status: 'canceled' }
          : item.schedule,
        feedback: '定时任务已取消，未下发到机器人。',
        timeline: [...item.timeline, { status: 'canceled' as const, timestamp: nowText() }],
      }))
      appendLog('warn', `定时任务 ${taskId} 已取消`)
      return
    }

    transitionTask(taskId, 'canceled', '任务已由操作员取消。')
  }

  function retryTask(taskId: string) {
    const task = runtime.value.taskRuns.find((item) => item.id === taskId)
    if (!task) return

    if (backendEnabled && backendCommands) {
      void backendCommands.retry(task)
      return
    }

    const timestamp = nowText()
    const records = runtime.value.taskRuns.map((item) =>
      item.id === taskId
        ? {
            ...item,
            status: 'running' as const,
            transitioning: true,
            completedTime: null,
            progressPercent: 0,
            nextTargetIndex: item.type === 'multi_point_cruise' ? 0 : undefined,
            activeGoalStartIndex:
              item.type === 'multi_point_cruise' ? 0 : undefined,
            failureReason: undefined,
            feedback: '任务已重试，正在重新规划路径。',
            timeline: [...item.timeline, { status: 'retried' as const, timestamp }],
          }
        : item,
    )
    setTaskRuns(records, taskId)
    if (taskTargetIds(task).length) {
      setRouteToTargets(taskTargetIds(task))
    }

    window.setTimeout(() => {
      updateTaskRecord(taskId, (item) => ({ ...item, transitioning: false }))
    }, 260)
  }

  async function deleteTask(taskId: string) {
    const task = runtime.value.taskRuns.find((item) => item.id === taskId)
    if (!task) return false

    if (backendEnabled && backendCommands) {
      return backendCommands.deleteTask(task)
    }

    const records = runtime.value.taskRuns.filter((item) => item.id !== taskId)
    const deletedCurrentTask = runtime.value.task.id === taskId
    const nextCurrentTask =
      records.find((item) => isTaskActive(item.status)) ?? records[0]

    runtime.value = {
      ...runtime.value,
      taskRuns: records,
      task: deletedCurrentTask
        ? nextCurrentTask
          ? taskStateFromRecord(nextCurrentTask)
          : emptyTaskState()
        : runtime.value.task,
    }

    appendLog('info', `任务 ${taskId} 已删除`)
    return true
  }

  async function loadTaskDetail(taskId: string) {
    await backendSync?.loadTaskDetail(taskId)
  }

  function runScheduleNow(scheduleId: string) {
    void backendCommands?.runScheduleNow(scheduleId)
  }

  function cancelSchedule(scheduleId: string) {
    void backendCommands?.cancelSchedule(scheduleId)
  }

  async function createRouteTemplate(name: string, targetIds: string[]) {
    if (!backendCommands) return null

    const targets = targetIds.flatMap((targetId) => {
      const target = runtime.value.map.targets.find(
        (item) => item.id === targetId,
      )
      return target ? [target] : []
    })
    if (!targets.length) return null

    try {
      return await backendCommands.createRouteTemplate(name, targets)
    } catch (error) {
      backendError.value =
        error instanceof Error ? error.message : '保存路线模板失败'
      return null
    }
  }

  function reorderTasks(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return

    const records = [...runtime.value.taskRuns]
    const [removed] = records.splice(fromIndex, 1)
    if (!removed) return

    records.splice(toIndex, 0, removed)
    setTaskRuns(records)
  }

  return {
    runtime,
    dataSourceMode,
    dataSourceError,
    backendEnabled,
    backendError,
    mapDashboard,
    overviewDashboard,
    initializeDataSource,
    stopDataSource,
    setRuntimeSnapshot,
    updateRobotPose,
    setActiveTarget,
    clearActiveTarget,
    saveTargetFromCanvas,
    deleteTarget,
    createTask,
    startTask,
    pauseTask,
    continueTask,
    cancelTask,
    retryTask,
    deleteTask,
    loadTaskDetail,
    runScheduleNow,
    cancelSchedule,
    createRouteTemplate,
    reorderTasks,
    startMockPoseStream: mockController.startPoseStream,
    stopMockPoseStream: mockController.stopPoseStream,
  }
})
