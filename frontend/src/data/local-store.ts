import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'district-heating:entries'
// 变更留痕与片区轮值各用一个键，和业务记录分开存。
const AUDIT_KEY = 'district-heating:audit'
const DUTY_KEY = 'district-heating:duty'

// 一条留痕：谁、哪支队、什么时候、做了什么、改动内容。打回的提交也留痕，事后能追到人。
export type AuditEntry = {
  time: string
  operator: string
  team: string
  action: string
  detail: string
}

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

export function storageKey(): string {
  return STORAGE_KEY
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

type AuditBook = Record<string, Record<string, AuditEntry[]>>

export function listAudit(key: string, id: number): AuditEntry[] {
  const book = readJson<AuditBook>(AUDIT_KEY, {})
  return book[key]?.[String(id)] ?? []
}

export function appendAudit(key: string, id: number, entry: AuditEntry): void {
  const book = readJson<AuditBook>(AUDIT_KEY, {})
  const moduleBook = book[key] ?? {}
  const list = moduleBook[String(id)] ?? []
  list.push(entry)
  moduleBook[String(id)] = list
  book[key] = moduleBook
  writeJson(AUDIT_KEY, book)
}

export function loadDutyMap(): Record<string, string> | null {
  return readJson<Record<string, string> | null>(DUTY_KEY, null)
}

export function saveDutyMap(map: Record<string, string>): void {
  writeJson(DUTY_KEY, map)
}
