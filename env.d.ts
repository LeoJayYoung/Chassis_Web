/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'mock' | 'rosbridge'
  readonly VITE_BACKEND_ENABLED?: string
  readonly VITE_BACKEND_API_BASE_URL?: string
  readonly VITE_ROSBRIDGE_WS_URL?: string
  readonly VITE_ROS_TOPIC_MAP?: string
  readonly VITE_ROS_TOPIC_KEEPOUT_FILTER_MASK?: string
  readonly VITE_ROS_TOPIC_AMCL_POSE?: string
  readonly VITE_ROS_TOPIC_PLAN?: string
  readonly VITE_ROS_TOPIC_ODOM?: string
  readonly VITE_ROS_TOPIC_CMD_VEL?: string
  readonly VITE_ROS_TOPIC_TF?: string
  readonly VITE_ROS_TOPIC_TF_STATIC?: string
  readonly VITE_ROS_TOPIC_BATTERY_STATE?: string
  readonly VITE_ROS_TOPIC_DIAGNOSTICS?: string
  readonly VITE_ROS_LOCALIZATION_LOST_TIMEOUT_MS?: string
  readonly VITE_MAP_VISUAL_FILTER_ENABLED?: string
  readonly VITE_MAP_OCCUPIED_THRESHOLD?: string
  readonly VITE_MAP_MIN_COMPONENT_CELLS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
