import type { RuntimeDashboardSnapshot } from '../types'

export type RuntimeDataSourceMode = 'mock' | 'rosbridge'

export type RuntimeSnapshotMessageType = 'runtime_snapshot' | 'runtime_update'

export interface RuntimeSnapshotMessage {
  type: RuntimeSnapshotMessageType
  data: RuntimeDashboardSnapshot
}

export type RuntimeSnapshotListener = (snapshot: RuntimeDashboardSnapshot) => void
export type RuntimeDataSourceErrorListener = (error: Error) => void

export interface RuntimeDataSource {
  readonly mode: RuntimeDataSourceMode
  loadSnapshot(): Promise<RuntimeDashboardSnapshot>
  subscribe(
    onSnapshot: RuntimeSnapshotListener,
    onError?: RuntimeDataSourceErrorListener,
  ): () => void
  disconnect(): void
}
