<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal-card wide">
      <header class="modal-head">
        <h3>抢修详情 · {{ row['抢修编号'] }}</h3>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>

      <p class="banner" :class="bannerClass">{{ bannerText }}</p>

      <table class="detail-grid">
        <tbody>
          <tr v-for="item in readonlyItems" :key="item.label">
            <th>{{ item.label }}</th>
            <td :class="{ muted: !item.value }">{{ item.value || '—' }}</td>
          </tr>
          <tr>
            <th>到场核定</th>
            <td>
              <span class="chip" :class="{ overtime: assessment.overtime, ok: assessment.timed && !assessment.overtime }">
                {{ assessment.label }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <form v-if="!locked" class="modal-form" @submit.prevent="saveFields">
        <h4 class="form-title">值班队修改（只有「{{ ownerTeamName }}」值班人可改，跨队提交打回）</h4>
        <div class="form-grid">
          <label class="form-item">
            <span>故障类型</span>
            <input v-model="patch['故障类型']" />
          </label>
          <label class="form-item">
            <span>到场时间（YYYY-MM-DD HH:mm）</span>
            <input v-model="patch['到场时间']" placeholder="2026-10-02 13:48" />
          </label>
          <label class="form-item">
            <span>影响面积</span>
            <input v-model="patch['影响面积']" placeholder="补齐后解除挂起" />
          </label>
        </div>
        <footer class="modal-foot left">
          <button class="btn primary" type="submit">保存修改</button>
        </footer>
      </form>

      <div v-if="!locked" class="action-bar">
        <button
          v-if="row.status === '待派修'"
          class="btn primary"
          type="button"
          @click="$emit('dispatch', Number(row.id))"
        >派出抢修</button>
        <template v-if="row.status === '抢修中'">
          <button class="btn primary" type="button" @click="$emit('recover', Number(row.id))">确认恢复</button>
          <button class="btn danger" type="button" @click="showEscalate = !showEscalate">上报升级</button>
        </template>
        <form v-if="showEscalate" class="escalate-form" @submit.prevent="confirmEscalate">
          <input v-model="escalateReason" placeholder="升级原因（必填）" />
          <button class="btn danger" type="submit">确认升级</button>
        </form>
      </div>

      <section class="audit-log">
        <h4>操作留痕（谁动过这张单一目了然）</h4>
        <ul v-if="logs.length">
          <li v-for="(item, idx) in logs" :key="idx" :class="{ rejected: item.rejected }">
            <span class="audit-at">{{ item.at }}</span>
            <span class="audit-actor">{{ item.team }} · {{ item.actor }}</span>
            <span class="audit-action">{{ item.action }}</span>
            <span v-if="item.detail" class="audit-detail">{{ item.detail }}</span>
          </li>
        </ul>
        <p v-else class="muted">暂无操作记录</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { arrivalAssessment, holdReason, isHeld } from '@/api/repair-service'
import { teamNameOf } from '@/data/repair'
import type { RepairFieldPatch } from '@/api/repair-service'
import type { RepairAudit, RepairRow } from '@/data/repair'

const props = defineProps<{
  row: RepairRow
  currentTeamId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', id: number, patch: RepairFieldPatch): void
  (e: 'dispatch', id: number): void
  (e: 'recover', id: number): void
  (e: 'escalate', id: number, reason: string): void
}>()

const locked = computed(() => ['已恢复', '已升级'].includes(String(props.row.status)))
const ownerTeamName = computed(() => teamNameOf(String(props.row['当前值班队'])))
const assessment = computed(() => arrivalAssessment(props.row))
const logs = computed<RepairAudit[]>(() => (props.row['日志'] as RepairAudit[]) ?? [])

const showEscalate = ref(false)
const escalateReason = ref('')

const patch = reactive<RepairFieldPatch>({
  故障类型: '',
  到场时间: '',
  影响面积: '',
})

watch(
  () => props.row.id,
  () => {
    patch['故障类型'] = String(props.row['故障类型'] ?? '')
    patch['到场时间'] = String(props.row['到场时间'] ?? '')
    patch['影响面积'] = String(props.row['影响面积'] ?? '')
    showEscalate.value = false
    escalateReason.value = ''
  },
  { immediate: true },
)

const readonlyItems = computed(() => [
  { label: '故障管段', value: String(props.row['故障管段'] ?? '') },
  { label: '所属片区', value: String(props.row['所属片区'] ?? '') },
  { label: '归属抢修队（历史归原队）', value: teamNameOf(String(props.row['归属抢修队'])) },
  { label: '当前值班队', value: teamNameOf(String(props.row['当前值班队'])) },
  { label: '当前值班人', value: String(props.row['当前值班人'] ?? '') },
  { label: '报修时间', value: String(props.row['报修时间'] ?? '') },
  { label: '派修时间', value: String(props.row['派修时间'] ?? '') },
  { label: '到场时间（台账与详情同一套）', value: String(props.row['到场时间'] ?? '') },
  { label: '到场时限口径', value: String(props.row['到场时限'] ?? '') },
  { label: '恢复时间', value: String(props.row['恢复时间'] ?? '') },
])

const bannerClass = computed(() => {
  if (locked.value) {
    return 'locked'
  }
  if (isHeld(props.row)) {
    return 'held'
  }
  if (String(props.row['当前值班队']) !== props.currentTeamId) {
    return 'cross'
  }
  return 'mine'
})

const bannerText = computed(() => {
  if (locked.value) {
    return `该单已${String(props.row.status)}，整单转只读，任何队都不能再改。`
  }
  if (isHeld(props.row)) {
    return holdReason(props.row)
  }
  if (String(props.row['当前值班队']) !== props.currentTeamId) {
    return `跨队单：当前由${ownerTeamName.value}值班处理，你的队伍只能看不能改，提交会被打回。`
  }
  return `本队在办单：你以「${ownerTeamName.value}」值班身份处理。`
})

function saveFields() {
  emit('save', Number(props.row.id), { ...patch })
}

function confirmEscalate() {
  emit('escalate', Number(props.row.id), escalateReason.value)
}
</script>
