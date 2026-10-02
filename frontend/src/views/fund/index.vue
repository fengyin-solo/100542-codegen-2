<template>
  <section class="page" data-module="fund">
    <header class="page-head">
      <div>
        <h2>经费下达与拨付台账</h2>
        <p class="page-desc">
          按下达文号分栏陈列，逐栏列出经费批次、拨付金额与拨付进度；尚未拨付到位的几笔另列一栏。
          状态按「收到下达 → 财务复核 → 拨付到位」固定次序推进，插队不认、重复提交只认先到的。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showForm = !showForm">
          {{ showForm ? '收起接收单' : '接收下达' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出台账</button>
        <button class="btn ghost" type="button" @click="resetLedger">重置台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ formatValue(item.label, item.value) }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">拨付金额口径：文号登记表（多处取数同一份）</span>
    </p>

    <form v-if="showForm" class="fund-form" @submit.prevent="submit">
      <div class="form-grid">
        <label class="filter-item">
          <span>下达文号 <em>*</em></span>
          <input v-model="form.docNo" list="fund-doc-list" placeholder="选择或填写下达文号，为空按无效值退回" />
        </label>
        <label class="filter-item">
          <span>经费批次</span>
          <input v-model="form.batch" list="fund-batch-list" placeholder="与文号对不上时按文号口径归正" />
        </label>
        <label class="filter-item">
          <span>上报拨付金额（万元）</span>
          <input v-model="form.amountInput" placeholder="仅作核对，入账金额以登记表为准" />
        </label>
        <label class="filter-item">
          <span>关联治理工程编号</span>
          <input v-model="form.projectCode" placeholder="可空，留空自动生成" />
        </label>
      </div>
      <datalist id="fund-doc-list">
        <option v-for="doc in docOptions" :key="doc" :value="doc" />
      </datalist>
      <datalist id="fund-batch-list">
        <option
          v-for="entry in batchOptions"
          :key="entry.docNo + entry.batch"
          :value="entry.batch"
        >
          {{ entry.docNo }}｜{{ entry.amount }}万元
        </option>
      </datalist>
      <div class="form-foot">
        <button class="btn primary" type="submit">提交接收</button>
        <button class="btn ghost" type="button" @click="showForm = false">取消</button>
      </div>
      <ul v-if="notices.length" class="form-notices">
        <li v-for="(item, index) in notices" :key="index">{{ item }}</li>
      </ul>
    </form>

    <p v-if="formMessage" :class="['form-message', lastOk ? 'ok-text' : 'error-text']">{{ formMessage }}</p>

    <div class="board">
      <article v-for="column in columns" :key="column.docNo" class="board-col">
        <header class="col-head">
          <strong>{{ column.docNo }}</strong>
          <span class="col-title">{{ column.docTitle || '未登记文号' }}</span>
          <span class="col-sum">{{ column.rows.length }} 笔 · {{ formatAmount(column.totalAmount) }} 万元</span>
        </header>
        <div v-for="row in column.rows" :key="String(row.id)" class="fund-card">
          <div class="card-line">
            <span class="batch-name">{{ row['经费批次'] }}</span>
            <span :class="['status-tag', tagClass(String(row.status))]">{{ row.status }}</span>
          </div>
          <div class="card-line amount-line">
            <span>拨付金额</span>
            <strong>{{ formatAmount(Number(row['拨付金额'])) }} 万元</strong>
          </div>
          <div class="progress-track">
            <div class="progress-bar" :style="{ width: String(row['拨付进度']) }" />
            <span class="progress-text">拨付进度 {{ row['拨付进度'] }}</span>
          </div>
          <div class="card-line sub-line">
            <span>关联工程：{{ row['关联工程'] || '—' }}</span>
          </div>
          <div class="card-line sub-line">
            <span>接收：{{ row['接收时间'] || '—' }}</span>
          </div>
          <div class="card-line sub-line">
            <span>复核：{{ row['复核时间'] || '—' }}</span>
          </div>
          <div class="card-line sub-line">
            <span>到位：{{ row['到位时间'] || '—' }}</span>
          </div>
          <p v-if="row['对账说明']" class="card-note">{{ row['对账说明'] }}</p>
          <div v-if="nextAction(String(row.status))" class="card-actions">
            <button class="link" type="button" @click="advance(row, nextAction(String(row.status))!.action)">
              {{ nextAction(String(row.status))!.action }}
            </button>
          </div>
        </div>
        <p v-if="!column.rows.length" class="col-empty">该文号暂无经费记录</p>
      </article>

      <article class="board-col pending-col">
        <header class="col-head">
          <strong>尚未拨付到位</strong>
          <span class="col-title">收到下达 / 财务复核两笔汇总</span>
          <span class="col-sum">{{ pendingRows.length }} 笔 · {{ formatAmount(pendingAmount) }} 万元</span>
        </header>
        <div v-for="row in pendingRows" :key="'p' + String(row.id)" class="fund-card pending-card">
          <div class="card-line">
            <span class="batch-name">{{ row['下达文号'] }}</span>
            <span :class="['status-tag', tagClass(String(row.status))]">{{ row.status }}</span>
          </div>
          <div class="card-line">
            <span>{{ row['经费批次'] }}</span>
            <strong>{{ formatAmount(Number(row['拨付金额'])) }} 万元</strong>
          </div>
          <div class="progress-track">
            <div class="progress-bar" :style="{ width: String(row['拨付进度']) }" />
            <span class="progress-text">拨付进度 {{ row['拨付进度'] }}</span>
          </div>
          <div v-if="nextAction(String(row.status))" class="card-actions">
            <button class="link" type="button" @click="advance(row, nextAction(String(row.status))!.action)">
              {{ nextAction(String(row.status))!.action }}
            </button>
          </div>
        </div>
        <p v-if="!pendingRows.length" class="col-empty">各笔经费均已拨付到位</p>
      </article>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 笔经费记录，数据保存在本机浏览器</span>
      <span v-if="actionMessage" class="error-text">{{ actionMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  advanceFund,
  exportFunds,
  fundColumns,
  fundStats,
  nextFundAction,
  pendingFunds,
  resetFunds,
  submitFund,
} from '@/api/fund-service'
import { FUND_CATALOG, FUND_DOC_ORDER } from '@/data/fund-catalog'
import type { EntryRow } from '@/data/types'

const FUND_STATUS = ['收到下达', '财务复核', '拨付到位']

const columns = ref<ReturnType<typeof fundColumns>>([])
const pendingRows = ref<EntryRow[]>([])
const stats = ref(fundStats())
const actionMessage = ref('')
const formMessage = ref('')
const notices = ref<string[]>([])
const lastOk = ref(false)
const showForm = ref(false)

const form = ref({ docNo: '', batch: '', amountInput: '', projectCode: '' })

const total = computed(() => columns.value.reduce((sum, column) => sum + column.rows.length, 0))
const pendingAmount = computed(() =>
  pendingRows.value.reduce((sum, row) => sum + (Number(row['拨付金额']) || 0), 0),
)
const statusSummary = computed(() =>
  FUND_STATUS.map((status) => ({
    status,
    count: columns.value.reduce((sum, column) => sum + column.rows.filter((row) => row.status === status).length, 0),
  })),
)
const docOptions = FUND_DOC_ORDER
const batchOptions = FUND_CATALOG

function nextAction(status: string): { action: string; target: string } | null {
  return nextFundAction(status)
}

function tagClass(status: string): string {
  return `tag-${status}`
}

function formatAmount(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function formatValue(label: string, value: number): string {
  return label.includes('金额') ? `${formatAmount(value)} 万元` : String(value)
}

function submit() {
  notices.value = []
  formMessage.value = ''
  const result = submitFund({ ...form.value })
  lastOk.value = result.ok
  notices.value = result.notices
  formMessage.value = result.message
  if (!result.ok) {
    return
  }
  form.value = { docNo: '', batch: '', amountInput: '', projectCode: '' }
  showForm.value = false
  reload()
}

function advance(row: EntryRow, action: string) {
  actionMessage.value = ''
  const result = advanceFund(Number(row.id), action)
  if (!result.ok) {
    actionMessage.value = result.message
    return
  }
  reload()
}

function exportRows() {
  const { filename, content } = exportFunds()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function resetLedger() {
  if (typeof window !== 'undefined' && !window.confirm('重置经费台账将只回到台账示例数据（不动其他模块），确认继续？')) {
    return
  }
  resetFunds()
  reload()
}

// 文号登记表速览见 datalist，文号在册与否由接收服务统一校验。

function reload() {
  columns.value = fundColumns()
  pendingRows.value = pendingFunds()
  stats.value = fundStats()
}

onMounted(reload)
</script>

<style scoped>
.board {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 12px;
  align-items: flex-start;
}
.board-col {
  flex: 0 0 270px;
  background: #eef2f7;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  min-height: 120px;
}
.pending-col {
  background: #fff4ec;
  border-color: #f2b083;
}
.col-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}
.col-head strong {
  font-size: 13px;
}
.col-title {
  font-size: 12px;
  color: var(--muted);
}
.col-sum {
  font-size: 12px;
  color: var(--brand);
}
.fund-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
.pending-card {
  border-color: #f2b083;
}
.card-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  gap: 8px;
}
.amount-line strong {
  color: #b45309;
}
.batch-name {
  font-weight: 600;
}
.sub-line {
  color: var(--muted);
  font-size: 12px;
}
.card-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: #b45309;
  background: #fffbeb;
  border-radius: 4px;
  padding: 4px 6px;
}
.card-actions {
  margin-top: 6px;
  text-align: right;
}
.status-tag {
  font-size: 12px;
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
}
.tag-收到下达 {
  background: #e0e7ff;
  color: #3730a3;
}
.tag-财务复核 {
  background: #fef3c7;
  color: #92400e;
}
.tag-拨付到位 {
  background: #dcfce7;
  color: #166534;
}
.progress-track {
  position: relative;
  height: 18px;
  background: #e5e7eb;
  border-radius: 999px;
  margin: 6px 0;
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: var(--brand);
  border-radius: 999px;
}
.progress-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #1f2937;
}
.col-empty {
  font-size: 12px;
  color: var(--muted);
  text-align: center;
  padding: 12px 0;
}
.fund-form {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.form-foot {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}
.filter-item em {
  color: #b42318;
  font-style: normal;
}
.form-notices {
  margin: 10px 0 0;
  padding-left: 18px;
  font-size: 12px;
  color: #b45309;
}
.form-message {
  margin: 0 0 10px;
  font-size: 13px;
}
.ok-text {
  color: #166534;
}
</style>
