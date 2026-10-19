<script setup lang="ts">
import Konva from 'konva'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  MapPoint,
  MapSceneSnapshot,
  RobotPose,
  RuntimeOccupancyGrid,
} from '../../types'
import type { Point2D } from '../../utils/mapCoordinates'
import { themeColors } from '../../utils/theme'

const DEFAULT_MAP_WIDTH = 1000
const DEFAULT_MAP_HEIGHT = 620
const GRID_STEP = 48
const ZOOM_STEP = 1.18
const MIN_ZOOM_RATIO = 0.7
const MAX_ZOOM_RATIO = 3.5

const props = defineProps<{
  robotPose: RobotPose
  scene: MapSceneSnapshot
  selectionMode?: boolean
  draftTarget?: MapPoint
  showRobot?: boolean
}>()

const emit = defineEmits<{
  (event: 'target-select', targetId: string): void
  (event: 'map-click', point: Point2D): void
}>()

const stageHost = ref<HTMLDivElement | null>(null)
const zoomPercent = ref(100)
const isDragging = ref(false)

let stage: Konva.Stage | null = null
let layer: Konva.Layer | null = null
let contentGroup: Konva.Group | null = null
let resizeObserver: ResizeObserver | null = null
let fitScale = 1
let currentScale = 1
let currentPosition = { x: 0, y: 0 }
let isViewInitialized = false
let lastPanPoint: { x: number; y: number } | null = null
let hasPanned = false
let occupancyRasterCache: {
  key: string
  canvas: HTMLCanvasElement
} | null = null

function mapWidth() {
  return props.scene.width || DEFAULT_MAP_WIDTH
}

function mapHeight() {
  return props.scene.height || DEFAULT_MAP_HEIGHT
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function minZoomScale() {
  return fitScale * MIN_ZOOM_RATIO
}

function maxZoomScale() {
  return fitScale * MAX_ZOOM_RATIO
}

function mapSymbolScale() {
  return clamp(Math.min(mapWidth(), mapHeight()) / 620, 0.12, 1)
}

function updateZoomPercent() {
  zoomPercent.value = fitScale ? Math.round((currentScale / fitScale) * 100) : 100
}

function applyViewTransform() {
  if (!contentGroup || !layer) return

  contentGroup.position(currentPosition)
  contentGroup.scale({ x: currentScale, y: currentScale })
  updateZoomPercent()
  layer.batchDraw()
}

function stageCenter() {
  if (!stage) {
    return { x: 0, y: 0 }
  }

  return {
    x: stage.width() / 2,
    y: stage.height() / 2,
  }
}

function zoomAtPoint(nextScale: number, anchor: { x: number; y: number }) {
  if (!contentGroup || !currentScale) return

  const scale = clamp(nextScale, minZoomScale(), maxZoomScale())
  const localPoint = {
    x: (anchor.x - currentPosition.x) / currentScale,
    y: (anchor.y - currentPosition.y) / currentScale,
  }

  currentScale = scale
  currentPosition = {
    x: anchor.x - localPoint.x * scale,
    y: anchor.y - localPoint.y * scale,
  }

  applyViewTransform()
}

function zoomIn() {
  zoomAtPoint(currentScale * ZOOM_STEP, stageCenter())
}

function zoomOut() {
  zoomAtPoint(currentScale / ZOOM_STEP, stageCenter())
}

function resetView() {
  layoutStage(true)
}

function focusRobot() {
  if (!stage) return

  currentPosition = {
    x: stage.width() / 2 - props.robotPose.x * currentScale,
    y: stage.height() / 2 - props.robotPose.y * currentScale,
  }

  applyViewTransform()
}

function handleWheel(event: Konva.KonvaEventObject<WheelEvent>) {
  event.evt.preventDefault()

  if (!stage) return

  const pointer = stage.getPointerPosition()

  if (!pointer) return

  const nextScale = event.evt.deltaY > 0 ? currentScale / ZOOM_STEP : currentScale * ZOOM_STEP

  zoomAtPoint(nextScale, pointer)
}

function beginPan(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
  if (event.evt instanceof MouseEvent && event.evt.button !== 0) return
  if (!stage) return

  event.evt.preventDefault()
  lastPanPoint = stage.getPointerPosition()
  hasPanned = false
  isDragging.value = Boolean(lastPanPoint)
}

function movePan(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
  if (!stage || !lastPanPoint) return

  event.evt.preventDefault()

  const pointer = stage.getPointerPosition()

  if (!pointer) return

  if (Math.hypot(pointer.x - lastPanPoint.x, pointer.y - lastPanPoint.y) > 3) {
    hasPanned = true
  }

  currentPosition = {
    x: currentPosition.x + pointer.x - lastPanPoint.x,
    y: currentPosition.y + pointer.y - lastPanPoint.y,
  }
  lastPanPoint = pointer

  applyViewTransform()
}

function endPan() {
  lastPanPoint = null
  isDragging.value = false
}

function scenePointFromPointer() {
  if (!stage) return null

  const pointer = stage.getPointerPosition()
  if (!pointer || !currentScale) return null

  return {
    x: Math.min(Math.max((pointer.x - currentPosition.x) / currentScale, 0), mapWidth()),
    y: Math.min(Math.max((pointer.y - currentPosition.y) / currentScale, 0), mapHeight()),
  }
}

function handleSceneClick(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
  if (!props.selectionMode || hasPanned) {
    hasPanned = false
    return
  }

  if (event.target !== event.currentTarget && event.target.name() !== 'map-background') return

  const point = scenePointFromPointer()
  if (point) {
    emit('map-click', point)
  }
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
  ].join(':')
}

function occupancyColor(value: number): [number, number, number] {
  if (value < 0) {
    return [156, 163, 175]
  }

  const occupancy = clamp(value, 0, 100) / 100
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

  /*
   * OccupancyGrid rows start at the map origin (bottom-left in ROS map
   * coordinates), while an HTML canvas starts at the top-left. Flip the row
   * index here so the bitmap aligns with robot and path coordinates.
   */
  for (let mapRow = 0; mapRow < grid.heightCells; mapRow += 1) {
    const canvasRow = grid.heightCells - 1 - mapRow

    for (let column = 0; column < grid.widthCells; column += 1) {
      const value = grid.data[mapRow * grid.widthCells + column] ?? -1
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
  const occupancyGrid = props.scene.occupancyGrid

  if (!occupancyGrid) {
    return false
  }

  group.add(
    new Konva.Image({
      name: 'map-background',
      image: createOccupancyRaster(occupancyGrid),
      x: 0,
      y: 0,
      width: mapWidth(),
      height: mapHeight(),
      imageSmoothingEnabled: false,
      listening: true,
    }),
  )

  return true
}

function addGrid(group: Konva.Group) {
  const width = mapWidth()
  const height = mapHeight()

  for (let x = 0; x <= width; x += GRID_STEP) {
    group.add(
      new Konva.Line({
        points: [x, 0, x, height],
        stroke: 'rgba(229, 231, 235, 0.92)',
        strokeWidth: 1,
        listening: false,
      }),
    )
  }

  for (let y = 0; y <= height; y += GRID_STEP) {
    group.add(
      new Konva.Line({
        points: [0, y, width, y],
        stroke: 'rgba(229, 231, 235, 0.92)',
        strokeWidth: 1,
        listening: false,
      }),
    )
  }
}

function addObstacles(group: Konva.Group) {
  for (const obstacle of props.scene.obstacles) {
    group.add(
      new Konva.Rect({
        x: obstacle.x,
        y: obstacle.y,
        width: obstacle.width,
        height: obstacle.height,
        cornerRadius: obstacle.cornerRadius ?? 14,
        fill: 'rgba(31, 41, 55, 0.08)',
        listening: false,
      }),
    )
  }
}

function addZones(group: Konva.Group) {
  for (const zone of props.scene.zones) {
    group.add(
      new Konva.Rect({
        x: zone.x,
        y: zone.y,
        width: zone.width,
        height: zone.height,
        cornerRadius: 10,
        fill: zone.fill,
        stroke: zone.stroke,
        strokeWidth: 3,
        listening: false,
      }),
    )
  }
}

function addRoute(group: Konva.Group) {
  group.add(
    new Konva.Line({
      points: props.scene.routePoints,
      stroke: themeColors.sidebar,
      strokeWidth: 7,
      lineCap: 'round',
      lineJoin: 'round',
      shadowColor: 'rgba(11, 59, 46, 0.18)',
      shadowBlur: 10,
      shadowOffsetY: 4,
      shadowOpacity: 1,
      strokeScaleEnabled: false,
      listening: false,
    }),
  )

  group.add(
    new Konva.Line({
      points: props.scene.routePoints,
      stroke: 'rgba(16, 185, 129, 0.72)',
      strokeWidth: 2,
      dash: [12, 14],
      lineCap: 'round',
      lineJoin: 'round',
      strokeScaleEnabled: false,
      listening: false,
    }),
  )
}

function addGoals(group: Konva.Group) {
  const symbolScale = mapSymbolScale()

  for (const target of props.scene.targets) {
    const isActive = target.id === props.scene.activeTargetId
    const color = isActive ? themeColors.primary : themeColors.muted

    const point = new Konva.Group({
      x: target.x,
      y: target.y,
      listening: true,
    })

    point.on('click tap', (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      event.cancelBubble = true
      emit('target-select', target.id)
    })

    if (isActive) {
      point.add(
        new Konva.Circle({
          radius: 28 * symbolScale,
          fill: 'transparent',
          stroke: color,
          strokeWidth: 4,
          dash: [8, 8],
          strokeScaleEnabled: false,
        }),
      )
    }

    point.add(
      new Konva.Circle({
        radius: (isActive ? 18 : 14) * symbolScale,
        fill: isActive ? 'rgba(16, 185, 129, 0.14)' : 'rgba(107, 114, 128, 0.1)',
        stroke: color,
        strokeWidth: 4,
        strokeScaleEnabled: false,
      }),
    )

    point.add(
      new Konva.Text({
        x: 22 * symbolScale,
        y: -13 * symbolScale,
        text: target.name,
        fill: themeColors.textTertiary,
        fontSize: 18 * symbolScale,
        fontStyle: '600',
        listening: false,
      }),
    )

    group.add(point)
  }

  if (props.draftTarget) {
    const symbolScale = mapSymbolScale()
    const point = new Konva.Group({
      x: props.draftTarget.x,
      y: props.draftTarget.y,
      listening: true,
    })

    point.on('click tap', (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      event.cancelBubble = true
    })

    point.add(
      new Konva.Circle({
        radius: 30 * symbolScale,
        fill: 'rgba(16, 185, 129, 0.08)',
        stroke: themeColors.primary,
        strokeWidth: 3,
        dash: [8, 8],
        strokeScaleEnabled: false,
      }),
    )
    point.add(
      new Konva.Circle({
        radius: 13 * symbolScale,
        fill: themeColors.primary,
        stroke: themeColors.card,
        strokeWidth: 4,
        strokeScaleEnabled: false,
      }),
    )
    point.add(
      new Konva.Text({
        x: 20 * symbolScale,
        y: -12 * symbolScale,
        text: props.draftTarget.name,
        fill: themeColors.primaryStrong,
        fontSize: 18 * symbolScale,
        fontStyle: 'bold',
        listening: false,
      }),
    )

    group.add(point)
  }
}

function addRobot(group: Konva.Group) {
  const symbolScale = mapSymbolScale()
  const robot = new Konva.Group({
    x: props.robotPose.x,
    y: props.robotPose.y,
    rotation: props.robotPose.rotationDeg,
    listening: false,
  })

  robot.add(
    new Konva.Circle({
      x: 0,
      y: 0,
      radius: 26 * symbolScale,
        fill: 'rgba(255, 255, 255, 0.96)',
        stroke: 'rgba(11, 59, 46, 0.24)',
      strokeWidth: 4,
      shadowColor: 'rgba(15, 23, 42, 0.08)',
      shadowBlur: 12,
      shadowOffsetY: 4,
      strokeScaleEnabled: false,
    }),
  )

  robot.add(
    new Konva.Shape({
      x: 0,
      y: 0,
        fill: themeColors.text,
      sceneFunc(context, shape) {
        context.beginPath()
        context.moveTo(0, -18 * symbolScale)
        context.lineTo(16 * symbolScale, 12 * symbolScale)
        context.lineTo(-16 * symbolScale, 12 * symbolScale)
        context.closePath()
        context.fillStrokeShape(shape)
      },
    }),
  )

  robot.add(
    new Konva.Line({
      points: [0, 10 * symbolScale, 0, -18 * symbolScale],
      stroke: themeColors.primary,
      strokeWidth: 4,
      lineCap: 'round',
      strokeScaleEnabled: false,
    }),
  )

  group.add(robot)
}

function buildScene() {
  if (!stage || !layer) return

  layer.destroyChildren()
  const scene = new Konva.Group()
  layer.add(scene)
  contentGroup = scene

  const hasOccupancyGrid = addOccupancyGrid(scene)

  if (!hasOccupancyGrid) {
    scene.add(
      new Konva.Rect({
        name: 'map-background',
        x: 0,
        y: 0,
        width: mapWidth(),
        height: mapHeight(),
        fillLinearGradientStartPoint: { x: 0, y: 0 },
        fillLinearGradientEndPoint: { x: 0, y: mapHeight() },
        fillLinearGradientColorStops: [0, themeColors.card, 1, themeColors.surfaceSoft],
        listening: true,
      }),
    )
  }

  scene.on('click tap', handleSceneClick)

  if (!hasOccupancyGrid) {
    addGrid(scene)
    addZones(scene)
    addObstacles(scene)
  }

  addRoute(scene)
  addGoals(scene)

  if (props.showRobot !== false) {
    addRobot(scene)
  }

  if (isViewInitialized) {
    applyViewTransform()
  }
}

function layoutStage(shouldResetView = false) {
  if (!stage || !layer || !contentGroup || !stageHost.value) return

  const width = stageHost.value.clientWidth
  const height = stageHost.value.clientHeight

  if (!width || !height) return

  stage.size({ width, height })

  fitScale = Math.min(width / mapWidth(), height / mapHeight())

  if (shouldResetView || !isViewInitialized) {
    currentScale = fitScale

    const contentWidth = mapWidth() * currentScale
    const contentHeight = mapHeight() * currentScale

    currentPosition = {
      x: (width - contentWidth) / 2,
      y: (height - contentHeight) / 2,
    }
    isViewInitialized = true
  } else {
    currentScale = clamp(currentScale, minZoomScale(), maxZoomScale())
  }

  applyViewTransform()
}

function mountKonva() {
  if (!stageHost.value) return

  stage?.destroy()
  stage = new Konva.Stage({
    container: stageHost.value,
    width: stageHost.value.clientWidth,
    height: stageHost.value.clientHeight,
  })
  stage.on('wheel', handleWheel)
  stage.on('mousedown touchstart', beginPan)
  stage.on('mousemove touchmove', movePan)
  stage.on('mouseup touchend mouseleave touchcancel', endPan)

  layer = new Konva.Layer()
  stage.add(layer)

  buildScene()
  layoutStage()
}

watch(
  () => [props.robotPose, props.scene, props.selectionMode, props.draftTarget],
  () => {
    buildScene()
  },
  { deep: true },
)

onMounted(() => {
  mountKonva()

  if (!stageHost.value) return

  resizeObserver = new ResizeObserver(() => {
    layoutStage()
  })
  resizeObserver.observe(stageHost.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  lastPanPoint = null
  occupancyRasterCache = null
  stage?.destroy()
  stage = null
  layer = null
  contentGroup = null
})
</script>

<template>
  <section class="map-container" aria-label="地图画布">
    <div
      ref="stageHost"
      class="map-container__viewport"
      :class="{ 'is-dragging': isDragging }"
    ></div>

    <div class="map-container__tools" role="toolbar" aria-label="地图视图工具">
      <button class="map-tool-button" type="button" title="放大" aria-label="放大地图" @click="zoomIn">
        +
      </button>
      <button class="map-tool-button" type="button" title="缩小" aria-label="缩小地图" @click="zoomOut">
        -
      </button>
      <button
        class="map-tool-button"
        type="button"
        title="定位机器人"
        aria-label="定位机器人"
        @click="focusRobot"
      >
        <span class="tool-icon tool-icon--locate" aria-hidden="true"></span>
      </button>
      <button
        class="map-tool-button"
        type="button"
        title="适应窗口"
        aria-label="适应窗口"
        @click="resetView"
      >
        <span class="tool-icon tool-icon--fit" aria-hidden="true"></span>
      </button>
      <span class="map-container__zoom">{{ zoomPercent }}%</span>
    </div>
  </section>
</template>

<style scoped>
.map-container {
  display: grid;
  position: relative;
  min-height: 100%;
  border-radius: 18px;
  border: 1px solid var(--color-border);
  overflow: hidden;
  background: var(--color-card);
}

.map-container__viewport {
  position: relative;
  aspect-ratio: 1000 / 620;
  min-height: 560px;
  overflow: hidden;
  background:
    linear-gradient(0deg, rgba(229, 231, 235, 0.6) 0, rgba(229, 231, 235, 0.6) 1px, transparent 1px),
    linear-gradient(90deg, rgba(229, 231, 235, 0.6) 0, rgba(229, 231, 235, 0.6) 1px, transparent 1px),
    linear-gradient(180deg, var(--color-card) 0%, var(--color-surface-soft) 100%);
  background-size: 48px 48px, 48px 48px, 100% 100%;
  cursor: grab;
  touch-action: none;
}

.map-container__viewport.is-dragging {
  cursor: grabbing;
}

.map-container__viewport :deep(canvas) {
  cursor: inherit;
}

.map-container__tools {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border: 1px solid rgba(229, 231, 235, 0.9);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(10px);
}

.map-tool-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  color: var(--color-text);
  font: inherit;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
}

.map-tool-button:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-bg);
}

.map-tool-button:active {
  transform: translateY(1px);
}

.tool-icon {
  position: relative;
  display: inline-block;
  width: 15px;
  height: 15px;
}

.tool-icon--locate {
  border: 2px solid currentColor;
  border-radius: 50%;
}

.tool-icon--locate::before,
.tool-icon--locate::after {
  position: absolute;
  content: '';
  background: currentColor;
}

.tool-icon--locate::before {
  top: 5px;
  left: -5px;
  width: 21px;
  height: 2px;
}

.tool-icon--locate::after {
  top: -5px;
  left: 5px;
  width: 2px;
  height: 21px;
}

.tool-icon--fit {
  border: 2px solid currentColor;
  border-radius: 3px;
}

.tool-icon--fit::before {
  position: absolute;
  inset: 3px;
  content: '';
  border: 2px solid var(--color-card);
  border-radius: 2px;
}

.map-container__zoom {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  background: var(--color-neutral-bg);
  color: var(--color-text);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 760px) {
  .map-container__viewport {
    min-height: 420px;
  }
}
</style>
