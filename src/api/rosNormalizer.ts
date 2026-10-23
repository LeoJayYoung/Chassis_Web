import type {
  RuntimeBatteryState,
  RuntimeDiagnosticItem,
  RuntimeHealthStatus,
  RuntimeOccupancyGrid,
  RuntimeOdometrySnapshot,
  RuntimePathPoint,
  RuntimePathSnapshot,
  RuntimeRobotPose,
  RuntimeTfFrame,
  RuntimeTwist,
} from '../types'

type RosRecord = Record<string, unknown>

interface Vector3 {
  x: number
  y: number
  z: number
}

interface Quaternion {
  x: number
  y: number
  z: number
  w: number
}

interface ParsedPose {
  position: Vector3
  orientation: Quaternion
}

export type SupportedRosTopic =
  | '/map'
  | '/keepout_filter_mask'
  | '/amcl_pose'
  | '/plan'
  | '/odom'
  | '/cmd_vel'
  | '/tf'
  | '/tf_static'
  | '/battery_state'
  | '/diagnostics'

export type NormalizedRosMessage =
  | { topic: '/map'; value: RuntimeOccupancyGrid }
  | { topic: '/keepout_filter_mask'; value: RuntimeOccupancyGrid }
  | { topic: '/amcl_pose'; value: RuntimeRobotPose }
  | { topic: '/plan'; value: RuntimePathSnapshot }
  | { topic: '/odom'; value: RuntimeOdometrySnapshot }
  | { topic: '/cmd_vel'; value: RuntimeTwist }
  | { topic: '/tf' | '/tf_static'; value: RuntimeTfFrame[] }
  | { topic: '/battery_state'; value: RuntimeBatteryState }
  | { topic: '/diagnostics'; value: RuntimeDiagnosticItem[] }

function asRecord(value: unknown): RosRecord | null {
  return typeof value === 'object' && value !== null ? (value as RosRecord) : null
}

function readValue(record: RosRecord | null, key: string): unknown {
  return record?.[key]
}

function readNumber(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN

  return Number.isFinite(numeric) ? numeric : null
}

function readRequiredNumber(record: RosRecord | null, key: string): number | null {
  return readNumber(readValue(record, key))
}

function readInteger(record: RosRecord | null, key: string): number | null {
  const numeric = readRequiredNumber(record, key)

  return numeric !== null && Number.isInteger(numeric) ? numeric : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readHeader(record: RosRecord, receivedAt: number, fallbackFrameId = '') {
  const header = asRecord(readValue(record, 'header'))

  return {
    frameId: readString(readValue(header, 'frame_id')) ?? fallbackFrameId,
    stamp: readStamp(readValue(header, 'stamp'), receivedAt),
  }
}

function readStamp(value: unknown, fallback: number): number {
  const numeric = readNumber(value)

  if (numeric !== null) {
    return numeric > 1_000_000_000_000 ? Math.round(numeric) : Math.round(numeric * 1000)
  }

  const time = asRecord(value)
  const seconds =
    readNumber(readValue(time, 'sec')) ?? readNumber(readValue(time, 'secs'))
  const nanoseconds =
    readNumber(readValue(time, 'nanosec')) ?? readNumber(readValue(time, 'nsec')) ?? readNumber(readValue(time, 'nsecs'))

  if (seconds === null) return fallback

  return Math.round(seconds * 1000 + (nanoseconds ?? 0) / 1_000_000)
}

function readVector3(value: unknown): Vector3 | null {
  const record = asRecord(value)
  const x = readRequiredNumber(record, 'x')
  const y = readRequiredNumber(record, 'y')

  if (x === null || y === null) return null

  return {
    x,
    y,
    z: readRequiredNumber(record, 'z') ?? 0,
  }
}

function readQuaternion(value: unknown): Quaternion | null {
  const record = asRecord(value)
  const x = readRequiredNumber(record, 'x')
  const y = readRequiredNumber(record, 'y')
  const z = readRequiredNumber(record, 'z')
  const w = readRequiredNumber(record, 'w')

  if (x === null || y === null || z === null || w === null) return null

  return { x, y, z, w }
}

function readPose(value: unknown): ParsedPose | null {
  const record = asRecord(value)
  const position = readVector3(readValue(record, 'position'))
  const orientation = readQuaternion(readValue(record, 'orientation'))

  if (!position || !orientation) return null

  return { position, orientation }
}

function readNestedPose(value: unknown): ParsedPose | null {
  const record = asRecord(value)
  const nestedPose = readValue(record, 'pose')

  return readPose(nestedPose ?? value)
}

function readNestedTwist(value: unknown): RosRecord | null {
  const record = asRecord(value)
  const nestedTwist = asRecord(readValue(record, 'twist'))

  return nestedTwist ?? record
}

function quaternionToEuler(quaternion: Quaternion) {
  const { x, y, z, w } = quaternion
  const norm = Math.hypot(x, y, z, w)

  if (!norm) return null

  const normalized = {
    x: x / norm,
    y: y / norm,
    z: z / norm,
    w: w / norm,
  }

  const sinrCosp = 2 * (normalized.w * normalized.x + normalized.y * normalized.z)
  const cosrCosp = 1 - 2 * (normalized.x ** 2 + normalized.y ** 2)
  const sinp = 2 * (normalized.w * normalized.y - normalized.z * normalized.x)
  const sinyCosp = 2 * (normalized.w * normalized.z + normalized.x * normalized.y)
  const cosyCosp = 1 - 2 * (normalized.y ** 2 + normalized.z ** 2)

  return {
    rollRad: Math.atan2(sinrCosp, cosrCosp),
    pitchRad: Math.asin(Math.max(-1, Math.min(1, sinp))),
    yawRad: Math.atan2(sinyCosp, cosyCosp),
  }
}

function quaternionToYaw(quaternion: Quaternion) {
  return quaternionToEuler(quaternion)?.yawRad ?? null
}

function normalizePoseMessage(
  message: unknown,
  receivedAt: number,
): RuntimeRobotPose | null {
  const record = asRecord(message)

  if (!record) return null

  const header = readHeader(record, receivedAt, 'map')
  const pose = readNestedPose(readValue(record, 'pose'))
  const yawRad = pose ? quaternionToYaw(pose.orientation) : null

  if (!pose || yawRad === null) return null

  return {
    x: pose.position.x,
    y: pose.position.y,
    yawRad,
    frameId: header.frameId || 'map',
    stamp: header.stamp,
  }
}

export function normalizeOccupancyGridMessage(
  message: unknown,
  receivedAt = Date.now(),
): RuntimeOccupancyGrid | null {
  const record = asRecord(message)
  const info = asRecord(readValue(record, 'info'))
  const origin = readPose(readValue(info, 'origin'))
  const resolution = readRequiredNumber(info, 'resolution')
  const widthCells = readInteger(info, 'width')
  const heightCells = readInteger(info, 'height')
  const rawData = readValue(record, 'data')
  const header = record ? readHeader(record, receivedAt, 'map') : null

  if (
    !record ||
    !info ||
    !origin ||
    resolution === null ||
    resolution <= 0 ||
    widthCells === null ||
    widthCells <= 0 ||
    heightCells === null ||
    heightCells <= 0 ||
    !Array.isArray(rawData) ||
    rawData.length !== widthCells * heightCells ||
    !header
  ) {
    return null
  }

  const data: number[] = []

  for (const value of rawData) {
    const numeric = readNumber(value)

    if (numeric === null) return null

    data.push(Math.trunc(numeric))
  }

  const originYawRad = quaternionToYaw(origin.orientation)

  if (originYawRad === null) return null

  return {
    frameId: header.frameId || 'map',
    resolution,
    widthCells,
    heightCells,
    originX: origin.position.x,
    originY: origin.position.y,
    originYawRad,
    data,
    stamp: header.stamp,
  }
}

export function normalizeAmclPoseMessage(
  message: unknown,
  receivedAt = Date.now(),
): RuntimeRobotPose | null {
  return normalizePoseMessage(message, receivedAt)
}

export function normalizePathMessage(
  message: unknown,
  receivedAt = Date.now(),
): RuntimePathSnapshot | null {
  const record = asRecord(message)
  const rawPoses = readValue(record, 'poses')

  if (!record || !Array.isArray(rawPoses)) return null

  const header = readHeader(record, receivedAt, 'map')
  const points: RuntimePathPoint[] = []

  for (const rawPose of rawPoses) {
    const poseRecord = asRecord(rawPose)
    const pose = readNestedPose(readValue(poseRecord, 'pose'))

    if (!pose) return null

    points.push({
      x: pose.position.x,
      y: pose.position.y,
    })
  }

  return {
    frameId: header.frameId || 'map',
    stamp: header.stamp,
    points,
  }
}

function normalizeTwist(
  message: unknown,
  receivedAt: number,
  fallbackFrameId = '',
): RuntimeTwist | null {
  const record = asRecord(message)
  const twist = readNestedTwist(record)
  const linear = readVector3(readValue(twist, 'linear'))
  const angular = readVector3(readValue(twist, 'angular'))

  if (!record || !twist || !linear || !angular) return null

  const header = readHeader(record, receivedAt, fallbackFrameId)

  return {
    frameId: header.frameId || fallbackFrameId,
    stamp: header.stamp,
    linearX: linear.x,
    linearY: linear.y,
    linearZ: linear.z,
    angularX: angular.x,
    angularY: angular.y,
    angularZ: angular.z,
  }
}

export function normalizeTwistMessage(
  message: unknown,
  receivedAt = Date.now(),
): RuntimeTwist | null {
  return normalizeTwist(message, receivedAt)
}

export function normalizeOdometryMessage(
  message: unknown,
  receivedAt = Date.now(),
): RuntimeOdometrySnapshot | null {
  const record = asRecord(message)
  const poseEnvelope = readValue(record, 'pose')
  const twistEnvelope = readValue(record, 'twist')
  const pose = readNestedPose(poseEnvelope)
  const childFrameId = readString(readValue(record, 'child_frame_id')) ?? 'base_link'
  const velocity = normalizeTwist(twistEnvelope, receivedAt, childFrameId)

  if (!record || !pose || !velocity) return null

  const header = readHeader(record, receivedAt, 'odom')
  const yawRad = quaternionToYaw(pose.orientation)

  if (yawRad === null) return null

  return {
    frameId: header.frameId || 'odom',
    childFrameId,
    stamp: header.stamp,
    pose: {
      x: pose.position.x,
      y: pose.position.y,
      yawRad,
      frameId: header.frameId || 'odom',
      stamp: header.stamp,
    },
    velocity: {
      ...velocity,
      frameId: childFrameId,
      stamp: header.stamp,
    },
  }
}

export function normalizeTfMessage(
  message: unknown,
  isStatic = false,
  receivedAt = Date.now(),
): RuntimeTfFrame[] | null {
  const record = asRecord(message)
  const rawTransforms = readValue(record, 'transforms')

  if (!record || !Array.isArray(rawTransforms)) return null

  const frames: RuntimeTfFrame[] = []

  for (const rawTransform of rawTransforms) {
    const transformRecord = asRecord(rawTransform)
    const transform = asRecord(readValue(transformRecord, 'transform'))
    const translation = readVector3(readValue(transform, 'translation'))
    const rotation = readQuaternion(readValue(transform, 'rotation'))
    const childFrame = readString(readValue(transformRecord, 'child_frame_id'))
    const header = transformRecord ? readHeader(transformRecord, receivedAt) : null
    const euler = rotation ? quaternionToEuler(rotation) : null

    if (!translation || !rotation || !childFrame || !header || !euler || !header.frameId) {
      continue
    }

    frames.push({
      parentFrame: header.frameId,
      childFrame,
      translation,
      rotation: euler,
      stamp: header.stamp,
      isStatic,
    })
  }

  return frames
}

export function normalizeBatteryStateMessage(
  message: unknown,
  receivedAt = Date.now(),
): RuntimeBatteryState | null {
  const record = asRecord(message)

  if (!record) return null

  const header = readHeader(record, receivedAt)
  const voltage = readNumber(readValue(record, 'voltage'))
  const current = readNumber(readValue(record, 'current'))
  const rawPercentage = readNumber(readValue(record, 'percentage'))
  const percentage =
    rawPercentage === null || rawPercentage < 0
      ? null
      : Math.max(0, Math.min(100, rawPercentage <= 1 ? rawPercentage * 100 : rawPercentage))
  const powerSupplyStatus = readInteger(record, 'power_supply_status')

  if (voltage === null && current === null && percentage === null) return null

  return {
    frameId: header.frameId,
    stamp: header.stamp,
    voltage,
    current,
    percentage,
    powerSupplyStatus,
  }
}

function diagnosticLevel(value: unknown): RuntimeHealthStatus {
  const level = readNumber(value)

  if (level === 2) return 'error'
  if (level === 1 || level === 3) return 'warning'
  return 'normal'
}

function readDiagnosticValues(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {}

  const values: Record<string, string> = {}

  for (const rawValue of value) {
    const entry = asRecord(rawValue)
    const key = readString(readValue(entry, 'key')) ?? readString(readValue(entry, 'name'))
    const entryValue = readValue(entry, 'value')

    if (key && entryValue !== undefined && entryValue !== null) {
      values[key] = String(entryValue)
    }
  }

  return values
}

export function normalizeDiagnosticArrayMessage(
  message: unknown,
  receivedAt = Date.now(),
): RuntimeDiagnosticItem[] | null {
  const record = asRecord(message)
  const rawStatuses = readValue(record, 'status')

  if (!record || !Array.isArray(rawStatuses)) return null

  const header = readHeader(record, receivedAt)

  return rawStatuses.flatMap((rawStatus) => {
    const status = asRecord(rawStatus)

    if (!status) return []

    return [
      {
        name: readString(readValue(status, 'name')) ?? 'Unnamed diagnostic',
        message: readString(readValue(status, 'message')) ?? '',
        hardwareId: readString(readValue(status, 'hardware_id')) ?? '',
        level: diagnosticLevel(readValue(status, 'level')),
        values: readDiagnosticValues(readValue(status, 'values')),
        stamp: header.stamp,
      },
    ]
  })
}

function canonicalTopic(topic: string): SupportedRosTopic | null {
  const value = topic.trim().replace(/\/+$/, '')

  if (value.endsWith('/keepout_filter_mask')) return '/keepout_filter_mask'
  if (value.endsWith('/map')) return '/map'
  if (value.endsWith('/amcl_pose')) return '/amcl_pose'
  if (value.endsWith('/plan')) return '/plan'
  if (value.endsWith('/odom')) return '/odom'
  if (value.endsWith('/cmd_vel') || value.endsWith('/cmd_vel_unstamped')) return '/cmd_vel'
  if (value.endsWith('/tf_static')) return '/tf_static'
  if (value.endsWith('/tf')) return '/tf'
  if (value.endsWith('/battery_state') || value.endsWith('/battery')) return '/battery_state'
  if (value.endsWith('/diagnostics')) return '/diagnostics'

  return null
}

export function normalizeRosMessage(
  topic: string,
  message: unknown,
  receivedAt = Date.now(),
): NormalizedRosMessage | null {
  const normalizedTopic = canonicalTopic(topic)

  switch (normalizedTopic) {
    case '/map': {
      const value = normalizeOccupancyGridMessage(message, receivedAt)
      return value ? { topic: normalizedTopic, value } : null
    }
    case '/keepout_filter_mask': {
      const value = normalizeOccupancyGridMessage(message, receivedAt)
      return value ? { topic: normalizedTopic, value } : null
    }
    case '/amcl_pose': {
      const value = normalizeAmclPoseMessage(message, receivedAt)
      return value ? { topic: normalizedTopic, value } : null
    }
    case '/plan': {
      const value = normalizePathMessage(message, receivedAt)
      return value ? { topic: normalizedTopic, value } : null
    }
    case '/odom': {
      const value = normalizeOdometryMessage(message, receivedAt)
      return value ? { topic: normalizedTopic, value } : null
    }
    case '/cmd_vel': {
      const value = normalizeTwistMessage(message, receivedAt)
      return value ? { topic: normalizedTopic, value } : null
    }
    case '/tf':
    case '/tf_static': {
      const value = normalizeTfMessage(message, normalizedTopic === '/tf_static', receivedAt)
      return value ? { topic: normalizedTopic, value } : null
    }
    case '/battery_state': {
      const value = normalizeBatteryStateMessage(message, receivedAt)
      return value ? { topic: normalizedTopic, value } : null
    }
    case '/diagnostics': {
      const value = normalizeDiagnosticArrayMessage(message, receivedAt)
      return value ? { topic: normalizedTopic, value } : null
    }
    default:
      return null
  }
}
