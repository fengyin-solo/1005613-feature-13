<template>
  <section class="page" data-module="emergencyrepair">
    <header class="page-head">
      <div>
        <h2>抢修处置管理</h2>
        <p class="page-desc">
          归属按片区轮值落抢修队：只有当前值班队值班人能改故障类型与到场时间，跨队提交打回；
          待派修→抢修中→已恢复（抢修中可升级），越级挡回；恢复后整单只读，并把整改事项推到站点巡检待整改清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showRegister = true">登记抢修记录</button>
        <button class="btn" type="button" @click="showHandover = true">轮值交接</button>
        <button class="btn" type="button" @click="exportRows">导出抢修台账</button>
        <button class="btn ghost" type="button" @click="resetData">复位抢修数据</button>
      </div>
    </header>

    <div class="identity-bar">
      <label class="identity-item">
        <span>当前值班身份（抢修队）</span>
        <select v-model="store.repairTeamId" @change="syncOperator">
          <option v-for="team in REPAIR_TEAMS" :key="team.id" :value="team.id">
            {{ team.name }}（{{ team.district }}）
          </option>
        </select>
      </label>
      <label class="identity-item">
        <span>值班人</span>
        <select v-model="store.repairOperator">
          <option v-for="member in currentMembers" :key="member" :value="member">{{ member }}</option>
        </select>
      </label>
      <span class="identity-hint">切换到别的队即可验证跨队提交打回</span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item held">挂起待补面积：{{ heldCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>抢修编号 / 故障管段</span>
        <input v-model="keyword" placeholder="按编号或管段检索" />
      </label>
      <label class="filter-item">
        <span>所属片区</span>
        <select v-model="districtFilter">
          <option value="">全部</option>
          <option v-for="district in REPAIR_DISTRICTS" :key="district" :value="district">{{ district }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>抢修状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-item check">
        <input v-model="onlyMine" type="checkbox" />
        <span>只看本队在办</span>
      </label>
      <button class="btn" type="submit">查询</button>
    </form>

    <table class="data-table repair-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>到场核定（与详情同一套）</th>
          <th>当前状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="String(row.id)" :class="{ lockedRow: isLocked(row), heldRow: serviceHeld(row) }">
          <td>{{ row['抢修编号'] }}</td>
          <td>{{ row['所属片区'] }}</td>
          <td>{{ row['故障管段'] }}</td>
          <td>{{ row['故障类型'] }}</td>
          <td>
            {{ row['影响面积'] || '缺失' }}
            <span v-if="serviceHeld(row)" class="tag held">挂起</span>
          </td>
          <td>{{ teamNameOf(String(row['归属抢修队'])) }}</td>
          <td>
            {{ teamNameOf(String(row['当前值班队'])) }}
            <span v-if="String(row['当前值班队']) !== String(row['归属抢修队'])" class="tag shifted">已随班移交</span>
          </td>
          <td>{{ row['当前值班人'] }}</td>
          <td>{{ row['到场时间'] || '—' }}</td>
          <td>
            <span :class="assessmentClass(row)">{{ assessmentOf(row).label }}</span>
          </td>
          <td>
            {{ row.status }}
            <span v-if="isLocked(row)" class="tag locked">只读</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-if="row.status === '待派修'"
              class="link"
              type="button"
              :disabled="!canOperate(row)"
              :title="canOperate(row) ? '' : '非本队值班单 / 已挂起，不能派修'"
              @click="quickDispatch(row)"
            >派出抢修</button>
            <template v-if="row.status === '抢修中'">
              <button
                class="link"
                type="button"
                :disabled="!canOperate(row)"
                :title="canOperate(row) ? '' : '非本队值班单，无权操作'"
                @click="quickRecover(row)"
              >确认恢复</button>
              <button
                class="link danger-link"
                type="button"
                :disabled="!canOperate(row)"
                @click="openDetail(row)"
              >上报升级</button>
            </template>
          </td>
        </tr>
        <tr v-if="!filteredRows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无符合条件的抢修记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filteredRows.length }} 条抢修记录</span>
      <span v-if="toast" class="toast" :class="{ error: !toastOk }">{{ toast }}</span>
    </footer>

    <RegisterDialog v-if="showRegister" @close="showRegister = false" @submit="handleRegister" />
    <HandoverDialog
      v-if="showHandover"
      :roster="roster"
      @close="showHandover = false"
      @handover="handleHandover"
    />
    <RepairDetailDialog
      v-if="activeRow"
      :row="activeRow"
      :current-team-id="store.repairTeamId"
      @close="activeRow = null"
      @save="handleSaveFields"
      @dispatch="handleDispatch"
      @recover="handleRecover"
      @escalate="handleEscalate"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  arrivalAssessment,
  dispatchRepair,
  escalateRepair,
  handoverDistrict,
  isHeld,
  listRepairs,
  recoverRepair,
  registerRepair,
  resetRepairs,
  updateRepairFields,
} from '@/api/repair-service'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import { REPAIR_DISTRICTS, REPAIR_TEAMS, teamNameOf } from '@/data/repair'
import { useSessionStore } from '@/stores/session'
import type { RepairFieldPatch, RegisterInput } from '@/api/repair-service'
import type { RepairDistrict, RepairRow } from '@/data/repair'
import type { ActionResult } from '@/data/types'

import RegisterDialog from './RegisterDialog.vue'
import HandoverDialog from './HandoverDialog.vue'
import RepairDetailDialog from './RepairDetailDialog.vue'

const store = useSessionStore()
const meta = moduleMeta('emergencyrepair')

const columns = [
  '抢修编号',
  '所属片区',
  '故障管段',
  '故障类型',
  '影响面积',
  '归属抢修队',
  '当前值班队',
  '当前值班人',
  '到场时间',
]
const statuses = ['待派修', '抢修中', '已恢复', '已升级']

const rows = ref<RepairRow[]>([])
const roster = ref<RepairDistrict[]>([])
const keyword = ref('')
const districtFilter = ref('')
const statusFilter = ref('')
const onlyMine = ref(false)

const showRegister = ref(false)
const showHandover = ref(false)
const activeId = ref<number | null>(null)
const toast = ref('')
const toastOk = ref(true)

const currentMembers = computed(
  () => REPAIR_TEAMS.find((team) => team.id === store.repairTeamId)?.members ?? [],
)

function syncOperator() {
  store.repairOperator = currentMembers.value[0] ?? store.repairOperator
}

const activeRow = computed<RepairRow | null>(
  () => rows.value.find((row) => Number(row.id) === activeId.value) ?? null,
)

const filteredRows = computed(() =>
  rows.value.filter((row) => {
    const key = keyword.value.trim()
    if (key && !`${row['抢修编号'] ?? ''}${row['故障管段'] ?? ''}`.includes(key)) {
      return false
    }
    if (districtFilter.value && row['所属片区'] !== districtFilter.value) {
      return false
    }
    if (statusFilter.value && row.status !== statusFilter.value) {
      return false
    }
    if (onlyMine.value && String(row['当前值班队']) !== store.repairTeamId) {
      return false
    }
    return true
  }),
)

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const heldCount = computed(() => rows.value.filter((row) => isHeld(row)).length)

const stats = computed(() => {
  const monthPrefix = new Date().toISOString().slice(0, 7)
  return [
    { label: '待派修故障', value: rows.value.filter((row) => row.status === '待派修').length },
    { label: '抢修中故障', value: rows.value.filter((row) => row.status === '抢修中').length },
    { label: '挂起待补面积', value: heldCount.value },
    {
      label: '本月恢复数',
      value: rows.value.filter(
        (row) => row.status === '已恢复' && String(row['恢复时间'] ?? '').startsWith(monthPrefix),
      ).length,
    },
  ]
})

function notify(result: ActionResult) {
  toast.value = result.message
  toastOk.value = result.ok
}

function isLocked(row: RepairRow): boolean {
  return ['已恢复', '已升级'].includes(String(row.status))
}

function serviceHeld(row: RepairRow): boolean {
  return isHeld(row)
}

function canOperate(row: RepairRow): boolean {
  return !isLocked(row) && String(row['当前值班队']) === store.repairTeamId && !isHeld(row)
}

function assessmentOf(row: RepairRow) {
  return arrivalAssessment(row)
}

function assessmentClass(row: RepairRow): Record<string, boolean> {
  const result = arrivalAssessment(row)
  return {
    overtime: result.overtime,
    ok: result.timed && !result.overtime,
  }
}

function reload() {
  const payload = listRepairs()
  rows.value = payload.items
  roster.value = payload.roster
}

function openDetail(row: RepairRow) {
  activeId.value = Number(row.id)
}

function handleRegister(input: RegisterInput) {
  const result = registerRepair(input, { teamId: store.repairTeamId, operator: store.repairOperator })
  notify(result)
  if (result.ok) {
    showRegister.value = false
    reload()
  }
}

function handleSaveFields(id: number, patch: RepairFieldPatch) {
  const result = updateRepairFields(id, patch, {
    teamId: store.repairTeamId,
    operator: store.repairOperator,
  })
  notify(result)
  if (result.ok) {
    reload()
  }
}

function handleDispatch(id: number) {
  const result = dispatchRepair(id, { teamId: store.repairTeamId, operator: store.repairOperator })
  notify(result)
  reload()
}

function handleRecover(id: number) {
  const result = recoverRepair(id, { teamId: store.repairTeamId, operator: store.repairOperator })
  notify(result)
  reload()
}

function handleEscalate(id: number, reason: string) {
  const result = escalateRepair(id, reason, { teamId: store.repairTeamId, operator: store.repairOperator })
  notify(result)
  if (result.ok) {
    activeId.value = null
  }
  reload()
}

function handleHandover(district: string) {
  const result = handoverDistrict(district, {
    teamId: store.repairTeamId,
    operator: store.repairOperator,
  })
  notify(result)
  reload()
}

function quickDispatch(row: RepairRow) {
  handleDispatch(Number(row.id))
}

function quickRecover(row: RepairRow) {
  handleRecover(Number(row.id))
}

function exportRows() {
  downloadEntries(meta.key)
}

function resetData() {
  resetRepairs()
  notify({ ok: true, message: '抢修单、待整改来源与轮值花名册已复位到初始口径' })
  reload()
}

onMounted(reload)
</script>
