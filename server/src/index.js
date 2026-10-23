import { EventEmitter } from 'node:events'
import { config } from './config.js'
import { createStore } from './store.js'
import { RosbridgeClient } from './rosbridge.js'
import { createTaskService } from './tasks.js'
import { createScheduler } from './scheduler.js'
import { createApiServer } from './api.js'

async function main() {
  let DatabaseSync
  try {
    ;({ DatabaseSync } = await import('node:sqlite'))
  } catch (error) {
    console.error('[server] node:sqlite 不可用：', error.message)
    console.error(
      '[server] 请使用 Node >= 23.4（推荐 24），或在 Node 22.x 上用 node --experimental-sqlite 启动。',
    )
    process.exit(1)
  }

  const bus = new EventEmitter()
  const store = createStore(DatabaseSync, config.dbPath)
  const rosbridge = new RosbridgeClient()
  const taskService = createTaskService({ store, rosbridge, bus })
  const scheduler = createScheduler({
    store,
    bus,
    dispatchRoute: taskService.dispatchRoute,
  })

  taskService.recoverInterruptedRuns()

  rosbridge.on('log', (entry) => {
    store.insertLog(entry)
    bus.emit('log', entry)
  })
  rosbridge.on('action_result', (payload) => taskService.handleActionResult(payload))
  rosbridge.on('action_feedback', (payload) =>
    taskService.handleActionFeedback(payload),
  )
  rosbridge.on('connected', () => {
    console.log('[server] rosbridge 已连接')
    const entry = {
      ts: Date.now(),
      level: 'info',
      module: 'system',
      source: 'server',
      message: '后端已连接 rosbridge',
    }
    store.insertLog(entry)
    bus.emit('log', entry)
  })
  rosbridge.on('disconnected', () => {
    console.log('[server] rosbridge 已断开，稍后重连')
    taskService.handleRosbridgeDisconnected()
  })
  rosbridge.on('error', (error) => {
    console.error('[server] rosbridge 错误：', error.message)
  })

  scheduler.start()
  rosbridge.connect()

  const apiServer = createApiServer({ store, bus, rosbridge, scheduler, taskService })
  apiServer.listen(config.port, config.host, () => {
    console.log(`[server] HTTP/SSE 服务已启动：http://${config.host}:${config.port}`)
    console.log(`[server] rosbridge：${config.rosbridgeWsUrl}`)
    console.log(`[server] 数据库：${config.dbPath}`)
  })

  function shutdown() {
    console.log('[server] 正在关闭...')
    scheduler.stop()
    rosbridge.disconnect()
    apiServer.close(() => {
      store.close()
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error('[server] 启动失败：', error)
  process.exit(1)
})
