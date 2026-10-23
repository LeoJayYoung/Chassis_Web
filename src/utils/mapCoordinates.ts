export interface RosMapTransform {
  canvasWidth: number
  canvasHeight: number
  widthCells: number
  heightCells: number
  resolution: number
  originX: number
  originY: number
  originYawRad: number
}

export interface Point2D {
  x: number
  y: number
}

export interface Rect2D extends Point2D {
  width: number
  height: number
}

export interface RosPose2D extends Point2D {
  yawRad: number
  frameId: string
  stamp: number
}

export interface CanvasPose2D extends Point2D {
  yawRad: number
  rotationDeg: number
  frameId: string
  stamp: number
}

export interface OccupancyGridGeometry {
  resolution: number
  widthCells: number
  heightCells: number
  originX: number
  originY: number
  originYawRad: number
}

export interface CanvasGridOverlayTransform extends Point2D {
  width: number
  height: number
  rotationDeg: number
}

function radToDeg(rad: number) {
  return (rad * 180) / Math.PI
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180
}

function normalizeDeg(deg: number) {
  return ((deg % 360) + 360) % 360
}

function boundsFromPoints(points: Point2D[]): Rect2D {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function rosPointToCanvasPoint(point: Point2D, transform: RosMapTransform): Point2D {
  const dx = point.x - transform.originX
  const dy = point.y - transform.originY
  const cos = Math.cos(-transform.originYawRad)
  const sin = Math.sin(-transform.originYawRad)
  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos
  const cellX = localX / transform.resolution
  const cellY = localY / transform.resolution

  return {
    x: (cellX / transform.widthCells) * transform.canvasWidth,
    y: transform.canvasHeight - (cellY / transform.heightCells) * transform.canvasHeight,
  }
}

export function canvasPointToRosPoint(point: Point2D, transform: RosMapTransform): Point2D {
  const cellX = (point.x / transform.canvasWidth) * transform.widthCells
  const cellY = ((transform.canvasHeight - point.y) / transform.canvasHeight) * transform.heightCells
  const localX = cellX * transform.resolution
  const localY = cellY * transform.resolution
  const cos = Math.cos(transform.originYawRad)
  const sin = Math.sin(transform.originYawRad)

  return {
    x: transform.originX + localX * cos - localY * sin,
    y: transform.originY + localX * sin + localY * cos,
  }
}

export function rosYawToCanvasRotationDeg(yawRad: number, transform: RosMapTransform) {
  const localYawDeg = radToDeg(yawRad - transform.originYawRad)

  return normalizeDeg(90 - localYawDeg)
}

export function canvasRotationDegToRosYawRad(rotationDeg: number, transform: RosMapTransform) {
  const localYawDeg = 90 - rotationDeg

  return degToRad(localYawDeg) + transform.originYawRad
}

export function rosPoseToCanvasPose(pose: RosPose2D, transform: RosMapTransform): CanvasPose2D {
  const point = rosPointToCanvasPoint(pose, transform)
  const rotationDeg = rosYawToCanvasRotationDeg(pose.yawRad, transform)

  return {
    x: point.x,
    y: point.y,
    yawRad: degToRad(rotationDeg),
    rotationDeg,
    frameId: pose.frameId,
    stamp: pose.stamp,
  }
}

export function canvasPoseToRosPose(pose: CanvasPose2D, transform: RosMapTransform): RosPose2D {
  const point = canvasPointToRosPoint(pose, transform)

  return {
    x: point.x,
    y: point.y,
    yawRad: canvasRotationDegToRosYawRad(pose.rotationDeg, transform),
    frameId: pose.frameId,
    stamp: pose.stamp,
  }
}

export function rosRectToCanvasRect(rect: Rect2D, transform: RosMapTransform): Rect2D {
  return boundsFromPoints([
    rosPointToCanvasPoint({ x: rect.x, y: rect.y }, transform),
    rosPointToCanvasPoint({ x: rect.x + rect.width, y: rect.y }, transform),
    rosPointToCanvasPoint({ x: rect.x, y: rect.y + rect.height }, transform),
    rosPointToCanvasPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, transform),
  ])
}

export function canvasRectToRosRect(rect: Rect2D, transform: RosMapTransform): Rect2D {
  return boundsFromPoints([
    canvasPointToRosPoint({ x: rect.x, y: rect.y }, transform),
    canvasPointToRosPoint({ x: rect.x + rect.width, y: rect.y }, transform),
    canvasPointToRosPoint({ x: rect.x, y: rect.y + rect.height }, transform),
    canvasPointToRosPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, transform),
  ])
}

export function occupancyGridToCanvasOverlay(
  grid: OccupancyGridGeometry,
  transform: RosMapTransform,
): CanvasGridOverlayTransform {
  const widthMeters = grid.widthCells * grid.resolution
  const heightMeters = grid.heightCells * grid.resolution
  const cos = Math.cos(grid.originYawRad)
  const sin = Math.sin(grid.originYawRad)
  const localToRos = (localX: number, localY: number) => ({
    x: grid.originX + localX * cos - localY * sin,
    y: grid.originY + localX * sin + localY * cos,
  })
  const topLeft = rosPointToCanvasPoint(
    localToRos(0, heightMeters),
    transform,
  )
  const topRight = rosPointToCanvasPoint(
    localToRos(widthMeters, heightMeters),
    transform,
  )
  const bottomLeft = rosPointToCanvasPoint(localToRos(0, 0), transform)

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y),
    height: Math.hypot(
      bottomLeft.x - topLeft.x,
      bottomLeft.y - topLeft.y,
    ),
    rotationDeg: radToDeg(
      Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x),
    ),
  }
}
