import { runtimeApiConfig } from './config'
import { mockRuntimeDataSource } from './mockRuntime'
import { RosbridgeRuntimeDataSource } from './rosbridgeRuntime'
import type { RuntimeDataSource } from './runtime'

export function createRuntimeDataSource(): RuntimeDataSource {
  if (runtimeApiConfig.mode === 'rosbridge') {
    return new RosbridgeRuntimeDataSource()
  }

  return mockRuntimeDataSource
}
