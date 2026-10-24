import { randomUUID } from 'node:crypto'

function isRecord(value) {
  return typeof value === 'object' && value !== null
}

function finiteNumber(value, field) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw new Error(`${field} 不能为空`)
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new Error(`${field} 必须是有限数值`)
  }
  return number
}

function normalizeTargets(targets) {
  if (!Array.isArray(targets)) throw new Error('targets 必须是数组')

  return targets.map((target, index) => {
    if (!isRecord(target)) {
      throw new Error(`第 ${index + 1} 个目标点格式不正确`)
    }
    return {
      id: String(target.id ?? target.name ?? `P${index + 1}`),
      name: String(target.name ?? target.id ?? `P${index + 1}`),
      x: finiteNumber(target.x, `targets[${index}].x`),
      y: finiteNumber(target.y, `targets[${index}].y`),
      yawRad: finiteNumber(target.yawRad ?? 0, `targets[${index}].yawRad`),
      frameId: target.frameId ? String(target.frameId) : undefined,
    }
  })
}

function clampInteger(value, min, max) {
  return Math.min(Math.max(Math.trunc(Number(value) || 0), min), max)
}

function durationSeconds(value) {
  if (!isRecord(value)) return null
  const sec = Number(value.sec ?? value.secs)
  const nanosec = Number(value.nanosec ?? value.nsec ?? value.nsecs ?? 0)
  if (!Number.isFinite(sec)) return null
  return sec + (Number.isFinite(nanosec) ? nanosec : 0) / 1_000_000_000
}

const TERMINAL_STATUSES = ['completed', 'failed', 'canceled']

export function createTaskService({ store, rosbridge, bus }) {
  function emitLog(level, message) {
    const entry = {
      ts: Date.now(),
      level,
      module: 'nav2',
      source: 'server',
      message,
    }
    store.insertLog(entry)
    bus.emit('log', entry)
  }

  function emitRun(runId) {
    bus.emit('task-run', store.getTaskRun(runId))
  }

  function sendTargets(runId, targets) {
    return targets.length > 1
      ? rosbridge.sendNavigateThroughPoses(runId, targets)
      : rosbridge.sendNavigateToPose(runId, targets[0])
  }

  function dispatchRoute({
    targets,
    routeId,
    mapId,
    dispatchedBy,
    scheduleId,
    scheduledFor,
  }) {
    const normalized = normalizeTargets(targets)
    if (!normalized.length) throw new Error('任务缺少目标点')
    if (!rosbridge.connected) {
      throw new Error('rosbridge 未连接，无法下发任务')
    }

    const activeRun = store.findActiveTaskRun()
    if (activeRun) {
      throw new Error(`机器人正被任务 ${activeRun.task_no} 占用`)
    }

    const startedAt = Date.now()
    const run = {
      id: `RUN-${randomUUID()}`,
      taskNo: store.nextTaskNo(),
      routeId: routeId ?? null,
      mapId: mapId ?? null,
      type:
        normalized.length > 1
          ? 'multi_point_cruise'
          : 'single_point_navigation',
      targets: normalized,
      status: 'dispatching',
      dispatchedBy,
      scheduleId: scheduleId ?? null,
      scheduledFor: scheduledFor ?? null,
      startedAt,
      updatedAt: startedAt,
      nextTargetIndex: 0,
      activeGoalStartIndex: 0,
    }

    store.transaction(() => {
      store.createTaskRun(run)
      store.appendTaskRunEvent({
        runId: run.id,
        event: 'created',
        ts: startedAt,
        source: dispatchedBy,
        note: null,
      })
    })

    try {
      const goal = sendTargets(run.id, normalized)
      const now = Date.now()
      store.transaction(() => {
        store.updateTaskRun(run.id, {
          status: 'running',
          activeGoalId: goal.goalId,
          activeAction: goal.action,
          activeGoalStartIndex: 0,
          updatedAt: now,
        })
        store.appendTaskRunEvent({
          runId: run.id,
          event: 'running',
          ts: now,
          source: dispatchedBy,
          note: goal.goalId,
        })
      })
      emitLog(
        'info',
        `任务 ${run.taskNo} 已下发（${normalized
          .map((target) => target.name)
          .join(' → ')}）`,
      )
      emitRun(run.id)
      return store.getTaskRun(run.id)
    } catch (error) {
      const now = Date.now()
      store.transaction(() => {
        store.updateTaskRun(run.id, {
          status: 'failed',
          completedAt: now,
          updatedAt: now,
          failureReason: error.message,
        })
        store.appendTaskRunEvent({
          runId: run.id,
          event: 'failed',
          ts: now,
          source: 'system',
          note: error.message,
        })
      })
      emitLog('error', `任务 ${run.taskNo} 下发失败：${error.message}`)
      emitRun(run.id)
      throw error
    }
  }

  function pauseRun(runId, source = 'human') {
    const run = store.getTaskRun(runId)
    if (!run) throw new Error(`任务 ${runId} 不存在`)
    if (run.status !== 'running') {
      throw new Error(`任务 ${runId} 当前状态为 ${run.status}，无法暂停`)
    }
    if (!rosbridge.cancelGoal(runId)) {
      throw new Error(`任务 ${runId} 没有可取消的活动 goal`)
    }

    const now = Date.now()
    store.transaction(() => {
      store.updateTaskRun(runId, { status: 'pausing', updatedAt: now })
      store.appendTaskRunEvent({
        runId,
        event: 'pause_requested',
        ts: now,
        source,
        note: '等待 Nav2 返回 canceled',
      })
    })
    emitLog('warn', `任务 ${run.task_no} 已请求暂停，等待 Nav2 确认`)
    emitRun(runId)
    return { runId, status: 'pausing' }
  }

  function resumeRun(runId, source = 'human') {
    const run = store.getTaskRun(runId)
    if (!run) throw new Error(`任务 ${runId} 不存在`)
    if (run.status !== 'paused') {
      throw new Error(`任务 ${runId} 当前状态为 ${run.status}，无法继续`)
    }
    if (!rosbridge.connected) {
      throw new Error('rosbridge 未连接，无法继续任务')
    }

    const startIndex = clampInteger(
      run.next_target_index,
      0,
      run.targets.length,
    )
    const remainingTargets = run.targets.slice(startIndex)

    if (!remainingTargets.length) {
      const now = Date.now()
      store.transaction(() => {
        store.updateTaskRun(runId, {
          status: 'completed',
          completedAt: now,
          updatedAt: now,
          nextTargetIndex: run.targets.length,
        })
        store.appendTaskRunEvent({
          runId,
          event: 'completed',
          ts: now,
          source: 'system',
          note: '恢复时已无剩余航点',
        })
      })
      emitRun(runId)
      return { runId, status: 'completed' }
    }

    const goal = sendTargets(runId, remainingTargets)
    const now = Date.now()
    store.transaction(() => {
      store.updateTaskRun(runId, {
        status: 'running',
        activeGoalId: goal.goalId,
        activeAction: goal.action,
        activeGoalStartIndex: startIndex,
        updatedAt: now,
        completedAt: null,
        failureReason: null,
      })
      store.appendTaskRunEvent({
        runId,
        event: 'resumed',
        ts: now,
        source,
        note: `从第 ${startIndex + 1} 个航点继续`,
      })
    })
    emitLog(
      'info',
      `任务 ${run.task_no} 已继续，剩余路线：${remainingTargets
        .map((target) => target.name)
        .join(' → ')}`,
    )
    emitRun(runId)
    return { runId, status: 'running' }
  }

  function cancelRun(runId, source = 'human') {
    const run = store.getTaskRun(runId)
    if (!run) throw new Error(`任务 ${runId} 不存在`)
    if (TERMINAL_STATUSES.includes(run.status)) {
      throw new Error(`任务 ${runId} 已结束，无法取消`)
    }

    const now = Date.now()
    if (run.status === 'paused') {
      store.transaction(() => {
        store.updateTaskRun(runId, {
          status: 'canceled',
          completedAt: now,
          updatedAt: now,
          activeGoalId: null,
          activeAction: null,
        })
        store.appendTaskRunEvent({
          runId,
          event: 'canceled',
          ts: now,
          source,
          note: '从暂停状态取消',
        })
      })
      emitLog('warn', `任务 ${run.task_no} 已取消`)
      emitRun(runId)
      return { runId, status: 'canceled' }
    }

    let cancelSent = false
    try {
      cancelSent = rosbridge.cancelGoal(runId)
    } catch (error) {
      if (run.status !== 'unknown') throw error
    }

    if (run.status === 'unknown' && !cancelSent) {
      store.transaction(() => {
        store.updateTaskRun(runId, {
          status: 'canceled',
          completedAt: now,
          updatedAt: now,
          activeGoalId: null,
          activeAction: null,
          failureReason: '任务状态未知，由操作员人工取消',
        })
        store.appendTaskRunEvent({
          runId,
          event: 'canceled',
          ts: now,
          source,
          note: 'unknown 状态人工取消，未确认原 goal',
        })
      })
      rosbridge.clearGoal(runId)
      emitLog('warn', `待核对任务 ${run.task_no} 已由操作员取消`)
      emitRun(runId)
      return { runId, status: 'canceled' }
    }

    if (!cancelSent) {
      throw new Error(`任务 ${runId} 没有可取消的活动 goal`)
    }
    store.transaction(() => {
      store.updateTaskRun(runId, { status: 'canceling', updatedAt: now })
      store.appendTaskRunEvent({
        runId,
        event: 'cancel_requested',
        ts: now,
        source,
        note: '等待 Nav2 返回 canceled',
      })
    })
    emitLog('warn', `任务 ${run.task_no} 已请求取消，等待 Nav2 确认`)
    emitRun(runId)
    return { runId, status: 'canceling' }
  }

  function retryRun(runId, source = 'human') {
    const run = store.getTaskRun(runId)
    if (!run) throw new Error(`任务 ${runId} 不存在`)
    if (!TERMINAL_STATUSES.includes(run.status) && run.status !== 'unknown') {
      throw new Error(`任务 ${runId} 当前状态为 ${run.status}，无法重试`)
    }

    if (run.status === 'unknown') {
      const now = Date.now()
      store.transaction(() => {
        store.updateTaskRun(runId, {
          status: 'failed',
          completedAt: now,
          updatedAt: now,
          activeGoalId: null,
          activeAction: null,
          failureReason: '待核对任务由操作员选择重新执行',
        })
        store.appendTaskRunEvent({
          runId,
          event: 'failed',
          ts: now,
          source,
          note: 'unknown 状态人工结束并重新执行',
        })
      })
      rosbridge.clearGoal(runId)
      emitRun(runId)
    }

    return dispatchRoute({
      targets: run.targets,
      routeId: run.route_id,
      mapId: run.map_id,
      dispatchedBy: 'retry',
      scheduleId: null,
      scheduledFor: null,
    })
  }

  function handleActionFeedback(payload) {
    const runId = payload.runId
    if (!runId) return
    const run = store.getTaskRun(runId)
    if (!run || payload.id !== run.active_goal_id) return

    const values = isRecord(payload.values) ? payload.values : {}
    const posesRemaining = Number(values.number_of_poses_remaining)
    const goalStartIndex = clampInteger(
      run.active_goal_start_index,
      0,
      run.targets.length,
    )
    const sentTargetCount = run.targets.length - goalStartIndex
    const nextTargetIndex = Number.isFinite(posesRemaining)
      ? Math.min(
          goalStartIndex +
            Math.max(sentTargetCount - Math.round(posesRemaining), 0),
          run.targets.length,
        )
      : Number(run.next_target_index) || 0
    const previousIndex = Number(run.next_target_index) || 0
    const now = Date.now()

    store.transaction(() => {
      store.updateTaskRun(runId, {
        distanceRemaining: Number.isFinite(Number(values.distance_remaining))
          ? Number(values.distance_remaining)
          : null,
        estimatedTimeRemainingSec: durationSeconds(
          values.estimated_time_remaining,
        ),
        navigationTimeSec: durationSeconds(values.navigation_time),
        numberOfRecoveries: Number.isFinite(
          Number(values.number_of_recoveries),
        )
          ? Number(values.number_of_recoveries)
          : null,
        posesRemaining: Number.isFinite(posesRemaining)
          ? Math.round(posesRemaining)
          : null,
        nextTargetIndex,
        lastFeedbackAt: now,
        updatedAt: now,
      })

      for (let index = previousIndex; index < nextTargetIndex; index += 1) {
        const target = run.targets[index]
        store.appendTaskRunEvent({
          runId,
          event: 'waypoint_reached',
          ts: now,
          source: 'nav2',
          note: target ? `${index + 1}:${target.name}` : String(index + 1),
        })
      }
    })
    emitRun(runId)
  }

  function handleActionResult(payload) {
    const runId = payload.runId
    if (!runId) return
    const run = store.getTaskRun(runId)
    if (!run || payload.id !== run.active_goal_id) return

    const statusNumber = Number(payload.status)
    const values = isRecord(payload.values) ? payload.values : {}
    const errorMsg =
      typeof values.error_msg === 'string'
        ? values.error_msg
        : typeof payload.values === 'string'
          ? payload.values
          : undefined
    const now = Date.now()

    if (statusNumber === 5 && run.status === 'pausing') {
      store.transaction(() => {
        store.updateTaskRun(runId, {
          status: 'paused',
          activeGoalId: null,
          activeAction: null,
          updatedAt: now,
        })
        store.appendTaskRunEvent({
          runId,
          event: 'paused',
          ts: now,
          source: 'nav2',
          note: 'Nav2 已确认取消当前 goal',
        })
      })
      rosbridge.clearGoal(runId)
      emitLog('warn', `任务 ${run.task_no} 已暂停`)
      emitRun(runId)
      return
    }

    let status
    if (statusNumber === 4) status = 'completed'
    else if (statusNumber === 5) status = 'canceled'
    else if (statusNumber === 6) status = 'failed'
    else status = payload.result === true ? 'completed' : 'failed'
    if (!TERMINAL_STATUSES.includes(status)) return

    store.transaction(() => {
      store.updateTaskRun(runId, {
        status,
        completedAt: now,
        updatedAt: now,
        activeGoalId: null,
        activeAction: null,
        nextTargetIndex:
          status === 'completed'
            ? run.targets.length
            : run.next_target_index,
        failureReason: status === 'failed' ? errorMsg ?? 'Nav2 执行失败' : null,
      })
      store.appendTaskRunEvent({
        runId,
        event: status,
        ts: now,
        source: 'nav2',
        note: errorMsg ?? null,
      })
    })
    rosbridge.clearGoal(runId)

    if (status === 'completed') emitLog('info', `任务 ${run.task_no} 已完成`)
    else if (status === 'failed') {
      emitLog(
        'error',
        `任务 ${run.task_no} 失败${errorMsg ? `：${errorMsg}` : ''}`,
      )
    } else emitLog('warn', `任务 ${run.task_no} 已取消`)
    emitRun(runId)
  }

  function recoverInterruptedRuns() {
    const now = Date.now()
    for (const run of store.listInterruptedTaskRuns()) {
      if (run.active_goal_id && run.active_action) {
        rosbridge.restoreGoal(run.id, run.active_goal_id, run.active_action)
      }
      if (run.status === 'unknown') continue

      store.transaction(() => {
        store.updateTaskRun(run.id, {
          status: 'unknown',
          updatedAt: now,
          failureReason: '后端重启，无法确认原 Nav2 goal 的实时状态',
        })
        store.appendTaskRunEvent({
          runId: run.id,
          event: 'interrupted',
          ts: now,
          source: 'system',
          note: '后端重启，任务状态待人工核对',
        })
      })
      emitLog(
        'warn',
        `任务 ${run.task_no} 在后端重启时仍未结束，已标记为 unknown`,
      )
    }
  }

  function handleRosbridgeDisconnected() {
    const run = store.findActiveTaskRun()
    if (
      !run ||
      run.status === 'paused' ||
      run.status === 'unknown'
    ) {
      return
    }

    const now = Date.now()
    store.transaction(() => {
      store.updateTaskRun(run.id, {
        status: 'unknown',
        updatedAt: now,
        failureReason: 'rosbridge 连接中断，无法确认 Nav2 goal 状态',
      })
      store.appendTaskRunEvent({
        runId: run.id,
        event: 'connection_lost',
        ts: now,
        source: 'system',
        note: 'rosbridge 断线，任务状态待人工核对',
      })
    })
    emitLog(
      'warn',
      `任务 ${run.task_no} 执行期间 rosbridge 断线，已标记为 unknown`,
    )
    emitRun(run.id)
  }

  return {
    dispatchRoute,
    pauseRun,
    resumeRun,
    cancelRun,
    retryRun,
    handleActionFeedback,
    handleActionResult,
    recoverInterruptedRuns,
    handleRosbridgeDisconnected,
    emitLog,
  }
}
