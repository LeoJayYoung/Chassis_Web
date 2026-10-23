import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, '')
}

function isRecord(value) {
  return typeof value === 'object' && value !== null
}

function quaternionFromYaw(yawRad) {
  return {
    x: 0,
    y: 0,
    z: Math.sin(yawRad / 2),
    w: Math.cos(yawRad / 2),
  }
}

// ROS2 rcl 日志级别：DEBUG=10 INFO=20 WARN=30 ERROR=40 FATAL=50
function rosLogLevel(value) {
  if (value >= 40) return 'error'
  if (value >= 30) return 'warn'
  if (value >= 20) return 'info'
  return 'debug'
}

// diagnostic_msgs DiagnosticStatus.level: OK=0 WARN=1 ERROR=2 STALE=3
function diagnosticLevel(value) {
  if (value === 2) return 'error'
  if (value === 1 || value === 3) return 'warn'
  return 'info'
}

function rosStampMs(message, fallback = Date.now()) {
  const stamp = message?.header?.stamp ?? message?.stamp
  const sec = Number(stamp?.sec ?? stamp?.secs)
  const nanosec = Number(stamp?.nanosec ?? stamp?.nsec ?? stamp?.nsecs ?? 0)

  if (!Number.isFinite(sec)) return fallback
  return Math.round(sec * 1000 + (Number.isFinite(nanosec) ? nanosec : 0) / 1_000_000)
}

/**
 * rosbridge WebSocket 客户端：订阅日志 topic、给 Nav2 下发/取消 action goal。
 * 事件：
 *   'connected' / 'disconnected' / 'error'
 *   'log'            -> { level, module, source, message }
 *   'action_feedback'-> { runId, ...payload }
 *   'action_result'  -> { runId, ...payload }
 */
export class RosbridgeClient extends EventEmitter {
  constructor() {
    super()
    this.socket = null
    this.disposed = false
    this.reconnectTimer = null
    this.subscribed = new Set()
    this.goals = new Map() // runId -> { goalId, action }
  }

  get connected() {
    return this.socket?.readyState === 1
  }

  connect() {
    if (this.disposed) return
    if (!config.rosbridgeWsUrl) {
      this.emit('error', new Error('未配置 ROSBRIDGE_WS_URL，无法连接 rosbridge'))
      return
    }

    const socket = new WebSocket(config.rosbridgeWsUrl)
    this.socket = socket

    socket.onopen = () => {
      if (this.socket !== socket) return
      this.emit('connected')
      this.subscribeTopics()
    }

    socket.onmessage = (event) => {
      try {
        this.handleMessage(String(event.data))
      } catch (error) {
        this.emit('error', error)
      }
    }

    socket.onerror = () => {
      this.emit('error', new Error('rosbridge WebSocket 连接异常'))
    }

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null
      this.subscribed.clear()
      this.emit('disconnected')

      if (!this.disposed) {
        this.reconnectTimer = setTimeout(
          () => this.connect(),
          config.rosbridgeReconnectMs,
        )
      }
    }
  }

  subscribeTopics() {
    const topics = [
      {
        topic: config.logTopics.rosout,
        type: 'rcl_interfaces/msg/Log',
        throttle: 200,
      },
      {
        topic: config.logTopics.diagnostics,
        type: 'diagnostic_msgs/msg/DiagnosticArray',
        throttle: 500,
      },
      {
        topic: config.logTopics.stm32,
        type: config.logTopics.stm32Type,
        throttle: 200,
      },
    ].filter((item) => item.topic)

    for (const { topic, type, throttle } of topics) {
      this.send({
        op: 'subscribe',
        id: `server:${topic}`,
        topic,
        type,
        throttle_rate: throttle,
        queue_length: 1,
        compression: 'none',
      })
      this.subscribed.add(topic)
    }
  }

  handleMessage(data) {
    let payload
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    if (!isRecord(payload)) return

    if (payload.op === 'publish') {
      this.handlePublish(payload)
    } else if (payload.op === 'action_feedback') {
      this.emit('action_feedback', { ...payload, runId: this.runIdForGoal(payload.id) })
    } else if (payload.op === 'action_result') {
      this.emit('action_result', { ...payload, runId: this.runIdForGoal(payload.id) })
    }
  }

  handlePublish(payload) {
    const topic = payload.topic
    const msg = payload.msg

    if (topic === config.logTopics.rosout && isRecord(msg)) {
      this.emit('log', {
        ts: rosStampMs(msg),
        level: rosLogLevel(msg.level),
        module: 'ros',
        source: topic,
        message: typeof msg.msg === 'string' ? msg.msg : JSON.stringify(msg),
      })
      return
    }

    if (topic === config.logTopics.diagnostics && isRecord(msg)) {
      const statuses = Array.isArray(msg.status) ? msg.status : []
      for (const status of statuses) {
        if (!isRecord(status) || status.level === 0) continue
        this.emit('log', {
          ts: rosStampMs(msg),
          level: diagnosticLevel(status.level),
          module: 'system',
          source: topic,
          message: `${status.name || 'diagnostic'}: ${status.message || ''}`,
        })
      }
      return
    }

    if (topic && topic === config.logTopics.stm32) {
      this.emit('log', {
        ts: rosStampMs(msg),
        level: 'info',
        module: 'stm32',
        source: topic,
        message: typeof msg === 'string' ? msg : JSON.stringify(msg),
      })
    }
  }

  runIdForGoal(goalId) {
    for (const [runId, goal] of this.goals.entries()) {
      if (goal.goalId === goalId) return runId
    }
    return null
  }

  toPoseStamped(target) {
    return {
      header: {
        frame_id: target.frameId || config.frameId,
        stamp: { sec: 0, nanosec: 0 },
      },
      pose: {
        position: { x: target.x ?? 0, y: target.y ?? 0, z: 0 },
        orientation: quaternionFromYaw(target.yawRad ?? 0),
      },
    }
  }

  sendNavigateToPose(runId, target) {
    return this.sendActionGoal(
      runId,
      trimTrailingSlashes(config.rosActions.navigateToPose),
      'nav2_msgs/action/NavigateToPose',
      { pose: this.toPoseStamped(target), behavior_tree: '' },
    )
  }

  sendNavigateThroughPoses(runId, targets) {
    return this.sendActionGoal(
      runId,
      trimTrailingSlashes(config.rosActions.navigateThroughPoses),
      'nav2_msgs/action/NavigateThroughPoses',
      { poses: targets.map((target) => this.toPoseStamped(target)), behavior_tree: '' },
    )
  }

  sendActionGoal(runId, action, actionType, args) {
    const socket = this.requireSocket()
    const goalId = `server:${runId}:${Date.now()}:${randomUUID()}`

    socket.send(
      JSON.stringify({
        op: 'send_action_goal',
        id: goalId,
        action,
        action_type: actionType,
        feedback: true,
        args,
      }),
    )

    this.goals.set(runId, { goalId, action })
    return { goalId, action }
  }

  cancelGoal(runId) {
    const goal = this.goals.get(runId)
    if (!goal) return false

    const socket = this.requireSocket()
    socket.send(
      JSON.stringify({
        op: 'cancel_action_goal',
        id: goal.goalId,
        action: goal.action,
      }),
    )
    return true
  }

  restoreGoal(runId, goalId, action) {
    if (!runId || !goalId || !action) return false
    this.goals.set(runId, { goalId, action })
    return true
  }

  clearGoal(runId) {
    this.goals.delete(runId)
  }

  requireSocket() {
    if (!this.connected) {
      throw new Error('rosbridge 未连接，无法下发命令')
    }
    return this.socket
  }

  send(payload) {
    if (!this.connected) return false
    this.socket.send(JSON.stringify(payload))
    return true
  }

  disconnect() {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      const socket = this.socket
      this.socket = null
      try {
        socket.close()
      } catch {
        // 忽略关闭异常
      }
    }
  }
}
