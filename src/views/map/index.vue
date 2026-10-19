<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import MapContainer from '../../components/map/MapContainer.vue'
import { useRobotRuntimeStore } from '../../stores/robotRuntime'
import type { MapPoint, NavigationMode, TaskStatus, TaskType } from '../../types'

type DispatchMode = 'immediate' | 'scheduled'

const runtimeStore = useRobotRuntimeStore()
const { mapDashboard: dashboard } = storeToRefs(runtimeStore)
const targetSelectionMode = ref(false)
const targetDraft = ref<MapPoint | null>(null)
const targetDraftName = ref('')
const selectedTaskType = ref<TaskType>(dashboard.value.task.type)
const selectedCruiseTargetIds = ref<string[]>([])
const selectedDispatchMode = ref<DispatchMode>('immediate')
const scheduledAtInput = ref('')
const actionMessage = ref('')

const navigationModeLabels: Record<NavigationMode, string> = {
  auto_navigation: '自动导航',
  manual_control: '手动控制',
}

const taskTypeLabels: Record<TaskType, string> = {
  single_point_navigation: '单点导航',
  multi_point_cruise: '多点巡航',
  return_home: '返航',
}

const taskStatusLabels: Record<TaskStatus, string> = {
  idle: '空闲',
  running: '执行中',
  paused: '已暂停',
  canceled: '已取消',
  completed: '已完成',
  failed: '失败',
}

const localizationLabels = {
  ready: '已就绪',
  initializing: '初始化中',
  lost: '已丢失',
} as const

const connectionLabels = {
  connected: '已连接',
  disconnected: '未连接',
} as const

const modeOptions = [
  'single_point_navigation',
  'multi_point_cruise',
  'return_home',
] as const

const activeTarget = computed(
  () => dashboard.value.targets.find((item) => item.id === dashboard.value.activeTargetId) ?? null,
)
const selectedCruiseTargets = computed(() =>
  selectedCruiseTargetIds.value.flatMap((targetId) => {
    const target = dashboard.value.targets.find((item) => item.id === targetId)

    return target ? [target] : []
  }),
)
const selectedTargetSummary = computed(() => {
  if (selectedTaskType.value === 'multi_point_cruise') {
    return selectedCruiseTargets.value.length
      ? selectedCruiseTargets.value.map((target) => target.name).join(' → ')
      : '请选择至少 2 个目标点'
  }

  return activeTarget.value?.name ?? targetDraft.value?.name ?? '待选择'
})

const canDispatch = computed(
  () => {
    const hasTarget =
      selectedTaskType.value === 'return_home' ||
      (selectedTaskType.value === 'multi_point_cruise'
        ? selectedCruiseTargetIds.value.length >= 2
        : Boolean(activeTarget.value))

    if (!hasTarget) return false

    if (selectedDispatchMode.value === 'immediate') return true

    return scheduledAtTimestamp.value !== null && scheduledAtTimestamp.value > Date.now()
  },
)
const canPause = computed(() => dashboard.value.task.status === 'running')
const canContinue = computed(() => dashboard.value.task.status === 'paused')
const canCancel = computed(() =>
  ['running', 'paused'].includes(dashboard.value.task.status),
)
const minScheduleDateTime = computed(() => toDatetimeLocalValue(Date.now() + 60_000))
const scheduledAtTimestamp = computed(() => {
  if (!scheduledAtInput.value) return null

  const timestamp = new Date(scheduledAtInput.value).getTime()

  return Number.isFinite(timestamp) ? timestamp : null
})

function toDatetimeLocalValue(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join('T')
}

function formatScheduleTime(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function taskStatusClass(status: TaskStatus) {
  if (status === 'running' || status === 'completed') return 'is-good'
  if (status === 'paused') return 'is-warning'
  if (status === 'failed' || status === 'canceled') return 'is-error'
  return 'is-muted'
}

function connectionStatusClass(status: keyof typeof connectionLabels) {
  return status === 'connected' ? 'is-good' : 'is-error'
}

function localizationStatusClass(status: keyof typeof localizationLabels) {
  if (status === 'ready') return 'is-good'
  if (status === 'initializing') return 'is-warning'
  return 'is-error'
}

function selectTarget(targetId: string) {
  targetDraft.value = null
  targetSelectionMode.value = false

  if (selectedTaskType.value === 'multi_point_cruise') {
    const targetIndex = selectedCruiseTargetIds.value.indexOf(targetId)

    if (targetIndex >= 0) {
      selectedCruiseTargetIds.value = selectedCruiseTargetIds.value.filter(
        (item) => item !== targetId,
      )
    } else {
      selectedCruiseTargetIds.value = [...selectedCruiseTargetIds.value, targetId]
    }

    runtimeStore.setActiveTarget(selectedCruiseTargetIds.value.at(-1))
    actionMessage.value = selectedCruiseTargetIds.value.length
      ? `已选择 ${selectedCruiseTargetIds.value.length} 个巡航目标点。`
      : '请选择至少 2 个巡航目标点。'
    return
  }

  runtimeStore.setActiveTarget(targetId)
  actionMessage.value = '目标点已选中，可以下发任务。'
}

function handleMapClick(point: Pick<MapPoint, 'x' | 'y'>) {
  targetDraft.value = {
    id: 'draft-target',
    name: '未保存目标',
    x: point.x,
    y: point.y,
  }
  targetDraftName.value = ''
  runtimeStore.clearActiveTarget()
  actionMessage.value = '目标点已框选，请点击“保存目标”。'
}

function updateDraftName() {
  if (!targetDraft.value) return

  targetDraft.value.name = targetDraftName.value.trim() || '未保存目标'
}

function toggleTargetSelection() {
  targetSelectionMode.value = !targetSelectionMode.value
  actionMessage.value = targetSelectionMode.value
    ? '请在地图上点击已有目标点或空白位置。'
    : ''
}

function saveTarget() {
  if (!targetDraft.value) {
    actionMessage.value = '请先在地图上框选一个目标点。'
    return
  }

  const target = runtimeStore.saveTargetFromCanvas(targetDraft.value, targetDraftName.value)
  targetDraft.value = null
  targetDraftName.value = ''
  targetSelectionMode.value = false
  if (selectedTaskType.value === 'multi_point_cruise') {
    selectedCruiseTargetIds.value = [...selectedCruiseTargetIds.value, target.id]
  }
  actionMessage.value = `目标点 ${target.name} 已保存。`
}

function clearTarget() {
  targetDraft.value = null
  targetSelectionMode.value = false
  selectedCruiseTargetIds.value = []
  runtimeStore.clearActiveTarget()
  actionMessage.value = '当前目标选择已清除。'
}

function removeTarget(targetId: string) {
  const removed = runtimeStore.deleteTarget(targetId)
  if (removed) {
    selectedCruiseTargetIds.value = selectedCruiseTargetIds.value.filter(
      (item) => item !== targetId,
    )
  }
  actionMessage.value = removed ? '目标点已移除。' : '目标点正在被任务使用，无法移除。'
}

function selectTaskType(type: TaskType) {
  selectedTaskType.value = type
  if (type !== 'multi_point_cruise') {
    selectedCruiseTargetIds.value = []
  }
  actionMessage.value =
    type === 'multi_point_cruise'
      ? '请按巡航顺序选择至少 2 个已保存目标点。'
      : ''
}

function cruiseTargetOrder(targetId: string) {
  const index = selectedCruiseTargetIds.value.indexOf(targetId)

  return index >= 0 ? index + 1 : null
}

function selectDispatchMode(mode: DispatchMode) {
  selectedDispatchMode.value = mode

  if (mode === 'scheduled' && !scheduledAtInput.value) {
    scheduledAtInput.value = toDatetimeLocalValue(Date.now() + 5 * 60_000)
  }
}

function dispatchTask() {
  const scheduledAt =
    selectedDispatchMode.value === 'scheduled'
      ? (scheduledAtTimestamp.value ?? undefined)
      : undefined

  const taskId = runtimeStore.createTask({
    type: selectedTaskType.value,
    targetPointId:
      selectedTaskType.value === 'single_point_navigation'
        ? dashboard.value.activeTargetId
        : undefined,
    targetPointIds:
      selectedTaskType.value === 'multi_point_cruise'
        ? selectedCruiseTargetIds.value
        : undefined,
    dispatchMode: selectedDispatchMode.value,
    scheduledAt,
  })

  if (!taskId) {
    actionMessage.value =
      selectedDispatchMode.value === 'scheduled'
        ? '请确认目标点和计划执行时间。'
        : '请先选择并保存目标点。'
    return
  }

  actionMessage.value =
    selectedDispatchMode.value === 'scheduled' && scheduledAt
      ? `定时任务 ${taskId} 已创建，计划 ${formatScheduleTime(scheduledAt)} 执行。`
      : `任务 ${taskId} 已创建并同步到任务页。`

  if (selectedTaskType.value === 'multi_point_cruise') {
    selectedCruiseTargetIds.value = []
  }
}

function pauseCurrentTask() {
  runtimeStore.pauseTask(dashboard.value.task.id)
}

function continueCurrentTask() {
  runtimeStore.continueTask(dashboard.value.task.id)
}

function cancelCurrentTask() {
  runtimeStore.cancelTask(dashboard.value.task.id)
}
</script>

<template>
  <section class="map-page">
    <header class="map-page__topbar">
      <div class="map-page__heading">
        <div class="map-page__eyebrow">
          <span>ROBOT CHASSIS CONTROL</span>
          <span>/</span>
          <strong>MAP CONTROL</strong>
        </div>
        <h1 class="map-page__title">Map Control</h1>
      </div>

      <div class="map-page__status-strip" aria-label="页面状态">
        <div class="status-chip">
          <span
            class="status-dot"
            :class="connectionStatusClass(dashboard.connection)"
            aria-hidden="true"
          ></span>
          <div>
            <span class="status-chip__label">连接</span>
            <strong>{{ connectionLabels[dashboard.connection] }}</strong>
          </div>
        </div>
        <div class="status-chip">
          <span class="status-dot is-accent" aria-hidden="true"></span>
          <div>
            <span class="status-chip__label">模式</span>
            <strong>{{ navigationModeLabels[dashboard.navigationMode] }}</strong>
          </div>
        </div>
        <div class="status-chip">
          <span
            class="status-dot"
            :class="localizationStatusClass(dashboard.localization)"
            aria-hidden="true"
          ></span>
          <div>
            <span class="status-chip__label">定位</span>
            <strong>{{ localizationLabels[dashboard.localization] }}</strong>
          </div>
        </div>
        <div class="status-chip">
          <span
            class="status-dot"
            :class="taskStatusClass(dashboard.task.status)"
            aria-hidden="true"
          ></span>
          <div>
            <span class="status-chip__label">任务</span>
            <strong>{{ taskStatusLabels[dashboard.task.status] }}</strong>
          </div>
        </div>
      </div>
    </header>

    <main class="map-page__body">
      <section class="map-page__canvas" aria-label="地图显示区">
        <MapContainer
          :robot-pose="dashboard.robotPose"
          :scene="dashboard.scene"
          :show-robot="dashboard.robotVisible"
          :selected-target-ids="selectedCruiseTargetIds"
          :selection-mode="targetSelectionMode"
          :draft-target="targetDraft ?? undefined"
          @target-select="selectTarget"
          @map-click="handleMapClick"
        />
      </section>

      <aside class="map-page__panel" aria-label="地图控制区">
        <section class="panel-block panel-block--targets">
          <div class="panel-block__head">
            <div>
              <p class="panel-block__eyebrow">目标与管理</p>
              <h2 class="panel-block__title">目标点与保存</h2>
            </div>
          </div>

          <div class="panel-summary">
            <div class="panel-summary__item">
              <span class="panel-summary__label">目标点</span>
              <strong>{{ selectedTargetSummary }}</strong>
            </div>
            <div class="panel-summary__item">
              <span class="panel-summary__label">已保存</span>
              <strong>{{ dashboard.targets.length }}</strong>
            </div>
          </div>

          <div class="target-list">
            <div
              v-for="target in dashboard.targets"
              :key="target.id"
              class="target-row"
              :class="{
                'is-active':
                  target.id === dashboard.activeTargetId ||
                  selectedCruiseTargetIds.includes(target.id),
              }"
              role="button"
              tabindex="0"
              @click="selectTarget(target.id)"
              @keydown.enter="selectTarget(target.id)"
            >
              <div>
                <strong>
                  <span
                    v-if="cruiseTargetOrder(target.id)"
                    class="target-order-badge"
                  >
                    {{ cruiseTargetOrder(target.id) }}
                  </span>
                  {{ target.name }}
                </strong>
                <span>{{ target.saved ? '已保存' : '地图目标' }}</span>
              </div>
              <button
                type="button"
                aria-label="移除目标点"
                title="移除目标点"
                @click.stop="removeTarget(target.id)"
              >
                ×
              </button>
            </div>
            <div v-if="targetDraft" class="target-row is-draft">
              <div>
                <strong>{{ targetDraft.name }}</strong>
                <span>待保存</span>
              </div>
            </div>
          </div>

          <input
            v-if="targetDraft"
            v-model="targetDraftName"
            class="target-name-input"
            type="text"
            maxlength="24"
            placeholder="目标名称（可选）"
            aria-label="目标名称"
            @input="updateDraftName"
          />

          <div class="panel-actions">
            <button
              class="panel-button panel-button--primary"
              :class="{ 'is-active': targetSelectionMode }"
              type="button"
              @click="toggleTargetSelection"
            >
              {{ targetSelectionMode ? '结束框选' : '框选目标点' }}
            </button>
            <button
              class="panel-button panel-button--soft"
              type="button"
              :disabled="!targetDraft"
              @click="saveTarget"
            >
              保存目标
            </button>
            <button class="panel-button panel-button--soft" type="button" @click="clearTarget">
              清除目标
            </button>
          </div>
        </section>

        <section class="panel-block panel-block--task">
          <div class="panel-block__head">
            <div>
              <p class="panel-block__eyebrow">任务控制</p>
              <h2 class="panel-block__title">下发与执行</h2>
            </div>
          </div>

          <div class="mode-strip">
            <button
              v-for="mode in modeOptions"
              :key="mode"
              class="mode-chip"
              :class="{ 'is-active': mode === selectedTaskType }"
              type="button"
              @click="selectTaskType(mode)"
            >
              {{ taskTypeLabels[mode] }}
            </button>
          </div>

          <div class="dispatch-mode-strip" aria-label="任务执行方式">
            <button
              class="mode-chip"
              :class="{ 'is-active': selectedDispatchMode === 'immediate' }"
              type="button"
              @click="selectDispatchMode('immediate')"
            >
              立即下发
            </button>
            <button
              class="mode-chip"
              :class="{ 'is-active': selectedDispatchMode === 'scheduled' }"
              type="button"
              @click="selectDispatchMode('scheduled')"
            >
              定时下发
            </button>
          </div>

          <label v-if="selectedDispatchMode === 'scheduled'" class="schedule-field">
            <span>计划执行时间</span>
            <input
              v-model="scheduledAtInput"
              type="datetime-local"
              :min="minScheduleDateTime"
              aria-label="计划执行时间"
            />
          </label>

          <p v-if="actionMessage" class="panel-feedback">{{ actionMessage }}</p>
          <div class="panel-actions panel-actions--compact">
            <button
              class="panel-button panel-button--primary"
              type="button"
              :disabled="!canDispatch"
              @click="dispatchTask"
            >
              {{ selectedDispatchMode === 'scheduled' ? '创建定时任务' : '下发任务' }}
            </button>
            <button
              class="panel-button panel-button--warning"
              type="button"
              :disabled="!canPause"
              @click="pauseCurrentTask"
            >
              暂停
            </button>
            <button
              class="panel-button panel-button--success"
              type="button"
              :disabled="!canContinue"
              @click="continueCurrentTask"
            >
              继续
            </button>
            <button
              class="panel-button panel-button--danger"
              type="button"
              :disabled="!canCancel"
              @click="cancelCurrentTask"
            >
              取消
            </button>
          </div>
        </section>

      </aside>
    </main>

    <section class="map-page__status-monitor" aria-label="状态监控">
      <div class="map-page__status-head">
        <div>
          <p class="panel-block__eyebrow">STATUS MONITOR</p>
          <h2 class="panel-block__title">状态监控</h2>
        </div>
      </div>

      <div class="status-monitor-grid">
        <article class="status-monitor-card">
          <span class="status-monitor-card__label">机器人状态</span>
          <strong class="status-monitor-card__value">
            <i
              class="status-dot"
              :class="dashboard.robot === 'online' ? 'is-good' : 'is-error'"
              aria-hidden="true"
            ></i>
            <span>{{ dashboard.robot === 'online' ? '在线' : '离线' }}</span>
          </strong>
        </article>

        <article class="status-monitor-card">
          <span class="status-monitor-card__label">当前任务</span>
          <strong class="status-monitor-card__value">
            <i
              class="status-dot"
              :class="taskStatusClass(dashboard.task.status)"
              aria-hidden="true"
            ></i>
            <span>{{ dashboard.task.id }} · {{ taskStatusLabels[dashboard.task.status] }}</span>
          </strong>
        </article>

        <article class="status-monitor-card">
          <span class="status-monitor-card__label">定位状态</span>
          <strong class="status-monitor-card__value">
            <i
              class="status-dot"
              :class="localizationStatusClass(dashboard.localization)"
              aria-hidden="true"
            ></i>
            <span>{{ localizationLabels[dashboard.localization] }}</span>
          </strong>
        </article>

        <article class="status-monitor-card">
          <span class="status-monitor-card__label">任务反馈</span>
          <strong class="status-monitor-card__value">
            <i
              class="status-dot"
              :class="taskStatusClass(dashboard.task.status)"
              aria-hidden="true"
            ></i>
            <span>{{ dashboard.task.feedback }}</span>
          </strong>
        </article>
      </div>
    </section>
  </section>
</template>

<style scoped>
.map-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 16px;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: var(--color-text);
}

.map-page__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.map-page__heading {
  display: grid;
  gap: 0;
}

.map-page__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-subtle);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.map-page__eyebrow strong {
  color: var(--color-primary);
}

.map-page__title {
  margin: 4px 0 0;
  color: var(--color-text);
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: 0;
}

.map-page__status-strip {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 10px 14px;
  border-radius: 14px;
  border: 1px solid var(--color-border);
  background: var(--color-card);
}

.status-chip div {
  display: grid;
  gap: 4px;
}

.status-chip__label {
  color: var(--color-muted);
  font-size: 12px;
}

.status-chip strong {
  color: var(--color-text);
  font-size: 13px;
  font-weight: 500;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}

.status-dot.is-good {
  background: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
}

.status-dot.is-accent {
  background: var(--color-primary-dark);
  box-shadow: 0 0 0 4px rgba(11, 59, 46, 0.12);
}

.status-dot.is-warning {
  background: var(--color-warning);
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.12);
}

.status-dot.is-error {
  background: var(--color-error);
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.12);
}

.status-dot.is-muted {
  background: var(--color-subtle);
  box-shadow: 0 0 0 4px rgba(156, 163, 175, 0.12);
}

.map-page__body {
  display: grid;
  grid-template-columns: minmax(0, 1.78fr) minmax(320px, 0.92fr);
  gap: 16px;
  align-items: stretch;
  min-height: 0;
}

.map-page__canvas,
.map-page__panel,
.map-page__status-monitor {
  min-width: 0;
}

.panel-block,
.map-page__status-monitor {
  border: 1px solid var(--color-border);
  border-radius: 18px;
  background: var(--color-card);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.04);
}

.map-page__canvas {
  display: grid;
  min-height: 0;
}

.map-page__panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  max-height: 100%;
  overflow: auto;
  padding-right: 3px;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}

.map-page__panel::-webkit-scrollbar {
  width: 6px;
}

.map-page__panel::-webkit-scrollbar-track {
  background: transparent;
}

.map-page__panel::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: #cbd5e1;
}

.map-page__panel::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

.panel-block {
  padding: 15px;
}

.panel-block--targets {
  flex: 0 0 auto;
}

.panel-block--task {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  margin-top: 6px;
}

.panel-block--task .panel-block__head {
  margin-bottom: 10px;
}

.panel-block--task .panel-actions--compact {
  margin-top: auto;
  padding-top: 12px;
}

.panel-block--task .panel-feedback {
  margin-top: 8px;
}

.panel-block__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.panel-block__eyebrow {
  margin: 0 0 6px;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.panel-block__title {
  margin: 0;
  font-size: 16px;
  line-height: 1.25;
  color: var(--color-text);
}

.panel-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.panel-summary__item {
  position: relative;
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(167, 243, 208, 0.85);
  background:
    linear-gradient(135deg, rgba(236, 253, 245, 0.9) 0%, rgba(255, 255, 255, 0.96) 72%),
    var(--color-card);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85);
}

.panel-summary__label {
  color: var(--color-muted);
  font-size: 12px;
}

.panel-summary__item strong {
  overflow: hidden;
  color: var(--color-primary-dark);
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-list {
  display: grid;
  gap: 8px;
  max-height: 156px;
  margin-top: 12px;
  overflow: auto;
  padding-right: 2px;
}

.target-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(248, 250, 252, 0.98) 0%, rgba(236, 253, 245, 0.42) 100%),
    var(--color-card);
  cursor: pointer;
}

.target-row.is-active,
.target-row.is-draft {
  border-color: var(--color-primary-border);
  background: var(--color-primary-bg);
}

.target-row div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.target-row strong {
  overflow: hidden;
  color: var(--color-text);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-row span {
  color: var(--color-muted);
  font-size: 11px;
}

.target-row .target-order-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--color-primary-dark);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  vertical-align: middle;
}

.target-name-input {
  width: 100%;
  min-height: 38px;
  margin-top: 8px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  outline: none;
  background: var(--color-card);
  color: var(--color-text);
  font: inherit;
  font-size: 12px;
}

.target-name-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
}

.target-row button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-card);
  color: var(--color-muted);
  font: inherit;
  line-height: 1;
}

.target-row button:hover {
  border-color: var(--color-error-border);
  background: var(--color-error-bg);
  color: var(--color-error-strong);
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.panel-actions--compact {
  margin-top: 12px;
}

.panel-button,
.mode-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-card);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}

.panel-button:disabled,
.mode-chip:disabled {
  cursor: not-allowed;
  opacity: 0.46;
}

.panel-button--primary {
  border-color: transparent;
  background: var(--color-primary-dark);
  color: var(--color-card);
}

.panel-button--success {
  border-color: var(--color-primary-border);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.panel-button--warning {
  border-color: var(--color-warning-border);
  background: var(--color-warning-bg);
  color: var(--color-warning-strong);
}

.panel-button--danger {
  border-color: var(--color-error-border);
  background: var(--color-error-bg);
  color: var(--color-error-strong);
}

.panel-button--soft {
  background: var(--color-neutral-bg);
}

.panel-feedback {
  margin: 12px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}

.mode-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.dispatch-mode-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-soft);
}

.mode-chip {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-soft);
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 500;
}

.mode-chip.is-active {
  border-color: var(--color-primary-border);
  background: var(--color-primary-bg);
  color: var(--color-primary-dark);
}

.schedule-field {
  display: grid;
  gap: 7px;
  margin-top: 10px;
}

.schedule-field span {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 600;
}

.schedule-field input {
  width: 100%;
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  outline: none;
  background: var(--color-card);
  color: var(--color-text);
  font: inherit;
  font-size: 12px;
}

.schedule-field input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
}

.map-page__status-monitor {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: auto;
  padding: 14px 16px;
  border-color: rgba(167, 243, 208, 0.74);
  background:
    linear-gradient(135deg, rgba(236, 253, 245, 0.62) 0%, rgba(255, 255, 255, 0.98) 48%, rgba(248, 250, 252, 0.96) 100%),
    var(--color-card);
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.055);
}

.map-page__status-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border-soft);
}

.status-monitor-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  align-content: start;
}

.status-monitor-card {
  display: grid;
  gap: 8px;
  min-height: 78px;
  padding: 14px 16px;
  border: 1px solid rgba(209, 250, 229, 0.9);
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(236, 253, 245, 0.42) 100%),
    var(--color-card);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.035);
}

.status-monitor-card__label {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 600;
}

.status-monitor-card__value {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.25;
}

.status-monitor-card__value span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1120px) {
  .map-page__body {
    grid-template-columns: 1fr;
  }

  .status-monitor-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .map-page__topbar {
    flex-direction: column;
  }

  .map-page__status-strip {
    justify-content: flex-start;
  }

  .panel-summary,
  .status-monitor-grid {
    grid-template-columns: 1fr;
  }

  .panel-block__head,
  .map-page__status-head {
    flex-direction: column;
  }
}
</style>
