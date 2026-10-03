import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市集中供热管网与换热站运行管理平台',
    // 当前值班的抢修队与值班人：抢修归属管控以这个身份为准。
    crewTeam: '抢修一队',
    crewMember: '王建国',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setCrew(team: string, member: string) {
      this.crewTeam = team
      this.crewMember = member
    },
  },
})
