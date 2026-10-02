<template>
  <section class="page" data-module="funding">
    <header class="page-head">
      <div>
        <h2>经费下达与拨付台账</h2>
        <p class="page-desc">按下达文号分栏陈列上级防治经费，逐栏列出经费批次、拨付金额与拨付进度；尚未拨付到位的另列一栏。状态按「收到下达→财务复核→拨付到位」固定次序推进。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出台账清单</button>
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

    <!-- 收到下达：登记入口。文号为空按无效值退回重填，重复提交只认先到一份。 -->
    <form class="ledger-form" @submit.prevent="submitIncoming">
      <h3 class="ledger-form-title">收到下达登记</h3>
      <div class="ledger-form-grid">
        <label class="filter-item">
          <span>下达文号（必填）</span>
          <input v-model="form['下达文号']" placeholder="如：川财资环〔2026〕18号" />
        </label>
        <label class="filter-item">
          <span>经费批次（必填）</span>
          <input v-model="form['经费批次']" placeholder="如：2026年第3批" />
        </label>
        <label class="filter-item">
          <span>拨付金额（万元）</span>
          <input v-model="form['拨付金额']" placeholder="如：60" inputmode="decimal" />
        </label>
        <label class="filter-item">
          <span>所属工程</span>
          <input v-model="form['所属工程']" placeholder="如：PROJ-0001，可留空" list="project-options" />
          <datalist id="project-options">
            <option v-for="code in projectOptions" :key="code" :value="code" />
          </datalist>
        </label>
        <label class="filter-item">
          <span>下达日期</span>
          <input v-model="form['下达日期']" type="date" />
        </label>
      </div>
      <div class="ledger-form-foot">
        <button class="btn primary" type="submit">提交收到下达</button>
        <span class="form-hint">新登记一律为「收到下达」、拨付进度 0%，不可插队直接报到位</span>
      </div>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 尚未拨付到位：另列一栏 -->
    <section class="ledger-column pending-column">
      <header class="ledger-column-head">
        <h3>尚未拨付到位（{{ pendingRows.length }} 笔）</h3>
        <span class="column-hint">收到下达、财务复核阶段的批次都在这里盯着</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>下达文号</th>
            <th>经费批次</th>
            <th>拨付金额（万元）</th>
            <th>拨付进度</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pendingRows" :key="`pending-${String(row.id)}`">
            <td>{{ row['下达文号'] }}</td>
            <td>{{ row['经费批次'] }}</td>
            <td>{{ formatAmount(row['拨付金额']) }}</td>
            <td>{{ progressOf(row) }}%</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button v-if="nextAction(row)" class="link" type="button" @click="advance(row)">
                {{ nextAction(row) }}
              </button>
              <span v-else class="column-hint">已到位</span>
            </td>
          </tr>
          <tr v-if="!pendingRows.length">
            <td colspan="6" class="empty-state">没有尚未拨付到位的批次</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 按下达文号分栏陈列 -->
    <section v-for="group in groupedRows" :key="group.docNo" class="ledger-column">
      <header class="ledger-column-head">
        <h3>下达文号：{{ group.docNo }}</h3>
        <span class="column-hint">
          {{ group.rows.length }} 个批次 · 合计 {{ formatAmount(group.amount) }} 万元 ·
          未到位 {{ group.pendingCount }} 笔
        </span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>经费批次</th>
            <th>拨付金额（万元）</th>
            <th>拨付进度</th>
            <th>所属工程</th>
            <th>下达日期</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.rows" :key="String(row.id)">
            <td>{{ row['经费批次'] }}</td>
            <td>{{ formatAmount(row['拨付金额']) }}</td>
            <td>{{ progressOf(row) }}%</td>
            <td>{{ row['所属工程'] ?? '—' }}</td>
            <td>{{ row['下达日期'] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button v-if="nextAction(row)" class="link" type="button" @click="advance(row)">
                {{ nextAction(row) }}
              </button>
              <span v-else class="column-hint">流程已走完</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-if="!groupedRows.length" class="empty-state ledger-empty">当前筛选条件下没有台账记录</p>

    <footer class="page-foot">
      <span>共 {{ total }} 笔经费台账记录，拨付金额合计 {{ formatAmount(totalAmount) }} 万元</span>
      <span v-if="infoMessage" class="info-text">{{ infoMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  submitFunding,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'
import type { EntryRow, FundingSubmit } from '@/data/types'

const meta = moduleMeta('funding')
const filterFields = ['下达文号', '经费批次', '所属工程']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const filters = ref<Record<string, string>>({})

const emptyForm = (): FundingSubmit => ({
  下达文号: '',
  经费批次: '',
  拨付金额: '',
  所属工程: '',
  下达日期: '',
})
const form = reactive<FundingSubmit>(emptyForm())

const projectOptions = computed(() =>
  [...new Set(listRows('project').map((row) => String(row['工程编号'] ?? '')).filter(Boolean))],
)

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 分栏：同一下达文号归一栏。
const groupedRows = computed(() => {
  const map = new Map<string, EntryRow[]>()
  for (const row of rows.value) {
    const docNo = String(row['下达文号'] ?? '')
    const bucket = map.get(docNo) ?? []
    bucket.push(row)
    map.set(docNo, bucket)
  }
  return [...map.entries()].map(([docNo, bucket]) => ({
    docNo,
    rows: bucket,
    amount: bucket.reduce((sum, row) => sum + (Number(row['拨付金额']) || 0), 0),
    pendingCount: bucket.filter((row) => String(row.status) !== '拨付到位').length,
  }))
})

// 尚未拨付到位的那几笔，另列一栏。
const pendingRows = computed(() =>
  rows.value.filter((row) => String(row.status) !== '拨付到位'),
)

const totalAmount = computed(() =>
  rows.value.reduce((sum, row) => sum + (Number(row['拨付金额']) || 0), 0),
)

const stats = computed(() => [
  { label: '下达批次合计', value: rows.value.length },
  { label: '待复核批次', value: rows.value.filter((row) => String(row.status) === '收到下达').length },
  { label: '未拨付到位批次', value: pendingRows.value.length },
  { label: '拨付金额合计（万元）', value: formatAmount(totalAmount.value) },
])

// 固定次序：每行只暴露「当前状态的下一格」动作，插队按钮直接不给。
function nextAction(row: EntryRow): string {
  const index = meta.statuses.indexOf(String(row.status))
  if (index < 0 || index >= meta.statuses.length - 1) {
    return ''
  }
  return meta.actions[index]
}

function progressOf(row: EntryRow): number {
  const value = Number(row['拨付进度'])
  return Number.isFinite(value) ? value : 0
}

function formatAmount(value: string | number | boolean | undefined): string {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function submitIncoming() {
  errorMessage.value = ''
  infoMessage.value = ''
  const result = submitFunding({ ...form })
  if (!result.ok) {
    // 下达文号为空、金额非法、重复提交等都退回，不落到台账。
    errorMessage.value = result.message
    return
  }
  infoMessage.value = result.message
  Object.assign(form, emptyForm())
  reload()
}

function advance(row: EntryRow) {
  errorMessage.value = ''
  infoMessage.value = ''
  const action = nextAction(row)
  if (!action) {
    errorMessage.value = '该记录已到终态，没有可推进的动作'
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  infoMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '经费台账读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.ledger-form {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.ledger-form-title {
  margin: 0 0 10px;
  font-size: 14px;
}
.ledger-form-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.ledger-form-grid .filter-item {
  flex: 1 1 180px;
}
.ledger-form-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}
.form-hint,
.column-hint {
  color: var(--muted);
  font-size: 12px;
}
.ledger-column {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
}
.pending-column {
  border-color: #f0c36d;
  background: #fffaf0;
}
.ledger-column-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
.ledger-column-head h3 {
  margin: 0;
  font-size: 14px;
}
.ledger-empty {
  padding: 16px;
}
.info-text {
  color: #17693a;
}
</style>
