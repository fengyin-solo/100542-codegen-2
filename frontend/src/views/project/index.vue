<template>
  <section class="page" data-module="project">
    <header class="page-head">
      <div>
        <h2>治理工程管理</h2>
        <p class="page-desc">维护治理工程，围绕工程编号、所属隐患点、工程类型、批复日期做登记、筛选与状态流转。经费台账接收下达后会在上方添一条待核拨付。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记治理工程</button>
        <button class="btn" type="button" @click="exportRows">导出治理工程清单</button>
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

    <section class="pending-panel">
      <header class="panel-head">
        <h3>待核拨付（经费台账联动）</h3>
        <span class="panel-tip">拨付金额始终取自《经费下达与拨付台账》，多处取数同一份</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>工程编号</th>
            <th>拨付文号</th>
            <th>拨付金额（万元）</th>
            <th>挂账日期</th>
            <th>所属隐患点</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pendingFundRows" :key="'pf' + String(row.id)">
            <td>{{ row['工程编号'] }}</td>
            <td>{{ row['拨付文号'] ?? '—' }}</td>
            <td>{{ linkedAmount(row) }}</td>
            <td>{{ row['批复日期'] ?? '—' }}</td>
            <td>{{ row['所属隐患点'] ?? '—' }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="confirmFund(row)">核拨确认</button>
            </td>
          </tr>
          <tr v-if="!pendingFundRows.length">
            <td colspan="6" class="empty-state">暂无待核拨付记录，经费台账「接收下达」后会自动添进来</td>
          </tr>
        </tbody>
      </table>
    </section>

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
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in tableRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!tableRows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无治理工程数据，可先登记治理工程</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条治理工程记录（另有 {{ pendingFundRows.length }} 条待核拨付见上方专栏）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
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
import { fundAmountOf } from '@/api/fund-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('project')
const columns = ["工程编号", "所属隐患点", "工程类型", "批复日期", "批复金额", "承建单位", "完工日期", "工程状态"]
const actions = ["提交批复", "开始施工", "确认竣工"]
const statuses = ["待核拨付", "待批复", "已批复", "施工中", "已竣工"]
const PENDING_FUND_STATUS = '待核拨付'

const rows = ref<EntryRow[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const pendingFundRows = computed(() => rows.value.filter((row) => row.status === PENDING_FUND_STATUS))
const tableRows = ref<EntryRow[]>([])

const stats = computed(() => [
  { label: '待核拨付工程', value: pendingFundRows.value.length },
  { label: '施工中工程', value: rows.value.filter((row) => row.status === '施工中').length },
  { label: '待批复工程', value: rows.value.filter((row) => row.status === '待批复').length },
  { label: '已竣工工程', value: rows.value.filter((row) => row.status === '已竣工').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

/** 拨付金额多处取数只认经费台账那一份；台账里查不到时退回显示批复金额。 */
function linkedAmount(row: EntryRow): string {
  const fundId = row['关联经费编号']
  const amount = fundId === undefined || fundId === '' ? null : fundAmountOf(Number(fundId))
  return amount === null ? `待核（批复 ${row['批复金额'] ?? '—'}）` : amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '治理工程登记入口尚未接入审批流'
}

function confirmFund(row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), '核拨确认')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    // 待核拨付另列专栏，主表不再重复陈列；筛选条件只作用于主表。
    const payload = listEntries(meta.key, filters.value)
    rows.value = listEntries(meta.key).items
    tableRows.value = payload.items.filter((row) => row.status !== PENDING_FUND_STATUS)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '治理工程列表读取失败'
  }
}

const total = computed(() => tableRows.value.length)

onMounted(reload)
</script>

<style scoped>
.pending-panel {
  background: #fff;
  border: 1px solid #f2b083;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
}
.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}
.panel-head h3 {
  margin: 0;
  font-size: 14px;
}
.panel-tip {
  font-size: 12px;
  color: var(--muted);
}
</style>
