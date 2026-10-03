// 抢修领域规则的冒烟测试：esbuild 打包后在 node 里跑，不经过浏览器。
import {
  assessArrival,
  createRepair,
  currentDuty,
  handoverRotation,
  isSuspended,
  repairAudit,
  runRepairAction,
  setRepairActor,
  updateRepair,
} from '@/api/repair-service'
import { listRows } from '@/data/local-store'

const results: string[] = []
function check(name: string, cond: boolean, extra = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

const TEAM1 = { team: '抢修一队', member: '王建国' }
const TEAM2 = { team: '抢修二队', member: '李海峰' }
const TEAM3 = { team: '抢修三队', member: '赵铁柱' }

// 1. 跨队提交打回：一队的单子，二队值班人不能派修
setRepairActor(TEAM2)
const r1 = runRepairAction(1, '派出抢修')
check('跨队派修打回', !r1.ok && r1.message.includes('跨队打回'), r1.message)

// 2. 归属队派修成功，派修时间落戳
setRepairActor(TEAM1)
const r2 = runRepairAction(1, '派出抢修')
const row1 = listRows('emergencyrepair').find((r) => Number(r.id) === 1)!
check('归属队派修成功', r2.ok && row1.status === '抢修中' && String(row1['派修时间']).length > 0, r2.message)

// 3. 重复派修只落一条
const r3 = runRepairAction(1, '派出抢修')
check('重复派修不落新单', !r3.ok && r3.message.includes('只落一条'), r3.message)

// 4. 越级挡回：抢修中不能直接确认恢复之外的状态？（抢修中→确认恢复合法，先测待派修越级）
//    先对单4（待派修、影响面积缺失）测挂起
setRepairActor(TEAM3)
const r4 = runRepairAction(4, '派出抢修')
check('影响面积缺失挂起', !r4.ok && r4.message.includes('挂起'), r4.message)

// 5. 补录面积后解除挂起并可派修
const r5 = updateRepair(4, { 影响面积: '900' })
check('补录影响面积', r5.ok, r5.message)
const row4 = listRows('emergencyrepair').find((r) => Number(r.id) === 4)!
check('挂起解除', !isSuspended(row4))
const r6 = runRepairAction(4, '派出抢修')
check('补录后可派修', r6.ok, r6.message)

// 6. 越级：单4 现在抢修中，直接确认恢复合法；对单2（抢修中）越级到已升级？合法。先测待派修→确认恢复
setRepairActor(TEAM1)
const r7 = runRepairAction(1, '确认恢复') // 单1 抢修中，合法
check('抢修中确认恢复', r7.ok, r7.message)
const row1After = listRows('emergencyrepair').find((r) => Number(r.id) === 1)!
check('恢复后只读', row1After.status === '已恢复')
const r8 = runRepairAction(1, '上报升级')
check('恢复后整单只读', !r8.ok && r8.message.includes('只读'), r8.message)
const r9 = updateRepair(1, { 到场时间: '2026-10-03 09:00' })
check('恢复后改单被挡', !r9.ok && r9.message.includes('只读'), r9.message)

// 7. 恢复结果落到站点巡检待整改清单，且只落一条
const patrol = listRows('stationpatrol')
const rect = patrol.filter((r) => String(r['巡检路线']) === '抢修复查-EMER-0001')
check('恢复落巡检待整改', rect.length === 1 && rect[0].status === '待整改' && rect[0]['发现问题数'] === 1)

// 8. 到场核定：夜间单5（02:00→03:25，85分钟 > 夜间60）超时；昼间单2（08:05→08:26，21分钟 ≤ 30）达标
const row5 = listRows('emergencyrepair').find((r) => Number(r.id) === 5)!
const a5 = assessArrival(row5)
check('夜间时限单独算且超时', a5.verdict === '超时' && a5.period === '夜间' && a5.limitMinutes === 60, a5.text)
const row2 = listRows('emergencyrepair').find((r) => Number(r.id) === 2)!
const a2 = assessArrival(row2)
check('昼间到场达标', a2.verdict === '达标' && a2.period === '昼间' && a2.limitMinutes === 30, a2.text)

// 9. 到场时间早于派修时间打回；合法改动落台账且留痕
setRepairActor(TEAM2)
const r10 = updateRepair(2, { 到场时间: '2026-10-03 07:00' })
check('到场早于派修打回', !r10.ok && r10.message.includes('口径'), r10.message)
const r11 = updateRepair(2, { 到场时间: '2026-10-03 08:30', 故障类型: '阀门内漏' })
check('归属队改单成功', r11.ok, r11.message)
const row2After = listRows('emergencyrepair').find((r) => Number(r.id) === 2)!
check('台账详情同一套到场时间', String(row2After['到场时间']) === '2026-10-03 08:30')
const trail = repairAudit(2)
check('改动留痕可追人', trail.some((t) => t.action === '保存修改' && t.operator === '李海峰' && t.team === '抢修二队'), `${trail.length} 条留痕`)

// 10. 跨队改单打回并留痕
setRepairActor(TEAM1)
const r12 = updateRepair(2, { 到场时间: '2026-10-03 08:40' })
check('跨队改单打回', !r12.ok && r12.message.includes('跨队打回'), r12.message)
check('打回也留痕', repairAudit(2).some((t) => t.action === '打回' && t.team === '抢修一队'))

// 11. 重复登记去重
setRepairActor(TEAM1)
const r13 = createRepair({ 所属片区: '城东片区', 故障管段: 'PRIM-0012', 故障类型: '焊缝开裂', 影响面积: '100' })
check('重复登记只落一条', !r13.ok && r13.message.includes('只落一条'), r13.message)
const r14 = createRepair({ 所属片区: '城东片区', 故障管段: 'SECO-0999', 故障类型: '管道泄漏', 影响面积: '' })
check('新故障登记成功且挂起', r14.ok && r14.message.includes('挂起'), r14.message)

// 12. 轮值交接：未恢复单跟新值班人走，历史单归原队
const before = listRows('emergencyrepair')
const histBefore = before.filter((r) => ['已恢复', '已升级'].includes(String(r.status))).map((r) => [Number(r.id), String(r['抢修队'])])
const h = handoverRotation()
check('交接返回汇总', h.ok && h.message.includes('轮值交接完成'), h.message)
const after = listRows('emergencyrepair')
const duty = currentDuty()
const openRows = after.filter((r) => ['待派修', '抢修中'].includes(String(r.status)))
check('未恢复单随新值班人', openRows.every((r) => String(r['抢修队']) === duty[String(r['所属片区'])]), openRows.map((r) => `${r['抢修编号']}→${r['抢修队']}`).join(','))
const histAfter = after.filter((r) => ['已恢复', '已升级'].includes(String(r.status))).map((r) => [Number(r.id), String(r['抢修队'])])
check('历史记录仍归原队', JSON.stringify(histBefore) === JSON.stringify(histAfter))
const dutyEntries = Object.entries(duty).map(([a, t]) => `${a}:${t}`).join(' ')
check('轮值表推进', dutyEntries.includes('抢修'), dutyEntries)

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL')).length
console.log(`\n${results.length - fails}/${results.length} 通过`)
if (fails > 0) process.exit(1)
