import { defineStore } from 'pinia'

import { REPAIR_TEAMS } from '@/data/repair'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市集中供热管网与换热站运行管理平台',
    // 抢修处置用的值班身份：默认城东抢修甲队王建军，可在抢修页切换，用来验证跨队打回。
    repairTeamId: 'EA',
    repairOperator: REPAIR_TEAMS[0]?.members[0] ?? '值班人',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    repairTeamName(state): string {
      return REPAIR_TEAMS.find((team) => team.id === state.repairTeamId)?.name ?? state.repairTeamId
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRepairIdentity(teamId: string, operator: string) {
      this.repairTeamId = teamId
      this.repairOperator = operator
    },
  },
})
