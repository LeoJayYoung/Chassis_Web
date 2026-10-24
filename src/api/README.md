# Front-end data boundaries

The production UI uses two independent data paths:

```text
ROS telemetry:
rosbridgeRuntime -> rosNormalizer -> Pinia -> pages

Business data:
BackendClient -> REST/SSE -> Pinia -> Tasks / Logs
```

## Source modes

`VITE_DATA_SOURCE` supports:

```text
mock
rosbridge
```

- `mock` keeps the browser-only demonstration, including local task movement.
- `rosbridge` subscribes to map, localization, path and chassis telemetry.
- Task commands, schedules and persistent logs use the business backend when
  `VITE_BACKEND_ENABLED=true`.

Production configuration:

```env
VITE_DATA_SOURCE=rosbridge
VITE_BACKEND_ENABLED=true
VITE_BACKEND_API_BASE_URL=http://127.0.0.1:8080/api
VITE_ROSBRIDGE_WS_URL=ws://192.168.43.100:9090
```

Vite reads environment variables only when the dev server starts.

## Responsibilities

- `rosbridgeRuntime.ts`: subscribes to ROS telemetry only.
- `rosNormalizer.ts`: converts ROS messages into front-end runtime models.
- `backendClient.ts`: task, schedule, route-template and log REST/SSE client.
- `stores/backendSync.ts`: maps backend records and maintains live SSE state.
- `stores/taskCommands.ts`: sends business commands to the backend.
- `stores/mock.ts`: browser-only mock movement and schedule simulation.
- `stores/robotRuntime.ts`: shared Pinia state and public page actions.

The browser does not send Nav2 Action commands in production. The Node backend
is the single command authority and owns task persistence, pause/resume,
scheduled dispatch and Action feedback/result processing.

## Runtime collections

Business entities remain separate:

```text
runtime.taskRuns       -> task_runs
runtime.schedules      -> schedules
runtime.routeTemplates -> routes
```

A recurring schedule remains visible after each execution. Each execution
creates a separate task run while preserving its `schedule_id` and route
snapshot.

## ROS telemetry topics

| Topic | ROS message |
| --- | --- |
| `/map` | `nav_msgs/msg/OccupancyGrid` |
| `/keepout_filter_mask` | `nav_msgs/msg/OccupancyGrid` |
| `/amcl_pose` | `geometry_msgs/msg/PoseWithCovarianceStamped` |
| `/plan` | `nav_msgs/msg/Path` |
| `/odom` | `nav_msgs/msg/Odometry` |
| `/cmd_vel` | `geometry_msgs/msg/Twist` |
| `/tf`, `/tf_static` | `tf2_msgs/msg/TFMessage` |
| `/battery_state` | `sensor_msgs/msg/BatteryState` |
| `/diagnostics` | `diagnostic_msgs/msg/DiagnosticArray` |

Malformed ROS messages are rejected by the normalizer instead of entering the
Store. The last valid AMCL pose remains visible while localization freshness is
tracked independently by the configured timeout.
