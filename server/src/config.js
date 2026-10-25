import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function env(name, fallback) {
  const value = process.env[name]
  return value === undefined || value.trim() === '' ? fallback : value.trim()
}

function envNumber(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const config = {
  port: envNumber('PORT', 8080),
  host: env('HOST', '0.0.0.0'),
  rosbridgeWsUrl: env('ROSBRIDGE_WS_URL', 'ws://192.168.43.100:9090'),
  dbPath: env('DB_PATH', path.join(__dirname, '..', 'data', 'chassis.db')),
  rosbridgeReconnectMs: envNumber('ROSBRIDGE_RECONNECT_MS', 1600),
  schedulerRetryMs: envNumber('SCHEDULER_RETRY_MS', 30_000),
  // 日志保留策略：超过 N 天的日志定期清理；maxRows>0 时再按条数兜底
  logRetentionDays: envNumber('LOG_RETENTION_DAYS', 30),
  logMaxRows: envNumber('LOG_MAX_ROWS', 0),
  logCleanupIntervalMs: envNumber('LOG_CLEANUP_INTERVAL_MS', 60 * 60 * 1000),
  // 日志采集 topic
  logTopics: {
    rosout: env('ROS_TOPIC_ROSOUT', '/rosout'),
    diagnostics: env('ROS_TOPIC_DIAGNOSTICS', '/diagnostics'),
    // 底盘/STM32 日志需要上位机发布到某个 topic，这里可留空
    stm32: env('ROS_TOPIC_STM32_LOG', ''),
    stm32Type: env('ROS_TOPIC_STM32_LOG_TYPE', 'std_msgs/msg/String'),
  },
  // Nav2 action 名称
  rosActions: {
    navigateToPose: env('ROS_NAVIGATE_ACTION_NAME', '/navigate_to_pose'),
    navigateThroughPoses: env(
      'ROS_NAVIGATE_THROUGH_POSES_ACTION_NAME',
      '/navigate_through_poses',
    ),
  },
  frameId: env('ROS_DEFAULT_FRAME_ID', 'map'),
}
