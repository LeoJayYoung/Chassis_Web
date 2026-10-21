export type RuntimeConnectionState = 'connected' | 'disconnected'

export type RuntimeNavigationMode = 'auto_navigation' | 'manual_control'

export type RuntimeTaskType = 'single_point_navigation' | 'multi_point_cruise' | 'return_home'

export type RuntimeTaskStatus = 'idle' | 'running' | 'paused' | 'canceled' | 'completed' | 'failed'

export type RuntimeTaskDispatchMode = 'immediate' | 'scheduled'

export type RuntimeTaskScheduleStatus =
  | 'pending'
  | 'waiting'
  | 'triggering'
  | 'dispatched'
  | 'canceled'
  | 'missed'
  | 'failed'

export type RuntimeTaskTimelineStatus =
  | RuntimeTaskStatus
  | 'created'
  | 'scheduled'
  | 'triggered'
  | 'resumed'
  | 'retried'

export type RuntimeTaskQueueStatus = RuntimeTaskStatus

export type RuntimeLocalizationStatus = 'ready' | 'initializing' | 'lost'

export type RuntimeRobotStatus = 'online' | 'offline'

export type RuntimeHealthStatus = 'normal' | 'warning' | 'error'

export type RuntimeLogLevel = 'info' | 'warn' | 'error' | 'debug'

export type RuntimeLogModule = 'ros' | 'nav2' | 'stm32' | 'amcl' | 'costmap' | 'system'

export interface RuntimeRobotSummary {
  id: string
  name: string
  status: RuntimeRobotStatus
  batteryPercent: number
  signalLabel: string
}

export interface RuntimeRobotPose {
  x: number
  y: number
  yawRad: number
  frameId: string
  stamp: number
}

export interface RuntimeRosMapMetadata {
  frameId: string
  resolution: number
  widthCells: number
  heightCells: number
  originX: number
  originY: number
  originYawRad: number
}

export interface RuntimeOccupancyGrid {
  frameId: string
  resolution: number
  widthCells: number
  heightCells: number
  originX: number
  originY: number
  originYawRad: number
  data: number[]
  stamp: number
}

export interface RuntimeMapPoint {
  id: string
  name: string
  x: number
  y: number
  done: boolean
  saved?: boolean
}

export interface RuntimePathPoint {
  x: number
  y: number
}

export interface RuntimePathSnapshot {
  frameId: string
  stamp: number
  points: RuntimePathPoint[]
}

export interface RuntimeTwist {
  frameId: string
  stamp: number
  linearX: number
  linearY: number
  linearZ: number
  angularX: number
  angularY: number
  angularZ: number
}

export interface RuntimeOdometrySnapshot {
  frameId: string
  childFrameId: string
  stamp: number
  pose: RuntimeRobotPose
  velocity: RuntimeTwist
}

export interface RuntimeTfFrame {
  parentFrame: string
  childFrame: string
  translation: {
    x: number
    y: number
    z: number
  }
  rotation: {
    rollRad: number
    pitchRad: number
    yawRad: number
  }
  stamp: number
  isStatic: boolean
}

export interface RuntimeBatteryState {
  frameId: string
  stamp: number
  voltage: number | null
  current: number | null
  percentage: number | null
  powerSupplyStatus: number | null
}

export interface RuntimeDiagnosticItem {
  name: string
  message: string
  hardwareId: string
  level: RuntimeHealthStatus
  values: Record<string, string>
  stamp: number
}

export interface RuntimeCommunicationTelemetry {
  reconnectCount: number
  lastMessageAt: number | null
  linkDelayMs: number | null
}

export interface RuntimeTelemetrySnapshot {
  communication: RuntimeCommunicationTelemetry
  odometry?: RuntimeOdometrySnapshot
  commandVelocity?: RuntimeTwist
  battery?: RuntimeBatteryState
  tfFrames: RuntimeTfFrame[]
  diagnostics: RuntimeDiagnosticItem[]
}

export interface RuntimeMapObstacle {
  id: string
  x: number
  y: number
  width: number
  height: number
  cornerRadius?: number
}

export interface RuntimeMapZone {
  id: string
  x: number
  y: number
  width: number
  height: number
  fill: string
  stroke: string
}

export interface RuntimeMapSnapshot {
  id: string
  name: string
  width: number
  height: number
  ros: RuntimeRosMapMetadata
  occupancyGrid?: RuntimeOccupancyGrid
  activeTargetId?: string
  draftTarget?: RuntimeMapPoint
  robotPose: RuntimeRobotPose
  robotPoseReceived?: boolean
  targets: RuntimeMapPoint[]
  routePoints: RuntimePathPoint[]
  obstacles: RuntimeMapObstacle[]
  zones: RuntimeMapZone[]
}

export interface RuntimeTaskState {
  id: string
  name: string
  type: RuntimeTaskType
  status: RuntimeTaskStatus
  feedback: string
  targetPointId?: string
  targetPointIds?: string[]
  nextTargetIndex?: number
  activeGoalStartIndex?: number
  progressPercent: number
  etaMinutes: number
}

export interface RuntimeTaskTimelineEvent {
  status: RuntimeTaskTimelineStatus
  timestamp: string
  note?: string
}

export interface RuntimeTaskSchedule {
  mode: 'once'
  scheduledAt: number
  timezone: string
  status: RuntimeTaskScheduleStatus
  createdAt: number
  triggeredAt?: number
  failureReason?: string
}

export interface RuntimeTaskRecord {
  id: string
  name: string
  targetName?: string
  type: RuntimeTaskType
  status: RuntimeTaskStatus
  dispatchMode?: RuntimeTaskDispatchMode
  schedule?: RuntimeTaskSchedule
  targetPointId?: string
  targetPointIds?: string[]
  nextTargetIndex?: number
  activeGoalStartIndex?: number
  createdTime: string
  completedTime: string | null
  progressPercent: number
  etaMinutes: number
  feedback?: string
  failureReason?: string
  transitioning?: boolean
  timeline: RuntimeTaskTimelineEvent[]
}

export interface RuntimeTaskQueueItem {
  id: string
  name: string
  targetName: string
  progressPercent: number
  status: RuntimeTaskQueueStatus
}

export interface RuntimeAlarmSummary {
  total: number
  critical: number
  warning: number
}

export interface RuntimeMetricItem {
  id: string
  label: string
  value: string
  unit: string
  percent: number
  status: RuntimeHealthStatus
}

export interface RuntimeLogEntry {
  id: string
  time: string
  level: RuntimeLogLevel
  module?: RuntimeLogModule
  message: string
}

export interface RuntimeDashboardSnapshot {
  connection: RuntimeConnectionState
  navigationMode: RuntimeNavigationMode
  localization: RuntimeLocalizationStatus
  robot: RuntimeRobotSummary
  systemStatus: RuntimeHealthStatus
  systemMessage: string
  map: RuntimeMapSnapshot
  task: RuntimeTaskState
  tasks: RuntimeTaskRecord[]
  alarms: RuntimeAlarmSummary
  metrics: RuntimeMetricItem[]
  logs: RuntimeLogEntry[]
  telemetry?: RuntimeTelemetrySnapshot
}
