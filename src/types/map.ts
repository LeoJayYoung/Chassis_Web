export type ConnectionState = 'connected' | 'disconnected'

export type NavigationMode = 'auto_navigation' | 'manual_control'

export type TaskType = 'single_point_navigation' | 'multi_point_cruise' | 'return_home'

export type TaskStatus = 'idle' | 'running' | 'paused' | 'canceled' | 'completed' | 'failed'

export type LocalizationStatus = 'ready' | 'initializing' | 'lost'

export type RobotStatus = 'online' | 'offline'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

import type { RuntimeOccupancyGrid } from './runtime'

export interface MapPoint {
  id: string
  name: string
  x: number
  y: number
  saved?: boolean
}

export interface MapObstacle {
  id: string
  x: number
  y: number
  width: number
  height: number
  cornerRadius?: number
}

export interface MapZone {
  id: string
  x: number
  y: number
  width: number
  height: number
  fill: string
  stroke: string
}

export interface MapSceneSnapshot {
  width: number
  height: number
  occupancyGrid?: RuntimeOccupancyGrid
  keepoutMask?: RuntimeOccupancyGrid
  zones: MapZone[]
  obstacles: MapObstacle[]
  routePoints: number[]
  targets: MapPoint[]
  activeTargetId?: string
}

export interface RobotPose {
  x: number
  y: number
  yawRad: number
  rotationDeg: number
  frameId: string
  stamp: number
}

export interface MapLogEntry {
  time: string
  level: LogLevel
  message: string
}

export interface MapTaskState {
  id: string
  name?: string
  type: TaskType
  status: TaskStatus
  feedback: string
  targetPointId?: string
  progressPercent?: number
}

export interface MapDashboardSnapshot {
  connection: ConnectionState
  navigationMode: NavigationMode
  localization: LocalizationStatus
  robot: RobotStatus
  scene: MapSceneSnapshot
  task: MapTaskState
  targets: MapPoint[]
  activeTargetId?: string
  targetDraft?: MapPoint
  robotPose: RobotPose
  robotVisible: boolean
  logs: MapLogEntry[]
}
