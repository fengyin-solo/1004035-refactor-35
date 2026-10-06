/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 复检结论：进行中是临时态，其余三种是复检登记后的最终结论。 */
export type RecheckOutcome = '进行中' | '复检合格' | '复检不通过' | '复检中断'

/**
 * 一次复检尝试：发起时写一条「进行中」，登记结果后原地更新同一条；
 * 重复点击不会产生第二条。发起时快照修复记录的有效状态，复检失败/中断后据此回退。
 */
export type RecheckRecord = {
  id: number
  repairId: number
  /** 发起复检时修复记录的 pending 值，失败回退时原样保留。 */
  basePending: boolean
  修复编号: string
  发起时间: string
  完成时间: string
  发起时状态: string
  复检结果: RecheckOutcome
  [field: string]: string | number | boolean
}

/** 复检入口统一结果：各入口（发起、合格、不通过、中断）都按同一结构返回与展示。 */
export type RecheckKind =
  | 'started'
  | 'need-supplement'
  | 'passed'
  | 'retained'
  | 'duplicate'
  | 'frozen'
  | 'blocked'
  | 'not-found'

export type RecheckResult = {
  ok: boolean
  kind: RecheckKind
  message: string
}

export type RecheckListResult = {
  items: RecheckRecord[]
  total: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
