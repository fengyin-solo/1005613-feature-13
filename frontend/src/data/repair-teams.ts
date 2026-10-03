// 抢修队、片区轮值与既有抢修口径：队名录、轮值顺序、昼夜划分、到场时限都集中在这一处，
// 台账页与详情页核定用同一套，调口径只改这里。

export type RepairTeam = {
  name: string
  member: string // 该队当前值班人
}

export const REPAIR_TEAMS: RepairTeam[] = [
  { name: '抢修一队', member: '王建国' },
  { name: '抢修二队', member: '李海峰' },
  { name: '抢修三队', member: '赵铁柱' },
]

// 抢修队按片区轮值：每个片区沿 ROTATION_ORDER 依次交接。
export const DUTY_AREAS = ['城东片区', '城西片区', '城北片区']
export const ROTATION_ORDER = REPAIR_TEAMS.map((team) => team.name)

// 既有抢修口径：昼间 06:00-22:00，夜间 22:00-次日 06:00；夜间抢修的时限单独算。
export const DAY_WINDOW = { startHour: 6, endHour: 22 }
export const ARRIVAL_LIMIT_MINUTES = { day: 30, night: 60 }

export function teamOf(name: string): RepairTeam | undefined {
  return REPAIR_TEAMS.find((team) => team.name === name)
}

// 初始轮值表：片区按顺序落到各队，之后以交接记录为准。
export function defaultDutyMap(): Record<string, string> {
  const map: Record<string, string> = {}
  DUTY_AREAS.forEach((area, index) => {
    map[area] = ROTATION_ORDER[index % ROTATION_ORDER.length]
  })
  return map
}
