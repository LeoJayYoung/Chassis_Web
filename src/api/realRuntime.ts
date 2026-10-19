import { runtimeApiConfig } from './config'
import type {
  RuntimeDataSource,
  RuntimeDataSourceErrorListener,
  RuntimeSnapshotListener,
} from './runtime'
import type { RuntimeDashboardSnapshot } from '../types'

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

function toError(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error : new Error(fallbackMessage)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unwrapSnapshot(payload: unknown): RuntimeDashboardSnapshot | null {
  const candidate =
    isRecord(payload) && 'data' in payload ? payload.data : payload

  if (
    !isRecord(candidate) ||
    !('connection' in candidate) ||
    !('map' in candidate) ||
    !('robot' in candidate) ||
    !('tasks' in candidate)
  ) {
    return null
  }

  return candidate as unknown as RuntimeDashboardSnapshot
}

export class RealRuntimeDataSource implements RuntimeDataSource {
  readonly mode = 'real' as const

  private socket: WebSocket | null = null

  async loadSnapshot() {
    const response = await fetch(
      joinUrl(runtimeApiConfig.apiBaseUrl, runtimeApiConfig.snapshotPath),
    )

    if (!response.ok) {
      throw new Error(`真实接口返回 HTTP ${response.status}`)
    }

    const payload: unknown = await response.json()
    const snapshot = unwrapSnapshot(payload)

    if (!snapshot) {
      throw new Error('真实接口返回的数据不是 RuntimeDashboardSnapshot')
    }

    return snapshot
  }

  subscribe(
    onSnapshot: RuntimeSnapshotListener,
    onError?: RuntimeDataSourceErrorListener,
  ) {
    this.disconnect()

    if (!runtimeApiConfig.wsUrl) {
      onError?.(new Error('未配置 VITE_RUNTIME_WS_URL，无法订阅实时数据'))
      return () => undefined
    }

    let disposed = false
    const socket = new WebSocket(runtimeApiConfig.wsUrl)
    this.socket = socket

    socket.onmessage = (event) => {
      try {
        const payload: unknown = JSON.parse(String(event.data))
        const snapshot = unwrapSnapshot(payload)

        if (snapshot) {
          onSnapshot(snapshot)
        }
      } catch (error) {
        onError?.(toError(error, '实时数据消息不是合法 JSON'))
      }
    }

    socket.onerror = () => {
      if (!disposed) {
        onError?.(new Error('实时数据 WebSocket 连接异常'))
      }
    }

    socket.onclose = () => {
      if (!disposed) {
        onError?.(new Error('实时数据 WebSocket 已断开'))
      }
    }

    return () => {
      disposed = true
      if (this.socket === socket) {
        this.socket = null
      }
      socket.close()
    }
  }

  disconnect() {
    if (!this.socket) return

    const socket = this.socket
    this.socket = null
    socket.close()
  }
}
