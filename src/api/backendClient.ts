import { runtimeApiConfig } from './config'

export interface BackendTarget {
  id: string
  name: string
  x: number
  y: number
  yawRad: number
  frameId: string
}

export interface BackendTaskEvent {
  id: number
  run_id: string
  event: string
  ts: number
  source: string | null
  note: string | null
}

export interface BackendTaskRun {
  id: string
  task_no: string
  route_id: string | null
  map_id: string | null
  type: string
  targets: BackendTarget[]
  status: string
  dispatched_by: string
  schedule_id: string | null
  scheduled_for: number | null
  started_at: number
  completed_at: number | null
  active_goal_id: string | null
  active_action: string | null
  next_target_index: number
  active_goal_start_index: number
  distance_remaining: number | null
  estimated_time_remaining_sec: number | null
  navigation_time_sec: number | null
  number_of_recoveries: number | null
  poses_remaining: number | null
  last_feedback_at: number | null
  updated_at: number | null
  failure_reason: string | null
  events?: BackendTaskEvent[]
}

export interface BackendLog {
  id: number
  ts: number
  level: string
  module: string | null
  source: string | null
  message: string
}

export interface BackendRoute {
  id: string
  name: string
  map_id: string | null
  targets: BackendTarget[]
  created_at: number
}

export interface BackendSchedule {
  id: string
  name: string
  route_id: string | null
  mode: 'once' | 'interval' | 'daily'
  interval_minutes: number | null
  time_of_day: string | null
  scheduled_at: number | null
  next_run_at: number | null
  enabled: number
  created_at: number
}

export type BackendEvent =
  | { type: 'log'; data: BackendLog }
  | { type: 'task-run'; data: BackendTaskRun }
  | { type: 'schedule-created'; data: BackendSchedule }
  | { type: 'schedule-updated'; data: BackendSchedule }
  | { type: 'schedule-deleted'; data: { id: string } }

function joinUrl(path: string) {
  const base = runtimeApiConfig.backendApiBaseUrl
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(joinUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `后端接口返回 HTTP ${response.status}`
    throw new Error(message)
  }

  return payload as T
}

export class BackendClient {
  private events: EventSource | null = null

  listLogs(limit = 500) {
    return request<BackendLog[]>(`/logs?limit=${limit}`)
  }

  listTaskRuns(limit = 500) {
    return request<BackendTaskRun[]>(`/task-runs?limit=${limit}`)
  }

  getTaskRun(id: string) {
    return request<BackendTaskRun>(`/task-runs/${encodeURIComponent(id)}`)
  }

  listRoutes() {
    return request<BackendRoute[]>('/routes')
  }

  createRoute(input: {
    id?: string
    name: string
    mapId?: string
    targets: BackendTarget[]
  }) {
    return request<BackendRoute>('/routes', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  listSchedules() {
    return request<BackendSchedule[]>('/schedules')
  }

  createSchedule(input: {
    name: string
    routeId: string
    mode: 'once' | 'interval' | 'daily'
    scheduledAt?: number
    intervalMinutes?: number
    timeOfDay?: string
  }) {
    return request<BackendSchedule>('/schedules', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  cancelSchedule(id: string) {
    return request<{ id: string; enabled: number }>(
      `/schedules/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' },
    )
  }

  runScheduleNow(id: string) {
    return request<BackendTaskRun>(
      `/schedules/${encodeURIComponent(id)}/run-now`,
      { method: 'POST' },
    )
  }

  dispatchTask(input: {
    routeId?: string
    mapId?: string
    targets?: BackendTarget[]
  }) {
    return request<BackendTaskRun>('/tasks/dispatch', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  taskCommand(
    id: string,
    action: 'pause' | 'resume' | 'cancel' | 'retry',
  ) {
    return request<BackendTaskRun | { runId: string; status: string }>(
      `/tasks/${encodeURIComponent(id)}/${action}`,
      { method: 'POST' },
    )
  }

  deleteTaskRun(id: string) {
    return request<{ deleted: boolean }>(
      `/task-runs/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    )
  }

  subscribe(
    listener: (event: BackendEvent) => void,
    onError?: (error: Error) => void,
    onOpen?: () => void,
  ) {
    this.disconnect()
    const source = new EventSource(joinUrl('/stream'))
    this.events = source

    const bind = <T>(type: BackendEvent['type']) => {
      source.addEventListener(type, (event) => {
        try {
          listener({
            type,
            data: JSON.parse((event as MessageEvent).data) as T,
          } as BackendEvent)
        } catch {
          onError?.(new Error(`后端 ${type} 事件不是合法 JSON`))
        }
      })
    }

    bind<BackendLog>('log')
    bind<BackendTaskRun>('task-run')
    bind<BackendSchedule>('schedule-created')
    bind<BackendSchedule>('schedule-updated')
    bind<{ id: string }>('schedule-deleted')
    source.onopen = () => onOpen?.()
    source.onerror = () => {
      onError?.(new Error('后端 SSE 暂时断开，浏览器将自动重连'))
    }

    return () => {
      if (this.events === source) this.events = null
      source.close()
    }
  }

  disconnect() {
    this.events?.close()
    this.events = null
  }
}
