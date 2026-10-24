import type { Ref } from 'vue'
import type {
  RuntimeDashboardSnapshot,
  RuntimePathPoint,
  RuntimeRobotPose,
  RuntimeTaskRecord,
} from '../types'

const MOCK_POSE_TICK_MS = 500
const MOCK_LOOP_TICKS = 80
const SCHEDULE_CHECK_MS = 1000

function pointDistance(start: RuntimePathPoint, end: RuntimePathPoint) {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

interface MockControllerOptions {
  runtime: Ref<RuntimeDashboardSnapshot>
  updateTask: (
    taskId: string,
    updater: (task: RuntimeTaskRecord) => RuntimeTaskRecord,
  ) => boolean
  setTaskRuns: (records: RuntimeTaskRecord[], currentTaskId?: string) => void
  startTask: (taskId: string) => void
  appendLog: (
    level: RuntimeDashboardSnapshot['logs'][number]['level'],
    message: string,
  ) => void
  nowText: () => string
}

export function createMockRuntimeController(options: MockControllerOptions) {
  const {
    runtime,
    updateTask,
    setTaskRuns,
    startTask,
    appendLog,
    nowText,
  } = options
  let poseTimer: number | undefined
  let scheduleTimer: number | undefined
  let poseTick = 0

  function poseAtPathProgress(
    points: RuntimePathPoint[],
    progress: number,
  ): RuntimeRobotPose {
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
    const totalLength = segments.reduce(
      (sum, segment) => sum + segment.length,
      0,
    )
    let distance = totalLength * progress

    for (const segment of segments) {
      if (!segment.end) continue

      if (distance <= segment.length || segment === segments.at(-1)) {
        const ratio = segment.length ? distance / segment.length : 0
        return {
          x:
            segment.start.x +
            (segment.end.x - segment.start.x) * ratio,
          y:
            segment.start.y +
            (segment.end.y - segment.start.y) * ratio,
          yawRad: Math.atan2(
            segment.end.y - segment.start.y,
            segment.end.x - segment.start.x,
          ),
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

  function updateProgress(progress: number, pose: RuntimeRobotPose) {
    const currentTask = runtime.value.taskRuns.find(
      (task) => task.id === runtime.value.task.id,
    )
    if (!currentTask || currentTask.status !== 'running') return

    const progressPercent = Math.round(progress * 100)
    const reachedEnd = progress >= 1
    const timestamp = reachedEnd ? nowText() : undefined
    const records = runtime.value.taskRuns.map((task) =>
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
              ? [
                  ...task.timeline,
                  {
                    status: 'completed' as const,
                    timestamp: timestamp ?? nowText(),
                  },
                ]
              : task.timeline,
          }
        : task,
    )

    setTaskRuns(records, currentTask.id)
    runtime.value = {
      ...runtime.value,
      map: {
        ...runtime.value.map,
        robotPose: pose,
      },
    }

    if (reachedEnd) appendLog('info', `任务 ${currentTask.id} 已完成`)
  }

  function startPoseStream() {
    if (poseTimer) return

    const currentTask = runtime.value.taskRuns.find(
      (task) => task.id === runtime.value.task.id,
    )
    if (currentTask) {
      poseTick = Math.round(
        (currentTask.progressPercent / 100) * (MOCK_LOOP_TICKS - 1),
      )
    }

    poseTimer = window.setInterval(() => {
      const task = runtime.value.taskRuns.find(
        (item) => item.id === runtime.value.task.id,
      )
      if (!task || task.status !== 'running') return

      poseTick = Math.min(poseTick + 1, MOCK_LOOP_TICKS - 1)
      const progress = poseTick / (MOCK_LOOP_TICKS - 1)
      updateProgress(
        progress,
        poseAtPathProgress(runtime.value.map.routePoints, progress),
      )
    }, MOCK_POSE_TICK_MS)
  }

  function stopPoseStream() {
    if (!poseTimer) return
    window.clearInterval(poseTimer)
    poseTimer = undefined
  }

  function checkSchedules() {
    const now = Date.now()

    for (const task of runtime.value.taskRuns) {
      if (
        task.dispatchMode !== 'scheduled' ||
        !task.schedule ||
        task.status !== 'idle' ||
        task.schedule.scheduledAt > now
      ) {
        continue
      }

      const active = runtime.value.taskRuns.some(
        (item) =>
          item.id !== task.id &&
          (item.status === 'running' || item.status === 'paused'),
      )
      if (active) {
        updateTask(task.id, (item) => ({
          ...item,
          feedback: '计划时间已到，正在等待当前任务完成。',
          schedule: item.schedule
            ? { ...item.schedule, status: 'waiting' }
            : item.schedule,
        }))
        continue
      }

      startTask(task.id)
    }
  }

  function startScheduleTimer() {
    if (scheduleTimer) return
    scheduleTimer = window.setInterval(checkSchedules, SCHEDULE_CHECK_MS)
  }

  function stopScheduleTimer() {
    if (!scheduleTimer) return
    window.clearInterval(scheduleTimer)
    scheduleTimer = undefined
  }

  function resetPoseProgress(progressPercent: number) {
    poseTick = Math.round(
      (progressPercent / 100) * (MOCK_LOOP_TICKS - 1),
    )
  }

  return {
    startPoseStream,
    stopPoseStream,
    startScheduleTimer,
    stopScheduleTimer,
    resetPoseProgress,
  }
}
