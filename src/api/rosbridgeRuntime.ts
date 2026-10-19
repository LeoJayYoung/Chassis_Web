import { mockRuntimeDashboard } from '../mock/runtime'
import type {
  RuntimeDashboardSnapshot,
  RuntimeDiagnosticItem,
  RuntimeHealthStatus,
  RuntimeMetricItem,
  RuntimeTelemetrySnapshot,
  RuntimeTfFrame,
  RuntimeTwist,
} from '../types'
import { runtimeApiConfig } from './config'
import { normalizeRosMessage, type NormalizedRosMessage } from './rosNormalizer'
import type {
  RuntimeDataSource,
  RuntimeDataSourceErrorListener,
  RuntimeSnapshotListener,
} from './runtime'

interface RosbridgeEnvelope {
  op?: string
  id?: string
  topic?: string
  msg?: unknown
}

interface RosbridgeSubscription {
  topic: string
  throttleRate: number
}

const RECONNECT_DELAY_MS = 1600
const LOCALIZATION_CHECK_MS = 1000

const DEFAULT_TELEMETRY: RuntimeTelemetrySnapshot = {
  communication: {
    reconnectCount: 0,
    lastMessageAt: null,
    linkDelayMs: null,
  },
  tfFrames: [],
  diagnostics: [],
}

function buildSubscriptions(): RosbridgeSubscription[] {
  const topics = runtimeApiConfig.rosTopics

  return [
    { topic: topics.map, throttleRate: 1000 },
    { topic: topics.amclPose, throttleRate: 200 },
    { topic: topics.plan, throttleRate: 500 },
    { topic: topics.odom, throttleRate: 200 },
    { topic: topics.cmdVel, throttleRate: 200 },
    { topic: topics.tf, throttleRate: 500 },
    { topic: topics.tfStatic, throttleRate: 2000 },
    { topic: topics.batteryState, throttleRate: 1000 },
    { topic: topics.diagnostics, throttleRate: 1000 },
  ].filter((subscription) => subscription.topic)
}

function cloneData<T>(value: T): T {
  return structuredClone(value)
}

function createRosbridgeSnapshot(): RuntimeDashboardSnapshot {
  const snapshot = cloneData(mockRuntimeDashboard)

  return {
    ...snapshot,
    localization: 'initializing',
    task: {
      ...snapshot.task,
      id: 'TASK-0000',
      name: '等待任务',
      status: 'idle',
      feedback: '等待 ROS 任务反馈。',
      targetPointId: undefined,
      progressPercent: 0,
      etaMinutes: 0,
    },
    map: {
      ...snapshot.map,
      robotPoseReceived: false,
      activeTargetId: undefined,
      draftTarget: undefined,
      targets: [],
      routePoints: [],
      obstacles: [],
      zones: [],
    },
    tasks: [],
    telemetry: cloneData(DEFAULT_TELEMETRY),
  }
}

function toError(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error : new Error(fallbackMessage)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function clampPercent(value: number) {
  return Math.min(Math.max(Math.round(value), 0), 100)
}

function formatNumber(value: number, digits: number) {
  return Number.isFinite(value) ? value.toFixed(digits) : '--'
}

function healthFromDelay(delayMs: number): RuntimeHealthStatus {
  if (delayMs > 1000) return 'error'
  if (delayMs > 250) return 'warning'
  return 'normal'
}

function healthFromDiagnostics(items: RuntimeDiagnosticItem[]): RuntimeHealthStatus {
  if (items.some((item) => item.level === 'error')) return 'error'
  if (items.some((item) => item.level === 'warning')) return 'warning'
  return 'normal'
}

function metricDefaults(id: string): RuntimeMetricItem {
  const labels: Record<string, Pick<RuntimeMetricItem, 'label' | 'unit'>> = {
    'forward-speed': { label: '前进速度', unit: 'm/s' },
    'turning-speed': { label: '转向速度', unit: 'rad/s' },
    'link-delay': { label: '通信延迟', unit: 'ms' },
  }
  const fallback = labels[id] ?? { label: id, unit: '' }

  return {
    id,
    label: fallback.label,
    value: '--',
    unit: fallback.unit,
    percent: 0,
    status: 'normal',
  }
}

function patchMetric(
  metrics: RuntimeMetricItem[],
  id: string,
  patch: Pick<RuntimeMetricItem, 'value' | 'unit' | 'percent' | 'status'>,
) {
  const nextMetrics = [...metrics]
  const index = nextMetrics.findIndex((metric) => metric.id === id)
  const current = index >= 0 ? (nextMetrics[index] ?? metricDefaults(id)) : metricDefaults(id)
  const next = {
    ...current,
    ...patch,
  }

  if (index >= 0) {
    nextMetrics[index] = next
  } else {
    nextMetrics.push(next)
  }

  return nextMetrics
}

function patchVelocityMetrics(
  metrics: RuntimeMetricItem[],
  velocity: RuntimeTwist,
): RuntimeMetricItem[] {
  const linearSpeed = Math.abs(velocity.linearX)
  const angularSpeed = Math.abs(velocity.angularZ)
  const withLinear = patchMetric(metrics, 'forward-speed', {
    value: formatNumber(linearSpeed, 2),
    unit: 'm/s',
    percent: clampPercent((linearSpeed / 2) * 100),
    status: linearSpeed > 1.6 ? 'warning' : 'normal',
  })

  return patchMetric(withLinear, 'turning-speed', {
    value: formatNumber(angularSpeed, 2),
    unit: 'rad/s',
    percent: clampPercent((angularSpeed / 1.5) * 100),
    status: angularSpeed > 1.2 ? 'warning' : 'normal',
  })
}

function patchLinkDelayMetric(
  metrics: RuntimeMetricItem[],
  delayMs: number,
): RuntimeMetricItem[] {
  return patchMetric(metrics, 'link-delay', {
    value: String(Math.round(delayMs)),
    unit: 'ms',
    percent: clampPercent((delayMs / 500) * 100),
    status: healthFromDelay(delayMs),
  })
}

function tfKey(frame: RuntimeTfFrame) {
  return `${frame.parentFrame}->${frame.childFrame}`
}

function hasTfLink(frames: RuntimeTfFrame[], parentFrame: string, childFrames: string[]) {
  return frames.some(
    (frame) =>
      frame.parentFrame === parentFrame &&
      childFrames.includes(frame.childFrame),
  )
}

function inferLocalizationStatus(frames: RuntimeTfFrame[]): RuntimeDashboardSnapshot['localization'] {
  if (!frames.length) return 'initializing'

  const hasMapToOdom = hasTfLink(frames, 'map', ['odom'])
  const hasOdomToBase = hasTfLink(frames, 'odom', ['base_link', 'base_footprint'])

  if (hasMapToOdom && hasOdomToBase) return 'ready'
  return 'initializing'
}

function messageStamp(normalized: NormalizedRosMessage) {
  switch (normalized.topic) {
    case '/tf':
    case '/tf_static':
      return normalized.value.at(0)?.stamp
    case '/diagnostics':
      return normalized.value.at(0)?.stamp
    case '/odom':
      return normalized.value.stamp
    default:
      return normalized.value.stamp
  }
}

function parseRosbridgeEnvelope(data: string): RosbridgeEnvelope | null {
  const payload: unknown = JSON.parse(data)

  if (!isRecord(payload)) return null

  return {
    op: typeof payload.op === 'string' ? payload.op : undefined,
    id: typeof payload.id === 'string' ? payload.id : undefined,
    topic: typeof payload.topic === 'string' ? payload.topic : undefined,
    msg: payload.msg,
  }
}

export class RosbridgeRuntimeDataSource implements RuntimeDataSource {
  readonly mode = 'rosbridge' as const

  private socket: WebSocket | null = null
  private snapshot: RuntimeDashboardSnapshot = createRosbridgeSnapshot()
  private tfFrames = new Map<string, RuntimeTfFrame>()
  private reconnectTimer: number | undefined
  private localizationTimer: number | undefined
  private lastAmclPoseAt: number | null = null
  private disposed = false

  async loadSnapshot() {
    this.snapshot = createRosbridgeSnapshot()

    return cloneData(this.snapshot)
  }

  subscribe(
    onSnapshot: RuntimeSnapshotListener,
    onError?: RuntimeDataSourceErrorListener,
  ) {
    this.disconnect()
    this.disposed = false

    const connect = () => {
      if (this.disposed) return

      if (!runtimeApiConfig.rosbridgeWsUrl) {
        onError?.(new Error('未配置 VITE_ROSBRIDGE_WS_URL，无法连接 rosbridge'))
        return
      }

      const socket = new WebSocket(runtimeApiConfig.rosbridgeWsUrl)
      this.socket = socket

      socket.onopen = () => {
        if (this.socket !== socket) return

        this.lastAmclPoseAt = Date.now()
        this.patchConnection('connected')
        this.subscribeTopics()
        this.startLocalizationWatchdog(onSnapshot)
        onSnapshot(cloneData(this.snapshot))
      }

      socket.onmessage = (event) => {
        try {
          const envelope = parseRosbridgeEnvelope(String(event.data))

          if (envelope?.op !== 'publish' || !envelope.topic) return

          const normalized = normalizeRosMessage(envelope.topic, envelope.msg)

          if (!normalized) return

          this.applyNormalizedMessage(normalized)
          onSnapshot(cloneData(this.snapshot))
        } catch (error) {
          onError?.(toError(error, 'rosbridge 消息不是合法 JSON'))
        }
      }

      socket.onerror = () => {
        if (!this.disposed) {
          onError?.(new Error('rosbridge WebSocket 连接异常'))
        }
      }

      socket.onclose = () => {
        if (this.socket === socket) {
          this.socket = null
        }

        this.patchConnection('disconnected')
        this.stopLocalizationWatchdog()
        onSnapshot(cloneData(this.snapshot))

        if (!this.disposed) {
          this.bumpReconnectCount()
          this.reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }
    }

    connect()

    return () => {
      this.disposed = true
      this.disconnect()
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }

    this.stopLocalizationWatchdog()

    if (!this.socket) return

    const socket = this.socket
    this.socket = null
    this.unsubscribeTopics(socket)
    socket.close()
  }

  private applyNormalizedMessage(normalized: NormalizedRosMessage) {
    const receivedAt = Date.now()
    const stamp = messageStamp(normalized)

    this.snapshot = {
      ...this.snapshot,
      telemetry: {
        ...this.ensureTelemetry(),
        communication: {
          ...this.ensureTelemetry().communication,
          lastMessageAt: receivedAt,
        },
      },
    }

    if (stamp) {
      const delayMs = Math.max(0, receivedAt - stamp)

      this.snapshot = {
        ...this.snapshot,
        metrics: patchLinkDelayMetric(this.snapshot.metrics, delayMs),
        telemetry: {
          ...this.ensureTelemetry(),
          communication: {
            ...this.ensureTelemetry().communication,
            linkDelayMs: delayMs,
          },
        },
      }
    }

    switch (normalized.topic) {
      case '/map':
        this.snapshot = {
          ...this.snapshot,
          map: {
            ...this.snapshot.map,
            width: normalized.value.widthCells,
            height: normalized.value.heightCells,
            ros: {
              frameId: normalized.value.frameId,
              resolution: normalized.value.resolution,
              widthCells: normalized.value.widthCells,
              heightCells: normalized.value.heightCells,
              originX: normalized.value.originX,
              originY: normalized.value.originY,
              originYawRad: normalized.value.originYawRad,
            },
            occupancyGrid: normalized.value,
          },
        }
        break

      case '/amcl_pose':
        this.lastAmclPoseAt = receivedAt
        this.snapshot = {
          ...this.snapshot,
          localization: 'ready',
          map: {
            ...this.snapshot.map,
            robotPose: normalized.value,
            robotPoseReceived: true,
          },
        }
        break

      case '/plan':
        this.snapshot = {
          ...this.snapshot,
          map: {
            ...this.snapshot.map,
            routePoints: normalized.value.points,
          },
        }
        break

      case '/odom':
        this.snapshot = {
          ...this.snapshot,
          metrics: patchVelocityMetrics(this.snapshot.metrics, normalized.value.velocity),
          telemetry: {
            ...this.ensureTelemetry(),
            odometry: normalized.value,
          },
        }
        break

      case '/cmd_vel':
        this.snapshot = {
          ...this.snapshot,
          metrics: patchVelocityMetrics(this.snapshot.metrics, normalized.value),
          telemetry: {
            ...this.ensureTelemetry(),
            commandVelocity: normalized.value,
          },
        }
        break

      case '/tf':
      case '/tf_static':
        for (const frame of normalized.value) {
          this.tfFrames.set(tfKey(frame), frame)
        }

        this.snapshot = {
          ...this.snapshot,
          localization:
            !this.snapshot.map.robotPoseReceived ||
            this.snapshot.localization === 'lost'
              ? this.snapshot.localization
              : inferLocalizationStatus([...this.tfFrames.values()]),
          telemetry: {
            ...this.ensureTelemetry(),
            tfFrames: [...this.tfFrames.values()],
          },
        }
        break

      case '/battery_state':
        this.snapshot = {
          ...this.snapshot,
          robot: {
            ...this.snapshot.robot,
            batteryPercent:
              normalized.value.percentage ?? this.snapshot.robot.batteryPercent,
          },
          telemetry: {
            ...this.ensureTelemetry(),
            battery: normalized.value,
          },
        }
        break

      case '/diagnostics': {
        const systemStatus = healthFromDiagnostics(normalized.value)

        this.snapshot = {
          ...this.snapshot,
          systemStatus,
          systemMessage:
            systemStatus === 'normal'
              ? '系统运行正常'
              : systemStatus === 'warning'
                ? '部分诊断项需要关注'
                : '存在异常诊断项',
          alarms: {
            total: normalized.value.filter((item) => item.level !== 'normal').length,
            warning: normalized.value.filter((item) => item.level === 'warning').length,
            critical: normalized.value.filter((item) => item.level === 'error').length,
          },
          telemetry: {
            ...this.ensureTelemetry(),
            diagnostics: normalized.value,
          },
        }
        break
      }
    }
  }

  private ensureTelemetry(): RuntimeTelemetrySnapshot {
    return this.snapshot.telemetry ?? cloneData(DEFAULT_TELEMETRY)
  }

  private patchConnection(connection: RuntimeDashboardSnapshot['connection']) {
    this.snapshot = {
      ...this.snapshot,
      connection,
      robot: {
        ...this.snapshot.robot,
        status: connection === 'connected' ? 'online' : 'offline',
        signalLabel: connection === 'connected' ? 'rosbridge 已连接' : 'rosbridge 已断开',
      },
    }
  }

  private bumpReconnectCount() {
    const telemetry = this.ensureTelemetry()

    this.snapshot = {
      ...this.snapshot,
      telemetry: {
        ...telemetry,
        communication: {
          ...telemetry.communication,
          reconnectCount: telemetry.communication.reconnectCount + 1,
        },
      },
    }
  }

  private startLocalizationWatchdog(onSnapshot: RuntimeSnapshotListener) {
    this.stopLocalizationWatchdog()

    this.localizationTimer = window.setInterval(() => {
      if (
        this.disposed ||
        this.snapshot.connection !== 'connected' ||
        !this.lastAmclPoseAt
      ) {
        return
      }

      const isLost =
        Date.now() - this.lastAmclPoseAt > runtimeApiConfig.localizationLostTimeoutMs

      if (!isLost || this.snapshot.localization === 'lost') return

      this.snapshot = {
        ...this.snapshot,
        localization: 'lost',
      }
      onSnapshot(cloneData(this.snapshot))
    }, LOCALIZATION_CHECK_MS)
  }

  private stopLocalizationWatchdog() {
    if (!this.localizationTimer) return

    window.clearInterval(this.localizationTimer)
    this.localizationTimer = undefined
  }

  private subscribeTopics() {
    for (const subscription of buildSubscriptions()) {
      this.send({
        op: 'subscribe',
        id: this.subscriptionId(subscription.topic),
        topic: subscription.topic,
        throttle_rate: subscription.throttleRate,
      })
    }
  }

  private unsubscribeTopics(socket = this.socket) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return

    for (const subscription of buildSubscriptions()) {
      socket.send(
        JSON.stringify({
          op: 'unsubscribe',
          id: this.subscriptionId(subscription.topic),
          topic: subscription.topic,
        }),
      )
    }
  }

  private send(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return

    this.socket.send(JSON.stringify(payload))
  }

  private subscriptionId(topic: string) {
    return `runtime:${topic}`
  }
}
