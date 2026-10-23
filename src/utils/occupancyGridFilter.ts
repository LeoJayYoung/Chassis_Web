export interface OccupancyNoiseFilterOptions {
  enabled?: boolean
  occupiedThreshold?: number
  minComponentCells?: number
}

function envBoolean(value: string | undefined, fallback: boolean) {
  if (!value?.trim()) return fallback

  return !['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase())
}

function envInteger(value: string | undefined, fallback: number) {
  const numeric = Number(value)

  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export const occupancyVisualFilterConfig = {
  enabled: envBoolean(import.meta.env?.VITE_MAP_VISUAL_FILTER_ENABLED, true),
  occupiedThreshold: clamp(
    envInteger(import.meta.env?.VITE_MAP_OCCUPIED_THRESHOLD, 65),
    0,
    100,
  ),
  minComponentCells: envInteger(
    import.meta.env?.VITE_MAP_MIN_COMPONENT_CELLS,
    3,
  ),
}

export function occupancyVisualFilterKey() {
  const config = occupancyVisualFilterConfig

  return [
    config.enabled ? 'on' : 'off',
    config.occupiedThreshold,
    config.minComponentCells,
  ].join(':')
}

export function filterOccupancyNoise(
  data: readonly number[],
  width: number,
  height: number,
  options: OccupancyNoiseFilterOptions = occupancyVisualFilterConfig,
) {
  const enabled = options.enabled ?? true
  const occupiedThreshold = clamp(
    Math.trunc(options.occupiedThreshold ?? 65),
    0,
    100,
  )
  const minComponentCells = Math.max(
    1,
    Math.trunc(options.minComponentCells ?? 3),
  )

  if (
    !enabled ||
    minComponentCells <= 1 ||
    width <= 0 ||
    height <= 0 ||
    data.length !== width * height
  ) {
    return data
  }

  const filtered = [...data]
  const visited = new Uint8Array(data.length)
  const queue: number[] = []
  const component: number[] = []
  const directions = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ] as const

  for (let startIndex = 0; startIndex < data.length; startIndex += 1) {
    if (visited[startIndex] || (data[startIndex] ?? -1) < occupiedThreshold) {
      continue
    }

    queue.length = 0
    component.length = 0
    queue.push(startIndex)
    visited[startIndex] = 1

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const currentIndex = queue[queueIndex] as number
      const currentX = currentIndex % width
      const currentY = Math.floor(currentIndex / width)
      component.push(currentIndex)

      for (const [offsetX, offsetY] of directions) {
        const nextX = currentX + offsetX
        const nextY = currentY + offsetY

        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
          continue
        }

        const nextIndex = nextY * width + nextX

        if (
          visited[nextIndex] ||
          (data[nextIndex] ?? -1) < occupiedThreshold
        ) {
          continue
        }

        visited[nextIndex] = 1
        queue.push(nextIndex)
      }
    }

    if (component.length >= minComponentCells) continue

    for (const cellIndex of component) {
      filtered[cellIndex] = 0
    }
  }

  return filtered
}
