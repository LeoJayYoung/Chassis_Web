import type { RuntimeDashboardSnapshot } from '../types'
import {
  canvasPointToRosPoint,
  canvasRectToRosRect,
  type RosMapTransform,
} from '../utils/mapCoordinates'
import { themeColors } from '../utils/theme'

const MAP_WIDTH = 1000
const MAP_HEIGHT = 620
const ROBOT_YAW_RAD = (56 * Math.PI) / 180

const ROS_MAP = {
  frameId: 'map',
  resolution: 0.05,
  widthCells: 1000,
  heightCells: 620,
  originX: -25,
  originY: -15.5,
  originYawRad: 0,
}

const MAP_TRANSFORM: RosMapTransform = {
  canvasWidth: MAP_WIDTH,
  canvasHeight: MAP_HEIGHT,
  ...ROS_MAP,
}

function targetFromCanvas(id: string, name: string, x: number, y: number, done: boolean) {
  return {
    id,
    name,
    ...canvasPointToRosPoint({ x, y }, MAP_TRANSFORM),
    done,
    saved: true,
  }
}

function pathPointFromCanvas(x: number, y: number) {
  return canvasPointToRosPoint({ x, y }, MAP_TRANSFORM)
}

function obstacleFromCanvas(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  cornerRadius: number,
) {
  return {
    id,
    ...canvasRectToRosRect({ x, y, width, height }, MAP_TRANSFORM),
    cornerRadius,
  }
}

function zoneFromCanvas(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
) {
  return {
    id,
    ...canvasRectToRosRect({ x, y, width, height }, MAP_TRANSFORM),
    fill,
    stroke,
  }
}

export const mockRuntimeDashboard: RuntimeDashboardSnapshot = {
  connection: 'connected',
  navigationMode: 'auto_navigation',
  localization: 'ready',
  robot: {
    id: 'AMR-001',
    name: '底盘一号',
    status: 'online',
    batteryPercent: 82,
    signalLabel: '信号稳定',
  },
  systemStatus: 'normal',
  systemMessage: '系统运行正常',
  map: {
    id: 'greenhouse-001',
    name: '实验温室一区',
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    ros: ROS_MAP,
    activeTargetId: 'point-b2',
    robotPose: {
      ...canvasPointToRosPoint({ x: 520, y: 273 }, MAP_TRANSFORM),
      yawRad: ROBOT_YAW_RAD,
      frameId: 'map',
      stamp: 1757172600000,
    },
    targets: [
      targetFromCanvas('point-a1', 'A1', 150, 124, true),
      targetFromCanvas('point-a2', 'A2', 350, 124, true),
      targetFromCanvas('point-b1', 'B1', 350, 341, false),
      targetFromCanvas('point-b2', 'B2', 700, 341, false),
      targetFromCanvas('point-c1', 'C1', 850, 496, false),
    ],
    routePoints: [
      pathPointFromCanvas(150, 124),
      pathPointFromCanvas(350, 124),
      pathPointFromCanvas(350, 341),
      pathPointFromCanvas(700, 341),
      pathPointFromCanvas(850, 496),
    ],
    obstacles: [
      obstacleFromCanvas('obstacle-001', 200, 248, 80, 38, 8),
      obstacleFromCanvas('obstacle-002', 560, 186, 95, 48, 8),
      obstacleFromCanvas('obstacle-003', 380, 434, 58, 34, 8),
      obstacleFromCanvas('obstacle-004', 790, 434, 65, 70, 8),
    ],
    zones: [
      zoneFromCanvas('zone-a', 80, 50, 360, 174, themeColors.surfaceSoft, themeColors.border),
      zoneFromCanvas('zone-b', 80, 260, 280, 198, themeColors.surfaceSoft, themeColors.border),
      zoneFromCanvas('zone-c', 420, 260, 360, 174, themeColors.surfaceSoft, themeColors.border),
      zoneFromCanvas('zone-d', 500, 50, 400, 174, themeColors.surfaceSoft, themeColors.border),
      zoneFromCanvas('zone-e', 80, 496, 840, 74, themeColors.surfaceSoft, themeColors.border),
    ],
  },
  task: {
    id: 'TASK-0042',
    name: '温室巡检',
    type: 'single_point_navigation',
    status: 'running',
    feedback: '正在前往目标点 B2',
    targetPointId: 'point-b2',
    progressPercent: 67,
    etaMinutes: 4,
  },
  tasks: [
    {
      id: 'TASK-0041',
      name: '充电',
      targetName: 'Dock Station B-12',
      type: 'single_point_navigation',
      status: 'completed',
      targetPointId: 'point-a1',
      createdTime: '2026-09-09 08:14:22',
      completedTime: '2026-09-09 08:51:04',
      progressPercent: 100,
      etaMinutes: 0,
      feedback: '充电完成，电量已恢复至 98%。',
      timeline: [
        { status: 'created', timestamp: '2026-09-09 08:14:22' },
        { status: 'running', timestamp: '2026-09-09 08:15:01' },
        { status: 'completed', timestamp: '2026-09-09 08:51:04', note: 'Battery 98%' },
      ],
    },
    {
      id: 'TASK-0042',
      name: '温室巡检',
      targetName: 'Greenhouse B2',
      type: 'single_point_navigation',
      status: 'running',
      targetPointId: 'point-b2',
      createdTime: '2026-09-09 09:02:10',
      completedTime: null,
      progressPercent: 67,
      etaMinutes: 4,
      feedback: '正在前往目标点 B2，局部路径跟踪稳定。',
      timeline: [
        { status: 'created', timestamp: '2026-09-09 09:02:10' },
        { status: 'running', timestamp: '2026-09-09 09:03:45' },
      ],
    },
    {
      id: 'TASK-0043',
      name: '导航',
      targetName: 'Sampling Point A1',
      type: 'single_point_navigation',
      status: 'paused',
      targetPointId: 'point-a1',
      createdTime: '2026-09-09 09:30:00',
      completedTime: null,
      progressPercent: 42,
      etaMinutes: 8,
      feedback: '任务已由操作员暂停。',
      timeline: [
        { status: 'created', timestamp: '2026-09-09 09:30:00' },
        { status: 'running', timestamp: '2026-09-09 09:31:22' },
        { status: 'paused', timestamp: '2026-09-09 09:45:17', note: 'Manual pause' },
      ],
    },
    {
      id: 'TASK-0044',
      name: '配送',
      targetName: 'Exit Gate E-01',
      type: 'single_point_navigation',
      status: 'failed',
      createdTime: '2026-09-09 10:00:00',
      completedTime: '2026-09-09 10:14:33',
      progressPercent: 31,
      etaMinutes: 0,
      feedback: '任务在 3 次导航尝试失败后终止。',
      failureReason: '检测到坐标 (12.4, 7.1) 处存在障碍物，自动重试次数已用尽。',
      timeline: [
        { status: 'created', timestamp: '2026-09-09 10:00:00' },
        { status: 'running', timestamp: '2026-09-09 10:01:05' },
        { status: 'retried', timestamp: '2026-09-09 10:05:11', note: 'Attempt 2' },
        { status: 'retried', timestamp: '2026-09-09 10:09:44', note: 'Attempt 3' },
        { status: 'failed', timestamp: '2026-09-09 10:14:33', note: 'Obstacle unresolved' },
      ],
    },
    {
      id: 'TASK-0045',
      name: '建图',
      targetName: 'Zone Alpha-4',
      type: 'multi_point_cruise',
      status: 'idle',
      createdTime: '2026-09-09 10:25:00',
      completedTime: null,
      progressPercent: 0,
      etaMinutes: 12,
      timeline: [{ status: 'created', timestamp: '2026-09-09 10:25:00' }],
    },
    {
      id: 'TASK-0046',
      name: '取货',
      targetName: 'Conveyor Hub 2',
      type: 'single_point_navigation',
      status: 'idle',
      createdTime: '2026-09-09 10:40:00',
      completedTime: null,
      progressPercent: 0,
      etaMinutes: 10,
      timeline: [{ status: 'created', timestamp: '2026-09-09 10:40:00' }],
    },
  ],
  alarms: {
    total: 0,
    critical: 0,
    warning: 0,
  },
  metrics: [
    {
      id: 'forward-speed',
      label: '前进速度',
      value: '0.8',
      unit: 'm/s',
      percent: 40,
      status: 'normal',
    },
    {
      id: 'turning-speed',
      label: '转向速度',
      value: '0.12',
      unit: 'rad/s',
      percent: 24,
      status: 'normal',
    },
    { id: 'motor-load', label: '电机负载', value: '36', unit: '%', percent: 36, status: 'normal' },
    { id: 'link-delay', label: '通信延迟', value: '18', unit: 'ms', percent: 18, status: 'normal' },
  ],
  logs: [],
}
