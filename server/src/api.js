import http from 'node:http'
import { randomUUID } from 'node:crypto'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) req.destroy()
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function numParam(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function createApiServer({ store, bus, rosbridge, scheduler, taskService }) {
  const sseClients = new Set()

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const res of sseClients) {
      try {
        res.write(payload)
      } catch {
        // 客户端已断开，忽略
      }
    }
  }

  bus.on('log', (entry) => broadcast('log', entry))
  bus.on('task-run', (run) => broadcast('task-run', run))

  function handleSse(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS_HEADERS,
    })
    res.write(': connected\n\n')
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const path = url.pathname
    const method = req.method

    if (method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS)
      return res.end()
    }

    if (path === '/health' && method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        rosbridge: rosbridge.connected ? 'connected' : 'disconnected',
        logCount: store.countLogs(),
        scheduleCount: store.listSchedules().length,
      })
    }

    if (path === '/api/stream' && method === 'GET') {
      return handleSse(req, res)
    }

    // ---------- 日志 ----------
    if (path === '/api/logs' && method === 'GET') {
      const logs = store.queryLogs({
        since: numParam(url.searchParams.get('since')),
        before: numParam(url.searchParams.get('before')),
        level: url.searchParams.get('level') || undefined,
        module: url.searchParams.get('module') || undefined,
        limit: numParam(url.searchParams.get('limit')),
      })
      return sendJson(res, 200, logs)
    }

    // ---------- 巡检路线 ----------
    if (path === '/api/routes' && method === 'GET') {
      return sendJson(res, 200, store.listRoutes())
    }

    if (path === '/api/routes' && method === 'POST') {
      const body = await readBody(req).catch(() => null)
      if (!body) return sendJson(res, 400, { error: '请求体不是合法 JSON' })
      if (!body.name || !Array.isArray(body.targets) || !body.targets.length) {
        return sendJson(res, 400, { error: '需要 name 和 targets（非空数组）' })
      }

      const route = {
        id: body.id || `ROUTE-${randomUUID()}`,
        name: body.name,
        mapId: body.mapId ?? null,
        targets: body.targets,
        createdAt: Date.now(),
      }
      store.saveRoute(route)
      return sendJson(res, 201, route)
    }

    // ---------- 定时计划 ----------
    if (path === '/api/schedules' && method === 'GET') {
      return sendJson(res, 200, store.listSchedules())
    }

    if (path === '/api/schedules' && method === 'POST') {
      const body = await readBody(req).catch(() => null)
      if (!body) return sendJson(res, 400, { error: '请求体不是合法 JSON' })
      try {
        const schedule = scheduler.addSchedule(body)
        return sendJson(res, 201, schedule)
      } catch (error) {
        return sendJson(res, 400, { error: error.message })
      }
    }

    // ---------- 任务执行记录 ----------
    if (path === '/api/task-runs' && method === 'GET') {
      return sendJson(
        res,
        200,
        store.listTaskRuns({
          mapId: url.searchParams.get('mapId') || undefined,
          limit: numParam(url.searchParams.get('limit')),
        }),
      )
    }

    if (path.startsWith('/api/task-runs/') && method === 'GET') {
      const id = path.slice('/api/task-runs/'.length)
      const run = store.getTaskRun(id)
      if (!run) return sendJson(res, 404, { error: 'not found' })
      return sendJson(res, 200, run)
    }

    // ---------- 手动下发任务 ----------
    if (path === '/api/tasks/dispatch' && method === 'POST') {
      const body = await readBody(req).catch(() => null)
      if (!body) return sendJson(res, 400, { error: '请求体不是合法 JSON' })
      try {
        const targets =
          body.targets ?? (body.routeId ? store.getRoute(body.routeId)?.targets : null)
        if (!targets?.length) return sendJson(res, 400, { error: '需要 targets 或 routeId' })

        const run = taskService.dispatchRoute({
          targets,
          routeId: body.routeId ?? null,
          mapId: body.mapId ?? null,
          dispatchedBy: 'human',
          scheduleId: null,
        })
        return sendJson(res, 201, store.getTaskRun(run.id))
      } catch (error) {
        return sendJson(res, 400, { error: error.message })
      }
    }

    // ---------- 暂停 / 继续 / 取消 ----------
    if (path.startsWith('/api/tasks/') && method === 'POST') {
      const segments = path.slice('/api/tasks/'.length).split('/')
      const runId = segments[0]
      const action = segments[1]
      if (!runId || !action) return sendJson(res, 400, { error: '路径不合法' })

      try {
        if (action === 'pause') return sendJson(res, 200, taskService.pauseRun(runId))
        if (action === 'resume') return sendJson(res, 200, taskService.resumeRun(runId))
        if (action === 'cancel') return sendJson(res, 200, taskService.cancelRun(runId))
      } catch (error) {
        return sendJson(res, 400, { error: error.message })
      }
    }

    return sendJson(res, 404, { error: 'not found' })
  })

  const heartbeat = setInterval(() => {
    for (const res of sseClients) {
      try {
        res.write(': ping\n\n')
      } catch {
        // 忽略
      }
    }
  }, 15_000)

  server.on('close', () => clearInterval(heartbeat))

  return server
}
