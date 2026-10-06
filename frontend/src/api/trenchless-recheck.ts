import {
  listRecheckRows,
  listRows,
  resetRecheckRows,
  saveRecheckRows,
  saveRows,
} from '@/data/local-store'
import type { EntryRow, RecheckListResult, RecheckRecord, RecheckResult } from '@/data/types'

// 非开挖修复复检：缺资料、复检失败/中断、空记录三类边界在这里统一处理，
// 页面与通用动作入口都只经过本文件，保证提示文案与记录状态一致。

export const TRENCHLESS_KEY = 'trenchless'

// 复检入口动作：在通用动作之外补充三个结果登记动作。
export const START_RECHECK_ACTION = '发起复检'
export const RECHECK_PASS_ACTION = '复检合格'
export const RECHECK_FAIL_ACTION = '复检不通过'
export const RECHECK_INTERRUPT_ACTION = '复检中断'

export const RECHECK_ACTIONS = [
  START_RECHECK_ACTION,
  RECHECK_PASS_ACTION,
  RECHECK_FAIL_ACTION,
  RECHECK_INTERRUPT_ACTION,
] as const

export const STATUS_PENDING_SUPPLEMENT = '待补充'
export const STATUS_RECHECK_PASSED = '复检合格'
export const STATUS_RECHECKING = '待复检'

// 发起复检前必须齐备的资料：修复材料与施工日期，缺任一即转「待补充」。
const REQUIRED_FIELDS = ['修复材料', '施工日期'] as const

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function findRepair(repairId: number): { rows: EntryRow[]; index: number } | null {
  const rows = listRows(TRENCHLESS_KEY)
  const index = rows.findIndex((row) => Number(row.id) === Number(repairId))
  return index < 0 ? null : { rows, index }
}

function findActiveRecheck(repairId: number): RecheckRecord | undefined {
  return listRecheckRows().find(
    (item) => Number(item.repairId) === Number(repairId) && item.复检结果 === '进行中',
  )
}

function persistRepair(rows: EntryRow[], index: number, patch: Partial<EntryRow>): void {
  const next = [...rows]
  const updated: EntryRow = { ...next[index] }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      updated[key] = value
    }
  }
  next[index] = updated
  saveRows(TRENCHLESS_KEY, next)
}

function nextRecheckId(): number {
  return listRecheckRows().reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
}

/**
 * 发起复检：
 * - 资料缺失（修复材料/施工日期为空）→ 修复记录转「待补充」，不产生复检记录；
 * - 已有进行中复检 → 幂等提示，不再产生第二条；
 * - 已完成（复检合格）的复检 → 结果冻结，不允许重复发起；
 * - 只有「已完成」或资料补齐后的「待补充」可以发起。
 */
export function startRecheck(repairId: number): RecheckResult {
  const located = findRepair(repairId)
  if (!located) {
    return { ok: false, kind: 'not-found', message: `没有找到编号为 ${repairId} 的非开挖修复记录` }
  }

  if (findActiveRecheck(repairId)) {
    return {
      ok: false,
      kind: 'duplicate',
      message: '复检已在进行中，无需重复发起',
    }
  }

  const { rows, index } = located
  const repair = rows[index]

  if (String(repair.status) === STATUS_RECHECK_PASSED) {
    return {
      ok: false,
      kind: 'frozen',
      message: '复检已完成且结论合格，结果不能变更',
    }
  }

  const missing = REQUIRED_FIELDS.filter((field) => isBlank(repair[field]))
  if (missing.length > 0) {
    // 缺资料：统一进入「待补充」，提示与记录状态保持一致。
    persistRepair(rows, index, { status: STATUS_PENDING_SUPPLEMENT, pending: true })
    return {
      ok: false,
      kind: 'need-supplement',
      message: `缺少${missing.join('、')}，已转「待补充」，补齐后再发起复检`,
    }
  }

  const currentStatus = String(repair.status)
  if (currentStatus !== '已完成' && currentStatus !== STATUS_PENDING_SUPPLEMENT) {
    return {
      ok: false,
      kind: 'blocked',
      message: `当前状态为「${currentStatus}」，暂不能发起复检`,
    }
  }

  // 正常发起：只写一条复检记录并把修复记录置为「待复检」。
  const attempt: RecheckRecord = {
    id: nextRecheckId(),
    repairId: Number(repairId),
    basePending: Boolean(repair.pending),
    修复编号: String(repair['修复编号'] ?? repairId),
    发起时间: nowText(),
    完成时间: '',
    发起时状态: currentStatus,
    复检结果: '进行中',
  }
  saveRecheckRows([...listRecheckRows(), attempt])
  persistRepair(rows, index, { status: STATUS_RECHECKING, pending: false })
  return {
    ok: true,
    kind: 'started',
    message: '复检已发起，修复记录进入「待复检」',
  }
}

/**
 * 登记复检最终结果：
 * - 合格 → 复检结论冻结，修复记录转「复检合格」；
 * - 不通过/中断 → 回退并保留上次有效状态，不标记异常，允许重新发起复检。
 */
export function resolveRecheck(repairId: number, outcome: '复检合格' | '复检不通过' | '复检中断'): RecheckResult {
  const located = findRepair(repairId)
  if (!located) {
    return { ok: false, kind: 'not-found', message: `没有找到编号为 ${repairId} 的非开挖修复记录` }
  }

  const active = findActiveRecheck(repairId)
  if (!active) {
    return {
      ok: false,
      kind: 'blocked',
      message: '该修复记录还没有进行中的复检，请先发起复检',
    }
  }

  const attempts = listRecheckRows().map((item) =>
    item === active
      ? { ...item, 完成时间: nowText(), 复检结果: outcome }
      : item,
  )
  saveRecheckRows(attempts)

  const { rows, index } = located
  if (outcome === '复检合格') {
    // 合格结论只通过更新同一条复检记录得到，历史修复记录字段不动。
    persistRepair(rows, index, { status: STATUS_RECHECK_PASSED, pending: false })
    return { ok: true, kind: 'passed', message: '复检结论：合格，结果已保存' }
  }

  // 失败/中断：恢复发起前的有效状态与 pending 快照，不产生失败/异常态，允许重试。
  persistRepair(rows, index, {
    status: String(active.发起时状态),
    pending: Boolean(active.basePending),
  })
  const suffix = outcome === '复检中断' ? '复检已中断' : '复检未通过'
  return {
    ok: false,
    kind: 'retained',
    message: `${suffix}，已保留上次有效状态「${active.发起时状态}」，可重新发起复检`,
  }
}

/** 复检入口统一分发：所有触发复检的动作都走这里，返回同一结果结构。 */
export function dispatchRecheckAction(action: string, repairId: number): RecheckResult | null {
  switch (action) {
    case START_RECHECK_ACTION:
      return startRecheck(repairId)
    case RECHECK_PASS_ACTION:
      return resolveRecheck(repairId, '复检合格')
    case RECHECK_FAIL_ACTION:
      return resolveRecheck(repairId, '复检不通过')
    case RECHECK_INTERRUPT_ACTION:
      return resolveRecheck(repairId, '复检中断')
    default:
      return null
  }
}

/** 复检记录列表：按修复编号做包含匹配，空结果由页面展示明确空态。 */
export function listRechecks(filter: Record<string, string> = {}): RecheckListResult {
  const keyword = (filter['修复编号'] ?? '').trim()
  const items = [...listRecheckRows()]
    .sort((a, b) => Number(b.id) - Number(a.id))
    .filter((item) => keyword === '' || String(item['修复编号']).includes(keyword))
  return { items, total: items.length }
}

/** 修复记录重置时连带清空复检记录，保持模块内数据一致。 */
export function resetTrenchlessRechecks(): void {
  resetRecheckRows()
}
