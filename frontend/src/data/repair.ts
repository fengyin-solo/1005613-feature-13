import type { EntryRow } from './types'

// 抢修业务口径：页面与本地服务都只认这一套，不再在组件里各写一遍。

export const REPAIR_KEY = 'emergencyrepair'
export const PATROL_KEY = 'stationpatrol'

// 抢修四态只能顺序推进：待派修 → 抢修中 → 已恢复；抢修中 → 已升级。越级一律挡回。
export const REPAIR_STATUSES = ['待派修', '抢修中', '已恢复', '已升级'] as const
export type RepairStatus = (typeof REPAIR_STATUSES)[number]

// 允许的状态推进表：只登记合法去向，其余组合都按越级处理。
export const REPAIR_TRANSITIONS: Record<string, string[]> = {
  待派修: ['抢修中'],
  抢修中: ['已恢复', '已升级'],
}

// 终态整单只读：恢复后归原队留档，升级后转上级处理，都不得再改。
export const REPAIR_LOCKED_STATUSES = ['已恢复', '已升级']

// 到场时限沿用既有抢修口径分时段核定：白天 45 分钟，夜间抢修时限单独算（90 分钟）。
export const DAY_ARRIVAL_LIMIT_MIN = 45
export const NIGHT_ARRIVAL_LIMIT_MIN = 90
// 夜间班：20:00 到次日 08:00，按派修时刻落在哪个班次取哪条时限。
export const NIGHT_START_HOUR = 20
export const NIGHT_END_HOUR = 8

// 抢修字段口径：抢修详情与抢修台账共用同一套字段、同一个「到场时间」，不存在两处口径。
export const REPAIR_FIELDS = [
  '抢修编号',
  '故障管段',
  '故障类型',
  '影响面积',
  '所属片区',
  '归属抢修队',
  '当前值班队',
  '当前值班人',
  '报修时间',
  '派修时间',
  '到场时间',
  '到场时限',
  '恢复时间',
] as const

// 只有该队值班人能改的字段（归属管控的核心两项）。
export const RESTRICTED_REPAIR_FIELDS = ['故障类型', '到场时间']

export const REPAIR_PENDING_REASON_MISSING_AREA = '影响面积缺失，先挂起，补齐后再派修'

export type RepairAudit = {
  at: string
  actor: string
  team: string
  action: string
  detail?: string
  rejected?: boolean
}

export type RepairRow = EntryRow & {
  日志?: RepairAudit[]
}

export type RepairTeam = {
  id: string
  name: string
  district: string
  members: string[]
}

// 抢修队按片区轮值：每个片区一支轮值序列，当前指针指向当班队，交接时指针向后走一位。
export type RepairDistrict = {
  district: string
  rotation: string[] // 抢修队 id 顺序
  cursor: number // 当前值班队在 rotation 中的下标
  handovers: { at: string; from: string; to: string; openOrders: number }[]
}

export const REPAIR_TEAMS: RepairTeam[] = [
  // 城东
  { id: 'EA', name: '城东抢修甲队', district: '城东片区', members: ['王建军', '李志强'] },
  { id: 'EB', name: '城东抢修乙队', district: '城东片区', members: ['赵晓东', '孙立伟'] },
  // 城南
  { id: 'SA', name: '城南抢修甲队', district: '城南片区', members: ['陈国庆', '刘德海'] },
  { id: 'SB', name: '城南抢修乙队', district: '城南片区', members: ['周文斌', '吴建华'] },
  // 城西
  { id: 'WA', name: '城西抢修甲队', district: '城西片区', members: ['郑永刚', '冯海涛'] },
  { id: 'WB', name: '城西抢修乙队', district: '城西片区', members: ['褚明辉', '卫国强'] },
  // 城北
  { id: 'NA', name: '城北抢修甲队', district: '城北片区', members: ['蒋卫东', '沈春阳'] },
  { id: 'NB', name: '城北抢修乙队', district: '城北片区', members: ['韩雪峰', '杨守义'] },
]

export const REPAIR_DISTRICTS = ['城东片区', '城南片区', '城西片区', '城北片区'] as const
export type RepairDistrictName = (typeof REPAIR_DISTRICTS)[number]

export const REPAIR_TEAM_BY_ID: Map<string, RepairTeam> = new Map(
  REPAIR_TEAMS.map((team) => [team.id, team]),
)

// 花名册初始状态：每个片区轮值序列的第一队当班。
export function initialRoster(): RepairDistrict[] {
  return REPAIR_DISTRICTS.map((district) => {
    const rotation = REPAIR_TEAMS.filter((team) => team.district === district).map((team) => team.id)
    return { district, rotation, cursor: 0, handovers: [] }
  })
}

export function teamNameOf(teamId: string): string {
  return REPAIR_TEAM_BY_ID.get(teamId)?.name ?? teamId
}

export function currentTeamIdOf(roster: RepairDistrict[], district: string): string {
  const slot = roster.find((item) => item.district === district)
  if (!slot || slot.rotation.length === 0) {
    return ''
  }
  return slot.rotation[slot.cursor]
}

// 判定某一时刻是否属于夜间班：小时 >= 20:00 或 < 08:00。
export function isNightShift(at: Date): boolean {
  const hour = at.getHours()
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR
}

export function arrivalLimitLabel(at: Date): string {
  return isNightShift(at) ? `夜间 ${NIGHT_ARRIVAL_LIMIT_MIN} 分钟` : `白天 ${NIGHT_ARRIVAL_LIMIT_MIN} 分钟`
}

export function arrivalLimitMinutes(at: Date): number {
  return isNightShift(at) ? NIGHT_ARRIVAL_LIMIT_MIN : DAY_ARRIVAL_LIMIT_MIN
}

// 沿用既有抢修口径核定到场时限：按派修时刻对应班次给定时限。
export function describeArrivalLimit(dispatchedAt: string): string {
  const at = new Date(dispatchedAt.replace(' ', 'T'))
  if (Number.isNaN(at.getTime())) {
    return ''
  }
  return arrivalLimitLabel(at)
}

// 超时核定：派修到到场的实际耗时对比当班时限，> 时限即超时（口径只核到场，不核恢复）。
export function assessArrival(dispatchedAt: string, arrivedAt: string): {
  timed: boolean
  overtime: boolean
  usedMin: number
  limitMin: number
  night: boolean
} {
  const start = new Date(dispatchedAt.replace(' ', 'T'))
  const end = new Date(arrivedAt.replace(' ', 'T'))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { timed: false, overtime: false, usedMin: 0, limitMin: 0, night: false }
  }
  const limitMin = arrivalLimitMinutes(start)
  const usedMin = Math.round((end.getTime() - start.getTime()) / 60000)
  return {
    timed: usedMin >= 0,
    overtime: usedMin > limitMin,
    usedMin,
    limitMin,
    night: isNightShift(start),
  }
}

export function nowStamp(): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const at = new Date()
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`
  )
}

// 统一的时间先后校验：两个字段都填了就必须满足 first <= second。
export function isChronological(first: string, second: string): boolean {
  if (!first || !second) {
    return true
  }
  const a = new Date(first.replace(' ', 'T')).getTime()
  const b = new Date(second.replace(' ', 'T')).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return false
  }
  return a <= b
}

type NumberedRow = { [field: string]: unknown }

export function nextRepairNo(rows: NumberedRow[]): string {
  let max = 0
  for (const row of rows) {
    const matched = String(row['抢修编号'] ?? '').match(/^EMER-(\d+)$/)
    if (matched) {
      max = Math.max(max, Number(matched[1]))
    }
  }
  return `EMER-${String(max + 1).padStart(4, '0')}`
}

export function nextPatrolNo(rows: NumberedRow[]): string {
  let max = 0
  for (const row of rows) {
    const matched = String(row['巡检编号'] ?? '').match(/^STAT-(\d+)$/)
    if (matched) {
      max = Math.max(max, Number(matched[1]))
    }
  }
  return `STAT-${String(max + 1).padStart(4, '0')}`
}
