/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'mock' | 'real' | 'rosbridge'
  readonly VITE_RUNTIME_API_BASE_URL?: string
  readonly VITE_RUNTIME_WS_URL?: string
  readonly VITE_ROSBRIDGE_WS_URL?: string
  readonly VITE_ROS_TOPIC_MAP?: string
  readonly VITE_ROS_TOPIC_AMCL_POSE?: string
  readonly VITE_ROS_TOPIC_PLAN?: string
  readonly VITE_ROS_TOPIC_ODOM?: string
  readonly VITE_ROS_TOPIC_CMD_VEL?: string
  readonly VITE_ROS_TOPIC_TF?: string
  readonly VITE_ROS_TOPIC_TF_STATIC?: string
  readonly VITE_ROS_TOPIC_BATTERY_STATE?: string
  readonly VITE_ROS_TOPIC_DIAGNOSTICS?: string
  readonly VITE_ROS_NAVIGATE_ACTION_NAME?: string
  readonly VITE_ROS_COMMAND_TIMEOUT_MS?: string
  readonly VITE_ROS_LOCALIZATION_LOST_TIMEOUT_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
