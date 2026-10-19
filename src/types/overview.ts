export type OverviewHealthStatus = 'normal' | 'warning' | 'error'

export type OverviewTaskStatus = 'running' | 'queued' | 'paused' | 'completed' | 'failed' | 'canceled'

export type OverviewLogLevel = 'info' | 'warn' | 'error'

import type { RuntimeOccupancyGrid } from './runtime'

export interface OverviewRobotSummary {
  id: string
  name: string
  status: 'online' | 'offline'
  batteryPercent: number
  signalLabel: string
}

export interface OverviewCurrentTask {
  id: string
  name: string
  target: string
  progressPercent: number
  etaMinutes: number
  status: OverviewTaskStatus
}

export interface OverviewAlarmSummary {
  total: number
  critical: number
  warning: number
}

export interface OverviewKpiSnapshot {
  systemStatus: OverviewHealthStatus
  systemMessage: string
  robotsOnline: number
  robotsTotal: number
  currentTask: OverviewCurrentTask
  alarms: OverviewAlarmSummary
}

export interface OverviewWaypoint {
  id: string
  label: string
  xPercent: number
  yPercent: number
  done: boolean
  target?: boolean
}

export interface OverviewObstacle {
  id: string
  xPercent: number
  yPercent: number
  widthPercent: number
  heightPercent: number
}

export interface OverviewMapZone {
  id: string
  xPercent: number
  yPercent: number
  widthPercent: number
  heightPercent: number
  fill: string
  stroke: string
}

export interface OverviewMapSnapshot {
  name: string
  occupancyGrid?: RuntimeOccupancyGrid
  robotVisible: boolean
  robotXPercent: number
  robotYPercent: number
  robotYawDeg: number
  zones: OverviewMapZone[]
  waypoints: OverviewWaypoint[]
  obstacles: OverviewObstacle[]
}

export interface OverviewMetricItem {
  id: string
  label: string
  value: string
  unit: string
  percent: number
  status: OverviewHealthStatus
}

export interface OverviewTaskQueueItem {
  id: string
  name: string
  target: string
  progressPercent: number
  status: OverviewTaskStatus
}

export interface OverviewLogEntry {
  id: string
  time: string
  level: OverviewLogLevel
  message: string
}

export interface OverviewDashboardSnapshot {
  robot: OverviewRobotSummary
  kpi: OverviewKpiSnapshot
  map: OverviewMapSnapshot
  taskQueue: OverviewTaskQueueItem[]
  metrics: OverviewMetricItem[]
  logs: OverviewLogEntry[]
}
