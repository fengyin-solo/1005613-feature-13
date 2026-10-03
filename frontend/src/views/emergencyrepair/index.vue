<template>
  <section class="page" data-module="emergencyrepair">
    <header class="page-head">
      <div>
        <h2>抢修处置管理</h2>
        <p class="page-desc">
          抢修记录按归属队管理：只有归属队值班人能改故障类型与到场时间，跨队提交一律打回；恢复后整单转只读。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记抢修记录</button>
        <button class="btn" type="button" @click="handover">轮值交接</button>
        <button class="btn" type="button" @click="exportRows">导出抢修处置清单</button>
      </div>
    </header>

    <div class="identity-bar">
      <label class="identity-item">
        <span>当前值班队</span>
        <select v-model="crewTeam">
          <option v-for="team in teams" :key="team.name" :value="team.name">{{ team.name }}</option>
        </select>
      </label>
      <span class="identity-item">值班人：{{ crewMember }}</span>
      <span class="identity-item duty-line">片区轮值：{{ dutyText }}</span>
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
      <span class="legend-item warn">挂起：{{ suspendedCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>到场核定</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            {{ row[column] === '' || row[column] === undefined ? '—' : row[column] }}
            <span v-if="column === '影响面积' && isSuspended(row)" class="badge warn">挂起</span>
          </td>
          <td>
            {{ row.status }}
            <span v-if="isReadonly(row)" class="badge lock">只读</span>
          </td>
          <td>
            <span class="badge" :class="assessClass(row)">{{ assessArrival(row).verdict }}</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <template v-if="!isReadonly(row)">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无抢修处置数据，可先登记抢修记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条抢修处置记录</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>抢修详情 · {{ detailRow['抢修编号'] }}</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ detailRow[field] === '' || detailRow[field] === undefined ? '—' : detailRow[field] }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>
            {{ detailRow.status }}
            <span v-if="isReadonly(detailRow)" class="badge lock">只读</span>
            <span v-if="isSuspended(detailRow)" class="badge warn">挂起</span>
          </dd>
        </dl>
        <p class="assess-line">到场核定：{{ assessArrival(detailRow).text }}</p>

        <template v-if="!isReadonly(detailRow)">
          <h4 class="drawer-sub">修改（仅归属队值班人）</h4>
          <label v-for="field in editableFields" :key="field" class="form-item">
            <span>{{ field }}</span>
            <input v-model="editForm[field]" :placeholder="field === '影响面积' ? '缺失则保持挂起' : 'YYYY-MM-DD HH:mm'" />
          </label>
          <button class="btn primary" type="button" @click="saveDetail">保存修改</button>
        </template>
        <p v-else class="readonly-tip">该单已{{ detailRow.status }}，整单转只读，修改与流转一律打回。</p>

        <h4 class="drawer-sub">变更留痕</h4>
        <ul class="audit-list">
          <li v-for="(entry, index) in auditTrail" :key="index">
            <span class="audit-time">{{ entry.time }}</span>
            <span>{{ entry.team }} {{ entry.operator }} · {{ entry.action }}：{{ entry.detail }}</span>
          </li>
          <li v-if="!auditTrail.length" class="empty-state">暂无留痕</li>
        </ul>
      </aside>
    </div>

    <div v-if="createOpen" class="drawer-mask" @click.self="createOpen = false">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>登记抢修记录</h3>
          <button class="link" type="button" @click="createOpen = false">关闭</button>
        </header>
        <label class="form-item">
          <span>所属片区</span>
          <select v-model="createForm.所属片区">
            <option v-for="area in areas" :key="area" :value="area">{{ area }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>故障管段</span>
          <input v-model="createForm.故障管段" placeholder="如 SECO-0102" />
        </label>
        <label class="form-item">
          <span>故障类型</span>
          <input v-model="createForm.故障类型" placeholder="如 管道泄漏" />
        </label>
        <label class="form-item">
          <span>影响面积</span>
          <input v-model="createForm.影响面积" placeholder="平方米，缺失可留空先挂起" />
        </label>
        <p class="readonly-tip">新单归属当前值班队（{{ crewTeam }} {{ crewMember }}）；同一故障重复提交派修只落一条。</p>
        <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import { downloadEntries, listEntries } from '@/api/local-service'
import {
  assessArrival,
  createRepair,
  currentDuty,
  handoverRotation,
  isReadonly,
  isSuspended,
  repairAudit,
  runRepairAction,
  setRepairActor,
  updateRepair,
} from '@/api/repair-service'
import { DUTY_AREAS, REPAIR_TEAMS, teamOf } from '@/data/repair-teams'
import type { AuditEntry } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const MODULE_KEY = 'emergencyrepair'
const columns = ['抢修编号', '所属片区', '故障管段', '故障类型', '影响面积', '抢修队', '值班人', '到场时间', '恢复时间']
const detailFields = ['抢修编号', '所属片区', '故障管段', '故障类型', '影响面积', '抢修队', '值班人', '派修时间', '到场时间', '恢复时间']
const editableFields = ['故障类型', '影响面积', '到场时间', '恢复时间']
const actions = ['派出抢修', '确认恢复', '上报升级']
const statuses = ['待派修', '抢修中', '已恢复', '已升级']
const teams = REPAIR_TEAMS
const areas = DUTY_AREAS

const session = useSessionStore()
const crewTeam = ref(session.crewTeam)
const crewMember = computed(() => teamOf(crewTeam.value)?.member ?? '')

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['抢修编号', '所属片区', '故障管段']
const dutyText = ref('')

const detailRow = ref<EntryRow | null>(null)
const editForm = reactive<Record<string, string>>({})
const auditTrail = ref<AuditEntry[]>([])
const createOpen = ref(false)
const createForm = reactive({ 所属片区: areas[0], 故障管段: '', 故障类型: '', 影响面积: '' })

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const suspendedCount = computed(() => rows.value.filter((row) => isSuspended(row)).length)
const stats = computed(() => {
  const month = new Date().toISOString().slice(0, 7)
  return [
    { label: '待派修故障', value: rows.value.filter((row) => row.status === '待派修').length },
    { label: '抢修中故障', value: rows.value.filter((row) => row.status === '抢修中').length },
    {
      label: '本月恢复数',
      value: rows.value.filter(
        (row) => row.status === '已恢复' && String(row['恢复时间']).startsWith(month),
      ).length,
    },
  ]
})

// 值班身份一切换，抢修服务里的操作人就跟着换，归属校验以新身份为准。
watch(crewTeam, () => {
  session.setCrew(crewTeam.value, crewMember.value)
  setRepairActor({ team: crewTeam.value, member: crewMember.value })
})

function assessClass(row: EntryRow) {
  const verdict = assessArrival(row).verdict
  if (verdict === '达标') return 'pass'
  if (verdict === '超时') return 'fail'
  return ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(MODULE_KEY)
}

function openCreate() {
  createOpen.value = true
}

function submitCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = createRepair({ ...createForm })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  createOpen.value = false
  createForm.故障管段 = ''
  createForm.故障类型 = ''
  createForm.影响面积 = ''
  reload()
}

function handover() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = handoverRotation()
  noticeMessage.value = result.message
  refreshDuty()
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = runRepairAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function openDetail(row: EntryRow) {
  detailRow.value = row
  for (const field of editableFields) {
    editForm[field] = String(row[field] ?? '')
  }
  auditTrail.value = repairAudit(Number(row.id))
}

function closeDetail() {
  detailRow.value = null
}

function saveDetail() {
  if (!detailRow.value) return
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = updateRepair(Number(detailRow.value.id), { ...editForm })
  if (!result.ok) {
    errorMessage.value = result.message
    auditTrail.value = repairAudit(Number(detailRow.value.id))
    return
  }
  noticeMessage.value = result.message
  closeDetail()
  reload()
}

function refreshDuty() {
  dutyText.value = Object.entries(currentDuty())
    .map(([area, team]) => `${area}→${team}`)
    .join('　')
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(MODULE_KEY, filters.value)
    rows.value = payload.items
    total.value = payload.total
    if (detailRow.value) {
      const fresh = payload.items.find((row) => Number(row.id) === Number(detailRow.value?.id))
      if (fresh) detailRow.value = fresh
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '抢修处置列表读取失败'
  }
}

onMounted(() => {
  session.setCrew(crewTeam.value, crewMember.value)
  setRepairActor({ team: crewTeam.value, member: crewMember.value })
  refreshDuty()
  reload()
})
</script>
