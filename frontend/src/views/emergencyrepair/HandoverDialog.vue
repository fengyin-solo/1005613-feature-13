<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal-card wide">
      <header class="modal-head">
        <h3>抢修队片区轮值交接</h3>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>
      <p class="modal-tip">
        交接只换当前值班队：未恢复的单子跟着新值班人走，历史记录仍归原队；已恢复、已升级的单不动。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>片区</th>
            <th>轮值序列</th>
            <th>当前值班队</th>
            <th>当前值班人</th>
            <th>下一班</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="slot in roster" :key="slot.district">
            <td>{{ slot.district }}</td>
            <td>
              <span
                v-for="(teamId, idx) in slot.rotation"
                :key="teamId"
                class="chip"
                :class="{ active: idx === slot.cursor }"
              >{{ teamNameOf(teamId) }}</span>
            </td>
            <td>{{ teamNameOf(slot.rotation[slot.cursor]) }}</td>
            <td>{{ firstMember(slot.rotation[slot.cursor]) }}</td>
            <td>{{ teamNameOf(slot.rotation[(slot.cursor + 1) % slot.rotation.length]) }}</td>
            <td>
              <button class="link" type="button" @click="$emit('handover', slot.district)">执行交接</button>
            </td>
          </tr>
        </tbody>
      </table>

      <section v-if="handovers.length" class="handover-log">
        <h4>最近交接</h4>
        <ul>
          <li v-for="(item, idx) in recentHandovers" :key="idx">
            {{ item.at }} · {{ item.district }}：{{ teamNameOf(item.from) }} → {{ teamNameOf(item.to) }}
            （移交未恢复单 {{ item.openOrders }} 张）
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { REPAIR_TEAM_BY_ID, teamNameOf } from '@/data/repair'
import type { RepairDistrict } from '@/data/repair'

const props = defineProps<{ roster: RepairDistrict[] }>()
defineEmits<{
  (e: 'handover', district: string): void
  (e: 'close'): void
}>()

const handovers = computed(() =>
  props.roster.flatMap((slot) => slot.handovers.map((item) => ({ ...item, district: slot.district }))),
)
const recentHandovers = computed(() => [...handovers.value].reverse().slice(0, 6))

function firstMember(teamId: string): string {
  return REPAIR_TEAM_BY_ID.get(teamId)?.members[0] ?? '—'
}
</script>
