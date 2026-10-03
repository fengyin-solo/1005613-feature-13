import { listRows, loadRoster, resetRepairData, saveRows, saveRoster } from '@/data/local-store'
import {
  REPAIR_KEY,
  PATROL_KEY,
  REPAIR_LOCKED_STATUSES,
  REPAIR_PENDING_REASON_MISSING_AREA,
  REPAIR_STATUSES,
  REPAIR_TRANSITIONS,
  REPAIR_TEAM_BY_ID,
  assessArrival,
  currentTeamIdOf,
  describeArrivalLimit,
  isChronological,
  nextPatrolNo,
  nextRepairNo,
  nowStamp,
  teamNameOf,
} from '@/data/repair'
import type { ActionResult } from '@/data/types'
import type { RepairAudit, RepairDistrict, RepairRow } from '@/data/repair'

// 页面只认这个操作人身份：当前值班队 + 值班人，跨队操作一律在这里挡回。
export type RepairOperator = {
  teamId: string
  operator: string
}

function roster(): RepairDistrict[] {
  return loadRoster()
}

function repairRows(): RepairRow[] {
  return listRows(REPAIR_KEY) as RepairRow[]
}

function persistRepairs(rows: RepairRow[]): void {
  saveRows(REPAIR_KEY, rows)
}

function appendLog(row: RepairRow, entry: RepairAudit): void {
  const logs = Array.isArray(row['日志']) ? [...(row['日志'] as RepairAudit[])] : []
  logs.push(entry)
  row['日志'] = logs
}

function logEntry(actor: RepairOperator, action: string, detail = '', rejected = false): RepairAudit {
  return {
    at: nowStamp(),
    actor: actor.operator,
    team: teamNameOf(actor.teamId),
    action,
    detail,
    rejected,
  }
}

// 影响面积缺失先挂起：这是派修前的硬卡口。
export function isHeld(row: RepairRow): boolean {
  return String(row['影响面积'] ?? '').trim() === ''
}

export function holdReason(row: RepairRow): string {
  return isHeld(row) ? REPAIR_PENDING_REASON_MISSING_AREA : ''
}

// 到场时间只有一套口径：列表（抢修台账）与详情面板都从这里取核定结果。
export function arrivalAssessment(row: RepairRow): {
  label: string
  overtime: boolean
  night: boolean
  timed: boolean
} {
  const dispatchedAt = String(row['派修时间'] ?? '')
  const arrivedAt = String(row['到场时间'] ?? '')
  if (!arrivedAt) {
    return { label: '未到场', overtime: false, night: false, timed: false }
  }
  if (!dispatchedAt) {
    return { label: '已到场', overtime: false, night: false, timed: false }
  }
  const result = assessArrival(dispatchedAt, arrivedAt)
  if (!result.timed) {
    return { label: '到场时间口径异常', overtime: false, night: false, timed: false }
  }
  const shift = result.night ? '夜间' : '白天'
  const verdict = result.overtime
    ? `超时${result.usedMin - result.limitMin}分钟`
    : `提前${result.limitMin - result.usedMin}分钟`
  return {
    label: `${shift}限${result.limitMin}分钟，用时${result.usedMin}分钟（${verdict}）`,
    overtime: result.overtime,
    night: result.night,
    timed: true,
  }
}

// 只有挂在该抢修队、且当前仍由该队值班的单子才允许操作；终态单整单只读。
function guardEditable(row: RepairRow, actor: RepairOperator, action: string): ActionResult | null {
  const status = String(row.status)
  if (REPAIR_LOCKED_STATUSES.includes(status)) {
    return { ok: false, message: `抢修单 ${row['抢修编号']} 已${status}，整单转只读，不能再${action}` }
  }
  if (String(row['当前值班队'] ?? '') !== actor.teamId) {
    return {
      ok: false,
      message:
        `跨队操作打回：抢修单 ${row['抢修编号']} 归属${teamNameOf(String(row['归属抢修队']))}，` +
        `当前由${teamNameOf(String(row['当前值班队']))}值班，${teamNameOf(actor.teamId)}无权${action}`,
    }
  }
  return null
}

function findRow(rows: RepairRow[], id: number): { row: RepairRow; index: number } | ActionResult {
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的抢修记录` }
  }
  return { row: rows[index], index }
}

// 越级挡回：只允许按 待派修→抢修中→已恢复 / 抢修中→已升级 推进。
function guardTransition(row: RepairRow, target: string): ActionResult | null {
  const current = String(row.status)
  const allowed = REPAIR_TRANSITIONS[current] ?? []
  if (!allowed.includes(target)) {
    const ordered = REPAIR_STATUSES.join('→').concat('（抢修中可分支到已升级）')
    return {
      ok: false,
      message: `越级流转挡回：抢修单当前「${current}」不能直接推进到「${target}」，合法顺序：${ordered}`,
    }
  }
  return null
}

export function listRepairs(): { items: RepairRow[]; roster: RepairDistrict[] } {
  return { items: repairRows(), roster: roster() }
}

export type RegisterInput = {
  故障管段: string
  故障类型: string
  影响面积: string
  所属片区: string
}

// 登记抢修记录：归属即片区当前值班队；影响面积允许先缺，缺了就挂起，等本队补齐。
export function registerRepair(input: RegisterInput, actor: RepairOperator): ActionResult {
  const pipe = input['故障管段'].trim()
  if (!pipe) {
    return { ok: false, message: '故障管段不能为空' }
  }
  if (!input['所属片区']) {
    return { ok: false, message: '请选择所属片区，抢修归属按片区轮值确定' }
  }
  const teamId = currentTeamIdOf(roster(), input['所属片区'])
  const team = REPAIR_TEAM_BY_ID.get(teamId)
  if (!team) {
    return { ok: false, message: `片区「${input['所属片区']}」暂无值班抢修队，无法受理` }
  }
  // 重复提交派修只落一条：同片区同管段同故障类型且未恢复/升级的单子在，直接打回并指向原单。
  const duplicate = repairRows().find(
    (row) =>
      !REPAIR_LOCKED_STATUSES.includes(String(row.status)) &&
      String(row['所属片区'] ?? '') === input['所属片区'] &&
      String(row['故障管段'] ?? '') === pipe &&
      String(row['故障类型'] ?? '') === input['故障类型'].trim(),
  )
  if (duplicate) {
    return {
      ok: false,
      message: `重复派修打回：抢修单 ${duplicate['抢修编号']} 已覆盖该管段故障，未恢复前不重复落单`,
    }
  }

  const rows = repairRows()
  const stamped = nowStamp()
  const row: RepairRow = {
    id: rows.length ? Math.max(...rows.map((item) => Number(item.id))) + 1 : 1,
    status: '待派修',
    pending: true,
    abnormal: false,
    抢修编号: nextRepairNo(rows),
    故障管段: pipe,
    故障类型: input['故障类型'].trim(),
    影响面积: input['影响面积'].trim(),
    所属片区: input['所属片区'],
    归属抢修队: team.id,
    当前值班队: team.id,
    当前值班人: team.members[0],
    报修时间: stamped,
    派修时间: '',
    到场时间: '',
    到场时限: '',
    恢复时间: '',
    日志: [],
  }
  appendLog(row, logEntry(actor, '登记抢修', isHeld(row) ? REPAIR_PENDING_REASON_MISSING_AREA : ''))
  persistRepairs([...rows, row])
  return {
    ok: true,
    message: isHeld(row)
      ? `已登记 ${String(row['抢修编号'])}，归属${team.name}；${REPAIR_PENDING_REASON_MISSING_AREA}`
      : `已登记 ${String(row['抢修编号'])}，归属${team.name}，可派修`,
  }
}

export type EditableRepairField = '故障类型' | '到场时间' | '影响面积'
export type RepairFieldPatch = Partial<Record<EditableRepairField, string>>

// 改故障类型 / 到场时间 / 补影响面积：只有该单当前值班队的值班人能改。
// 到场时间沿用既有抢修口径：不得早于报修、不得晚于恢复；派修后改填按派修时刻时限重新核定。
export function updateRepairFields(id: number, patch: RepairFieldPatch, actor: RepairOperator): ActionResult {
  const rows = repairRows()
  const found = findRow(rows, id)
  if ('ok' in found) {
    return found
  }
  const { row, index } = found
  const denied = guardEditable(row, actor, '修改')
  if (denied) {
    const next = [...rows]
    appendLog(row, logEntry(actor, '尝试修改被打回', denied.message, true))
    next[index] = { ...row }
    persistRepairs(next)
    return denied
  }

  const merged: RepairRow = { ...row }
  const notes: string[] = []
  for (const field of ['故障类型', '到场时间', '影响面积'] as const) {
    if (patch[field] === undefined) {
      continue
    }
    const value = String(patch[field] ?? '').trim()
    merged[field] = value
    notes.push(`${field}改为「${value || '空'}」`)
  }

  if (merged['故障类型'] !== undefined && String(merged['故障类型']).trim() === '') {
    return { ok: false, message: '故障类型不能为空' }
  }
  const arrived = String(merged['到场时间'] ?? '')
  if (arrived) {
    if (!isChronological(String(merged['报修时间'] ?? ''), arrived)) {
      return { ok: false, message: '到场时间不能早于报修时间，按既有抢修口径核定' }
    }
    if (!isChronological(arrived, String(merged['恢复时间'] ?? ''))) {
      return { ok: false, message: '到场时间不能晚于恢复时间，按既有抢修口径核定' }
    }
  }

  // 到场时间两处并成一套：列表与详情都用 到场时间 + 到场时限（口径说明），不再各自维护。
  if (arrived && merged['派修时间']) {
    merged['到场时限'] = describeArrivalLimit(String(merged['派修时间']))
  }

  appendLog(merged, logEntry(actor, '修改抢修信息', notes.join('；')))
  const next = [...rows]
  next[index] = merged
  persistRepairs(next)
  return { ok: true, message: `抢修单 ${merged['抢修编号']} 已更新（${notes.join('；')}）` }
}

// 派出抢修（待派修 → 抢修中）。重复派修只落一条：已派出去的单再点直接提示，不重复推进。
export function dispatchRepair(id: number, actor: RepairOperator): ActionResult {
  const rows = repairRows()
  const found = findRow(rows, id)
  if ('ok' in found) {
    return found
  }
  const { row, index } = found
  const denied = guardEditable(row, actor, '派出抢修')
  if (denied) {
    const next = [...rows]
    appendLog(row, logEntry(actor, '尝试派修被打回', denied.message, true))
    next[index] = { ...row }
    persistRepairs(next)
    return denied
  }
  const blocked = guardTransition(row, '抢修中')
  if (blocked) {
    return blocked
  }
  if (isHeld(row)) {
    return {
      ok: false,
      message: `抢修单 ${row['抢修编号']} ${REPAIR_PENDING_REASON_MISSING_AREA}，补齐影响面积后才能派出`,
    }
  }

  const stamped = nowStamp()
  const updated: RepairRow = {
    ...row,
    status: '抢修中',
    派修时间: stamped,
    到场时限: describeArrivalLimit(stamped),
  }
  appendLog(updated, logEntry(actor, '派出抢修', `按${arrivalLimitFor(stamped)}时限核定到场`))
  const next = [...rows]
  next[index] = updated
  persistRepairs(next)
  return { ok: true, message: `抢修单 ${updated['抢修编号']} 已派出，${updated['到场时限']}内须到场` }
}

function arrivalLimitFor(stamp: string): string {
  return describeArrivalLimit(stamp)
}

// 确认恢复（抢修中 → 已恢复）。恢复之后整单转只读，并在站点巡检落一条待整改。
export function recoverRepair(id: number, actor: RepairOperator): ActionResult {
  const rows = repairRows()
  const found = findRow(rows, id)
  if ('ok' in found) {
    return found
  }
  const { row, index } = found
  const denied = guardEditable(row, actor, '确认恢复')
  if (denied) {
    const next = [...rows]
    appendLog(row, logEntry(actor, '尝试恢复被打回', denied.message, true))
    next[index] = { ...row }
    persistRepairs(next)
    return denied
  }
  const blocked = guardTransition(row, '已恢复')
  if (blocked) {
    return blocked
  }
  if (!String(row['到场时间'] ?? '').trim()) {
    return { ok: false, message: `抢修单 ${row['抢修编号']} 还没有到场时间，按抢修口径不能直接恢复` }
  }

  const stamped = nowStamp()
  if (!isChronological(String(row['到场时间']), stamped)) {
    return { ok: false, message: '恢复时间不能早于到场时间，按既有抢修口径核定' }
  }

  const updated: RepairRow = {
    ...row,
    status: '已恢复',
    pending: false,
    abnormal: arrivalAssessment(row).overtime,
    恢复时间: stamped,
  }
  appendLog(updated, logEntry(actor, '确认恢复', `${stamped} 恢复，整单转只读`))

  // 恢复结果落到站点巡检的待整改清单：现场虽恢复，仍要回站核查整改。
  const patrol = pushRectification(updated, actor)

  const next = [...rows]
  next[index] = updated
  persistRepairs(next)
  return {
    ok: true,
    message: `抢修单 ${updated['抢修编号']} 已恢复并转只读；已生成站点巡检待整改单 ${patrol['巡检编号']}`,
  }
}

function pushRectification(repair: RepairRow, actor: RepairOperator) {
  const patrolRows = listRows(PATROL_KEY)
  const no = nextPatrolNo(patrolRows)
  const stamp = nowStamp()
  const row = {
    id: patrolRows.length ? Math.max(...patrolRows.map((item) => Number(item.id))) + 1 : 1,
    status: '待整改',
    pending: true,
    abnormal: true,
    巡检编号: no,
    巡检站点: `${String(repair['所属片区'])}·${String(repair['故障管段'])}`,
    巡检路线: '抢修恢复回头看',
    巡检人: actor.operator,
    巡检日期: stamp.slice(0, 10),
    发现问题数: '1',
    整改期限: stamp.slice(0, 10),
    来源抢修单: String(repair['抢修编号']),
    整改事项: `${String(repair['故障类型'])}恢复后现场复核`,
  }
  saveRows(PATROL_KEY, [...patrolRows, row])
  return row
}

// 上报升级（抢修中 → 已升级）：升级单同样整单只读，转上级处理。
export function escalateRepair(id: number, reason: string, actor: RepairOperator): ActionResult {
  const rows = repairRows()
  const found = findRow(rows, id)
  if ('ok' in found) {
    return found
  }
  const { row, index } = found
  const denied = guardEditable(row, actor, '上报升级')
  if (denied) {
    const next = [...rows]
    appendLog(row, logEntry(actor, '尝试升级被打回', denied.message, true))
    next[index] = { ...row }
    persistRepairs(next)
    return denied
  }
  const blocked = guardTransition(row, '已升级')
  if (blocked) {
    return blocked
  }
  if (!reason.trim()) {
    return { ok: false, message: '升级必须填写原因' }
  }
  const updated: RepairRow = { ...row, status: '已升级', pending: false, abnormal: true }
  appendLog(updated, logEntry(actor, '上报升级', reason.trim()))
  const next = [...rows]
  next[index] = updated
  persistRepairs(next)
  return { ok: true, message: `抢修单 ${updated['抢修编号']} 已升级转上级处理，整单只读` }
}

// 轮值交接：片区值班队向后走一位；未恢复的单子跟着新值班人走，历史记录仍归原队。
export function handoverDistrict(district: string, actor: RepairOperator): ActionResult {
  const slots = roster()
  const slot = slots.find((item) => item.district === district)
  if (!slot || slot.rotation.length < 2) {
    return { ok: false, message: `片区「${district}」没有可轮换的下一支抢修队` }
  }
  const fromTeam = slot.rotation[slot.cursor]
  const nextCursor = (slot.cursor + 1) % slot.rotation.length
  const toTeam = slot.rotation[nextCursor]
  const toTeamInfo = REPAIR_TEAM_BY_ID.get(toTeam)
  if (!toTeamInfo) {
    return { ok: false, message: `下一班抢修队 ${toTeam} 未在花名册登记` }
  }

  const stamp = nowStamp()
  const rows = repairRows()
  let moved = 0
  for (const row of rows) {
    // 只有还没恢复/升级的单子跟着新值班人走；归属抢修队不动，历史仍归原队。
    if (
      String(row['所属片区']) === district &&
      !REPAIR_LOCKED_STATUSES.includes(String(row.status)) &&
      String(row['当前值班队']) === fromTeam
    ) {
      row['当前值班队'] = toTeam
      row['当前值班人'] = toTeamInfo.members[0]
      appendLog(
        row as RepairRow,
        logEntry(
          actor,
          '轮值交接',
          `${stamp} 起由${teamNameOf(toTeam)}（${toTeamInfo.members[0]}）接手，归属仍为${teamNameOf(fromTeam)}`,
        ),
      )
      moved += 1
    }
  }
  persistRepairs(rows.map((row) => ({ ...row })))

  slot.cursor = nextCursor
  slot.handovers.push({ at: stamp, from: fromTeam, to: toTeam, openOrders: moved })
  saveRoster(slots)

  return {
    ok: true,
    message:
      `${district}已交接：${teamNameOf(fromTeam)} → ${teamNameOf(toTeam)}（值班人 ${toTeamInfo.members[0]}）；` +
      `${moved} 张未恢复单已随班移交，历史记录仍归${teamNameOf(fromTeam)}`,
  }
}

export function resetRepairs(): void {
  resetRepairData()
}
