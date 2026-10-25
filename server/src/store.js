import { mkdirSync } from 'node:fs'
import path from 'node:path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  module TEXT,
  source TEXT,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  map_id TEXT,
  targets TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  route_id TEXT,
  mode TEXT NOT NULL,
  interval_minutes INTEGER,
  time_of_day TEXT,
  scheduled_at INTEGER,
  next_run_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_no TEXT,
  route_id TEXT,
  map_id TEXT,
  type TEXT NOT NULL,
  targets TEXT NOT NULL,
  status TEXT NOT NULL,
  dispatched_by TEXT NOT NULL,
  schedule_id TEXT,
  scheduled_for INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  active_goal_id TEXT,
  active_action TEXT,
  next_target_index INTEGER NOT NULL DEFAULT 0,
  active_goal_start_index INTEGER NOT NULL DEFAULT 0,
  distance_remaining REAL,
  estimated_time_remaining_sec REAL,
  navigation_time_sec REAL,
  number_of_recoveries INTEGER,
  poses_remaining INTEGER,
  last_feedback_at INTEGER,
  updated_at INTEGER,
  failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);

CREATE TABLE IF NOT EXISTS task_run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event TEXT NOT NULL,
  ts INTEGER NOT NULL,
  source TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_run_events_run ON task_run_events(run_id);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER,
  run_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(schedule_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_due
  ON schedule_runs(status, retry_at);
`

const TASK_RUN_COLUMNS = {
  taskNo: 'task_no',
  routeId: 'route_id',
  mapId: 'map_id',
  type: 'type',
  targets: 'targets',
  status: 'status',
  dispatchedBy: 'dispatched_by',
  scheduleId: 'schedule_id',
  scheduledFor: 'scheduled_for',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  activeGoalId: 'active_goal_id',
  activeAction: 'active_action',
  nextTargetIndex: 'next_target_index',
  activeGoalStartIndex: 'active_goal_start_index',
  distanceRemaining: 'distance_remaining',
  estimatedTimeRemainingSec: 'estimated_time_remaining_sec',
  navigationTimeSec: 'navigation_time_sec',
  numberOfRecoveries: 'number_of_recoveries',
  posesRemaining: 'poses_remaining',
  lastFeedbackAt: 'last_feedback_at',
  updatedAt: 'updated_at',
  failureReason: 'failure_reason',
}

/**
 * 创建数据访问层。所有表都围绕"日志 + 巡检路线 + 定时计划 + 每次执行记录"。
 * 使用 node:sqlite 内置模块，零第三方依赖。
 */
export function createStore(DatabaseSync, dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)

  function ensureColumn(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all()

    if (!columns.some((item) => item.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  for (const [column, definition] of [
    ['scheduled_for', 'INTEGER'],
    ['active_goal_id', 'TEXT'],
    ['active_action', 'TEXT'],
    ['next_target_index', 'INTEGER NOT NULL DEFAULT 0'],
    ['active_goal_start_index', 'INTEGER NOT NULL DEFAULT 0'],
    ['distance_remaining', 'REAL'],
    ['estimated_time_remaining_sec', 'REAL'],
    ['navigation_time_sec', 'REAL'],
    ['number_of_recoveries', 'INTEGER'],
    ['poses_remaining', 'INTEGER'],
    ['last_feedback_at', 'INTEGER'],
    ['updated_at', 'INTEGER'],
    ['failure_reason', 'TEXT'],
  ]) {
    ensureColumn('task_runs', column, definition)
  }

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);
     CREATE INDEX IF NOT EXISTS idx_task_runs_schedule_occurrence
       ON task_runs(schedule_id, scheduled_for);`,
  )

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function insertLog(entry) {
    db.prepare(
      'INSERT INTO logs (ts, level, module, source, message) VALUES (?, ?, ?, ?, ?)',
    ).run(
      Number.isFinite(entry.ts) ? entry.ts : Date.now(),
      entry.level,
      entry.module ?? null,
      entry.source ?? null,
      entry.message,
    )
  }

  function queryLogs({ since, before, level, module, limit = 200 } = {}) {
    const where = []
    const params = []

    if (since) {
      where.push('ts >= ?')
      params.push(since)
    }
    if (before) {
      where.push('ts <= ?')
      params.push(before)
    }
    if (level) {
      where.push('level = ?')
      params.push(level)
    }
    if (module) {
      where.push('module = ?')
      params.push(module)
    }

    const sql = `SELECT * FROM logs ${
      where.length ? 'WHERE ' + where.join(' AND ') : ''
    } ORDER BY ts DESC, id DESC LIMIT ?`
    params.push(Math.min(Math.max(Number(limit) || 200, 1), 1000))

    return db.prepare(sql).all(...params)
  }

  function countLogs() {
    return db.prepare('SELECT COUNT(*) AS n FROM logs').get().n
  }

  function pruneLogs({ retentionDays, maxRows } = {}) {
    return transaction(() => {
      let removedByAge = 0
      let removedByCount = 0

      if (retentionDays > 0) {
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
        const result = db.prepare('DELETE FROM logs WHERE ts < ?').run(cutoff)
        removedByAge = Number(result.changes) || 0
      }

      if (maxRows > 0) {
        const result = db
          .prepare(
            `DELETE FROM logs
             WHERE id NOT IN (
               SELECT id FROM logs ORDER BY ts DESC, id DESC LIMIT ?
             )`,
          )
          .run(maxRows)
        removedByCount = Number(result.changes) || 0
      }

      return { removedByAge, removedByCount }
    })
  }

  function nextTaskNo() {
    const row = db
      .prepare(
        `SELECT MAX(
           CASE
             WHEN task_no GLOB 'TASK-[0-9]*'
             THEN CAST(SUBSTR(task_no, 6) AS INTEGER)
             ELSE 0
           END
         ) AS max_no
         FROM task_runs`,
      )
      .get()
    const next = (Number(row?.max_no) || 0) + 1

    return `TASK-${String(next).padStart(4, '0')}`
  }

  function saveRoute(route) {
    db.prepare(
      'INSERT OR REPLACE INTO routes (id, name, map_id, targets, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      route.id,
      route.name,
      route.mapId ?? null,
      JSON.stringify(route.targets),
      route.createdAt,
    )
  }

  function listRoutes() {
    return db
      .prepare('SELECT * FROM routes ORDER BY created_at DESC')
      .all()
      .map((row) => ({ ...row, targets: JSON.parse(row.targets) }))
  }

  function getRoute(id) {
    const row = db.prepare('SELECT * FROM routes WHERE id = ?').get(id)
    return row ? { ...row, targets: JSON.parse(row.targets) } : null
  }

  function renameRoute(id, name) {
    const nextName = String(name ?? '').trim()
    if (!nextName) throw new Error('路线名称不能为空')

    const result = db.prepare('UPDATE routes SET name = ? WHERE id = ?').run(nextName, id)
    return result.changes === 1
  }

  function deleteRoute(id) {
    const used = db.prepare('SELECT COUNT(*) AS n FROM schedules WHERE route_id = ?').get(id)
    if (used && used.n > 0) {
      throw new Error(`该路线正被 ${used.n} 个巡检计划引用，请先删除那些计划`)
    }

    return db.prepare('DELETE FROM routes WHERE id = ?').run(id).changes === 1
  }

  function saveSchedule(schedule) {
    db.prepare(
      `INSERT OR REPLACE INTO schedules
       (id, name, route_id, mode, interval_minutes, time_of_day, scheduled_at, next_run_at, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      schedule.id,
      schedule.name,
      schedule.routeId ?? null,
      schedule.mode,
      schedule.intervalMinutes ?? null,
      schedule.timeOfDay ?? null,
      schedule.scheduledAt ?? null,
      schedule.nextRunAt ?? null,
      schedule.enabled ? 1 : 0,
      schedule.createdAt,
    )
  }

  function listSchedules() {
    return db.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all()
  }

  function listEnabledSchedules() {
    return db.prepare('SELECT * FROM schedules WHERE enabled = 1').all()
  }

  function updateSchedule(id, patch) {
    const fields = []
    const params = []

    for (const [key, value] of Object.entries(patch)) {
      fields.push(`${key} = ?`)
      params.push(value)
    }

    if (!fields.length) return
    params.push(id)
    db.prepare(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`).run(
      ...params,
    )
  }

  function deleteSchedule(id) {
    return transaction(() => {
      const schedule = db.prepare('SELECT id FROM schedules WHERE id = ?').get(id)
      if (!schedule) return false

      // 清掉这个计划的触发台账；task_runs 保留，作为执行历史
      db.prepare('DELETE FROM schedule_runs WHERE schedule_id = ?').run(id)
      return db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes === 1
    })
  }

  function createTaskRun(run) {
    db.prepare(
      `INSERT INTO task_runs
       (id, task_no, route_id, map_id, type, targets, status, dispatched_by,
        schedule_id, scheduled_for, started_at, updated_at, next_target_index,
        active_goal_start_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.id,
      run.taskNo ?? run.id,
      run.routeId ?? null,
      run.mapId ?? null,
      run.type,
      JSON.stringify(run.targets),
      run.status,
      run.dispatchedBy,
      run.scheduleId ?? null,
      run.scheduledFor ?? null,
      run.startedAt,
      run.updatedAt ?? run.startedAt,
      run.nextTargetIndex ?? 0,
      run.activeGoalStartIndex ?? 0,
    )
  }

  function updateTaskRun(id, patch) {
    const fields = []
    const params = []

    for (const [key, value] of Object.entries(patch)) {
      const column = TASK_RUN_COLUMNS[key]
      if (!column) {
        throw new Error(`不允许更新 task_runs 字段：${key}`)
      }
      fields.push(`${column} = ?`)
      params.push(key === 'targets' ? JSON.stringify(value) : value)
    }

    if (!fields.length) return
    params.push(id)
    db.prepare(`UPDATE task_runs SET ${fields.join(', ')} WHERE id = ?`).run(
      ...params,
    )
  }

  function appendTaskRunEvent(event) {
    db.prepare(
      'INSERT INTO task_run_events (run_id, event, ts, source, note) VALUES (?, ?, ?, ?, ?)',
    ).run(
      event.runId,
      event.event,
      event.ts,
      event.source ?? null,
      event.note ?? null,
    )
  }

  function listTaskRuns({ mapId, limit = 100 } = {}) {
    const where = []
    const params = []

    if (mapId) {
      where.push('map_id = ?')
      params.push(mapId)
    }

    const sql = `SELECT * FROM task_runs ${
      where.length ? 'WHERE ' + where.join(' AND ') : ''
    } ORDER BY started_at DESC LIMIT ?`
    params.push(Math.min(Math.max(Number(limit) || 100, 1), 1000))

    return db
      .prepare(sql)
      .all(...params)
      .map((row) => ({ ...row, targets: JSON.parse(row.targets) }))
  }

  function getTaskRun(id) {
    const run = db.prepare('SELECT * FROM task_runs WHERE id = ?').get(id)
    if (!run) return null

    const events = db
      .prepare(
        'SELECT * FROM task_run_events WHERE run_id = ? ORDER BY ts ASC, id ASC',
      )
      .all(id)

    return { ...run, targets: JSON.parse(run.targets), events }
  }

  function deleteTaskRun(id) {
    return transaction(() => {
      const run = db.prepare('SELECT status FROM task_runs WHERE id = ?').get(id)
      if (!run) return false
      if (!['completed', 'failed', 'canceled'].includes(run.status)) {
        throw new Error('只能删除已经结束的任务')
      }

      db.prepare('DELETE FROM task_run_events WHERE run_id = ?').run(id)
      return db.prepare('DELETE FROM task_runs WHERE id = ?').run(id).changes === 1
    })
  }

  function findTaskRunByScheduleOccurrence(scheduleId, scheduledFor) {
    if (!scheduleId || !scheduledFor) return null

    const row = db
      .prepare(
        `SELECT * FROM task_runs
         WHERE schedule_id = ? AND scheduled_for = ?
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get(scheduleId, scheduledFor)

    return row ? { ...row, targets: JSON.parse(row.targets) } : null
  }

  function findActiveTaskRun() {
    const row = db
      .prepare(
        `SELECT * FROM task_runs
         WHERE status IN ('dispatching','running','pausing','paused','canceling','unknown')
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get()

    return row ? { ...row, targets: JSON.parse(row.targets) } : null
  }

  function listInterruptedTaskRuns() {
    return db
      .prepare(
        `SELECT * FROM task_runs
         WHERE status IN ('dispatching','running','pausing','canceling','unknown')`,
      )
      .all()
      .map((row) => ({ ...row, targets: JSON.parse(row.targets) }))
  }

  function ensureScheduleRun(scheduleId, scheduledFor, now = Date.now()) {
    const id = `${scheduleId}:${scheduledFor}`
    db.prepare(
      `INSERT OR IGNORE INTO schedule_runs
       (id, schedule_id, scheduled_for, status, attempts, retry_at, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`,
    ).run(id, scheduleId, scheduledFor, now, now, now)

    return id
  }

  function claimScheduleRun(id, now = Date.now()) {
    const result = db.prepare(
      `UPDATE schedule_runs
       SET status = 'dispatching',
           attempts = attempts + 1,
           updated_at = ?,
           error = NULL
       WHERE id = ?
         AND status IN ('pending','retry')
         AND (retry_at IS NULL OR retry_at <= ?)`,
    ).run(now, id, now)

    return result.changes === 1
  }

  function updateScheduleRun(id, patch) {
    const allowed = new Set([
      'status',
      'retry_at',
      'run_id',
      'error',
      'updated_at',
    ])
    const fields = []
    const params = []

    for (const [key, value] of Object.entries(patch)) {
      if (!allowed.has(key)) {
        throw new Error(`不允许更新 schedule_runs 字段：${key}`)
      }
      fields.push(`${key} = ?`)
      params.push(value)
    }

    if (!fields.length) return
    params.push(id)
    db.prepare(
      `UPDATE schedule_runs SET ${fields.join(', ')} WHERE id = ?`,
    ).run(...params)
  }

  function getScheduleRun(id) {
    return db.prepare('SELECT * FROM schedule_runs WHERE id = ?').get(id) ?? null
  }

  function recoverScheduleRuns(now = Date.now()) {
    db.prepare(
      `UPDATE schedule_runs
       SET status = 'dispatched',
           run_id = (
             SELECT task_runs.id
             FROM task_runs
             WHERE task_runs.schedule_id = schedule_runs.schedule_id
               AND task_runs.scheduled_for = schedule_runs.scheduled_for
             ORDER BY task_runs.started_at DESC
             LIMIT 1
           ),
           error = NULL,
           updated_at = ?
       WHERE status = 'dispatching'
         AND EXISTS (
           SELECT 1
           FROM task_runs
           WHERE task_runs.schedule_id = schedule_runs.schedule_id
             AND task_runs.scheduled_for = schedule_runs.scheduled_for
         )`,
    ).run(now)

    db.prepare(
      `UPDATE schedule_runs
       SET status = 'retry',
           retry_at = ?,
           error = COALESCE(error, '后端重启时调度仍处于 dispatching'),
           updated_at = ?
       WHERE status = 'dispatching' AND run_id IS NULL`,
    ).run(now, now)
  }

  function close() {
    db.close()
  }

  return {
    insertLog,
    queryLogs,
    countLogs,
    pruneLogs,
    nextTaskNo,
    saveRoute,
    listRoutes,
    getRoute,
    renameRoute,
    deleteRoute,
    saveSchedule,
    listSchedules,
    listEnabledSchedules,
    updateSchedule,
    deleteSchedule,
    createTaskRun,
    updateTaskRun,
    appendTaskRunEvent,
    listTaskRuns,
    getTaskRun,
    deleteTaskRun,
    findTaskRunByScheduleOccurrence,
    findActiveTaskRun,
    listInterruptedTaskRuns,
    ensureScheduleRun,
    claimScheduleRun,
    updateScheduleRun,
    getScheduleRun,
    recoverScheduleRuns,
    transaction,
    close,
  }
}
