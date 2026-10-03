<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal-card">
      <header class="modal-head">
        <h3>登记抢修记录</h3>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>
      <p class="modal-tip">归属按「所属片区」当前值班抢修队自动落定；影响面积缺失会先挂起，补齐后才能派修。</p>
      <form class="modal-form" @submit.prevent="submit">
        <label class="form-item">
          <span>故障管段 *</span>
          <input v-model="form['故障管段']" placeholder="如 CD-GD-107" />
        </label>
        <label class="form-item">
          <span>故障类型 *</span>
          <input v-model="form['故障类型']" placeholder="如 管网泄漏" />
        </label>
        <label class="form-item">
          <span>所属片区 *</span>
          <select v-model="form['所属片区']">
            <option value="" disabled>请选择片区</option>
            <option v-for="district in REPAIR_DISTRICTS" :key="district" :value="district">{{ district }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>影响面积（万㎡，缺失先挂起）</span>
          <input v-model="form['影响面积']" placeholder="如 2.4万㎡" />
        </label>
        <footer class="modal-foot">
          <button class="btn primary" type="submit">提交登记</button>
          <button class="btn ghost" type="button" @click="$emit('close')">取消</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'

import { REPAIR_DISTRICTS } from '@/data/repair'
import type { RegisterInput } from '@/api/repair-service'

const emit = defineEmits<{
  (e: 'submit', input: RegisterInput): void
  (e: 'close'): void
}>()

const form = reactive<RegisterInput>({
  故障管段: '',
  故障类型: '',
  影响面积: '',
  所属片区: '',
})

function submit() {
  emit('submit', { ...form })
}
</script>
