import {
  appendAudit,
  listAudit,
  listRows,
  loadDutyMap,
  saveDutyMap,
  saveRows,
} from '@/data/local-store'
import {
  ARRIVAL_LIMIT_MINUTES,
  DAY_WINDOW,
  DUTY_AREAS,
  ROTATION_ORDER,
  defaultDutyMap,
  teamOf,
} from '@/data/repair-teams'
import type { ActionResult, EntryRow } from '@/data/types'

// 抢修处置的领域规则都收在这里：归属校验、状态机、只读、挂起、去重、到场核定、轮值交接。
// 页面不直接改数据，local-service 的 emergencyrepair 动作也委托到这里。

const KEY = 'emergencyrepair'
// 状态推进链：待派修 → 抢修中 → 已恢复 / 已升级，越级的一律挡回。
const CHAIN = ['待派修', '抢修中', '已恢复', '已升级']
const ACTION_TARGETS: Record<string, string> = {
  派出抢修: '抢修中',
  确认恢复: '已恢复',
  上报升级: '已升级',
}
// 每个动作只允许从紧邻的前一级发起：恢复与升级都必须先到场（抢修中）。
const ACTION_FROM: Record<string, string> = {
  派出抢修: '待派修',
  确认恢复: '抢修中',
  上报升级: '抢修中',
}
// 恢复（含升级结案）之后整单转只读。
const READONLY_STATUSES = ['已恢复', '已升级']
// 未恢复的单子：轮值交接时跟着新值班人走。
const OPEN_STATUSES = ['待派修', '抢修中']
// 归属队值班人才能改的字段，其余人提交一律打回。
const OWNED_FIELDS = ['故障类型', '到场时间']
const EDITABLE_FIELDS = ['故障类型', '影响面积', '到场时间', '恢复时间']

export type Actor = {
  team: string
  member: string
}

export type ArrivalAssessment = {
  verdict: '达标' | '超时' | '未核定'
  period: '昼间' | '夜间' | ''
  limitMinutes: number
  usedMinutes: number | null
  text: string
}

// 当前操作人由页面在切换值班身份时写入，服务层不直接依赖会话组件。
let currentActor: Actor = { team: '抢修一队', member: '王建国' }

export function setRepairActor(actor: Actor): void {
  currentActor = actor
}

export function getRepairActor(): Actor {
  return currentActor
}

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function parseTime(value: unknown): Date | null {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) {
    return null
  }
  const date = new Date(text.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

function isNight(date: Date): boolean {
  const hour = date.getHours()
  return hour >= DAY_WINDOW.endHour || hour < DAY_WINDOW.startHour
}

function findRow(id: number): { rows: EntryRow[]; index: number } {
  const rows = listRows(KEY)
  return { rows, index: rows.findIndex((row) => Number(row.id) === id) }
}

function trace(id: number, action: string, detail: string): void {
  appendAudit(KEY, id, {
    time: now(),
    operator: currentActor.member,
    team: currentActor.team,
    action,
    detail,
  })
}

export function repairAudit(id: number) {
  return listAudit(KEY, id)
}

export function isReadonly(row: EntryRow): boolean {
  return READONLY_STATUSES.includes(String(row.status))
}

// 影响面积缺失的在途单先挂起：不许派修，补录面积后自动解除。
export function isSuspended(row: EntryRow): boolean {
  return OPEN_STATUSES.includes(String(row.status)) && String(row['影响面积'] ?? '').trim() === ''
}

// 到场核定：台账与详情共用这一套口径，到场时间减派修时间，按派修时刻的昼夜分别卡时限。
export function assessArrival(row: EntryRow): ArrivalAssessment {
  const dispatched = parseTime(row['派修时间'])
  const arrived = parseTime(row['到场时间'])
  if (!dispatched || !arrived) {
    return { verdict: '未核定', period: '', limitMinutes: 0, usedMinutes: null, text: '未核定' }
  }
  const night = isNight(dispatched)
  const period = night ? '夜间' : '昼间'
  const limit = night ? ARRIVAL_LIMIT_MINUTES.night : ARRIVAL_LIMIT_MINUTES.day
  const used = Math.round((arrived.getTime() - dispatched.getTime()) / 60000)
  if (used < 0) {
    return { verdict: '超时', period, limitMinutes: limit, usedMinutes: used, text: `${period}口径 数据异常` }
  }
  const verdict = used <= limit ? '达标' : '超时'
  return {
    verdict,
    period,
    limitMinutes: limit,
    usedMinutes: used,
    text: `${period}时限${limit}分钟，用时${used}分钟，${verdict}`,
  }
}

function guardOwnership(row: EntryRow): ActionResult | null {
  if (String(row['抢修队']) === currentActor.team && String(row['值班人']) === currentActor.member) {
    return null
  }
  return {
    ok: false,
    message: `跨队打回：该单归属${row['抢修队']}（值班 ${row['值班人']}），当前值班为${currentActor.team} ${currentActor.member}，只有归属队值班人能改${OWNED_FIELDS.join('与')}`,
  }
}

function guardReadonly(row: EntryRow): ActionResult | null {
  if (!isReadonly(row)) {
    return null
  }
  const reason =
    row.status === '已恢复' ? '该单已恢复，整单转只读' : '该单已升级结案，整单只读'
  return { ok: false, message: `${reason}，修改与流转一律打回` }
}

export function runRepairAction(id: number, action: string): ActionResult {
  const target = ACTION_TARGETS[action]
  if (!target) {
    return { ok: false, message: `抢修记录没有登记「${action}」这个动作` }
  }
  const { rows, index } = findRow(id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的抢修记录` }
  }
  const row = rows[index]

  const readonlyHit = guardReadonly(row)
  if (readonlyHit) {
    trace(id, '打回', `${action}：${readonlyHit.message}`)
    return readonlyHit
  }
  const ownerHit = guardOwnership(row)
  if (ownerHit) {
    trace(id, '打回', `${action}：${ownerHit.message}`)
    return ownerHit
  }

  const current = String(row.status)
  if (action === '派出抢修' && OPEN_STATUSES.includes(current) && current !== '待派修') {
    const message = `该单已派出（当前「${current}」），重复提交派修只落一条，本次不落新单`
    trace(id, '打回', message)
    return { ok: false, message }
  }
  // 状态机：只能按链推进到相邻的下一级，越级挡回。
  const expected = ACTION_FROM[action]
  if (current !== expected) {
    const message = `越级挡回：状态须按 ${CHAIN.join('→')} 推进，「${current}」不能直接执行「${action}」`
    trace(id, '打回', message)
    return { ok: false, message }
  }
  // 影响面积缺失的在途单先挂起：补齐面积之前不允许任何流转。
  if (isSuspended(row)) {
    const message = '影响面积缺失，该单先挂起：请补录影响面积后再流转'
    trace(id, '打回', message)
    return { ok: false, message }
  }

  const updated: EntryRow = { ...row, status: target }
  if (action === '派出抢修') {
    updated['派修时间'] = now()
    updated.pending = true
  }
  if (action === '确认恢复') {
    updated['恢复时间'] = parseTime(row['恢复时间']) ? String(row['恢复时间']) : now()
    updated.pending = false
  }
  if (action === '上报升级') {
    updated.pending = false
  }
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  trace(id, action, `状态「${current}」→「${target}」`)

  if (action === '确认恢复') {
    pushRectification(updated)
  }
  return { ok: true, message: `抢修记录已${action}，当前状态「${target}」` }
}

// 恢复结果落到站点巡检的待整改清单：同一抢修编号只落一条，重复恢复不重复派单。
function pushRectification(row: EntryRow): void {
  const marker = `抢修复查-${row['抢修编号']}`
  const patrolRows = listRows('stationpatrol')
  if (patrolRows.some((item) => String(item['巡检路线']) === marker)) {
    return
  }
  const id = Math.max(0, ...patrolRows.map((item) => Number(item.id))) + 1
  const deadline = new Date()
  deadline.setDate(deadline.getDate() + 7)
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${deadline.getFullYear()}-${pad(deadline.getMonth() + 1)}-${pad(deadline.getDate())}`
  patrolRows.push({
    id,
    status: '待整改',
    pending: true,
    abnormal: false,
    巡检编号: `PATROL-R${String(id).padStart(4, '0')}`,
    巡检站点: String(row['故障管段']),
    巡检路线: marker,
    巡检人: currentActor.member,
    巡检日期: now().slice(0, 10),
    发现问题数: 1,
    整改期限: today,
    巡检状态: '待整改',
  })
  saveRows('stationpatrol', patrolRows)
}

export function updateRepair(id: number, patch: Record<string, string>): ActionResult {
  const { rows, index } = findRow(id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的抢修记录` }
  }
  const row = rows[index]

  const readonlyHit = guardReadonly(row)
  if (readonlyHit) {
    trace(id, '打回', `保存修改：${readonlyHit.message}`)
    return readonlyHit
  }
  const ownerHit = guardOwnership(row)
  if (ownerHit) {
    trace(id, '打回', `保存修改：${ownerHit.message}`)
    return ownerHit
  }

  const updated: EntryRow = { ...row }
  const changes: string[] = []
  for (const field of EDITABLE_FIELDS) {
    const value = String(patch[field] ?? '').trim()
    if (value === String(row[field] ?? '').trim()) {
      continue
    }
    if ((field === '到场时间' || field === '恢复时间') && value !== '' && !parseTime(value)) {
      return { ok: false, message: `${field}格式应为 YYYY-MM-DD HH:mm` }
    }
    if (field === '影响面积' && value !== '' && !/^\d+(\.\d+)?$/.test(value)) {
      return { ok: false, message: '影响面积需为数字（平方米）' }
    }
    updated[field] = value
    changes.push(`${field}：「${row[field] ?? ''}」→「${value}」`)
  }
  if (changes.length === 0) {
    return { ok: false, message: '没有需要保存的改动' }
  }

  // 到场时间早于派修时间，与既有抢修口径不符，直接打回。
  const dispatched = parseTime(updated['派修时间'])
  const arrived = parseTime(updated['到场时间'])
  if (dispatched && arrived && arrived.getTime() < dispatched.getTime()) {
    const message = '到场时间早于派修时间，与既有抢修口径不符，已打回'
    trace(id, '打回', message)
    return { ok: false, message }
  }

  // 沿用既有抢修口径核定：超时单挂异常，看板上能一眼看出来。
  const assessment = assessArrival(updated)
  updated.abnormal = assessment.verdict === '超时'
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  trace(id, '保存修改', changes.join('；'))
  return { ok: true, message: `已保存（${changes.length} 处改动），到场核定：${assessment.text}` }
}

// 重复提交派修只落一条：同一故障管段、同一故障类型已有在途单时，不再落新单。
export function createRepair(input: {
  所属片区: string
  故障管段: string
  故障类型: string
  影响面积: string
}): ActionResult {
  if (!input.故障管段.trim() || !input.故障类型.trim()) {
    return { ok: false, message: '故障管段与故障类型不能为空' }
  }
  if (input.影响面积.trim() !== '' && !/^\d+(\.\d+)?$/.test(input.影响面积.trim())) {
    return { ok: false, message: '影响面积需为数字（平方米），缺失可留空先挂起' }
  }
  const rows = listRows(KEY)
  const duplicate = rows.find(
    (row) =>
      OPEN_STATUSES.includes(String(row.status)) &&
      String(row['故障管段']) === input.故障管段.trim() &&
      String(row['故障类型']) === input.故障类型.trim(),
  )
  if (duplicate) {
    return {
      ok: false,
      message: `重复提交派修只落一条：该故障已有在途单 ${duplicate['抢修编号']}（${duplicate.status}），本次不再落新单`,
    }
  }
  const id = Math.max(0, ...rows.map((row) => Number(row.id))) + 1
  const code = `EMER-${String(id).padStart(4, '0')}`
  rows.push({
    id,
    status: '待派修',
    pending: true,
    abnormal: false,
    抢修编号: code,
    所属片区: input.所属片区,
    故障管段: input.故障管段.trim(),
    故障类型: input.故障类型.trim(),
    影响面积: input.影响面积.trim(),
    抢修队: currentActor.team,
    值班人: currentActor.member,
    派修时间: '',
    到场时间: '',
    恢复时间: '',
    抢修状态: '待派修',
  })
  saveRows(KEY, rows)
  trace(id, '登记', `新单 ${code} 归属${currentActor.team}（值班 ${currentActor.member}）`)
  const suspended = input.影响面积.trim() === '' ? '，影响面积缺失已先挂起' : ''
  return { ok: true, message: `抢修单 ${code} 已登记，归属${currentActor.team}${suspended}` }
}

// 片区轮值交接：未恢复的单子跟着新值班人走，历史记录仍归原队。
export function handoverRotation(): ActionResult {
  const duty = loadDutyMap() ?? defaultDutyMap()
  const rows = listRows(KEY)
  let moved = 0
  const lines: string[] = []
  for (const area of DUTY_AREAS) {
    const from = duty[area] ?? ROTATION_ORDER[0]
    const to = ROTATION_ORDER[(ROTATION_ORDER.indexOf(from) + 1) % ROTATION_ORDER.length]
    duty[area] = to
    const member = teamOf(to)?.member ?? ''
    let count = 0
    for (const row of rows) {
      if (String(row['所属片区']) !== area || !OPEN_STATUSES.includes(String(row.status))) {
        continue
      }
      row['抢修队'] = to
      row['值班人'] = member
      count += 1
      trace(Number(row.id), '轮值交接', `${area}由${from}交接给${to}，未恢复单随新值班人 ${member}`)
    }
    moved += count
    lines.push(`${area}：${from}→${to}，随交${count}单`)
  }
  saveRows(KEY, rows)
  saveDutyMap(duty)
  return {
    ok: true,
    message: `轮值交接完成（${lines.join('；')}），共 ${moved} 单未恢复单移交新值班人，历史记录仍归原队`,
  }
}

export function currentDuty(): Record<string, string> {
  return loadDutyMap() ?? defaultDutyMap()
}
