<script setup lang="ts">
import PanelHeader from './PanelHeader.vue';
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { api, json } from '../api';
import { state, notify } from '../store';
import { expenseSheets, type ExportScope } from '../../../shared/expense-export';
const props = defineProps<{ tripId: string; title: string; members: any[]; revision?: string }>();
const emit = defineEmits<{ updated: [report: any]; close: [] }>();
const report = ref<any>({
  data: [],
  budgets: [],
  total: 0,
  personalTotal: 0,
  mySharedTotal: 0,
  transfers: [],
});
const scope = ref<'SHARED' | 'PERSONAL'>('SHARED'),
  exportScope = ref<ExportScope>('SHARED');
const busy = ref(false),
  loading = ref(true),
  exporting = ref(false),
  error = ref('');
const label = ref(''),
  amount = ref<number | null>(null),
  payer = ref(state.user?.id || ''),
  participants = ref<string[]>([]);
const selectedBudget = ref(''),
  editingId = ref(''),
  legacyLink = ref<any>(null),
  amountInput = ref<HTMLInputElement>();
const base = computed(() => `/trips/${props.tripId}/expenses`);
const key = (b: any) => `${b.visitDate}|${b.placeId}`;
const budget = computed(() =>
  report.value.budgets.find((b: any) => key(b) === selectedBudget.value),
);
const entries = computed(() =>
  report.value.data.filter((e: any) => (e.scope || 'SHARED') === scope.value),
);
const plannedTotal = computed(() =>
  report.value.budgets.reduce((sum: number, b: any) => sum + b.estimatedCost, 0),
);
const person = (id: string) => props.members.find((m) => m.id === id)?.name || '탈퇴한 동행자';
const yen = (n: number) => Number(n || 0).toLocaleString() + '엔';
let generation = 0,
  alive = true;
async function refresh() {
  const token = ++generation;
  try {
    const result = await api(base.value);
    if (!alive || token !== generation) return;
    report.value = { budgets: [], personalTotal: 0, mySharedTotal: 0, ...result };
    emit('updated', report.value);
  } catch (e: any) {
    if (alive && token === generation) error.value = e.message;
  } finally {
    if (token === generation) loading.value = false;
  }
}
function reset() {
  label.value = '';
  amount.value = null;
  selectedBudget.value = '';
  editingId.value = '';
  legacyLink.value = null;
}
function changeScope(value: 'SHARED' | 'PERSONAL') {
  if (busy.value) return;
  scope.value = value;
  exportScope.value = value;
  reset();
  error.value = '';
}
async function useBudget(value: string) {
  selectedBudget.value = value;
  legacyLink.value = null;
  if (budget.value) label.value = budget.value.name;
  amount.value = null;
  await nextTick();
  amountInput.value?.focus();
}
async function edit(e: any) {
  editingId.value = e.id;
  label.value = e.label;
  amount.value = e.amount;
  payer.value = e.payerId;
  participants.value = e.shares.map((s: any) => s.id);
  selectedBudget.value = e.placeId ? key(e) : '';
  legacyLink.value = e.placeId ? e : null;
  await nextTick();
  amountInput.value?.focus();
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const link = budget.value || legacyLink.value;
    await api(
      base.value + (editingId.value ? '/' + editingId.value : ''),
      json(editingId.value ? 'PATCH' : 'POST', {
        label: label.value,
        amount: amount.value,
        scope: scope.value,
        ...(scope.value === 'SHARED'
          ? { payerId: payer.value, participantIds: participants.value }
          : {}),
        placeId: link?.placeId || null,
        visitDate: link?.visitDate || null,
      }),
    );
    reset();
    await refresh();
    notify('실제 지출을 저장했어요.');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function remove(e: any) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api(base.value + '/' + e.id, { method: 'DELETE' });
    if (editingId.value === e.id) reset();
    await refresh();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
let printFrame: HTMLIFrameElement | undefined;
async function download(format: 'xlsx' | 'pdf') {
  if (exporting.value) return;
  exporting.value = true;
  error.value = '';
  try {
    if (format === 'xlsx') {
      const response = await fetch(
        '/api' + base.value + '/export.xlsx?scope=' + exportScope.value,
        { credentials: 'same-origin' },
      );
      if (!response.ok) throw new Error((await response.json()).error || '다운로드하지 못했어요.');
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `여행정산-${exportScope.value}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      const latest = await api(base.value);
      report.value = { budgets: [], personalTotal: 0, ...latest };
      emit('updated', report.value);
      const sheets = expenseSheets(report.value, props.title, props.members, exportScope.value);
      printFrame?.remove();
      const frame = document.createElement('iframe');
      printFrame = frame;
      frame.title = '정산 PDF 인쇄';
      frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;border:0';
      frame.srcdoc = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>여행 정산</title><style>@page{size:A4 landscape;margin:14mm}body{font-family:Arial,"Apple SD Gothic Neo",sans-serif;color:#302c40;font-size:10pt}section{break-before:page}section:first-child{break-before:auto}h1{font-size:20pt}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #d8d2e1;padding:9px;text-align:left;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#eee8f6}tr{break-inside:avoid}thead{display:table-header-group}.summary{margin:8px 0;color:#6d6477}</style></head><body>${sheets
        .map((s) => {
          const header = s.headers.at(-1)!;
          return `<section><h1>${escapeHtml(s.name)}</h1>${s.rows
            .slice(0, header)
            .map((row) => `<p class="summary">${row.map(escapeHtml).join(' · ')}</p>`)
            .join(
              '',
            )}<table><thead><tr>${s.rows[header]!.map((v) => `<th>${escapeHtml(v)}</th>`).join('')}</tr></thead><tbody>${s.rows
            .slice(header + 1)
            .map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table></section>`;
        })
        .join('')}</body></html>`;
      await new Promise<void>((resolve, reject) => {
        frame.onload = () => resolve();
        frame.onerror = () => reject(new Error('인쇄 화면을 열지 못했어요.'));
        document.body.append(frame);
      });
      await frame.contentDocument?.fonts.ready;
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }
  } catch (e: any) {
    error.value = e.message;
  } finally {
    exporting.value = false;
  }
}
watch(
  () => props.revision,
  () => {
    void refresh();
  },
);
let participantsInitialized = false;
watch(
  () => props.members,
  (members) => {
    if (!participantsInitialized && members.length) {
      participants.value = members.map((m) => m.id);
      participantsInitialized = true;
    }
  },
  { immediate: true },
);
onMounted(() => {
  void refresh();
});
onBeforeUnmount(() => {
  alive = false;
  generation++;
  printFrame?.remove();
});
</script>
<template>
  <section class="expense-panel" aria-label="여행 지출 관리">
    <PanelHeader title="지출" close-label="여행 도구 닫기" @close="emit('close')" />
    <div class="spending-tabs" aria-label="지출 구분">
      <button :aria-pressed="scope === 'SHARED'" :disabled="busy" @click="changeScope('SHARED')">
        함께
      </button>
      <button
        :aria-pressed="scope === 'PERSONAL'"
        :disabled="busy"
        @click="changeScope('PERSONAL')"
      >
        내 지출
      </button>
    </div>
    <p v-if="error" class="form-error" role="alert">
      {{ error }}
      <button
        @click="
          error = '';
          refresh();
        "
      >
        다시 불러오기
      </button>
    </p>
    <p v-if="loading" role="status">지출 기록을 불러오고 있어요…</p>
    <template v-else>
      <div class="spending-summary" v-if="scope === 'SHARED'">
        <div>
          <small>예상</small>
          <strong>{{ yen(plannedTotal) }}</strong>
        </div>
        <div>
          <small>함께 쓴 돈</small>
          <strong>{{ yen(report.total) }}</strong>
        </div>
        <div>
          <small>내 몫</small>
          <strong>{{ yen(report.mySharedTotal) }}</strong>
        </div>
      </div>
      <div class="personal-summary" v-else>
        <strong>내 개인 지출 {{ yen(report.personalTotal) }}</strong>
      </div>
      <div v-if="report.budgets.length" class="budget-bridge">
        <div class="bridge-heading">
          <h3>일정 예상 비용</h3>
        </div>
        <div class="budget-list">
          <button
            v-for="b in report.budgets"
            :key="key(b)"
            :disabled="busy || !!editingId"
            @click="useBudget(key(b))"
            :class="{ selected: selectedBudget === key(b) }"
          >
            <div>
              <small>{{ b.visitDate }}</small>
              <strong>{{ b.name }}</strong>
            </div>
            <div class="budget-values">
              <span>예상 {{ yen(b.estimatedCost) }}</span>
              <small>
                {{
                  (scope === 'SHARED' ? b.sharedCount : b.personalCount)
                    ? '실제 ' + yen(scope === 'SHARED' ? b.sharedActual : b.personalActual)
                    : '지출 없음'
                }}
              </small>
            </div>
            <b>지출 더하기</b>
          </button>
        </div>
      </div>
      <div v-else class="budget-empty">예상 비용 없음</div>
      <div class="spending-layout">
        <form class="spending-form" @submit.prevent="save">
          <h3>
            {{ editingId ? '지출 수정' : '지출 더하기' }}
          </h3>
          <label>
            일정
            <select
              :value="selectedBudget"
              :disabled="busy"
              @change="useBudget(($event.target as HTMLSelectElement).value)"
            >
              <option value="">직접 입력</option>
              <option v-for="b in report.budgets" :key="key(b)" :value="key(b)">
                {{ b.visitDate }} · {{ b.name }} · 예상 {{ yen(b.estimatedCost) }}
              </option>
              <option v-if="legacyLink && !budget" :value="key(legacyLink)">
                {{ legacyLink.placeName }} · 기존 연결
              </option>
            </select>
          </label>
          <p v-if="budget" class="linked-budget">
            {{ budget.name }} · 예상 {{ yen(budget.estimatedCost) }}
          </p>
          <label>
            이름
            <input
              v-model="label"
              :disabled="busy"
              required
              maxlength="200"
              placeholder="식사, 기념품"
            />
          </label>
          <label>
            금액 (엔)
            <input
              ref="amountInput"
              v-model.number="amount"
              :disabled="busy"
              required
              type="number"
              min="1"
              max="100000000"
              step="1"
              placeholder="금액"
            />
          </label>
          <template v-if="scope === 'SHARED'">
            <label>
              결제
              <select v-model="payer" :disabled="busy">
                <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option>
              </select>
            </label>
            <fieldset :disabled="busy">
              <legend>나눌 사람</legend>
              <label v-for="m in members" :key="m.id">
                <input type="checkbox" v-model="participants" :value="m.id" />
                {{ m.name }}
              </label>
            </fieldset>
          </template>
          <button
            class="button dark"
            :disabled="busy || (scope === 'SHARED' && !participants.length)"
          >
            {{ busy ? '저장 중…' : editingId ? '저장' : '지출 더하기' }}
          </button>
          <button
            v-if="editingId || selectedBudget"
            type="button"
            class="text-button"
            :disabled="busy"
            @click="reset"
          >
            취소
          </button>
        </form>
        <div class="spending-history">
          <h3>
            지출 내역
            <small>{{ entries.length }}건</small>
          </h3>
          <p v-if="!entries.length" class="history-empty">지출 없음</p>
          <article v-for="e in entries" :key="e.id" class="expense-entry">
            <div class="entry-heading">
              <strong>{{ e.label }}</strong>
              <b>{{ yen(e.amount) }}</b>
            </div>
            <small v-if="e.placeName">{{ e.visitDate }} · {{ e.placeName }}</small>
            <small>
              {{ person(e.payerId) }} 결제 ·
              {{ scope === 'SHARED' ? e.shares.length + '명 분담' : '개인 지출' }}
            </small>
            <div class="entry-actions">
              <button :disabled="busy" :aria-label="e.label + ' 지출 수정'" @click="edit(e)">
                수정
              </button>
              <button :disabled="busy" :aria-label="e.label + ' 지출 삭제'" @click="remove(e)">
                삭제
              </button>
            </div>
          </article>
          <section v-if="scope === 'SHARED'" class="settlement-box">
            <h3>정산</h3>
            <p v-if="!report.transfers.length">보낼 돈 없음</p>
            <p v-for="(t, i) in report.transfers" :key="i" class="transfer">
              {{ person(t.from) }} → {{ person(t.to) }}
              <strong>{{ yen(t.amount) }}</strong>
            </p>
          </section>
          <button class="text-button" :disabled="busy" @click="refresh">최신 정산 불러오기</button>
        </div>
      </div>
      <div class="expense-download">
        <div>
          <h3>내보내기</h3>
        </div>
        <label>
          범위
          <select v-model="exportScope" :disabled="exporting">
            <option value="SHARED">공동 지출만</option>
            <option value="PERSONAL">내 개인 지출만</option>
            <option value="ALL">공동 + 내 개인 지출</option>
          </select>
        </label>
        <div class="download-buttons">
          <button class="button subtle" :disabled="exporting" @click="download('xlsx')">
            엑셀 다운로드
          </button>
          <button class="button subtle" :disabled="exporting" @click="download('pdf')">
            PDF 저장
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
<style scoped>
.expense-panel {
  min-width: 0;
  color: #393346;
}
.expense-panel h2 {
  font-size: 25px;
  margin: 0 35px 12px 0;
}
.expense-panel h3 {
  font-size: 18px;
  margin: 0;
  line-height: 1.5;
}
.expense-panel p {
  line-height: 1.7;
  font-size: 15px;
  color: #7b7087;
}
.intro {
  margin-bottom: 22px;
}
.spending-tabs {
  display: flex;
  gap: 8px;
  padding: 6px;
  background: #f2eef6;
  border-radius: 14px;
  margin: 20px 0;
}
.spending-tabs button {
  flex: 1;
  min-height: 58px;
  border-radius: 10px;
  padding: 12px;
  font-size: 17px;
  font-weight: 600;
}
.spending-tabs small {
  font-size: 12px;
  margin-left: 8px;
  font-weight: 400;
}
.spending-tabs button[aria-pressed='true'] {
  background: #fff;
  color: #71528f;
  box-shadow: 0 2px 8px #54426412;
}
.spending-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 24px 0;
}
.spending-summary > div,
.personal-summary {
  padding: 20px;
  background: #faf8fc;
  border: 1px solid #eee9f4;
  border-radius: 14px;
}
.spending-summary small {
  display: block;
  color: #8b7e96;
  font-size: 13px;
}
.spending-summary strong {
  font-size: 24px;
  display: block;
  margin-top: 10px;
}
.personal-summary strong {
  font-size: 24px;
}
.personal-summary p {
  margin-top: 10px;
}
.budget-bridge {
  margin: 24px 0;
}
.bridge-heading {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.bridge-heading span {
  color: #94889f;
  font-size: 13px;
}
.bridge-note {
  font-size: 13px !important;
  margin: 8px 0 14px;
}
.budget-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  max-height: 320px;
  overflow: auto;
  padding: 3px;
}
.budget-list button {
  border: 1px solid #e2d9eb;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  gap: 16px;
  align-items: center;
  text-align: left;
  min-width: 0;
}
.budget-list button:hover,
.budget-list button.selected {
  background: #f5effa;
  border-color: #ab91c5;
}
.budget-list strong {
  display: block;
  font-size: 16px;
  overflow-wrap: anywhere;
  margin-top: 5px;
}
.budget-list small {
  display: block;
  color: #93829f;
  font-size: 12px;
}
.budget-values {
  margin-left: auto;
  flex-shrink: 0;
}
.budget-values span {
  display: block;
  font-size: 14px;
  margin-bottom: 6px;
}
.budget-list b {
  font-size: 12px;
  white-space: nowrap;
  color: #85689d;
}
.budget-empty {
  padding: 20px;
  background: #f8f6fb;
  border-radius: 14px;
  color: #8b7d97;
  font-size: 14px;
  margin: 20px 0;
}
.spending-layout {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(0, 1.3fr);
  gap: 28px;
  margin-top: 28px;
}
.spending-form {
  display: grid;
  gap: 17px;
  align-content: start;
  padding: 22px;
  border: 1px solid #e6dfed;
  border-radius: 16px;
  background: #fcfbfd;
}
.spending-form label,
.expense-download label {
  display: grid;
  gap: 8px;
  font-size: 15px;
}
.expense-panel input:not([type='checkbox']),
.expense-panel select {
  width: 100%;
  min-width: 0;
  min-height: 46px;
  border: 1px solid #dcd4e4;
  border-radius: 10px;
  padding: 10px 12px;
  font: inherit;
  font-size: 16px;
  background: white;
}
.expense-panel fieldset {
  border: 1px solid #e2dbe8;
  border-radius: 12px;
  padding: 14px;
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.expense-panel legend {
  font-size: 14px;
}
.expense-panel fieldset label {
  display: flex;
  align-items: center;
  min-height: 32px;
}
.expense-panel input[type='checkbox'] {
  width: 20px;
  height: 20px;
  accent-color: #8866a4;
}
.split-note {
  font-size: 13px;
  color: #8c7e99;
}
.linked-budget {
  padding: 12px;
  border-radius: 10px;
  background: #eee7f5;
  color: #74538f !important;
}
.linked-budget small {
  font-size: 12px;
}
.spending-history {
  min-width: 0;
}
.spending-history h3 small {
  font-size: 13px;
  color: #a197a9;
  margin-left: 6px;
}
.expense-entry {
  padding: 18px 0;
  border-bottom: 1px solid #e9e3ee;
}
.entry-heading {
  display: flex;
  gap: 14px;
  justify-content: space-between;
  align-items: baseline;
  font-size: 16px;
}
.entry-heading strong {
  overflow-wrap: anywhere;
}
.entry-heading b {
  white-space: nowrap;
}
.expense-entry > small {
  display: block;
  margin-top: 8px;
  line-height: 1.5;
  color: #8d8098;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.entry-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.entry-actions button {
  min-height: 44px;
  padding: 8px;
  font-size: 14px;
  color: #8a789a;
}
.history-empty {
  padding: 32px 20px;
  border: 1px dashed #e2d9eb;
  border-radius: 14px;
  margin: 18px 0;
}
.settlement-box {
  padding: 20px;
  background: #f8f5fb;
  border-radius: 14px;
  margin: 24px 0 12px;
}
.settlement-box p {
  margin: 12px 0;
}
.settlement-box small {
  color: #95899f;
}
.transfer {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
}
.expense-download {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  align-items: center;
  padding: 24px;
  margin-top: 28px;
  background: #f7f4fa;
  border: 1px solid #e7dfef;
  border-radius: 16px;
}
.expense-download > div:first-child {
  flex: 1;
  min-width: 220px;
}
.expense-download p {
  font-size: 13px;
  margin-top: 6px;
}
.expense-download > small {
  width: 100%;
  font-size: 12px;
  line-height: 1.7;
  color: #95899e;
}
.download-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.expense-panel .button {
  font-size: 15px;
  min-height: 46px;
}
.expense-panel .text-button {
  min-height: 44px;
}
.form-error {
  padding: 14px;
  background: #fff0ef;
  border-radius: 10px;
}
@media (max-width: 1100px) {
  .budget-list {
    grid-template-columns: 1fr;
  }
  .spending-summary strong {
    font-size: 21px;
  }
}
@media (max-width: 760px) {
  .spending-layout {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .spending-summary {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .spending-summary > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
  }
  .spending-summary strong {
    margin: 0;
    font-size: 21px;
  }
  .spending-form {
    padding: 18px;
  }
  .spending-tabs small {
    display: block;
    margin: 5px 0 0;
  }
  .budget-list button {
    flex-wrap: wrap;
    gap: 10px;
    padding: 14px;
  }
  .budget-list b {
    width: 100%;
    text-align: right;
  }
  .expense-download {
    padding: 18px;
  }
  .expense-download label,
  .download-buttons {
    width: 100%;
  }
  .download-buttons button {
    flex: 1;
  }
  .expense-panel h2 {
    font-size: 23px;
  }
  .entry-heading {
    flex-wrap: wrap;
  }
}

/* Navy tone-on-tone expense UI. */
.expense-panel {
  color: #2e314e;
}
.expense-panel p,
.split-note {
  color: #748198;
}
.spending-tabs {
  background: #e9eef5;
}
.spending-tabs button[aria-pressed='true'] {
  color: #2e314e;
  box-shadow: 0 2px 8px #30375112;
}
.spending-summary > div,
.personal-summary {
  background: #f7f9fc;
  border-color: #e0e6ef;
}
.spending-summary small,
.bridge-heading span,
.budget-list small,
.expense-entry > small,
.settlement-box small {
  color: #78859a;
}
.budget-list button {
  border-color: #d5deea;
}
.budget-list button:hover,
.budget-list button.selected {
  background: #edf2f7;
  border-color: #9faec3;
}
.budget-list b {
  color: #526887;
}
.budget-empty,
.settlement-box,
.expense-download {
  background: #f4f7fb;
  border-color: #dfe6ef;
  color: #68758b;
}
.spending-form {
  border-color: #dce4ee;
  background: #fbfcfe;
}
.expense-panel input:not([type='checkbox']),
.expense-panel select,
.expense-panel fieldset {
  border-color: #d4dde9;
}
.expense-panel input[type='checkbox'] {
  accent-color: #526887;
}
.linked-budget {
  background: #e9eef6;
  color: #405675 !important;
}
.expense-entry {
  border-color: #e4eaf1;
}
.entry-actions button {
  color: #526887;
}
</style>
