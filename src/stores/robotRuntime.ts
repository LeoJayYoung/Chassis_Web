import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createRuntimeDataSource, createTaskCommandClient } from '../api'
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
import type {
  NavigateTaskCommand,
  NavigateThroughPosesTaskCommand,
  TaskCommandEvent,
} from '../api'

const MOCK_POSE_TICK_MS = 500
const MOCK_LOOP_TICKS = 80
const SCHEDULE_CHECK_MS = 1000

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
  scheduledAt?: number
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
  return status === 'running' || status === 'paused'
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
    alarms: incoming.alarms,
    metrics: incoming.metrics,
    telemetry: incoming.telemetry,
    map: {
      ...current.map,
      width: incoming.map.width,
      height: incoming.map.height,
      ros: incoming.map.ros,
      occupancyGrid: incoming.map.occupancyGrid ?? current.map.occupancyGrid,
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
  const taskCommandClient = createTaskCommandClient(dataSource.mode)
  const dataSourceMode = dataSource.mode
  const dataSourceError = ref<string | null>(null)
  let stopDataSourceSubscription: (() => void) | undefined
  let stopTaskCommandSubscription: (() => void) | undefined
  let dataSourceInitialized = false
  let mockPoseTimer: number | undefined
  let mockPoseTick = 0
  let nextTaskNumber = 47
  let nextTargetNumber = 6
  let scheduleTimer: number | undefined
  const pauseRequestedTaskIds = new Set<string>()

  const mapDashboard = computed(() => toMapDashboardSnapshot(runtime.value))
  const overviewDashboard = computed(() => toOverviewDashboardSnapshot(runtime.value))

  async function initializeDataSource() {
    if (dataSourceInitialized) return

    dataSourceInitialized = true

    if (dataSource.mode === 'mock') {
      runtime.value = await dataSource.loadSnapshot()
      startScheduleTimer()
      return
    }

    try {
      runtime.value = await dataSource.loadSnapshot()
      dataSourceError.value = null
    } catch (error) {
      dataSourceError.value =
        error instanceof Error ? error.message : '真实数据初始加载失败'
    }

    startTaskCommandEvents()
    startScheduleTimer()

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
    stopTaskCommandSubscription?.()
    stopScheduleTimer()
    stopDataSourceSubscription = undefined
    stopTaskCommandSubscription = undefined
    dataSource.disconnect()
    taskCommandClient.disconnect()
    dataSourceInitialized = false
  }

  function setRuntimeSnapshot(snapshot: RuntimeDashboardSnapshot) {
    runtime.value = snapshot
  }

  function setRuntimeWithTasks(records: RuntimeTaskRecord[], currentTaskId = runtime.value.task.id) {
    const currentRecord =
      records.find((record) => record.id === currentTaskId) ??
      records.find((record) => isTaskActive(record.status)) ??
      records[0]

    runtime.value = {
      ...runtime.value,
      tasks: records,
      task: currentRecord ? taskStateFromRecord(currentRecord) : emptyTaskState(),
    }
  }

  function updateTaskSchedule(
    taskId: string,
    updater: (task: RuntimeTaskRecord) => RuntimeTaskRecord,
  ) {
    updateTaskRecord(taskId, updater)
  }

  function hasActiveTask(exceptTaskId?: string) {
    return runtime.value.tasks.some(
      (task) => task.id !== exceptTaskId && isTaskActive(task.status),
    )
  }

  function isScheduledTask(task: RuntimeTaskRecord) {
    return task.dispatchMode === 'scheduled' && Boolean(task.schedule)
  }

  function triggerScheduledTask(task: RuntimeTaskRecord) {
    const schedule = task.schedule
    if (!schedule) return

    if (task.status !== 'idle') {
      return
    }

    if (hasActiveTask(task.id)) {
      if (schedule.status !== 'waiting') {
        updateTaskSchedule(task.id, (item) => ({
          ...item,
          schedule: item.schedule
            ? { ...item.schedule, status: 'waiting' }
            : item.schedule,
          feedback: '计划时间已到，正在等待当前任务完成。',
        }))
        appendLog('info', `定时任务 ${task.id} 到点，等待当前任务完成`)
      }
      return
    }

    const triggeredAt = Date.now()
    updateTaskSchedule(task.id, (item) => ({
      ...item,
      schedule: item.schedule
        ? { ...item.schedule, status: 'triggering', triggeredAt }
        : item.schedule,
      timeline: [
        ...item.timeline,
        { status: 'triggered' as const, timestamp: nowText(), note: 'Scheduled trigger' },
      ],
    }))
    appendLog('info', `定时任务 ${task.id} 已到执行时间，开始下发`)
    startTask(task.id)
    updateTaskSchedule(task.id, (item) => ({
      ...item,
      schedule: item.schedule
        ? { ...item.schedule, status: 'dispatched', triggeredAt }
        : item.schedule,
    }))
  }

  function checkScheduledTasks() {
    const now = Date.now()

    for (const task of runtime.value.tasks) {
      if (!isScheduledTask(task) || !task.schedule) continue
      if (task.schedule.status !== 'pending' && task.schedule.status !== 'waiting') continue
      if (task.schedule.scheduledAt > now) continue

      triggerScheduledTask(task)
    }
  }

  function startScheduleTimer() {
    if (scheduleTimer) return

    scheduleTimer = window.setInterval(checkScheduledTasks, SCHEDULE_CHECK_MS)
  }

  function stopScheduleTimer() {
    if (!scheduleTimer) return

    window.clearInterval(scheduleTimer)
    scheduleTimer = undefined
  }

  function appendLog(level: RuntimeDashboardSnapshot['logs'][number]['level'], message: string) {
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

    const referencedByActiveTask = runtime.value.tasks.some(
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
    mockPoseTick = Math.round(
      (runtime.value.task.progressPercent / 100) * (MOCK_LOOP_TICKS - 1),
    )
  }

  function pointDistance(start: RuntimePathPoint, end: RuntimePathPoint) {
    return Math.hypot(end.x - start.x, end.y - start.y)
  }

  function poseAtPathProgress(points: RuntimePathPoint[], progress: number): RuntimeRobotPose {
    if (points.length < 2) {
      return {
        ...runtime.value.map.robotPose,
        stamp: Date.now(),
      }
    }

    const segments = points.slice(0, -1).map((start, index) => {
      const end = points[index + 1]

      return {
        start,
        end,
        length: end ? pointDistance(start, end) : 0,
      }
    })
    const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0)
    let distance = totalLength * progress

    for (const segment of segments) {
      if (!segment.end) continue

      if (distance <= segment.length || segment === segments.at(-1)) {
        const ratio = segment.length ? distance / segment.length : 0
        const x = segment.start.x + (segment.end.x - segment.start.x) * ratio
        const y = segment.start.y + (segment.end.y - segment.start.y) * ratio
        const yawRad = Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x)

        return {
          x,
          y,
          yawRad,
          frameId: runtime.value.map.ros.frameId,
          stamp: Date.now(),
        }
      }

      distance -= segment.length
    }

    const lastPoint = points.at(-1) ?? runtime.value.map.robotPose

    return {
      x: lastPoint.x,
      y: lastPoint.y,
      yawRad: runtime.value.map.robotPose.yawRad,
      frameId: runtime.value.map.ros.frameId,
      stamp: Date.now(),
    }
  }

  function updateTaskRecord(
    taskId: string,
    updater: (task: RuntimeTaskRecord) => RuntimeTaskRecord,
  ) {
    const target = runtime.value.tasks.find((task) => task.id === taskId)
    if (!target) return false

    const records = runtime.value.tasks.map((task) =>
      task.id === taskId ? updater(task) : task,
    )
    setRuntimeWithTasks(records)
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

  function startTaskCommandEvents() {
    if (stopTaskCommandSubscription) return

    stopTaskCommandSubscription = taskCommandClient.subscribeTaskEvents(handleTaskCommandEvent)
  }

  function routeLength(points: RuntimePathPoint[]) {
    return points
      .slice(0, -1)
      .reduce((sum, point, index) => {
        const next = points[index + 1]

        return next ? sum + pointDistance(point, next) : sum
      }, 0)
  }

  function progressFromRemainingDistance(distanceRemaining?: number) {
    if (distanceRemaining === undefined) return undefined

    const length = routeLength(runtime.value.map.routePoints)

    if (!length) return undefined

    return Math.min(Math.max(Math.round((1 - distanceRemaining / length) * 100), 0), 100)
  }

  function feedbackFromCommandEvent(event: Extract<TaskCommandEvent, { type: 'feedback' }>) {
    const parts = ['正在执行导航任务']

    if (event.distanceRemaining !== undefined) {
      parts.push(`剩余 ${event.distanceRemaining.toFixed(1)} m`)
    }

    if (event.estimatedTimeRemainingSec !== undefined) {
      parts.push(`预计 ${Math.max(1, Math.ceil(event.estimatedTimeRemainingSec / 60))} min`)
    }

    if (event.numberOfRecoveries !== undefined && event.numberOfRecoveries > 0) {
      parts.push(`恢复 ${event.numberOfRecoveries} 次`)
    }

    if (event.posesRemaining !== undefined) {
      parts.push(`剩余 ${event.posesRemaining} 个航点`)
    }

    return `${parts.join('，')}。`
  }

  function updateTaskFromCommandFeedback(
    event: Extract<TaskCommandEvent, { type: 'feedback' }>,
  ) {
    const progressPercent = progressFromRemainingDistance(event.distanceRemaining)

    updateTaskRecord(event.taskId, (task) => {
      const allTargetIds = task.targetPointIds ?? []
      const goalStartIndex = task.activeGoalStartIndex ?? 0
      const sentTargetCount = Math.max(allTargetIds.length - goalStartIndex, 0)
      const completedInCurrentGoal =
        event.posesRemaining === undefined
          ? 0
          : Math.min(
              Math.max(sentTargetCount - Math.round(event.posesRemaining), 0),
              sentTargetCount,
            )
      const nextTargetIndex =
        event.posesRemaining === undefined
          ? task.nextTargetIndex
          : Math.min(goalStartIndex + completedInCurrentGoal, allTargetIds.length)

      return {
        ...task,
        status: 'running',
        transitioning: false,
        feedback: feedbackFromCommandEvent(event),
        nextTargetIndex,
        progressPercent: progressPercent ?? task.progressPercent,
        etaMinutes:
          event.estimatedTimeRemainingSec === undefined
            ? task.etaMinutes
            : Math.max(0, Math.ceil(event.estimatedTimeRemainingSec / 60)),
      }
    })
  }

  function updateTaskFromCommandStatus(
    event: Extract<TaskCommandEvent, { type: 'status' | 'result' }>,
  ) {
    const previous = runtime.value.tasks.find((task) => task.id === event.taskId)

    if (!previous) return

    const status =
      event.status === 'canceled' && pauseRequestedTaskIds.has(event.taskId)
        ? 'paused'
        : event.status
    const timestamp = nowText()
    const isTerminal = terminalTaskStatuses.includes(status)
    const feedback =
      status === 'paused'
        ? '任务已暂停，当前导航 goal 已停止。'
        : event.errorMessage
          ? `${event.feedback}：${event.errorMessage}`
          : event.feedback

    updateTaskRecord(event.taskId, (task) => ({
      ...task,
      status,
      transitioning: false,
      completedTime: isTerminal ? timestamp : task.completedTime,
      progressPercent: status === 'completed' ? 100 : task.progressPercent,
      nextTargetIndex:
        status === 'completed' && task.targetPointIds
          ? task.targetPointIds.length
          : task.nextTargetIndex,
      etaMinutes: isTerminal ? 0 : task.etaMinutes,
      feedback,
      failureReason: status === 'failed' ? event.errorMessage ?? event.feedback : task.failureReason,
      timeline:
        task.status === status
          ? task.timeline
          : [...task.timeline, { status, timestamp, note: event.goalId }],
    }))

    if (previous.status !== status && (isTerminal || status === 'paused')) {
      appendLog(
        status === 'failed' ? 'error' : status === 'canceled' ? 'warn' : 'info',
        `任务 ${event.taskId} 回填状态：${status}`,
      )
    }
  }

  function handleTaskCommandEvent(event: TaskCommandEvent) {
    if (event.type === 'feedback') {
      updateTaskFromCommandFeedback(event)
      return
    }

    updateTaskFromCommandStatus(event)
  }

  function isRosbridgeMode() {
    return dataSource.mode === 'rosbridge'
  }

  function taskTargetIds(task: RuntimeTaskRecord) {
    if (task.targetPointIds?.length) return task.targetPointIds
    return task.targetPointId ? [task.targetPointId] : []
  }

  function taskTargets(task: RuntimeTaskRecord) {
    return taskTargetIds(task).flatMap((targetId) => {
      const target = runtime.value.map.targets.find((item) => item.id === targetId)

      return target ? [target] : []
    })
  }

  function remainingTaskTargets(task: RuntimeTaskRecord) {
    const targetIds = taskTargetIds(task)
    const startIndex =
      task.type === 'multi_point_cruise'
        ? Math.min(Math.max(task.nextTargetIndex ?? 0, 0), targetIds.length)
        : 0

    return targetIds.slice(startIndex).flatMap((targetId) => {
      const target = runtime.value.map.targets.find((item) => item.id === targetId)

      return target ? [target] : []
    })
  }

  function toNavigateCommand(
    task: RuntimeTaskRecord,
    target: RuntimeMapPoint,
  ): NavigateTaskCommand {
    return {
      taskId: task.id,
      taskType: task.type,
      targetName: target.name,
      targetPose: {
        x: target.x,
        y: target.y,
        yawRad: runtime.value.map.robotPose.yawRad,
        frameId: runtime.value.map.ros.frameId,
      },
    }
  }

  function toNavigateThroughPosesCommand(
    task: RuntimeTaskRecord,
    targets: RuntimeMapPoint[],
  ): NavigateThroughPosesTaskCommand {
    return {
      taskId: task.id,
      taskType: task.type,
      targetNames: targets.map((target) => target.name),
      targetPoses: targets.map((target, index) => {
        const nextTarget = targets[index + 1]
        const previousTarget = targets[index - 1]
        const directionStart = nextTarget ? target : (previousTarget ?? target)
        const directionEnd = nextTarget ?? target
        const yawRad =
          directionStart === directionEnd
            ? runtime.value.map.robotPose.yawRad
            : Math.atan2(
                directionEnd.y - directionStart.y,
                directionEnd.x - directionStart.x,
              )

        return {
          x: target.x,
          y: target.y,
          yawRad,
          frameId: runtime.value.map.ros.frameId,
        }
      }),
    }
  }

  function markTaskCommandFailed(taskId: string, error: unknown, action: string) {
    const message = error instanceof Error ? error.message : `${action}失败`
    const timestamp = nowText()

    updateTaskRecord(taskId, (task) => ({
      ...task,
      status: 'failed',
      transitioning: false,
      completedTime: timestamp,
      feedback: `${action}失败：${message}`,
      failureReason: message,
      timeline: [...task.timeline, { status: 'failed', timestamp, note: action }],
    }))
    appendLog('error', `任务 ${taskId} ${action}失败：${message}`)
  }

  function sendTaskCommand(task: RuntimeTaskRecord, action = '导航任务下发') {
    const targets = taskTargets(task)

    if (!targets.length) {
      appendLog('warn', `任务 ${task.id} 缺少目标点，无法${action}`)
      return
    }

    if (task.type === 'multi_point_cruise') {
      updateTaskRecord(task.id, (item) => ({
        ...item,
        activeGoalStartIndex: 0,
      }))
    }

    const command =
      task.type === 'multi_point_cruise'
        ? taskCommandClient.sendNavigateThroughPoses(
            toNavigateThroughPosesCommand(task, targets),
          )
        : taskCommandClient.sendNavigateToPose(
            toNavigateCommand(task, targets[0] as RuntimeMapPoint),
          )

    void command
      .then((result) => {
        appendLog('info', `任务 ${task.id} ${action}成功${result.goalId ? `，goal=${result.goalId}` : ''}`)
      })
      .catch((error: unknown) => {
        markTaskCommandFailed(task.id, error, action)
      })
  }

  function pauseRosTask(taskId: string) {
    pauseRequestedTaskIds.add(taskId)
    updateTaskRecord(taskId, (task) => ({
      ...task,
      transitioning: true,
      feedback: '暂停命令已发送，等待 Nav2 停止当前 goal。',
    }))

    void taskCommandClient
      .pauseTask({ taskId })
      .then(() => {
        appendLog('info', `任务 ${taskId} 的暂停已由 Nav2 确认`)
      })
      .catch((error: unknown) => {
        const latestTask = runtime.value.tasks.find((task) => task.id === taskId)
        if (latestTask && terminalTaskStatuses.includes(latestTask.status)) {
          appendLog('warn', `任务 ${taskId} 在暂停确认前已进入 ${latestTask.status}`)
          return
        }
        markTaskCommandFailed(taskId, error, '暂停任务')
      })
  }

  function cancelRosTask(taskId: string) {
    pauseRequestedTaskIds.delete(taskId)
    updateTaskRecord(taskId, (task) => ({
      ...task,
      transitioning: true,
      feedback: '取消命令已发送，等待 Nav2 取消当前 goal。',
    }))

    void taskCommandClient
      .cancelTask({ taskId })
      .then(() => {
        appendLog('info', `任务 ${taskId} 的取消已由 Nav2 确认`)
      })
      .catch((error: unknown) => {
        const latestTask = runtime.value.tasks.find((task) => task.id === taskId)
        if (latestTask && terminalTaskStatuses.includes(latestTask.status)) {
          appendLog('warn', `任务 ${taskId} 在取消确认前已进入 ${latestTask.status}`)
          return
        }
        markTaskCommandFailed(taskId, error, '取消任务')
      })
  }

  function createTask(input: CreateTaskInput) {
    const requestedTargetIds =
      input.type === 'multi_point_cruise'
        ? [...new Set(input.targetPointIds ?? [])]
        : input.targetPointId
          ? [input.targetPointId]
          : []

    if (input.type === 'multi_point_cruise' && requestedTargetIds.length < 2) {
      appendLog('warn', '多点巡航至少需要选择两个已保存目标点')
      return null
    }

    if (input.type !== 'return_home' && !requestedTargetIds.length) {
      appendLog('warn', '请先选择并保存目标点，再下发任务')
      return null
    }

    const isScheduled = input.dispatchMode === 'scheduled'

    if (isScheduled && (!input.scheduledAt || input.scheduledAt <= Date.now())) {
      appendLog('warn', '定时任务的执行时间必须晚于当前时间')
      return null
    }

    const timestamp = nowText()
    const id = `TASK-${String(nextTaskNumber).padStart(4, '0')}`
    nextTaskNumber += 1
    const targets = requestedTargetIds.flatMap((targetId) => {
      const target = runtime.value.map.targets.find((item) => item.id === targetId)

      return target ? [target] : []
    })

    if (
      input.type !== 'return_home' &&
      targets.length !== requestedTargetIds.length
    ) {
      appendLog('warn', '部分巡航目标点不存在，请重新选择')
      return null
    }

    const target = targets[0]
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
            mode: 'once',
            scheduledAt: input.scheduledAt as number,
            timezone: localTimezone(),
            status: 'pending',
            createdAt: Date.now(),
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
        ? `定时任务已创建，将于 ${formatDateTime(input.scheduledAt as number)} 执行。`
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
                note: formatDateTime(input.scheduledAt as number),
              },
            ]
          : []),
        ...(status === 'running' ? [{ status: 'running' as const, timestamp }] : []),
      ],
    }

    const nextTasks = [task, ...runtime.value.tasks]
    setRuntimeWithTasks(nextTasks, status === 'running' ? id : runtime.value.task.id)

    if (requestedTargetIds.length) {
      setActiveTarget(requestedTargetIds.at(-1))
      if (status === 'running') {
        setRouteToTargets(requestedTargetIds)
      }
    }

    appendLog(
      'info',
      isScheduled
        ? `定时任务 ${id} 已创建：${task.targetName}，计划 ${formatDateTime(input.scheduledAt as number)}`
        : `任务 ${id} 已下发：${task.targetName}`,
    )

    if (isRosbridgeMode() && status === 'running') {
      sendTaskCommand(task)
    }

    return id
  }

  function startTask(taskId: string) {
    const task = runtime.value.tasks.find((item) => item.id === taskId)
    if (!task) return

    pauseRequestedTaskIds.delete(taskId)
    const currentTask = runtime.value.tasks.find((item) => item.id === runtime.value.task.id)
    let records = runtime.value.tasks

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
    setRuntimeWithTasks(records, taskId)

    if (taskTargetIds(task).length) {
      setRouteToTargets(taskTargetIds(task))
    }

    if (isRosbridgeMode()) {
      sendTaskCommand(task, '启动任务')
    }

    window.setTimeout(() => {
      updateTaskRecord(taskId, (item) => ({ ...item, transitioning: false }))
    }, 260)
  }

  function pauseTask(taskId: string) {
    if (isRosbridgeMode()) {
      pauseRosTask(taskId)
      return
    }

    transitionTask(taskId, 'paused', '任务已由操作员暂停。')
  }

  function continueTask(taskId: string) {
    const task = runtime.value.tasks.find((item) => item.id === taskId)
    if (!task) return

    pauseRequestedTaskIds.delete(taskId)
    setRuntimeWithTasks(
      runtime.value.tasks.map((item) =>
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

    if (isRosbridgeMode()) {
      const targets =
        task.type === 'multi_point_cruise'
          ? remainingTaskTargets(task)
          : taskTargets(task)

      if (!targets.length) {
        appendLog('warn', `任务 ${taskId} 已无剩余目标点，无法继续`)
        return
      }

      if (task.type === 'multi_point_cruise') {
        updateTaskRecord(taskId, (item) => ({
          ...item,
          activeGoalStartIndex: item.nextTargetIndex ?? 0,
        }))
      }

      const command =
        task.type === 'multi_point_cruise'
          ? targets.length === 1
            ? taskCommandClient.sendNavigateToPose(
                toNavigateCommand(task, targets[0] as RuntimeMapPoint),
              )
            : taskCommandClient.sendNavigateThroughPoses(
                toNavigateThroughPosesCommand(task, targets),
              )
          : taskCommandClient.resumeTask(
              toNavigateCommand(task, targets[0] as RuntimeMapPoint),
            )

      void command
        .then((result) => {
          appendLog('info', `任务 ${taskId} 继续成功${result.goalId ? `，goal=${result.goalId}` : ''}`)
        })
        .catch((error: unknown) => {
          markTaskCommandFailed(taskId, error, '继续任务')
        })
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
    const task = runtime.value.tasks.find((item) => item.id === taskId)

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

    if (isRosbridgeMode()) {
      cancelRosTask(taskId)
      return
    }

    transitionTask(taskId, 'canceled', '任务已由操作员取消。')
  }

  function retryTask(taskId: string) {
    const task = runtime.value.tasks.find((item) => item.id === taskId)
    if (!task) return

    pauseRequestedTaskIds.delete(taskId)
    const timestamp = nowText()
    const records = runtime.value.tasks.map((item) =>
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
    setRuntimeWithTasks(records, taskId)
    if (taskTargetIds(task).length) {
      setRouteToTargets(taskTargetIds(task))
    }

    if (isRosbridgeMode()) {
      sendTaskCommand(
        {
          ...task,
          status: 'running',
          nextTargetIndex: task.type === 'multi_point_cruise' ? 0 : undefined,
          activeGoalStartIndex:
            task.type === 'multi_point_cruise' ? 0 : undefined,
        },
        '重试任务',
      )
    }

    window.setTimeout(() => {
      updateTaskRecord(taskId, (item) => ({ ...item, transitioning: false }))
    }, 260)
  }

  function deleteTask(taskId: string) {
    const task = runtime.value.tasks.find((item) => item.id === taskId)
    if (!task) return false

    const records = runtime.value.tasks.filter((item) => item.id !== taskId)
    const deletedCurrentTask = runtime.value.task.id === taskId
    const nextCurrentTask =
      records.find((item) => isTaskActive(item.status)) ?? records[0]

    runtime.value = {
      ...runtime.value,
      tasks: records,
      task: deletedCurrentTask
        ? nextCurrentTask
          ? taskStateFromRecord(nextCurrentTask)
          : emptyTaskState()
        : runtime.value.task,
    }

    appendLog('info', `任务 ${taskId} 已删除`)
    return true
  }

  function reorderTasks(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return

    const records = [...runtime.value.tasks]
    const [removed] = records.splice(fromIndex, 1)
    if (!removed) return

    records.splice(toIndex, 0, removed)
    setRuntimeWithTasks(records)
  }

  function updateMockProgress(progress: number, pose: RuntimeRobotPose) {
    const currentTask = runtime.value.tasks.find((task) => task.id === runtime.value.task.id)
    if (!currentTask || currentTask.status !== 'running') return

    const progressPercent = Math.round(progress * 100)
    const reachedEnd = progress >= 1
    const timestamp = reachedEnd ? nowText() : undefined
    const records = runtime.value.tasks.map((task) =>
      task.id === currentTask.id
        ? {
            ...task,
            progressPercent,
            status: reachedEnd ? ('completed' as const) : task.status,
            completedTime: timestamp ?? task.completedTime,
            feedback: reachedEnd
              ? '任务已完成，机器人已到达目标点。'
              : `正在执行任务，路径进度 ${progressPercent}%。`,
            timeline: reachedEnd
              ? [...task.timeline, { status: 'completed' as const, timestamp: timestamp ?? nowText() }]
              : task.timeline,
          }
        : task,
    )

    setRuntimeWithTasks(records, currentTask.id)
    runtime.value = {
      ...runtime.value,
      map: {
        ...runtime.value.map,
        robotPose: pose,
      },
    }

    if (reachedEnd) {
      appendLog('info', `任务 ${currentTask.id} 已完成`)
    }
  }

  function startMockPoseStream() {
    if (mockPoseTimer) return

    const currentTask = runtime.value.tasks.find((task) => task.id === runtime.value.task.id)
    if (currentTask) {
      mockPoseTick = Math.round(
        (currentTask.progressPercent / 100) * (MOCK_LOOP_TICKS - 1),
      )
    }

    mockPoseTimer = window.setInterval(() => {
      const currentTask = runtime.value.tasks.find((task) => task.id === runtime.value.task.id)
      if (!currentTask || currentTask.status !== 'running') return

      mockPoseTick = Math.min(mockPoseTick + 1, MOCK_LOOP_TICKS - 1)
      const progress = mockPoseTick / (MOCK_LOOP_TICKS - 1)
      const pose = poseAtPathProgress(runtime.value.map.routePoints, progress)

      updateMockProgress(progress, pose)
    }, MOCK_POSE_TICK_MS)
  }

  function stopMockPoseStream() {
    if (!mockPoseTimer) return

    window.clearInterval(mockPoseTimer)
    mockPoseTimer = undefined
  }

  return {
    runtime,
    dataSourceMode,
    dataSourceError,
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
    reorderTasks,
    startMockPoseStream,
    stopMockPoseStream,
  }
})
