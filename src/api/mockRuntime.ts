import { mockRuntimeDashboard } from '../mock/runtime'
import type { RuntimeDataSource } from './runtime'

export const mockRuntimeDataSource: RuntimeDataSource = {
  mode: 'mock',

  async loadSnapshot() {
    return structuredClone(mockRuntimeDashboard)
  },

  subscribe() {
    return () => undefined
  },

  disconnect() {
    // Mock data has no external connection.
  },
}
