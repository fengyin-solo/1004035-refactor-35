<template>
  <section class="page" data-module="trenchless">
    <header class="page-head">
      <div>
        <h2>非开挖修复管理</h2>
        <p class="page-desc">维护非开挖修复记录，围绕修复编号、修复管段、修复工艺、修复材料做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记非开挖修复记录</button>
        <button class="btn" type="button" @click="exportRows">导出非开挖修复清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div v-if="feedback" class="feedback-banner" :class="feedbackClass" role="status">
      {{ feedback }}
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>最近复检结果</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>{{ latestRecheck(row)?.复检结果 ?? '—' }}</td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无非开挖修复数据，可先登记非开挖修复记录</td>
        </tr>
      </tbody>
    </table>

    <section class="recheck-panel">
      <header class="recheck-head">
        <h3>复检记录</h3>
        <span class="page-desc">共 {{ recheckTotal }} 条复检记录</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in recheckColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in recheckRows" :key="String(record.id)">
            <td>{{ record.id }}</td>
            <td>{{ record['修复编号'] }}</td>
            <td>{{ record['发起时间'] }}</td>
            <td>{{ record['完成时间'] || '—' }}</td>
            <td>{{ record['发起时状态'] }}</td>
            <td>{{ record['复检结果'] }}</td>
          </tr>
          <tr v-if="!recheckRows.length">
            <td :colspan="recheckColumns.length" class="empty-state">暂无复检记录，修复完成后可发起复检</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条非开挖修复记录</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  RECHECK_INTERRUPT_ACTION,
  RECHECK_PASS_ACTION,
  RECHECK_FAIL_ACTION,
  STATUS_RECHECKING,
  listRechecks,
} from '@/api/trenchless-recheck'
import type { EntryRow, RecheckKind, RecheckRecord } from '@/data/types'

const meta = moduleMeta('trenchless')
const columns = ["修复编号", "修复管段", "修复工艺", "修复材料", "施工日期", "修复长度", "修复效果", "修复状态"]
// 与既有外部行为一致：三个基础动作仍对所有记录展示；复检结果动作仅在「待复检」出现。
const baseActions = ["安排施工", "确认完成", "发起复检"]
const recheckResolveActions = [RECHECK_PASS_ACTION, RECHECK_FAIL_ACTION, RECHECK_INTERRUPT_ACTION]
const statuses = ["待施工", "施工中", "已完成", "待复检", "待补充", "复检合格"]
const stats = [{"label": "待施工修复", "value": 0}, {"label": "施工中修复", "value": 0}, {"label": "已完成修复", "value": 0}]
const recheckColumns = ["复检编号", "修复编号", "发起时间", "完成时间", "发起时状态", "复检结果"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const recheckRows = ref<RecheckRecord[]>([])
const recheckTotal = ref(0)
const feedback = ref('')
const feedbackKind = ref<RecheckKind | 'error' | ''>('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const feedbackClass = computed(() => {
  switch (feedbackKind.value) {
    case 'started':
    case 'passed':
      return 'feedback-success'
    case 'need-supplement':
    case 'retained':
      return 'feedback-warning'
    case 'duplicate':
    case 'frozen':
    case 'blocked':
    case 'not-found':
      return 'feedback-info'
    default:
      return 'feedback-error'
  }
})

function actionsFor(row: EntryRow): string[] {
  return String(row.status) === STATUS_RECHECKING
    ? [...baseActions, ...recheckResolveActions]
    : baseActions
}

function latestRecheck(row: EntryRow): RecheckRecord | undefined {
  return recheckRows.value.find((record) => Number(record.repairId) === Number(row.id))
}

function setFeedback(message: string, kind: RecheckKind | 'error') {
  feedback.value = message
  feedbackKind.value = kind
}
function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  setFeedback('非开挖修复记录登记入口尚未接入审批流', 'blocked')
}

function runAction(action: string, row: EntryRow) {
  // 复检动作与通用动作都经过 local-service，结果结构一致；重复点击由服务层幂等拦截。
  const result = applyAction(meta.key, Number(row.id), action) as {
    ok: boolean
    message: string
    kind?: RecheckKind
  }
  setFeedback(result.message, result.kind ?? (result.ok ? 'started' : 'error'))
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    const recheckPayload = listRechecks({})
    recheckRows.value = recheckPayload.items
    recheckTotal.value = recheckPayload.total
  } catch (error) {
    rows.value = []
    recheckRows.value = []
    setFeedback(error instanceof Error ? error.message : '非开挖修复列表读取失败', 'error')
  }
}

onMounted(reload)
</script>
