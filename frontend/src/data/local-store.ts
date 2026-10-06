import { SEED_ROWS } from './seed'
import type { EntryRow, RecheckRecord } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'underground-pipeline-inspection:entries'
// 非开挖复检记录单独存一份：与修复记录解耦，修复记录重置不影响历史复检结论。
const RECHECK_STORAGE_KEY = 'underground-pipeline-inspection:trenchless-rechecks'

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

let recheckCache: RecheckRecord[] | null = null

function readRecheckStorage(): RecheckRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(RECHECK_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(RECHECK_STORAGE_KEY, '[]')
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RecheckRecord[]) : []
  } catch {
    window.localStorage.setItem(RECHECK_STORAGE_KEY, '[]')
    return []
  }
}

export function listRecheckRows(): RecheckRecord[] {
  if (recheckCache === null) {
    recheckCache = readRecheckStorage()
  }
  return recheckCache
}

export function saveRecheckRows(rows: RecheckRecord[]): void {
  recheckCache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(RECHECK_STORAGE_KEY, JSON.stringify(rows))
  }
}

export function resetRecheckRows(): RecheckRecord[] {
  saveRecheckRows([])
  return []
}
