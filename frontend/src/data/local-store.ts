import { initialRoster } from './repair'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'
import type { RepairDistrict } from './repair'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'district-heating:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 抢修轮值花名册单独存一格，不和业务条目混在同一个 key 里。
const ROSTER_KEY = 'district-heating:repair-roster'

export function loadRoster(): RepairDistrict[] {
  const fallback = initialRoster()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(ROSTER_KEY)
  if (!raw) {
    window.localStorage.setItem(ROSTER_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as RepairDistrict[]
    // 以花名册初始口径为准补齐片区，避免老缓存缺片区。
    const byDistrict = new Map(parsed.map((item) => [item.district, item]))
    return fallback.map((item) => byDistrict.get(item.district) ?? item)
  } catch {
    window.localStorage.setItem(ROSTER_KEY, JSON.stringify(fallback))
    return fallback
  }
}

export function saveRoster(roster: RepairDistrict[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(ROSTER_KEY, JSON.stringify(roster))
  }
}

// 回到抢修初始口径：抢修单、待整改来源、轮值花名册一起复位。
export function resetRepairData(): void {
  saveRows('emergencyrepair', clone(SEED_ROWS['emergencyrepair'] ?? []))
  saveRows('stationpatrol', clone(SEED_ROWS['stationpatrol'] ?? []))
  saveRoster(initialRoster())
}

export function storageKey(): string {
  return STORAGE_KEY
}
