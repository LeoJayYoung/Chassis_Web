import type { RuntimeDataSourceMode } from './runtime'
import type { RuntimeTaskStatus, RuntimeTaskType } from '../types'
import { runtimeApiConfig } from './config'

export type TaskCommandEvent =
  | {
      type: 'feedback'
      taskId: string
      goalId: string
      distanceRemaining?: number
      estimatedTimeRemainingSec?: number
      navigationTimeSec?: number
      numberOfRecoveries?: number
    }
  | {
      type: 'status' | 'result'
      taskId: string
      goalId: string
      status: RuntimeTaskStatus
      feedback: string
      errorCode?: number
      errorMessage?: string
    }

export type TaskCommandEventListener = (event: TaskCommandEvent) => void

export interface TaskTargetPose {
  x: number
  y: number
  yawRad: number
  frameId: string
}

export interface NavigateTaskCommand {
  taskId: string
  taskType: RuntimeTaskType
  targetName: string
  targetPose: TaskTargetPose
}

export interface TaskControlCommand {
  taskId: string
}

export interface TaskCommandResult {
  accepted: boolean
  goalId?: string
  message?: string
}

export interface TaskCommandClient {
  sendNavigateToPose(command: NavigateTaskCommand): Promise<TaskCommandResult>
  pauseTask(command: TaskControlCommand): Promise<TaskCommandResult>
  resumeTask(command: NavigateTaskCommand): Promise<TaskCommandResult>
  cancelTask(command: TaskControlCommand): Promise<TaskCommandResult>
  subscribeTaskEvents(listener: TaskCommandEventListener): () => void
  disconnect(): void
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(record: Record<string, unknown>, key: string) {
  return typeof record[key] === 'string' ? record[key] : undefined
}

function readNumber(value: unknown) {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN

  return Number.isFinite(numeric) ? numeric : undefined
}

function readRecord(record: Record<string, unknown>, key: string) {
  const value = record[key]

  return isRecord(value) ? value : undefined
}

function quaternionFromYaw(yawRad: number) {
  return {
    x: 0,
    y: 0,
    z: Math.sin(yawRad / 2),
    w: Math.cos(yawRad / 2),
  }
}

function durationSec(value: unknown) {
  const record = isRecord(value) ? value : null
  const seconds = record
    ? readNumber(record.sec) ?? readNumber(record.secs)
    : undefined
  const nanoseconds = record
    ? readNumber(record.nanosec) ?? readNumber(record.nsec) ?? readNumber(record.nsecs)
    : undefined

  if (seconds === undefined) return undefined

  return seconds + (nanoseconds ?? 0) / 1_000_000_000
}

function runtimeStatusFromActionStatus(status: number): RuntimeTaskStatus | null {
  if (status === 1 || status === 2 || status === 3) return 'running'
  if (status === 4) return 'completed'
  if (status === 5) return 'canceled'
  if (status === 6) return 'failed'

  return null
}

function feedbackFromActionStatus(status: RuntimeTaskStatus) {
  const labels: Record<RuntimeTaskStatus, string> = {
    idle: '任务等待执行。',
    running: 'Nav2 正在执行导航任务。',
    paused: '任务已暂停。',
    canceled: 'Nav2 导航任务已取消。',
    completed: 'Nav2 导航任务已到达目标点。',
    failed: 'Nav2 导航任务执行失败。',
  }

  return labels[status]
}

function createActionGoalId(taskId: string) {
  return `web:${taskId}:${Date.now()}:${crypto.randomUUID()}`
}

class MockTaskCommandClient implements TaskCommandClient {
  async sendNavigateToPose(command: NavigateTaskCommand) {
    return {
      accepted: true,
      goalId: `mock-${command.taskId}`,
      message: 'Mock NavigateToPose accepted',
    }
  }

  async pauseTask(command: TaskControlCommand) {
    return {
      accepted: true,
      goalId: `mock-${command.taskId}`,
      message: 'Mock pause accepted',
    }
  }

  async resumeTask(command: NavigateTaskCommand) {
    return this.sendNavigateToPose(command)
  }

  async cancelTask(command: TaskControlCommand) {
    return {
      accepted: true,
      goalId: `mock-${command.taskId}`,
      message: 'Mock cancel accepted',
    }
  }

  subscribeTaskEvents() {
    return () => undefined
  }

  disconnect() {
    // Mock command client has no external connection.
  }
}

class RosbridgeTaskCommandClient implements TaskCommandClient {
  private socket: WebSocket | null = null
  private openingSocket: Promise<WebSocket> | null = null
  private goalIds = new Map<string, string>()
  private taskIdsByGoalId = new Map<string, string>()
  private listeners = new Set<TaskCommandEventListener>()

  async sendNavigateToPose(command: NavigateTaskCommand) {
    const socket = await this.ensureSocket()
    const action = trimTrailingSlashes(runtimeApiConfig.rosCommands.navigateActionName)
    const goalId = createActionGoalId(command.taskId)

    socket.send(
      JSON.stringify({
        op: 'send_action_goal',
        id: goalId,
        action,
        action_type: 'nav2_msgs/action/NavigateToPose',
        feedback: true,
        args: {
          pose: {
            header: {
              frame_id: command.targetPose.frameId,
              stamp: {
                sec: 0,
                nanosec: 0,
              },
            },
            pose: {
              position: {
                x: command.targetPose.x,
                y: command.targetPose.y,
                z: 0,
              },
              orientation: quaternionFromYaw(command.targetPose.yawRad),
            },
          },
          behavior_tree: '',
        },
      }),
    )

    this.goalIds.set(command.taskId, goalId)
    this.taskIdsByGoalId.set(goalId, command.taskId)
    this.emit({
      type: 'status',
      taskId: command.taskId,
      goalId,
      status: 'running',
      feedback: 'NavigateToPose 目标已发送，等待 Nav2 反馈。',
    })

    return {
      accepted: true,
      goalId,
      message: `目标点 ${command.targetName} 已发送`,
    }
  }

  async pauseTask(command: TaskControlCommand) {
    return this.cancelTask({
      taskId: command.taskId,
    })
  }

  async resumeTask(command: NavigateTaskCommand) {
    return this.sendNavigateToPose(command)
  }

  async cancelTask(command: TaskControlCommand) {
    const goalId = this.goalIds.get(command.taskId)

    if (!goalId) {
      throw new Error(`未找到任务 ${command.taskId} 对应的 Nav2 goal，无法取消`)
    }

    const socket = await this.ensureSocket()
    const action = trimTrailingSlashes(runtimeApiConfig.rosCommands.navigateActionName)
    socket.send(
      JSON.stringify({
        op: 'cancel_action_goal',
        id: goalId,
        action,
      }),
    )
    this.goalIds.delete(command.taskId)

    return {
      accepted: true,
      goalId,
      message: 'Nav2 goal 取消请求已发送',
    }
  }

  subscribeTaskEvents(listener: TaskCommandEventListener) {
    this.listeners.add(listener)

    if (runtimeApiConfig.mode === 'rosbridge') {
      void this.ensureSocket().catch(() => undefined)
    }

    return () => {
      this.listeners.delete(listener)
    }
  }

  disconnect() {
    if (!this.socket) return

    const socket = this.socket
    this.socket = null
    this.openingSocket = null
    socket.close()
  }

  private ensureSocket() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.socket)
    }

    if (this.openingSocket) {
      return this.openingSocket
    }

    if (!runtimeApiConfig.rosbridgeWsUrl) {
      return Promise.reject(new Error('未配置 VITE_ROSBRIDGE_WS_URL，无法发送 ROS 命令'))
    }

    this.openingSocket = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(runtimeApiConfig.rosbridgeWsUrl)

      socket.onopen = () => {
        this.socket = socket
        this.openingSocket = null
        resolve(socket)
      }

      socket.onerror = () => {
        this.openingSocket = null
        reject(new Error('ROS 命令 WebSocket 连接异常'))
      }

      socket.onclose = () => {
        if (this.socket === socket) {
          this.socket = null
        }

        this.openingSocket = null
      }

      socket.onmessage = (event) => {
        this.handleMessage(String(event.data))
      }
    })

    return this.openingSocket
  }

  private handleMessage(data: string) {
    const payload: unknown = JSON.parse(data)

    if (!isRecord(payload)) return

    const op = readString(payload, 'op')

    if (op === 'action_feedback') {
      this.handleActionFeedback(payload)
      return
    }

    if (op === 'action_result') {
      this.handleActionResult(payload)
    }
  }

  private handleActionFeedback(payload: Record<string, unknown>) {
    const goalId = readString(payload, 'id')
    const feedback = readRecord(payload, 'values')
    if (!goalId || !feedback) return

    const taskId = this.taskIdsByGoalId.get(goalId)
    if (!taskId) return

    this.emit({
      type: 'feedback',
      taskId,
      goalId,
      distanceRemaining: readNumber(feedback.distance_remaining),
      estimatedTimeRemainingSec: durationSec(feedback.estimated_time_remaining),
      navigationTimeSec: durationSec(feedback.navigation_time),
      numberOfRecoveries: readNumber(feedback.number_of_recoveries),
    })
  }

  private handleActionResult(payload: Record<string, unknown>) {
    const goalId = readString(payload, 'id')
    const statusNumber = readNumber(payload.status)
    const succeeded = payload.result === true
    if (!goalId) return

    const taskId = this.taskIdsByGoalId.get(goalId)
    if (!taskId) return

    const values = readRecord(payload, 'values')
    const status =
      statusNumber === undefined
        ? succeeded
          ? 'completed'
          : 'failed'
        : (runtimeStatusFromActionStatus(statusNumber) ??
          (succeeded ? 'completed' : 'failed'))
    const errorCode = values ? readNumber(values.error_code) : undefined
    const errorMessage = values
      ? readString(values, 'error_msg')
      : typeof payload.values === 'string'
        ? payload.values
        : undefined

    this.goalIds.delete(taskId)
    this.taskIdsByGoalId.delete(goalId)
    this.emit({
      type: 'result',
      taskId,
      goalId,
      status,
      feedback: errorMessage || feedbackFromActionStatus(status),
      errorCode,
      errorMessage,
    })
  }

  private emit(event: TaskCommandEvent) {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

export function createTaskCommandClient(
  mode: RuntimeDataSourceMode,
): TaskCommandClient {
  return mode === 'rosbridge'
    ? new RosbridgeTaskCommandClient()
    : new MockTaskCommandClient()
}
