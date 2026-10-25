<script setup lang="ts">
import Konva from 'konva'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { OverviewMapSnapshot, RuntimeOccupancyGrid } from '../../types'
import {
  occupancyGridToCanvasOverlay,
  type RosMapTransform,
} from '../../utils/mapCoordinates'
import {
  filterOccupancyNoise,
  occupancyVisualFilterConfig,
  occupancyVisualFilterKey,
} from '../../utils/occupancyGridFilter'
import { themeColors } from '../../utils/theme'

const BASE_WIDTH = 1000
const BASE_HEIGHT = 620
const GRID_STEP = 125
const MIN_SCALE = 0.001

const props = defineProps<{
  snapshot: OverviewMapSnapshot
  // 为 true 时把视野收缩到航点包围盒，用于路线缩略图（自动放大到路线范围）
  focusWaypoints?: boolean
}>()

const stageHost = ref<HTMLDivElement | null>(null)

let stage: Konva.Stage | null = null
let layer: Konva.Layer | null = null
let contentGroup: Konva.Group | null = null
let resizeObserver: ResizeObserver | null = null
let occupancyRasterCache: {
  key: string
  canvas: HTMLCanvasElement
} | null = null
let keepoutRasterCache: {
  key: string
  canvas: HTMLCanvasElement
} | null = null

function toX(percent: number) {
  return (percent / 100) * sceneWidth()
}

function toY(percent: number) {
  return (percent / 100) * sceneHeight()
}

function sceneWidth() {
  return props.snapshot.occupancyGrid?.widthCells ?? BASE_WIDTH
}

function sceneHeight() {
  return props.snapshot.occupancyGrid?.heightCells ?? BASE_HEIGHT
}

let renderScale = 1

function contentScale() {
  return renderScale
}

function visualSize(pixelSize: number) {
  return pixelSize / contentScale()
}

function waypointPoints() {
  const points: number[] = []

  for (const waypoint of props.snapshot.waypoints) {
    points.push(toX(waypoint.xPercent), toY(waypoint.yPercent))
  }

  return points
}

function completedWaypointPoints() {
  const points: number[] = []

  for (const waypoint of props.snapshot.waypoints.filter((item) => item.done)) {
    points.push(toX(waypoint.xPercent), toY(waypoint.yPercent))
  }

  return points
}

function occupancyRasterKey(grid: RuntimeOccupancyGrid) {
  return [
    grid.stamp,
    grid.widthCells,
    grid.heightCells,
    grid.resolution,
    grid.originX,
    grid.originY,
    grid.originYawRad,
    occupancyVisualFilterKey(),
  ].join(':')
}

function occupancyColor(value: number): [number, number, number] {
  if (value < 0) {
    return [156, 163, 175]
  }

  const occupancy = Math.min(Math.max(value, 0), 100) / 100
  const shade = Math.round(255 - occupancy * 255)

  return [shade, shade, shade]
}

function createOccupancyRaster(grid: RuntimeOccupancyGrid) {
  const key = occupancyRasterKey(grid)

  if (occupancyRasterCache?.key === key) {
    return occupancyRasterCache.canvas
  }

  const canvas = document.createElement('canvas')
  canvas.width = grid.widthCells
  canvas.height = grid.heightCells

  const context = canvas.getContext('2d')

  if (!context) {
    return canvas
  }

  const imageData = context.createImageData(grid.widthCells, grid.heightCells)
  const displayData = filterOccupancyNoise(
    grid.data,
    grid.widthCells,
    grid.heightCells,
    occupancyVisualFilterConfig,
  )

  for (let mapRow = 0; mapRow < grid.heightCells; mapRow += 1) {
    const canvasRow = grid.heightCells - 1 - mapRow

    for (let column = 0; column < grid.widthCells; column += 1) {
      const value = displayData[mapRow * grid.widthCells + column] ?? -1
      const [red, green, blue] = occupancyColor(value)
      const pixelIndex = (canvasRow * grid.widthCells + column) * 4

      imageData.data.set([red, green, blue, 255], pixelIndex)
    }
  }

  context.putImageData(imageData, 0, 0)
  occupancyRasterCache = { key, canvas }

  return canvas
}

function addOccupancyGrid(group: Konva.Group) {
  const occupancyGrid = props.snapshot.occupancyGrid

  if (!occupancyGrid) return false

  group.add(
    new Konva.Image({
      image: createOccupancyRaster(occupancyGrid),
      x: 0,
      y: 0,
      width: sceneWidth(),
      height: sceneHeight(),
      imageSmoothingEnabled: false,
      listening: false,
    }),
  )

  return true
}

function keepoutRasterKey(grid: RuntimeOccupancyGrid) {
  return [
    grid.stamp,
    grid.widthCells,
    grid.heightCells,
    grid.resolution,
    grid.originX,
    grid.originY,
    grid.originYawRad,
  ].join(':')
}

function createKeepoutRaster(grid: RuntimeOccupancyGrid) {
  const key = keepoutRasterKey(grid)

  if (keepoutRasterCache?.key === key) {
    return keepoutRasterCache.canvas
  }

  const canvas = document.createElement('canvas')
  canvas.width = grid.widthCells
  canvas.height = grid.heightCells

  const context = canvas.getContext('2d')

  if (!context) return canvas

  const imageData = context.createImageData(grid.widthCells, grid.heightCells)

  for (let mapRow = 0; mapRow < grid.heightCells; mapRow += 1) {
    const canvasRow = grid.heightCells - 1 - mapRow

    for (let column = 0; column < grid.widthCells; column += 1) {
      const value = grid.data[mapRow * grid.widthCells + column] ?? -1
      const pixelIndex = (canvasRow * grid.widthCells + column) * 4

      if (value <= 0) {
        imageData.data.set([0, 0, 0, 0], pixelIndex)
        continue
      }

      const strength = Math.min(Math.max(value, 0), 100) / 100
      imageData.data.set(
        [244, 114, 182, Math.round(82 + strength * 76)],
        pixelIndex,
      )
    }
  }

  context.putImageData(imageData, 0, 0)
  keepoutRasterCache = { key, canvas }

  return canvas
}

function addKeepoutMask(group: Konva.Group) {
  const baseGrid = props.snapshot.occupancyGrid
  const keepoutMask = props.snapshot.keepoutMask

  if (!baseGrid || !keepoutMask) return
  if (
    baseGrid.frameId &&
    keepoutMask.frameId &&
    baseGrid.frameId !== keepoutMask.frameId
  ) {
    return
  }

  const transform: RosMapTransform = {
    canvasWidth: sceneWidth(),
    canvasHeight: sceneHeight(),
    widthCells: baseGrid.widthCells,
    heightCells: baseGrid.heightCells,
    resolution: baseGrid.resolution,
    originX: baseGrid.originX,
    originY: baseGrid.originY,
    originYawRad: baseGrid.originYawRad,
  }
  const placement = occupancyGridToCanvasOverlay(keepoutMask, transform)

  group.add(
    new Konva.Image({
      image: createKeepoutRaster(keepoutMask),
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotation: placement.rotationDeg,
      imageSmoothingEnabled: false,
      listening: false,
    }),
  )
}

function addGrid(group: Konva.Group) {
  const width = sceneWidth()
  const height = sceneHeight()

  for (let x = 0; x <= width; x += GRID_STEP) {
    group.add(
      new Konva.Line({
        points: [x, 0, x, height],
        stroke: themeColors.border,
        strokeWidth: 2,
        listening: false,
      }),
    )
  }

  for (let y = 0; y <= height; y += GRID_STEP) {
    group.add(
      new Konva.Line({
        points: [0, y, width, y],
        stroke: themeColors.border,
        strokeWidth: 2,
        listening: false,
      }),
    )
  }
}

function addZone(
  group: Konva.Group,
  zone: {
    x: number
    y: number
    width: number
    height: number
    fill: string
    stroke: string
  },
) {
  group.add(
    new Konva.Rect({
      x: toX(zone.x),
      y: toY(zone.y),
      width: toX(zone.width),
      height: toY(zone.height),
      cornerRadius: 10,
      fill: zone.fill,
      stroke: zone.stroke,
      strokeWidth: 3,
      listening: false,
    }),
  )
}

function addZones(group: Konva.Group) {
  for (const zone of props.snapshot.zones) {
    addZone(group, {
      x: zone.xPercent,
      y: zone.yPercent,
      width: zone.widthPercent,
      height: zone.heightPercent,
      fill: zone.fill,
      stroke: zone.stroke,
    })
  }
}

function addObstacles(group: Konva.Group) {
  for (const obstacle of props.snapshot.obstacles) {
    group.add(
      new Konva.Rect({
        x: toX(obstacle.xPercent),
        y: toY(obstacle.yPercent),
        width: toX(obstacle.widthPercent),
        height: toY(obstacle.heightPercent),
        cornerRadius: 8,
        fill: themeColors.neutral,
        opacity: 0.48,
        listening: false,
      }),
    )
  }
}

function addPath(group: Konva.Group) {
  const planned = waypointPoints()
  const completed = completedWaypointPoints()
  const pathStroke = visualSize(3)

  if (planned.length >= 4) {
    group.add(
      new Konva.Line({
        points: planned,
        stroke: themeColors.primary,
        strokeWidth: pathStroke,
        dash: [visualSize(8), visualSize(7)],
        lineCap: 'round',
        lineJoin: 'round',
        strokeScaleEnabled: false,
        listening: false,
      }),
    )
  }

  if (completed.length >= 4) {
    group.add(
      new Konva.Line({
        points: completed,
        stroke: themeColors.sidebar,
        strokeWidth: pathStroke + visualSize(1),
        lineCap: 'round',
        lineJoin: 'round',
        strokeScaleEnabled: false,
        listening: false,
      }),
    )
  }
}

function addWaypoints(group: Konva.Group) {
  const targetRingRadius = visualSize(10)
  const targetRadius = visualSize(6)
  const waypointRadius = visualSize(4)
  const waypointStroke = visualSize(2)
  const labelOffsetX = visualSize(9)
  const labelOffsetY = visualSize(-16)
  const labelFontSize = visualSize(11)

  for (const waypoint of props.snapshot.waypoints) {
    const pointGroup = new Konva.Group({
      x: toX(waypoint.xPercent),
      y: toY(waypoint.yPercent),
      listening: false,
    })

    if (waypoint.target) {
      pointGroup.add(
        new Konva.Circle({
          radius: targetRingRadius,
          fill: 'transparent',
          stroke: themeColors.primary,
          strokeWidth: waypointStroke,
          dash: [visualSize(5), visualSize(4)],
          strokeScaleEnabled: false,
        }),
      )
    }

    pointGroup.add(
      new Konva.Circle({
        radius: waypoint.target ? targetRadius : waypointRadius,
        fill: waypoint.done ? themeColors.sidebar : waypoint.target ? themeColors.primary : themeColors.subtle,
        stroke: themeColors.card,
        strokeWidth: waypointStroke,
        strokeScaleEnabled: false,
      }),
    )

    pointGroup.add(
      new Konva.Text({
        x: labelOffsetX,
        y: labelOffsetY,
        text: waypoint.label,
        fill: themeColors.muted,
        fontSize: labelFontSize,
        fontStyle: '600',
        listening: false,
      }),
    )

    group.add(pointGroup)
  }
}

function addRobot(group: Konva.Group) {
  const shellRadius = visualSize(12)
  const haloRadius = visualSize(18)
  const coreRadius = visualSize(6)
  const headingLength = visualSize(22)
  const headingStroke = visualSize(2.5)
  const headingTipRadius = visualSize(5)

  const robot = new Konva.Group({
    x: toX(props.snapshot.robotXPercent),
    y: toY(props.snapshot.robotYPercent),
    rotation: props.snapshot.robotYawDeg,
    listening: false,
  })

  robot.add(
    new Konva.Circle({
      radius: shellRadius,
      fill: themeColors.card,
      stroke: themeColors.sidebar,
      strokeWidth: visualSize(2),
      strokeScaleEnabled: false,
    }),
  )

  robot.add(
    new Konva.Circle({
      radius: haloRadius,
      fill: themeColors.primary,
      opacity: 0.18,
    }),
  )

  robot.add(
    new Konva.Circle({
      radius: coreRadius,
      fill: themeColors.sidebar,
    }),
  )

  robot.add(
    new Konva.Line({
      points: [0, 0, 0, -headingLength],
      stroke: themeColors.primary,
      strokeWidth: headingStroke,
      lineCap: 'round',
      strokeScaleEnabled: false,
    }),
  )

  robot.add(
    new Konva.RegularPolygon({
      x: 0,
      y: -headingLength - visualSize(4),
      sides: 3,
      radius: headingTipRadius,
      fill: themeColors.primary,
      rotation: 0,
    }),
  )

  group.add(robot)
}

function drawScene() {
  if (!layer) return

  layer.destroyChildren()

  // 先按视野范围算出渲染缩放，再画（让航点/标签尺寸保持屏幕像素级一致）
  const hostWidth = stageHost.value?.clientWidth ?? 0
  const hostHeight = stageHost.value?.clientHeight ?? 0
  const bounds = viewBounds()

  renderScale =
    hostWidth && hostHeight
      ? Math.max(
          Math.min(hostWidth / bounds.width, hostHeight / bounds.height),
          MIN_SCALE,
        )
      : 1

  const group = new Konva.Group()
  contentGroup = group

  const hasOccupancyGrid = addOccupancyGrid(group)

  if (!hasOccupancyGrid) {
    group.add(
      new Konva.Rect({
        x: 0,
        y: 0,
        width: sceneWidth(),
        height: sceneHeight(),
        fill: themeColors.surfaceSoft,
        listening: false,
      }),
    )

    addGrid(group)
    addZones(group)
    addObstacles(group)
  }

  addKeepoutMask(group)
  addPath(group)
  addWaypoints(group)

  if (props.snapshot.robotVisible) {
    addRobot(group)
  }

  layer.add(group)
  layoutStage()
}

function viewBounds() {
  const width = sceneWidth()
  const height = sceneHeight()
  const whole = { x: 0, y: 0, width, height }

  if (!props.focusWaypoints || props.snapshot.waypoints.length === 0) {
    return whole
  }

  const xs = props.snapshot.waypoints.map((waypoint) => (waypoint.xPercent / 100) * width)
  const ys = props.snapshot.waypoints.map((waypoint) => (waypoint.yPercent / 100) * height)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  // 保证最小视野范围：单点路线也能看到周边地图，不会缩成一个点
  const viewWidth = Math.min(width, Math.max((maxX - minX) * 1.8, width * 0.35))
  const viewHeight = Math.min(height, Math.max((maxY - minY) * 1.8, height * 0.35))
  const x = Math.max(0, Math.min(width - viewWidth, centerX - viewWidth / 2))
  const y = Math.max(0, Math.min(height - viewHeight, centerY - viewHeight / 2))

  return {
    x,
    y,
    width: Math.max(viewWidth, 1),
    height: Math.max(viewHeight, 1),
  }
}

function layoutStage() {
  if (!stage || !layer || !contentGroup || !stageHost.value) return

  const width = stageHost.value.clientWidth
  const height = stageHost.value.clientHeight

  if (!width || !height) return

  stage.size({ width, height })

  const bounds = viewBounds()
  const scale = renderScale
  const contentWidth = bounds.width * scale
  const contentHeight = bounds.height * scale

  contentGroup.position({
    x: (width - contentWidth) / 2 - bounds.x * scale,
    y: (height - contentHeight) / 2 - bounds.y * scale,
  })
  contentGroup.scale({ x: scale, y: scale })

  layer.batchDraw()
}

function mountKonva() {
  if (!stageHost.value) return

  stage?.destroy()
  stage = new Konva.Stage({
    container: stageHost.value,
    width: stageHost.value.clientWidth,
    height: stageHost.value.clientHeight,
  })

  layer = new Konva.Layer()
  stage.add(layer)

  drawScene()
}

watch(
  () => props.snapshot,
  () => {
    drawScene()
  },
  { deep: true },
)

onMounted(() => {
  mountKonva()

  if (!stageHost.value) return

  resizeObserver = new ResizeObserver(() => {
    drawScene()
  })
  resizeObserver.observe(stageHost.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  occupancyRasterCache = null
  keepoutRasterCache = null
  stage?.destroy()
  stage = null
  layer = null
  contentGroup = null
})
</script>

<template>
  <div ref="stageHost" class="overview-map-snapshot" aria-label="Map Snapshot"></div>
</template>

<style scoped>
.overview-map-snapshot {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
