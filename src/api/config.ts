import type { RuntimeDataSourceMode } from './runtime'

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '')
}

const configuredMode = import.meta.env.VITE_DATA_SOURCE?.trim().toLowerCase()

function resolveMode(value?: string): RuntimeDataSourceMode {
  return value === 'real' || value === 'rosbridge' ? value : 'mock'
}

function envValue(value: string | undefined, fallback: string) {
  return value?.trim() || fallback
}

function envNumber(value: string | undefined, fallback: number) {
  const numeric = Number(value)

  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

export const runtimeApiConfig = {
  mode: resolveMode(configuredMode),
  apiBaseUrl: trimTrailingSlashes(
    import.meta.env.VITE_RUNTIME_API_BASE_URL?.trim() || '/api',
  ),
  wsUrl: import.meta.env.VITE_RUNTIME_WS_URL?.trim() || '',
  rosbridgeWsUrl: import.meta.env.VITE_ROSBRIDGE_WS_URL?.trim() || '',
  rosTopics: {
    map: envValue(import.meta.env.VITE_ROS_TOPIC_MAP, '/map'),
    amclPose: envValue(import.meta.env.VITE_ROS_TOPIC_AMCL_POSE, '/amcl_pose'),
    plan: envValue(import.meta.env.VITE_ROS_TOPIC_PLAN, '/plan'),
    odom: envValue(import.meta.env.VITE_ROS_TOPIC_ODOM, '/odom'),
    cmdVel: envValue(import.meta.env.VITE_ROS_TOPIC_CMD_VEL, '/cmd_vel'),
    tf: envValue(import.meta.env.VITE_ROS_TOPIC_TF, '/tf'),
    tfStatic: envValue(import.meta.env.VITE_ROS_TOPIC_TF_STATIC, '/tf_static'),
    batteryState: envValue(import.meta.env.VITE_ROS_TOPIC_BATTERY_STATE, '/battery_state'),
    diagnostics: envValue(import.meta.env.VITE_ROS_TOPIC_DIAGNOSTICS, '/diagnostics'),
  },
  rosCommands: {
    navigateActionName: envValue(
      import.meta.env.VITE_ROS_NAVIGATE_ACTION_NAME,
      '/navigate_to_pose',
    ),
    navigateThroughPosesActionName: envValue(
      import.meta.env.VITE_ROS_NAVIGATE_THROUGH_POSES_ACTION_NAME,
      '/navigate_through_poses',
    ),
    timeoutMs: envNumber(import.meta.env.VITE_ROS_COMMAND_TIMEOUT_MS, 6000),
  },
  localizationLostTimeoutMs: envNumber(
    import.meta.env.VITE_ROS_LOCALIZATION_LOST_TIMEOUT_MS,
    30000,
  ),
  snapshotPath: '/runtime/snapshot',
}
