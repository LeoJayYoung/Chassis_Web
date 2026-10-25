import type {
  MapDashboardSnapshot,
  MapLogEntry,
  MapObstacle,
  MapPoint,
  MapSceneSnapshot,
  MapZone,
  OverviewDashboardSnapshot,
  OverviewLogLevel,
  OverviewMapSnapshot,
  OverviewTaskStatus,
  RuntimeDashboardSnapshot,
  RuntimeLogEntry,
  RuntimeMapObstacle,
  RuntimeMapPoint,
  RuntimeMapSnapshot,
  RuntimeMapZone,
  RuntimeTaskStatus,
} from '../types'
import {
  rosPointToCanvasPoint,
  rosPoseToCanvasPose,
  rosRectToCanvasRect,
  type RosMapTransform,
} from './mapCoordinates'

function toPercent(value: number, total: number) {
  if (!total) {
    return 0
  }

  return (value / total) * 100
}

function toRosMapTransform(map: RuntimeMapSnapshot): RosMapTransform {
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

function toRoutePoints(
  points: RuntimeDashboardSnapshot['map']['routePoints'],
  transform: RosMapTransform,
) {
  return points.flatMap((point) => {
    const canvasPoint = rosPointToCanvasPoint(point, transform)

    return [canvasPoint.x, canvasPoint.y]
  })
}

function toOverviewTaskStatus(status: RuntimeTaskStatus): OverviewTaskStatus {
  if (status === 'completed') {
    return 'completed'
  }

  if (status === 'idle') {
    return 'queued'
  }

  return status
}

function toOverviewLogLevel(level: RuntimeLogEntry['level']): OverviewLogLevel {
  if (level === 'debug') {
    return 'info'
  }

  return level
}

function toMapLogEntry(log: RuntimeLogEntry): MapLogEntry {
  return {
    time: log.time,
    level: log.level,
    message: log.message,
  }
}

function toMapPoint(point: RuntimeMapPoint, transform: RosMapTransform): MapPoint {
  const canvasPoint = rosPointToCanvasPoint(point, transform)

  return {
    id: point.id,
    name: point.name,
    x: canvasPoint.x,
    y: canvasPoint.y,
    saved: point.saved,
  }
}

function toMapObstacle(obstacle: RuntimeMapObstacle, transform: RosMapTransform): MapObstacle {
  return {
    ...rosRectToCanvasRect(obstacle, transform),
    id: obstacle.id,
    cornerRadius: obstacle.cornerRadius,
  }
}

function toMapZone(zone: RuntimeMapZone, transform: RosMapTransform): MapZone {
  return {
    ...rosRectToCanvasRect(zone, transform),
    id: zone.id,
    fill: zone.fill,
    stroke: zone.stroke,
  }
}

function toMapSceneSnapshot(runtime: RuntimeDashboardSnapshot): MapSceneSnapshot {
  const transform = toRosMapTransform(runtime.map)

  return {
    width: runtime.map.width,
    height: runtime.map.height,
    occupancyGrid: runtime.map.occupancyGrid,
    keepoutMask: runtime.map.keepoutMask,
    zones: runtime.map.zones.map((zone) => toMapZone(zone, transform)),
    obstacles: runtime.map.obstacles.map((obstacle) => toMapObstacle(obstacle, transform)),
    routePoints: toRoutePoints(runtime.map.routePoints, transform),
    targets: runtime.map.targets.map((point) => toMapPoint(point, transform)),
    activeTargetId: runtime.map.activeTargetId,
  }
}

function toOverviewMapSnapshot(runtime: RuntimeDashboardSnapshot): OverviewMapSnapshot {
  const transform = toRosMapTransform(runtime.map)
  const robotPose = rosPoseToCanvasPose(runtime.map.robotPose, transform)

  return {
    name: runtime.map.name,
    occupancyGrid: runtime.map.occupancyGrid,
    keepoutMask: runtime.map.keepoutMask,
    robotVisible: runtime.map.robotPoseReceived !== false,
    robotXPercent: toPercent(robotPose.x, runtime.map.width),
    robotYPercent: toPercent(robotPose.y, runtime.map.height),
    robotYawDeg: robotPose.rotationDeg,
    zones: runtime.map.zones.map((zone) => {
      const canvasZone = rosRectToCanvasRect(zone, transform)

      return {
        id: zone.id,
        xPercent: toPercent(canvasZone.x, runtime.map.width),
        yPercent: toPercent(canvasZone.y, runtime.map.height),
        widthPercent: toPercent(canvasZone.width, runtime.map.width),
        heightPercent: toPercent(canvasZone.height, runtime.map.height),
        fill: zone.fill,
        stroke: zone.stroke,
      }
    }),
    waypoints: runtime.map.targets.map((point) => {
      const canvasPoint = rosPointToCanvasPoint(point, transform)

      return {
        id: point.id,
        label: point.name,
        xPercent: toPercent(canvasPoint.x, runtime.map.width),
        yPercent: toPercent(canvasPoint.y, runtime.map.height),
        done: point.done,
        target: point.id === runtime.map.activeTargetId,
      }
    }),
    obstacles: runtime.map.obstacles.map((obstacle) => {
      const canvasObstacle = rosRectToCanvasRect(obstacle, transform)

      return {
        id: obstacle.id,
        xPercent: toPercent(canvasObstacle.x, runtime.map.width),
        yPercent: toPercent(canvasObstacle.y, runtime.map.height),
        widthPercent: toPercent(canvasObstacle.width, runtime.map.width),
        heightPercent: toPercent(canvasObstacle.height, runtime.map.height),
      }
    }),
  }
}

/**
 * 用当前地图底图 + 指定航点，构造一个概览地图快照，用于路线模板缩略图。
 */
export function routeToOverviewMapSnapshot(
  targets: RuntimeMapPoint[],
  runtime: RuntimeDashboardSnapshot,
): OverviewMapSnapshot {
  const transform = toRosMapTransform(runtime.map)

  return {
    name: runtime.map.name,
    occupancyGrid: runtime.map.occupancyGrid,
    keepoutMask: runtime.map.keepoutMask,
    robotVisible: false,
    robotXPercent: 0,
    robotYPercent: 0,
    robotYawDeg: 0,
    zones: runtime.map.zones.map((zone) => {
      const canvasZone = rosRectToCanvasRect(zone, transform)

      return {
        id: zone.id,
        xPercent: toPercent(canvasZone.x, runtime.map.width),
        yPercent: toPercent(canvasZone.y, runtime.map.height),
        widthPercent: toPercent(canvasZone.width, runtime.map.width),
        heightPercent: toPercent(canvasZone.height, runtime.map.height),
        fill: zone.fill,
        stroke: zone.stroke,
      }
    }),
    waypoints: targets.map((point, index) => {
      const canvasPoint = rosPointToCanvasPoint(point, transform)

      return {
        id: point.id,
        label: point.name,
        xPercent: toPercent(canvasPoint.x, runtime.map.width),
        yPercent: toPercent(canvasPoint.y, runtime.map.height),
        done: false,
        target: index === targets.length - 1,
      }
    }),
    obstacles: runtime.map.obstacles.map((obstacle) => {
      const canvasObstacle = rosRectToCanvasRect(obstacle, transform)

      return {
        id: obstacle.id,
        xPercent: toPercent(canvasObstacle.x, runtime.map.width),
        yPercent: toPercent(canvasObstacle.y, runtime.map.height),
        widthPercent: toPercent(canvasObstacle.width, runtime.map.width),
        heightPercent: toPercent(canvasObstacle.height, runtime.map.height),
      }
    }),
  }
}

export function toMapDashboardSnapshot(runtime: RuntimeDashboardSnapshot): MapDashboardSnapshot {
  const transform = toRosMapTransform(runtime.map)

  return {
    connection: runtime.connection,
    navigationMode: runtime.navigationMode,
    localization: runtime.localization,
    robot: runtime.robot.status,
    scene: toMapSceneSnapshot(runtime),
    task: {
      id: runtime.task.id,
      name: runtime.task.name,
      type: runtime.task.type,
      status: runtime.task.status,
      feedback: runtime.task.feedback,
      targetPointId: runtime.task.targetPointId,
      progressPercent: runtime.task.progressPercent,
    },
    targets: runtime.map.targets.map((point) => toMapPoint(point, transform)),
    activeTargetId: runtime.map.activeTargetId,
    robotPose: rosPoseToCanvasPose(runtime.map.robotPose, transform),
    robotVisible: runtime.map.robotPoseReceived !== false,
    logs: runtime.logs.map(toMapLogEntry),
  }
}

export function toOverviewDashboardSnapshot(
  runtime: RuntimeDashboardSnapshot,
): OverviewDashboardSnapshot {
  const targetPoint = runtime.map.targets.find((point) => point.id === runtime.task.targetPointId)

  return {
    robot: runtime.robot,
    kpi: {
      systemStatus: runtime.systemStatus,
      systemMessage: runtime.systemMessage,
      robotsOnline: runtime.robot.status === 'online' ? 1 : 0,
      robotsTotal: 1,
      currentTask: {
        id: runtime.task.id,
        name: runtime.task.name,
        target: targetPoint?.name ?? '待选择',
        progressPercent: runtime.task.progressPercent,
        etaMinutes: runtime.task.etaMinutes,
        status: toOverviewTaskStatus(runtime.task.status),
      },
      alarms: runtime.alarms,
    },
    map: toOverviewMapSnapshot(runtime),
    taskQueue: runtime.taskRuns.map((task) => ({
      id: task.id,
      name: task.name,
      target: task.targetName ?? '待选择',
      progressPercent: task.progressPercent,
      status: toOverviewTaskStatus(task.status),
    })),
    metrics: runtime.metrics,
    logs: runtime.logs.map((log) => ({
      id: log.id,
      time: log.time,
      level: toOverviewLogLevel(log.level),
      message: log.message,
    })),
  }
}
