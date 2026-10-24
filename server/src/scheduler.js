import { randomUUID } from 'node:crypto'
import { config } from './config.js'

const MODES = ['once', 'interval', 'daily']
const TICK_MS = 1000

function positiveInteger(value, field) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${field} 必须是正整数`)
  }
  return number
}

function parseTimeOfDay(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ''))
  if (!match) throw new Error('timeOfDay 格式必须为 HH:MM')
  return { hours: Number(match[1]), minutes: Number(match[2]) }
}

export function createScheduler({ store, bus, dispatchRoute }) {
  let timer = null
  let ticking = false

  function log(level, message) {
    const entry = {
      ts: Date.now(),
      level,
      module: 'system',
      source: 'scheduler',
      message,
    }
    store.insertLog(entry)
    bus.emit('log', entry)
  }

  function computeNextRun(schedule, fromTs) {
    if (schedule.mode === 'once') return Number(schedule.scheduled_at)

    if (schedule.mode === 'interval') {
      const interval =
        positiveInteger(schedule.interval_minutes, 'intervalMinutes') * 60_000
      return fromTs + interval
    }

    if (schedule.mode === 'daily') {
      const { hours, minutes } = parseTimeOfDay(schedule.time_of_day)
      const date = new Date(fromTs)
      date.setHours(hours, minutes, 0, 0)
      if (date.getTime() <= fromTs) date.setDate(date.getDate() + 1)
      return date.getTime()
    }

    return null
  }

  function nextAfterSuccess(schedule, scheduledFor, now) {
    if (schedule.mode === 'interval') {
      const interval =
        positiveInteger(schedule.interval_minutes, 'intervalMinutes') * 60_000
      let next = scheduledFor + interval
      while (next <= now) next += interval
      return next
    }
    return computeNextRun(schedule, now)
  }

  function advanceSchedule(schedule, scheduledFor) {
    if (schedule.mode === 'once') {
      store.updateSchedule(schedule.id, {
        enabled: 0,
        next_run_at: null,
      })
      bus.emit('schedule-deleted', { id: schedule.id })
      return
    }

    store.updateSchedule(schedule.id, {
      next_run_at: nextAfterSuccess(schedule, scheduledFor, Date.now()),
    })
    bus.emit(
      'schedule-updated',
      store.listSchedules().find((item) => item.id === schedule.id),
    )
  }

  function recover() {
    const now = Date.now()
    store.recoverScheduleRuns(now)

    for (const schedule of store.listEnabledSchedules()) {
      if (schedule.mode === 'once') {
        if (!schedule.scheduled_at) {
          store.updateSchedule(schedule.id, { enabled: 0, next_run_at: null })
          log('error', `一次性计划「${schedule.name}」缺少 scheduled_at，已停用`)
          continue
        }
        if (schedule.scheduled_at <= now && schedule.next_run_at == null) {
          store.updateSchedule(schedule.id, { enabled: 0 })
          log('warn', `一次性计划「${schedule.name}」已过期，本次不自动补发`)
          continue
        }
        if (schedule.next_run_at == null) {
          store.updateSchedule(schedule.id, {
            next_run_at: schedule.scheduled_at,
          })
        }
        continue
      }

      if (schedule.next_run_at == null) {
        store.updateSchedule(schedule.id, {
          next_run_at: computeNextRun(schedule, now),
        })
        continue
      }

      if (schedule.next_run_at <= now) {
        const occurrenceId = store.ensureScheduleRun(
          schedule.id,
          schedule.next_run_at,
          now,
        )
        const occurrence = store.getScheduleRun(occurrenceId)
        if (occurrence?.status === 'dispatched') {
          advanceSchedule(schedule, schedule.next_run_at)
        }
      }
    }
  }

  function fire(schedule) {
    const scheduledFor = Number(schedule.next_run_at)
    if (!Number.isFinite(scheduledFor)) return

    const occurrenceId = store.ensureScheduleRun(
      schedule.id,
      scheduledFor,
      Date.now(),
    )
    if (!store.claimScheduleRun(occurrenceId)) return

    const route = schedule.route_id
      ? store.getRoute(schedule.route_id)
      : null
    if (!route) {
      const now = Date.now()
      store.updateScheduleRun(occurrenceId, {
        status: 'failed',
        error: `找不到路线 ${schedule.route_id}`,
        updated_at: now,
      })
      store.updateSchedule(schedule.id, { enabled: 0, next_run_at: null })
      bus.emit('schedule-deleted', { id: schedule.id })
      log(
        'error',
        `定时计划「${schedule.name}」找不到路线 ${schedule.route_id}，已停用`,
      )
      return
    }

    const activeRun = store.findActiveTaskRun()
    if (activeRun) {
      const now = Date.now()
      store.updateScheduleRun(occurrenceId, {
        status: 'retry',
        retry_at: now + config.schedulerRetryMs,
        error: `机器人正被任务 ${activeRun.task_no} 占用`,
        updated_at: now,
      })
      return
    }

    try {
      const run = dispatchRoute({
        targets: route.targets,
        routeId: route.id,
        mapId: route.map_id ?? null,
        dispatchedBy: 'schedule',
        scheduleId: schedule.id,
        scheduledFor,
      })
      const now = Date.now()
      store.updateScheduleRun(occurrenceId, {
        status: 'dispatched',
        run_id: run.id,
        retry_at: null,
        error: null,
        updated_at: now,
      })
      advanceSchedule(schedule, scheduledFor)
      log(
        'info',
        `定时计划「${schedule.name}」已触发，下发路线「${route.name}」`,
      )
    } catch (error) {
      const now = Date.now()
      const existingRun = store.findTaskRunByScheduleOccurrence(
        schedule.id,
        scheduledFor,
      )

      if (existingRun && existingRun.status !== 'failed') {
        store.updateScheduleRun(occurrenceId, {
          status: 'dispatched',
          run_id: existingRun.id,
          error: null,
          updated_at: now,
        })
        advanceSchedule(schedule, scheduledFor)
        return
      }

      store.updateScheduleRun(occurrenceId, {
        status: 'retry',
        retry_at: now + config.schedulerRetryMs,
        error: error.message,
        updated_at: now,
      })
      log(
        'error',
        `定时计划「${schedule.name}」触发失败，将重试：${error.message}`,
      )
    }
  }

  function tick() {
    if (ticking) return
    ticking = true
    try {
      const now = Date.now()
      for (const schedule of store.listEnabledSchedules()) {
        if (schedule.next_run_at == null || schedule.next_run_at > now) continue
        fire(schedule)
      }
    } finally {
      ticking = false
    }
  }

  function addSchedule(input) {
    const mode = input.mode
    if (!MODES.includes(mode)) {
      throw new Error('mode 必须是 once / interval / daily')
    }
    if (!input.routeId || !store.getRoute(input.routeId)) {
      throw new Error('routeId 对应的巡检路线不存在')
    }

    const now = Date.now()
    const intervalMinutes =
      mode === 'interval'
        ? positiveInteger(input.intervalMinutes, 'intervalMinutes')
        : null
    const timeOfDay =
      mode === 'daily'
        ? `${String(parseTimeOfDay(input.timeOfDay).hours).padStart(2, '0')}:${String(
            parseTimeOfDay(input.timeOfDay).minutes,
          ).padStart(2, '0')}`
        : null
    const scheduledAt =
      mode === 'once' ? Number(input.scheduledAt) : null

    if (
      mode === 'once' &&
      (!Number.isFinite(scheduledAt) || scheduledAt <= now)
    ) {
      throw new Error('once 模式的 scheduledAt 必须是未来的 epoch 毫秒')
    }

    const schedule = {
      id: `SCH-${randomUUID()}`,
      name: input.name || '未命名计划',
      routeId: input.routeId,
      mode,
      intervalMinutes,
      timeOfDay,
      scheduledAt,
      nextRunAt: null,
      enabled: true,
      createdAt: now,
    }
    schedule.nextRunAt = computeNextRun(
      {
        mode,
        interval_minutes: intervalMinutes,
        time_of_day: timeOfDay,
        scheduled_at: scheduledAt,
      },
      now,
    )

    store.saveSchedule(schedule)
    bus.emit('schedule-created', schedule)
    return schedule
  }

  function cancelSchedule(id) {
    const schedule = store.listSchedules().find((item) => item.id === id)
    if (!schedule) throw new Error(`定时计划 ${id} 不存在`)

    store.updateSchedule(id, { enabled: 0, next_run_at: null })
    log('warn', `定时计划「${schedule.name}」已取消`)
    bus.emit('schedule-deleted', { id })
    return { id, enabled: 0 }
  }

  function runNow(id) {
    const schedule = store.listSchedules().find((item) => item.id === id)
    if (!schedule) throw new Error(`定时计划 ${id} 不存在`)
    const route = schedule.route_id ? store.getRoute(schedule.route_id) : null
    if (!route) throw new Error(`定时计划 ${id} 对应路线不存在`)

    return dispatchRoute({
      targets: route.targets,
      routeId: route.id,
      mapId: route.map_id ?? null,
      dispatchedBy: 'human',
      scheduleId: schedule.id,
      scheduledFor: Date.now(),
    })
  }

  function start() {
    recover()
    timer = setInterval(tick, TICK_MS)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    start,
    stop,
    addSchedule,
    cancelSchedule,
    runNow,
    computeNextRun,
  }
}
