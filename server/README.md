# chassis-server

底盘任务/日志后端骨架：rosbridge 客户端 + SQLite 持久化 + 定时调度。

**零第三方 npm 依赖**，只用 Node 内置能力（`node:sqlite`、`node:http`、全局 `WebSocket`、`node:crypto`）。跑起来不需要 `npm install`。

## 定位

- 联调时随 ROS 一起启动即可，不需要 7×24 常驻。
- 数据写进 `server/data/chassis.db`（SQLite），跨会话累积，刷新/关机不丢。
- 浏览器只负责展示；任务命令、定时调度、日志持久化都在这里。

## 运行

要求 Node ≥ 23.4（推荐 24）；Node 22.x 需加 `--experimental-sqlite`。

```powershell
# 在仓库根目录，或先 cd server
cd server
node src/index.js
# 或
npm start
```

配置走环境变量（见 `.env.example`）。Windows PowerShell 临时设置示例：

```powershell
$env:ROSBRIDGE_WS_URL="ws://192.168.43.100:9090"
$env:PORT="8080"
node src/index.js
```

启动后：

- HTTP/SSE 服务：`http://0.0.0.0:8080`
- 自动连接 rosbridge，订阅 `/rosout`、`/diagnostics`（和可选的 STM32 topic）落库
- 自动恢复未过期的定时计划；临时断线或机器人忙时保留本次触发并重试

## 数据模型

| 表 | 作用 |
|---|---|
| `logs` | 所有日志（rosbridge 采集 + 后端自身事件） |
| `routes` | 保存的巡检路线（有序目标点序列） |
| `schedules` | 定时计划（once / interval / daily） |
| `task_runs` | 每次移动 = 一条记录（路线快照、状态、goal、feedback、剩余航点） |
| `task_run_events` | 执行事件（created / running / paused / resumed / completed / failed / canceled，含 source） |
| `schedule_runs` | 每一次计划触发记录，用于防重、失败重试和重启恢复 |

「有没有人为暂停」查 `task_run_events` 里 `event IN ('paused','resumed') AND source='human'` 即可。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/api/stream` | SSE 推送：`log`、`task-run` 事件 |
| GET | `/api/logs?since=&before=&level=&module=&limit=` | 分页/过滤查日志 |
| GET/POST | `/api/routes` | 列出 / 保存巡检路线 |
| GET/POST | `/api/schedules` | 列出 / 创建定时计划 |
| GET | `/api/task-runs?mapId=&limit=` | 任务执行记录列表 |
| GET | `/api/task-runs/:id` | 单条记录 + 事件 |
| POST | `/api/tasks/dispatch` | 手动下发任务 |
| POST | `/api/tasks/:id/pause` | 暂停（记 `paused` 事件 + 取消 goal） |
| POST | `/api/tasks/:id/resume` | 继续（重新下发路线） |
| POST | `/api/tasks/:id/cancel` | 取消 |

### 创建巡检路线

```json
POST /api/routes
{
  "name": "一号线巡检",
  "mapId": "map-1",
  "targets": [
    { "id": "A", "name": "点A", "x": 1.0, "y": 2.0, "yawRad": 0, "frameId": "map" },
    { "id": "B", "name": "点B", "x": 3.0, "y": 4.0, "yawRad": 0, "frameId": "map" }
  ]
}
```

### 创建定时计划

```json
// 每 60 分钟巡检一次
POST /api/schedules
{ "name": "每小时巡检", "routeId": "<route-id>", "mode": "interval", "intervalMinutes": 60 }

// 每天 14:00 巡检
POST /api/schedules
{ "name": "每日巡检", "routeId": "<route-id>", "mode": "daily", "timeOfDay": "14:00" }

// 一次性定时
POST /api/schedules
{ "name": "一次性任务", "routeId": "<route-id>", "mode": "once", "scheduledAt": 1760000000000 }
```

### 手动下发

```json
POST /api/tasks/dispatch
{ "routeId": "<route-id>" }
```

## 当前任务状态机

- 暂停：`running → pausing → paused`，只有 Nav2 返回 `status=5` 后才确认暂停。
- 取消：`running → canceling → canceled`，不会在取消请求发出时提前写终态。
- 继续：根据 `number_of_poses_remaining` 只下发尚未完成的航点；只剩一个点时自动使用 `NavigateToPose`。
- feedback：剩余距离、预计时间、恢复次数、剩余航点和下一个目标点下标都会写回 `task_runs`。
- 后端重启或 rosbridge 断线时，未结束任务会标记为 `unknown`，阻止新的定时任务覆盖现场。

## 暂未实现

- 实际行驶轨迹（`/amcl_pose`）持久化暂未接入；目前永久保存的是任务路线快照、状态、操作事件、feedback 和系统日志。
- `unknown` 任务仍需操作员在上位机确认后取消或处理，不能在无法确认原 goal 的情况下自动重发。

## 与前端对接（后续）

前端保持 rosbridge 直连做高频遥测；任务/日志/定时改走这里的 `8080`：

- 查历史日志：`GET /api/logs`
- 实时日志/任务状态：`EventSource('/api/stream')`
- 下任务/建计划：上面的 POST 接口
