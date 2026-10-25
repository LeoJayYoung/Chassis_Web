import type { Ref } from 'vue'
import type {
  BackendClient,
  BackendTarget,
} from '../api'
import type {
  RuntimeDashboardSnapshot,
  RuntimeMapPoint,
  RuntimeTaskRecord,
  RuntimeTaskType,
} from '../types'

export interface BackendTaskInput {
  type: RuntimeTaskType
  dispatchMode?: 'immediate' | 'scheduled'
  scheduleMode?: 'once' | 'interval' | 'daily'
  scheduledAt?: number
  intervalMinutes?: number
  timeOfDay?: string
  routeTemplateId?: string
  routeTemplateName?: string
}

interface TaskCommandOptions {
  runtime: Ref<RuntimeDashboardSnapshot>
  backendClient: BackendClient
  backendError: Ref<string | null>
  refresh: () => Promise<void>
  upsertRun: (run: Awaited<ReturnType<BackendClient['getTaskRun']>>) => void
  updateTask: (
    taskId: string,
    updater: (task: RuntimeTaskRecord) => RuntimeTaskRecord,
  ) => boolean
  setTaskRuns: (tasks: RuntimeTaskRecord[]) => void
}

export function createBackendTaskCommands(options: TaskCommandOptions) {
  const {
    runtime,
    backendClient,
    backendError,
    refresh,
    upsertRun,
    updateTask,
    setTaskRuns,
  } = options

  function toBackendTargets(targets: RuntimeMapPoint[]): BackendTarget[] {
    return targets.map((target, index) => {
      const next = targets[index + 1]
      const previous = targets[index - 1]
      const from = next ? target : (previous ?? target)
      const to = next ?? target

      return {
        id: target.id,
        name: target.name,
        x: target.x,
        y: target.y,
        yawRad:
          from === to
            ? runtime.value.map.robotPose.yawRad
            : Math.atan2(to.y - from.y, to.x - from.x),
        frameId: runtime.value.map.ros.frameId,
      }
    })
  }

  async function createRouteTemplate(name: string, targets: RuntimeMapPoint[]) {
    const route = await backendClient.createRoute({
      name: name.trim() || '未命名巡检路线',
      mapId: runtime.value.map.id,
      targets: toBackendTargets(targets),
    })
    await refresh()
    return route.id
  }

  async function renameRoute(routeId: string, name: string) {
    try {
      await backendClient.renameRoute(routeId, name)
      await refresh()
    } catch (error) {
      backendError.value =
        error instanceof Error ? error.message : '修改路线名称失败'
    }
  }

  async function deleteRoute(routeId: string): Promise<string | null> {
    try {
      await backendClient.deleteRoute(routeId)
      await refresh()
      return null
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '删除路线失败'
      backendError.value = message
      return message
    }
  }

  async function reuseRouteImmediately(routeId: string) {
    try {
      const run = await backendClient.dispatchTask({
        routeId,
        mapId: runtime.value.map.id,
      })
      upsertRun(await backendClient.getTaskRun(run.id))
    } catch (error) {
      backendError.value =
        error instanceof Error ? error.message : '立即执行路线失败'
    }
  }

  async function createScheduleFromRoute(
    routeId: string,
    input: {
      mode: 'once' | 'interval' | 'daily'
      scheduledAt?: number
      intervalMinutes?: number
      timeOfDay?: string
    },
  ): Promise<string | null> {
    const route = runtime.value.routeTemplates.find(
      (item) => item.id === routeId,
    )

    try {
      await backendClient.createSchedule({
        name: `${route?.name ?? '巡检路线'}计划`,
        routeId,
        mode: input.mode,
        scheduledAt: input.scheduledAt,
        intervalMinutes: input.intervalMinutes,
        timeOfDay: input.timeOfDay,
      })
      await refresh()
      return null
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '创建巡检计划失败'
      backendError.value = message
      return message
    }
  }

  async function createTask(input: BackendTaskInput, targets: RuntimeMapPoint[]) {
    if (!targets.length && !input.routeTemplateId) {
      throw new Error('任务至少需要一个目标点或路线模板')
    }

    if (input.dispatchMode === 'scheduled') {
      const routeId =
        input.routeTemplateId ??
        (await createRouteTemplate(
          input.routeTemplateName || `${input.type}-路线`,
          targets,
        ))
      const route = runtime.value.routeTemplates.find(
        (item) => item.id === routeId,
      )
      const schedule = await backendClient.createSchedule({
        name: `${route?.name ?? input.routeTemplateName ?? '巡检路线'}计划`,
        routeId,
        mode: input.scheduleMode ?? 'once',
        scheduledAt: input.scheduledAt,
        intervalMinutes: input.intervalMinutes,
        timeOfDay: input.timeOfDay,
      })
      await refresh()
      return schedule.id
    }

    const run = await backendClient.dispatchTask({
      mapId: runtime.value.map.id,
      targets: toBackendTargets(targets),
    })
    upsertRun(await backendClient.getTaskRun(run.id))
    return run.task_no || run.id
  }

  async function runScheduleNow(scheduleId: string) {
    try {
      const run = await backendClient.runScheduleNow(scheduleId)
      upsertRun(await backendClient.getTaskRun(run.id))
    } catch (error) {
      backendError.value =
        error instanceof Error ? error.message : '立即执行计划失败'
    }
  }

  async function command(
    task: RuntimeTaskRecord,
    action: 'pause' | 'resume' | 'cancel',
  ) {
    if (!task.backendRunId) return

    updateTask(task.id, (item) => ({
      ...item,
      transitioning: true,
      feedback:
        action === 'pause'
          ? '暂停请求已发送到后端。'
          : action === 'resume'
            ? '继续请求已发送到后端。'
            : '取消请求已发送到后端。',
    }))
    try {
      await backendClient.taskCommand(task.backendRunId, action)
      upsertRun(await backendClient.getTaskRun(task.backendRunId))
    } catch (error) {
      backendError.value =
        error instanceof Error ? error.message : `${action}任务失败`
      updateTask(task.id, (item) => ({
        ...item,
        transitioning: false,
        feedback: backendError.value ?? `${action}任务失败`,
      }))
    }
  }

  async function retry(task: RuntimeTaskRecord) {
    if (!task.backendRunId) return

    try {
      const result = await backendClient.taskCommand(
        task.backendRunId,
        'retry',
      )
      if ('id' in result) {
        upsertRun(await backendClient.getTaskRun(result.id))
      } else {
        await refresh()
      }
    } catch (error) {
      backendError.value =
        error instanceof Error ? error.message : '重新执行任务失败'
    }
  }

  async function cancelSchedule(scheduleId: string) {
    try {
      await backendClient.cancelSchedule(scheduleId)
      await refresh()
    } catch (error) {
      backendError.value =
        error instanceof Error ? error.message : '取消巡检计划失败'
    }
  }

  async function enableSchedule(scheduleId: string) {
    try {
      await backendClient.enableSchedule(scheduleId)
      await refresh()
    } catch (error) {
      backendError.value =
        error instanceof Error ? error.message : '重新启用巡检计划失败'
    }
  }

  async function deleteSchedule(scheduleId: string) {
    try {
      await backendClient.deleteSchedule(scheduleId)
      await refresh()
    } catch (error) {
      backendError.value =
        error instanceof Error ? error.message : '删除巡检计划失败'
    }
  }

  async function deleteTask(task: RuntimeTaskRecord) {
    if (!task.backendRunId) return false

    await backendClient.deleteTaskRun(task.backendRunId)
    setTaskRuns(
      runtime.value.taskRuns.filter((item) => item.id !== task.id),
    )
    return true
  }

  return {
    createRouteTemplate,
    renameRoute,
    deleteRoute,
    reuseRouteImmediately,
    createScheduleFromRoute,
    createTask,
    runScheduleNow,
    pause: (task: RuntimeTaskRecord) => command(task, 'pause'),
    resume: (task: RuntimeTaskRecord) => command(task, 'resume'),
    cancel: (task: RuntimeTaskRecord) => command(task, 'cancel'),
    retry,
    cancelSchedule,
    enableSchedule,
    deleteSchedule,
    deleteTask,
  }
}
