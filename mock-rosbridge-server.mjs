import crypto from 'node:crypto'
import http from 'node:http'

const PORT = Number(process.env.MOCK_ROSBRIDGE_PORT || 9091)

const clients = new Set()
const subscriptions = new Map()
const actionGoals = new Map()
const ACTION_NAME = process.env.MOCK_NAVIGATE_ACTION_NAME || '/navigate_to_pose'
const THROUGH_POSES_ACTION_NAME =
  process.env.MOCK_NAVIGATE_THROUGH_POSES_ACTION_NAME || '/navigate_through_poses'

let currentPose = {
  x: -1.55,
  y: -2.05,
  yaw: 0.99,
}

function nowStamp() {
  const ms = Date.now()
  return {
    sec: Math.floor(ms / 1000),
    nanosec: (ms % 1000) * 1_000_000,
  }
}

function yawToQuaternion(yaw) {
  return {
    x: 0,
    y: 0,
    z: Math.sin(yaw / 2),
    w: Math.cos(yaw / 2),
  }
}

function actionTopic(suffix) {
  return `${ACTION_NAME}/_action/${suffix}`
}

function uuidKey(uuid) {
  return Array.isArray(uuid) ? uuid.join('-') : ''
}

function readGoalUuid(message) {
  return message?.args?.goal_id?.uuid ?? message?.args?.goal_info?.goal_id?.uuid
}

function distanceBetween(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

function removeDuplicateRoutePoints(points) {
  return points.filter((point, index) => {
    if (index === 0) return true
    return distanceBetween(points[index - 1], point) > 0.01
  })
}

function createActionRoute(start, target) {
  const midpointY = start.y < target.y ? 0.55 : -0.35
  const corridorX = target.x >= start.x ? 1.5 : -1.65

  return removeDuplicateRoutePoints([
    { x: start.x, y: start.y },
    { x: start.x, y: midpointY },
    { x: corridorX, y: midpointY },
    { x: corridorX, y: target.y },
    { x: target.x, y: target.y },
  ])
}

function routeLength(route) {
  let length = 0

  for (let index = 1; index < route.length; index += 1) {
    length += distanceBetween(route[index - 1], route[index])
  }

  return length
}

function pointAtRoute(route, progress) {
  if (!route.length) return { ...currentPose }
  if (route.length === 1) return { ...route[0], yaw: currentPose.yaw }

  const totalLength = routeLength(route)
  let remaining = totalLength * Math.min(Math.max(progress, 0), 1)

  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1]
    const to = route[index]
    const segmentLength = distanceBetween(from, to)

    if (remaining <= segmentLength || index === route.length - 1) {
      const ratio = segmentLength === 0 ? 1 : remaining / segmentLength
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
        yaw: Math.atan2(to.y - from.y, to.x - from.x),
      }
    }

    remaining -= segmentLength
  }

  const last = route[route.length - 1]
  const previous = route[route.length - 2]
  return {
    ...last,
    yaw: Math.atan2(last.y - previous.y, last.x - previous.x),
  }
}

function actionGoalInfo(goal) {
  return {
    goal_id: {
      uuid: goal.uuid,
    },
    stamp: nowStamp(),
  }
}

function actionStatusMessage(goal) {
  return {
    status_list: [
      {
        goal_info: actionGoalInfo(goal),
        status: goal.status,
      },
    ],
  }
}

function actionFeedbackMessage(goal) {
  const distanceRemaining = distanceBetween(currentPose, goal.target)
  const elapsedSec = Math.max((Date.now() - goal.startedAt) / 1000, 0)

  return {
    goal_id: {
      uuid: goal.uuid,
    },
    feedback: {
      current_pose: {
        pose: {
          position: {
            x: currentPose.x,
            y: currentPose.y,
            z: 0,
          },
          orientation: yawToQuaternion(currentPose.yaw),
        },
      },
      distance_remaining: distanceRemaining,
      estimated_time_remaining: {
        sec: Math.ceil(distanceRemaining / 0.42),
        nanosec: 0,
      },
      navigation_time: {
        sec: Math.floor(elapsedSec),
        nanosec: Math.floor((elapsedSec % 1) * 1_000_000_000),
      },
      number_of_recoveries: 0,
      number_of_poses_remaining: goal.targets
        ? Math.max(0, Math.ceil((1 - goal.progress) * goal.targets.length))
        : 0,
    },
  }
}

function publishActionStatus(goal) {
  if (goal.protocol === 'native') return
  publish(actionTopic('status'), actionStatusMessage(goal))
}

function publishActionFeedback(goal) {
  if (goal.protocol === 'native') {
    sendJson(goal.socket, {
      op: 'action_feedback',
      id: goal.key,
      action: goal.actionName,
      values: actionFeedbackMessage(goal).feedback,
    })
    return
  }

  publish(actionTopic('feedback'), actionFeedbackMessage(goal))
}

function sendNativeActionResult(goal) {
  if (goal.protocol !== 'native' || goal.resultSent) return

  goal.resultSent = true
  sendJson(goal.socket, {
    op: 'action_result',
    id: goal.key,
    action: goal.actionName,
    status: goal.resultStatus,
    // rosbridge result=true means the Action protocol completed successfully.
    // Navigation outcome is represented by status (4/5/6).
    result: true,
    values: goal.resultStatus === 4
      ? {
          error_code: 0,
          error_msg: '',
        }
      : goal.resultStatus === 5
        ? {
            error_code: 1,
            error_msg: 'Mock 导航任务已取消',
          }
        : {
            error_code: 2,
            error_msg: 'Mock 导航任务失败',
          },
  })
}

function createDemoMap() {
  const width = 85
  const height = 105
  const data = new Array(width * height).fill(0)

  const setCell = (x, y, value) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    data[y * width + x] = value
  }

  for (let x = 0; x < width; x += 1) {
    setCell(x, 0, 100)
    setCell(x, height - 1, 100)
  }

  for (let y = 0; y < height; y += 1) {
    setCell(0, y, 100)
    setCell(width - 1, y, 100)
  }

  for (let x = 12; x < 72; x += 1) setCell(x, 28, 100)
  for (let y = 42; y < 88; y += 1) setCell(26, y, 100)
  for (let x = 42; x < 75; x += 1) setCell(x, 73, 100)

  for (let y = 6; y < 18; y += 1) {
    for (let x = 6; x < 24; x += 1) setCell(x, y, -1)
  }

  return {
    header: {
      stamp: nowStamp(),
      frame_id: 'map',
    },
    info: {
      map_load_time: nowStamp(),
      resolution: 0.05,
      width,
      height,
      origin: {
        position: { x: -2.33, y: -3.3, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    data,
  }
}

function createKeepoutMask() {
  const width = 85
  const height = 105
  const data = new Array(width * height).fill(0)

  const fillRect = (startX, startY, rectWidth, rectHeight, value = 100) => {
    for (let y = startY; y < startY + rectHeight; y += 1) {
      for (let x = startX; x < startX + rectWidth; x += 1) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          data[y * width + x] = value
        }
      }
    }
  }

  fillRect(8, 8, 18, 12)
  fillRect(56, 58, 18, 22)

  return {
    header: {
      stamp: nowStamp(),
      frame_id: 'map',
    },
    info: {
      map_load_time: nowStamp(),
      resolution: 0.05,
      width,
      height,
      origin: {
        position: { x: -2.33, y: -3.3, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    data,
  }
}

function createPose(tick) {
  const activeGoal = [...actionGoals.values()].find(
    (goal) => goal.status === 1 || goal.status === 2,
  )

  if (activeGoal) {
    return {
      header: {
        stamp: nowStamp(),
        frame_id: 'map',
      },
      pose: {
        pose: {
          position: { x: currentPose.x, y: currentPose.y, z: 0 },
          orientation: yawToQuaternion(currentPose.yaw),
        },
        covariance: new Array(36).fill(0),
      },
    }
  }

  const route = createRoutePoints(tick)
  const progress = (tick * 0.035) % 1
  const segmentCount = route.length - 1
  const segmentFloat = progress * segmentCount
  const segmentIndex = Math.min(Math.floor(segmentFloat), segmentCount - 1)
  const localRatio = segmentFloat - segmentIndex
  const from = route[segmentIndex]
  const to = route[segmentIndex + 1]
  const x = from.x + (to.x - from.x) * localRatio
  const y = from.y + (to.y - from.y) * localRatio
  const yaw = Math.atan2(to.y - from.y, to.x - from.x)
  currentPose = { x, y, yaw }

  return {
    header: {
      stamp: nowStamp(),
      frame_id: 'map',
    },
    pose: {
      pose: {
        position: { x, y, z: 0 },
        orientation: yawToQuaternion(yaw),
      },
      covariance: new Array(36).fill(0),
    },
  }
}

function createRoutePoints(tick) {
  const endOffset = Math.sin(tick * 0.025) * 0.12

  return [
    { x: -1.55, y: -2.05 },
    { x: -1.0, y: -1.2 },
    { x: -1.0, y: -0.25 },
    { x: -0.35, y: 0.42 },
    { x: 0.55, y: 0.42 },
    { x: 1.1, y: 1.0 + endOffset },
    { x: 1.55, y: 1.72 + endOffset },
  ]
}

function densifyRoute(route, pointsPerSegment = 5) {
  const poses = []

  for (let index = 0; index < route.length - 1; index += 1) {
    const from = route[index]
    const to = route[index + 1]

    for (let step = 0; step < pointsPerSegment; step += 1) {
      const ratio = step / pointsPerSegment
      poses.push({
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
        yaw: Math.atan2(to.y - from.y, to.x - from.x),
      })
    }
  }

  const last = route[route.length - 1]
  const previous = route[route.length - 2]
  poses.push({
    x: last.x,
    y: last.y,
    yaw: Math.atan2(last.y - previous.y, last.x - previous.x),
  })

  return poses
}

function createPlan(tick) {
  const activeGoal = [...actionGoals.values()].find(
    (goal) => goal.status === 1 || goal.status === 2 || goal.status === 3,
  )
  const route = activeGoal?.route ?? createRoutePoints(tick)
  const plan = densifyRoute(route)

  return {
    header: {
      stamp: nowStamp(),
      frame_id: 'map',
    },
    poses: plan.map((point) => {
      return {
        header: {
          stamp: nowStamp(),
          frame_id: 'map',
        },
        pose: {
          position: {
            x: point.x,
            y: point.y,
            z: 0,
          },
          orientation: yawToQuaternion(point.yaw),
        },
      }
    }),
  }
}

function createOdom(tick) {
  return {
    header: {
      stamp: nowStamp(),
      frame_id: 'odom',
    },
    child_frame_id: 'base_link',
    twist: {
      twist: {
        linear: { x: 0.42 + Math.sin(tick * 0.1) * 0.08, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: 0.18 + Math.cos(tick * 0.1) * 0.05 },
      },
    },
  }
}

function createBattery(tick) {
  return {
    header: {
      stamp: nowStamp(),
      frame_id: 'base_link',
    },
    voltage: 24.6 + Math.sin(tick * 0.03) * 0.2,
    current: 4.8 + Math.cos(tick * 0.05) * 0.5,
    percentage: 0.78 + Math.sin(tick * 0.02) * 0.04,
  }
}

function encodeFrame(text) {
  const payload = Buffer.from(text)
  const length = payload.length

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload])
  }

  if (length < 65536) {
    const header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(length, 2)
    return Buffer.concat([header, payload])
  }

  const header = Buffer.alloc(10)
  header[0] = 0x81
  header[1] = 127
  header.writeBigUInt64BE(BigInt(length), 2)
  return Buffer.concat([header, payload])
}

function sendJson(socket, payload) {
  if (socket.destroyed) return
  socket.write(encodeFrame(JSON.stringify(payload)))
}

function publish(topic, msg) {
  for (const socket of clients) {
    const topics = subscriptions.get(socket)
    if (!topics?.has(topic)) continue
    sendJson(socket, { op: 'publish', topic, msg })
  }
}

function parseFrames(buffer, onMessage) {
  let offset = 0

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]
    const second = buffer[offset + 1]
    const opcode = first & 0x0f
    const masked = Boolean(second & 0x80)
    let length = second & 0x7f
    let headerLength = 2

    if (length === 126) {
      if (offset + 4 > buffer.length) break
      length = buffer.readUInt16BE(offset + 2)
      headerLength = 4
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break
      length = Number(buffer.readBigUInt64BE(offset + 2))
      headerLength = 10
    }

    const maskOffset = offset + headerLength
    const payloadOffset = maskOffset + (masked ? 4 : 0)
    const frameEnd = payloadOffset + length

    if (frameEnd > buffer.length) break

    if (opcode === 0x8) return buffer.subarray(frameEnd)

    if (opcode === 0x1) {
      const payload = Buffer.from(buffer.subarray(payloadOffset, frameEnd))

      if (masked) {
        const mask = buffer.subarray(maskOffset, maskOffset + 4)
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4]
        }
      }

      onMessage(payload.toString('utf8'))
    }

    offset = frameEnd
  }

  return buffer.subarray(offset)
}

function handleRosbridgeMessage(socket, raw) {
  let message

  try {
    message = JSON.parse(raw)
  } catch {
    console.warn('[mock-rosbridge] ignored invalid JSON:', raw)
    return
  }

  if (message.op === 'subscribe' && message.topic) {
    subscriptions.get(socket)?.add(message.topic)
    console.log(`[mock-rosbridge] subscribe ${message.topic}`)
    return
  }

  if (message.op === 'unsubscribe' && message.topic) {
    subscriptions.get(socket)?.delete(message.topic)
    console.log(`[mock-rosbridge] unsubscribe ${message.topic}`)
    return
  }

  if (message.op === 'advertise' || message.op === 'unadvertise') {
    console.log(`[mock-rosbridge] ${message.op} ${message.topic || ''}`)
    return
  }

  if (message.op === 'publish') {
    console.log(`[mock-rosbridge] frontend publish ${message.topic || ''}`)
    return
  }

  if (message.op === 'send_action_goal') {
    handleNativeActionGoal(socket, message)
    return
  }

  if (message.op === 'cancel_action_goal') {
    handleNativeActionCancel(socket, message)
    return
  }

  if (message.op === 'call_service') {
    handleServiceCall(socket, message)
  }
}

function handleNativeActionGoal(socket, message) {
  const isNavigateToPose =
    message.action === ACTION_NAME &&
    message.action_type === 'nav2_msgs/action/NavigateToPose'
  const isNavigateThroughPoses =
    message.action === THROUGH_POSES_ACTION_NAME &&
    message.action_type === 'nav2_msgs/action/NavigateThroughPoses'

  if (!isNavigateToPose && !isNavigateThroughPoses) {
    sendJson(socket, {
      op: 'action_result',
      id: message.id,
      action: message.action,
      status: 6,
      result: false,
      values: `不支持的 Action：${message.action} (${message.action_type})`,
    })
    return
  }

  const targets = isNavigateThroughPoses
    ? (message.args?.poses ?? []).map((pose) => ({
        x: Number(pose?.pose?.position?.x) || 0,
        y: Number(pose?.pose?.position?.y) || 0,
      }))
    : [
        {
          x: Number(message.args?.pose?.pose?.position?.x) || 0,
          y: Number(message.args?.pose?.pose?.position?.y) || 0,
        },
      ]

  if (isNavigateThroughPoses && targets.length < 2) {
    sendJson(socket, {
      op: 'action_result',
      id: message.id,
      action: message.action,
      status: 6,
      result: false,
      values: '多点巡航至少需要两个目标点',
    })
    return
  }

  const target = targets.at(-1)
  const route = isNavigateThroughPoses
    ? removeDuplicateRoutePoints([{ x: currentPose.x, y: currentPose.y }, ...targets])
    : createActionRoute(currentPose, target)
  const goal = {
    key: String(message.id),
    target,
    targets,
    route,
    status: 1,
    progress: 0,
    startedAt: Date.now(),
    cancelRequested: false,
    resultStatus: 1,
    resultSent: false,
    protocol: 'native',
    socket,
    actionName: message.action,
  }

  actionGoals.set(goal.key, goal)
  console.log(
    `[mock-rosbridge] action goal ${goal.key} -> ${targets
      .map((item) => `(${item.x}, ${item.y})`)
      .join(' -> ')}`,
  )
}

function handleNativeActionCancel(socket, message) {
  const goal = actionGoals.get(String(message.id))

  if (!goal || goal.socket !== socket || goal.status === 4 || goal.status === 5 || goal.status === 6) {
    sendJson(socket, {
      op: 'action_result',
      id: message.id,
      action: message.action,
      status: 6,
      result: false,
      values: '未找到可取消的导航 goal',
    })
    return
  }

  goal.cancelRequested = true
  goal.status = 5
  goal.resultStatus = 5
  goal.finishedAt = Date.now()
  sendNativeActionResult(goal)
  console.log(`[mock-rosbridge] action canceled ${goal.key}`)
}

function handleServiceCall(socket, message) {
  const service = message.service || ''

  if (service === `${ACTION_NAME}/_action/send_goal`) {
    const uuid = readGoalUuid(message)
    const pose = message.args?.goal?.pose?.pose
    const position = pose?.position ?? {}
    const target = {
      x: Number(position.x) || 0,
      y: Number(position.y) || 0,
    }

    if (!Array.isArray(uuid) || uuid.length !== 16) {
      sendJson(socket, {
        op: 'service_response',
        service,
        id: message.id,
        result: false,
        values: { accepted: false, message: 'goal_id.uuid 必须包含 16 个字节' },
      })
      return
    }

    const goal = {
      uuid,
      key: uuidKey(uuid),
      target,
      route: createActionRoute(currentPose, target),
      status: 1,
      progress: 0,
      startedAt: Date.now(),
      cancelRequested: false,
      resultStatus: 1,
      protocol: 'service',
    }

    actionGoals.set(goal.key, goal)

    sendJson(socket, {
      op: 'service_response',
      service,
      id: message.id,
      result: true,
      values: {
        accepted: true,
        goal_id: { uuid },
      },
    })

    publishActionStatus(goal)
    return
  }

  if (service === `${ACTION_NAME}/_action/cancel_goal`) {
    const uuid = readGoalUuid(message)
    const goal = actionGoals.get(uuidKey(uuid))

    if (goal && goal.status !== 4 && goal.status !== 5 && goal.status !== 6) {
      goal.cancelRequested = true
      goal.status = 5
      goal.resultStatus = 5
      goal.finishedAt = Date.now()
      publishActionStatus(goal)
    }

    sendJson(socket, {
      op: 'service_response',
      service,
      id: message.id,
      result: true,
      values: {
        goals_canceling: goal ? [actionGoalInfo(goal)] : [],
        return_code: 0,
      },
    })
    return
  }

  if (service === `${ACTION_NAME}/_action/get_result`) {
    const uuid = readGoalUuid(message)
    const goal = actionGoals.get(uuidKey(uuid))
    const status = goal?.resultStatus ?? 6

    sendJson(socket, {
      op: 'service_response',
      service,
      id: message.id,
      result: true,
      values: {
        status,
        result: {
          error_code: status === 4 ? 0 : status === 5 ? 1 : 2,
          error_msg:
            status === 4
              ? ''
              : status === 5
                ? 'Mock 导航任务已取消'
                : 'Mock 导航任务失败',
        },
      },
    })
    return
  }

  sendJson(socket, {
    op: 'service_response',
    service,
    id: message.id,
    result: true,
    values: {},
  })
}

function advanceActionGoals() {
  for (const goal of actionGoals.values()) {
    if (goal.status === 5 || goal.status === 6 || goal.status === 4) {
      continue
    }

    if (goal.cancelRequested) {
      goal.status = 5
      goal.resultStatus = 5
      publishActionStatus(goal)
      sendNativeActionResult(goal)
      continue
    }

    goal.status = 2
    goal.progress = Math.min(goal.progress + 0.035, 1)
    currentPose = pointAtRoute(goal.route, goal.progress)
    publishActionFeedback(goal)
    publishActionStatus(goal)

    if (goal.progress >= 1) {
      goal.status = 4
      goal.resultStatus = 4
      goal.finishedAt = Date.now()
      currentPose = pointAtRoute(goal.route, 1)
      publishActionFeedback(goal)
      publishActionStatus(goal)
      sendNativeActionResult(goal)
      console.log(`[mock-rosbridge] goal succeeded ${goal.key}`)
    }
  }
}

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end('mock rosbridge server is running\n')
})

server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key']

  if (!key) {
    socket.destroy()
    return
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')

  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      '',
    ].join('\r\n'),
  )

  clients.add(socket)
  subscriptions.set(socket, new Set())
  console.log('[mock-rosbridge] client connected')

  let pending = Buffer.alloc(0)

  socket.on('data', (chunk) => {
    pending = parseFrames(Buffer.concat([pending, chunk]), (raw) => {
      handleRosbridgeMessage(socket, raw)
    })
  })

  socket.on('close', () => {
    clients.delete(socket)
    subscriptions.delete(socket)
    console.log('[mock-rosbridge] client disconnected')
  })

  socket.on('error', () => {
    clients.delete(socket)
    subscriptions.delete(socket)
  })
})

let tick = 0

setInterval(() => {
  tick += 1
  advanceActionGoals()
  publish('/amcl_pose', createPose(tick))
  publish('/plan', createPlan(tick))
  publish('/odom', createOdom(tick))
  publish('/battery_state', createBattery(tick))
}, 500)

setInterval(() => {
  publish('/map', createDemoMap())
  publish('/keepout_filter_mask', createKeepoutMask())
}, 2000)

server.listen(PORT, () => {
  console.log(`[mock-rosbridge] listening on ws://localhost:${PORT}`)
  console.log('[mock-rosbridge] set .env.local:')
  console.log('VITE_DATA_SOURCE=rosbridge')
  console.log(`VITE_ROSBRIDGE_WS_URL=ws://localhost:${PORT}`)
})
