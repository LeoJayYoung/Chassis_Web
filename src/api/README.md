# Runtime data source

The pages do not read Mock data or ROS messages directly. The runtime data flow is:

```text
page -> Pinia store -> RuntimeDataSource -> mock or real transport
```

When the real transport receives raw ROS topics, the boundary becomes:

```text
rosbridgeRuntime -> rosNormalizer -> Pinia store -> page
```

`rosNormalizer.ts` is a pure conversion layer. It does not open a WebSocket,
write to Pinia, or contain page-specific rendering logic. It only converts
ROS message shapes into the `Runtime*` models exported from `src/types`.

## Switch data source

The switch is controlled by `VITE_DATA_SOURCE`:

```text
mock
real
rosbridge
```

If the variable is missing or has another value, the application uses `mock`.

Copy `.env.example` to `.env.local`, then change the value and restart Vite:

```text
VITE_DATA_SOURCE=real
VITE_RUNTIME_API_BASE_URL=http://127.0.0.1:8080/api
VITE_RUNTIME_WS_URL=ws://127.0.0.1:8080/ws/runtime
```

To connect directly to rosbridge:

```text
VITE_DATA_SOURCE=rosbridge
VITE_ROSBRIDGE_WS_URL=ws://127.0.0.1:9090
```

Vite environment variables are read when the dev server starts. Changing the
file while Vite is running requires a restart.

## Real transport contract

The current real adapter expects a normalized runtime model, not raw ROS
messages.

Initial snapshot:

```text
GET /runtime/snapshot
```

The response body is a `RuntimeDashboardSnapshot`. A response wrapper is also
accepted:

```json
{
  "data": {}
}
```

Live updates are sent through WebSocket as either a full snapshot or a wrapped
message:

```json
{
  "type": "runtime_snapshot",
  "data": {}
}
```

`runtime_update` is also accepted. The payload still needs to contain the
front-end `RuntimeDashboardSnapshot` shape.

## Where to write code

- `config.ts`: environment variables and the data source switch.
- `runtime.ts`: the common contract shared by Mock and real transports.
- `mockRuntime.ts`: local demo snapshot.
- `realRuntime.ts`: HTTP and WebSocket transport.
- `rosbridgeRuntime.ts`: connects to `rosbridge_server`, subscribes to ROS
  topics, normalizes each message, and emits a patched runtime snapshot.
- `rosNormalizer.ts`: converts raw ROS topic messages into front-end models.
- `rosCommands.ts`: sends ROS/Nav2 commands such as navigation goal,
  pause, resume, and cancel.
- `dataSource.ts`: selects the implementation.
- `stores/robotRuntime.ts`: puts the snapshot into Pinia and exposes it to
  pages.
- `utils/dashboardAdapters.ts`: converts the normalized runtime model into the
  Map, Overview, Status, and Logs view models.

The real adapter intentionally uses a normalized snapshot boundary. If the
upper computer only exposes raw ROS topics such as `/map`, `/amcl_pose`, and
`/plan`, add a ROS adapter or a small gateway that converts those messages to
`RuntimeDashboardSnapshot`. The pages should not need to change for that
transport replacement.

## Rosbridge transport notes

`rosbridgeRuntime.ts` implements the same `RuntimeDataSource` interface as
Mock and real transports. Its initial `loadSnapshot()` returns the Mock
snapshot as a safe base, because ROS topics do not provide a single complete
page snapshot. After the WebSocket connects, each ROS topic patches only the
fields it owns:

| ROS topic | Runtime field patched |
| --- | --- |
| `/map` | `map.occupancyGrid`, `map.ros`, map dimensions |
| `/amcl_pose` | `map.robotPose`, `localization` |
| `/plan` | `map.routePoints` |
| `/odom` | `telemetry.odometry`, speed metrics |
| `/cmd_vel` | `telemetry.commandVelocity`, speed metrics fallback |
| `/tf`, `/tf_static` | `telemetry.tfFrames`, localization readiness |
| `/battery_state` | `telemetry.battery`, `robot.batteryPercent` |
| `/diagnostics` | `telemetry.diagnostics`, `systemStatus`, `alarms` |

In `rosbridge` mode the Pinia Store preserves front-end owned fields such as
`tasks`, `task`, `map.targets`, `map.activeTargetId`, and `logs`. This prevents
high-frequency ROS messages from overwriting user-created tasks and saved
target points.

Localization is also guarded by a timeout. After rosbridge connects, if the
front end does not receive `/amcl_pose` within the configured timeout, or stops
receiving it later, `localization` is set to `lost`. A new `/amcl_pose` message
sets it back to `ready`.

```text
VITE_ROS_LOCALIZATION_LOST_TIMEOUT_MS=5000
```

The transport uses native rosbridge WebSocket JSON messages, so no additional
`roslibjs` dependency is required yet. If the project later standardizes on
`roslibjs`, only this transport layer needs to be replaced.

## Task command flow

Reading ROS data and writing ROS commands are intentionally separated:

```text
rosbridgeRuntime.ts -> reads ROS topics
rosCommands.ts      -> writes ROS/Nav2 commands
```

The Store calls `rosCommands.ts` only in `rosbridge` mode. Mock mode keeps the
existing local task simulation.

Current command mapping:

| UI action | ROS command |
| --- | --- |
| Create / start navigation task | `NavigateToPose` action `send_goal` |
| Pause task | `NavigateToPose` action `cancel_goal`, while keeping the front-end task as `paused` |
| Resume task | Sends a new `NavigateToPose` goal to the saved target |
| Cancel task | `NavigateToPose` action `cancel_goal`, then marks the task as `canceled` |

Task feedback is also handled in this layer. `rosCommands.ts` subscribes to:

```text
/navigate_to_pose/_action/feedback
/navigate_to_pose/_action/status
```

It maps the ROS action `goal_id` back to the front-end `taskId`, then emits
task events to the Pinia Store. The Store patches:

| ROS feedback | Runtime task field |
| --- | --- |
| `distance_remaining` | `feedback`, `progressPercent` when a route length is available |
| `estimated_time_remaining` | `etaMinutes` |
| `number_of_recoveries` | `feedback` |
| action status `EXECUTING` | `status: running` |
| action status `SUCCEEDED` | `status: completed`, `progressPercent: 100` |
| action status `CANCELED` | `status: canceled`, or `paused` when it came from the front-end pause action |
| action status `ABORTED` | `status: failed`, `failureReason` |

When a terminal action status arrives, the command client also makes a
best-effort `get_result` call:

```text
/navigate_to_pose/_action/get_result
```

The result fills in the final task feedback or failure reason when Nav2
provides one.

This is the lightweight direct-Nav2 approach. If the upper computer later adds
a dedicated task manager node, `rosCommands.ts` is the place to replace direct
Nav2 calls with that node's service or action API.

## Normalized ROS messages

The normalizer currently supports these topics. A malformed message returns
`null` instead of entering the Store.

| ROS topic | ROS message | Front-end model | Main use |
| --- | --- | --- | --- |
| `/map` | `nav_msgs/msg/OccupancyGrid` | `RuntimeOccupancyGrid` | Occupancy map pixels and map metadata |
| `/amcl_pose` | `geometry_msgs/msg/PoseWithCovarianceStamped` | `RuntimeRobotPose` | Robot position and heading |
| `/plan` | `nav_msgs/msg/Path` | `RuntimePathSnapshot` | Planned route rendering |
| `/odom` | `nav_msgs/msg/Odometry` | `RuntimeOdometrySnapshot` | Pose and actual velocity |
| `/cmd_vel` | `geometry_msgs/msg/Twist` or `TwistStamped` | `RuntimeTwist` | Velocity command |
| `/tf` | `tf2_msgs/msg/TFMessage` | `RuntimeTfFrame[]` | Dynamic coordinate relationships |
| `/tf_static` | `tf2_msgs/msg/TFMessage` | `RuntimeTfFrame[]` | Static coordinate relationships |
| `/battery_state` | `sensor_msgs/msg/BatteryState` | `RuntimeBatteryState` | Voltage, current and battery percentage |
| `/diagnostics` | `diagnostic_msgs/msg/DiagnosticArray` | `RuntimeDiagnosticItem[]` | STM32, motor and sensor diagnostic status |

The normalizer also accepts namespaced topics such as
`/robot_1/amcl_pose`, and canonicalizes them to the topic names above.
