<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { api, json } from '../api';
import { state, notify } from '../store';
const props = defineProps<{ tripId: string; isOwner: boolean }>();
const tab = ref(''),
  busy = ref(false),
  error = ref('');
const members = ref<any[]>([]),
  checklist = ref<any[]>([]),
  messages = ref<any[]>([]),
  expenses = ref<any>({ data: [], transfers: [], total: 0 }),
  invites = ref<any[]>([]);
const task = ref(''),
  message = ref(''),
  email = ref(''),
  shareUrl = ref(''),
  expenseLabel = ref(''),
  amount = ref<number | null>(null),
  payer = ref(''),
  participants = ref<string[]>([]),
  older = ref<any[]>([]),
  hasMore = ref(false);
const base = computed(() => `/trips/${props.tripId}`);
const progress = computed(() => checklist.value.filter((i) => i.done).length);
const chatLog = ref<HTMLElement | null>(null);
const person = (id: string) => members.value.find((m) => m.id === id)?.name || '탈퇴한 동행자';
const inviteStatus = (i: any) =>
  i.status === 'PENDING' && new Date(i.expiresAt).getTime() < Date.now()
    ? '만료'
    : (
        { PENDING: '대기', ACCEPTED: '수락 완료', DECLINED: '거절', REVOKED: '취소' } as Record<
          string,
          string
        >
      )[i.status];
let timer: ReturnType<typeof setInterval>,
  loading = false,
  refreshAgain = false,
  alive = true;
async function refresh() {
  if (!alive || !tab.value || document.hidden) return;
  if (loading) {
    refreshAgain = true;
    return;
  }
  loading = true;
  try {
    const current = tab.value;
    const data = await api(
      base.value +
        { checklist: '/checklist', expenses: '/expenses', chat: '/messages', share: '/members' }[
          current
        ]!,
    );
    if (!alive || current !== tab.value) return;
    if (current === 'checklist') checklist.value = data.data;
    if (current === 'expenses') expenses.value = data;
    if (current === 'chat') {
      const el = chatLog.value;
      const follow =
        !messages.value.length || (!!el && el.scrollHeight - el.scrollTop - el.clientHeight < 80);
      messages.value = data.data;
      if (!older.value.length) hasMore.value = data.hasMore;
      if (follow) {
        await nextTick();
        if (chatLog.value) chatLog.value.scrollTop = chatLog.value.scrollHeight;
      }
    }
    if (current === 'share') {
      members.value = data.data;
      if (props.isOwner) invites.value = (await api(base.value + '/invitations')).data;
    }
  } catch (e: any) {
    if (alive) error.value = e.message;
  } finally {
    loading = false;
    if (refreshAgain) {
      refreshAgain = false;
      void refresh();
    }
  }
}
async function open(value: string) {
  tab.value = tab.value === value ? '' : value;
  error.value = '';
  if (!tab.value) return;
  try {
    members.value = (await api(base.value + '/members')).data;
    if (!payer.value) payer.value = state.user!.id;
    if (tab.value === 'expenses' && !participants.value.length)
      participants.value = members.value.map((m) => m.id);
    await refresh();
  } catch (e: any) {
    error.value = e.message;
  }
}
async function mutate(path: string, method: string, body?: any) {
  if (busy.value) return false;
  busy.value = true;
  error.value = '';
  try {
    await api(base.value + path, body === undefined ? { method } : json(method, body));
    await refresh();
    return true;
  } catch (e: any) {
    error.value = e.message;
    return false;
  } finally {
    busy.value = false;
  }
}
async function addTask() {
  if (await mutate('/checklist', 'POST', { label: task.value })) task.value = '';
}
async function send() {
  if (await mutate('/messages', 'POST', { body: message.value })) message.value = '';
}
async function addExpense() {
  if (
    await mutate('/expenses', 'POST', {
      label: expenseLabel.value,
      amount: amount.value,
      payerId: payer.value,
      participantIds: participants.value,
    })
  ) {
    expenseLabel.value = '';
    amount.value = null;
  }
}
async function invite(link = false) {
  busy.value = true;
  error.value = '';
  try {
    const result = await api(
      base.value + '/invitations',
      json('POST', link ? {} : { email: email.value.trim().toLowerCase() }),
    );
    shareUrl.value = location.origin + result.path;
    email.value = '';
    await refresh();
    notify(
      link
        ? '한 사람이 수락할 수 있는 초대 링크를 만들었어요.'
        : '해당 이메일 계정의 알림함에 초대장을 보냈어요.',
    );
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    notify('초대 링크를 복사했어요.');
  } catch {
    notify('아래 링크를 직접 선택해 복사해주세요.');
  }
}
async function more() {
  if (busy.value) return;
  busy.value = true;
  try {
    const first = older.value[0] || messages.value[0];
    const r = await api(base.value + '/messages?before=' + encodeURIComponent(first.id));
    older.value = [...r.data, ...older.value];
    hasMore.value = r.hasMore;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
const allMessages = computed(() => [
  ...new Map([...older.value, ...messages.value].map((m) => [m.id, m])).values(),
]);
onMounted(() => {
  timer = setInterval(() => {
    if (tab.value === 'chat' || tab.value === 'share') void refresh();
  }, 6000);
});
onBeforeUnmount(() => {
  alive = false;
  clearInterval(timer);
});
</script>
<template>
  <section class="trip-tools" aria-label="여행 도구">
    <div class="tools-bar">
      <div>
        <small>TOGETHER, BETTER</small>
        <strong>여행 준비부터, 마지막 정산까지.</strong>
      </div>
      <div class="tool-tabs">
        <button
          v-for="[key, name] in [
            ['checklist', '체크리스트'],
            ['expenses', '정산 계산기'],
            ['share', '동행자 · 초대'],
            ['chat', '여행 채팅'],
          ]"
          :key="key"
          :aria-expanded="tab === key"
          :class="{ active: tab === key }"
          @click="open(key!)"
        >
          {{ name }}
        </button>
      </div>
    </div>
    <div v-if="tab" class="tools-panel">
      <button class="icon-button tools-close" aria-label="여행 도구 닫기" @click="tab = ''">
        ×
      </button>
      <p v-if="error" role="alert" class="form-error">{{ error }}</p>
      <template v-if="tab === 'checklist'">
        <h2>
          가볍게 떠날 준비
          <small>{{ progress }} / {{ checklist.length }} 완료</small>
        </h2>
        <p>동행자와 함께 체크해요. 항목을 체크하거나 삭제하면 모두에게 반영됩니다.</p>
        <progress :value="progress" :max="checklist.length || 1" aria-label="준비 완료율" />
        <form class="inline-form" @submit.prevent="addTask">
          <input
            v-model="task"
            required
            maxlength="200"
            placeholder="여권, eSIM, 렌터카 예약 확인…"
            aria-label="새 체크리스트 항목"
          />
          <button class="button dark small" :disabled="busy">추가</button>
        </form>
        <p v-if="!checklist.length" class="empty-copy">준비할 것을 하나씩 적어보세요.</p>
        <div v-for="item in checklist" :key="item.id" class="tool-row">
          <label>
            <input
              type="checkbox"
              :checked="item.done"
              :disabled="busy"
              @change="
                mutate('/checklist/' + item.id, 'PATCH', {
                  done: ($event.target as HTMLInputElement).checked,
                })
              "
            />
            <span :class="{ checked: item.done }">{{ item.label }}</span>
          </label>
          <button
            class="text-button"
            :disabled="busy"
            :aria-label="item.label + ' 삭제'"
            @click="mutate('/checklist/' + item.id, 'DELETE')"
          >
            삭제
          </button>
        </div>
        <button class="text-button" @click="refresh">동행자 변경 새로고침</button>
      </template>
      <template v-if="tab === 'expenses'">
        <h2>같이 쓴 만큼, 깔끔하게.</h2>
        <p>
          실제 지출을 엔화로 기록하세요. 선택한 분담자끼리 균등 분할하며, 나머지 1엔도 빠짐없이
          배분해요. 송금은 직접 진행해주세요.
        </p>
        <div class="expense-layout">
          <form class="expense-form" @submit.prevent="addExpense">
            <label>
              지출 내용
              <input
                v-model="expenseLabel"
                required
                maxlength="200"
                placeholder="저녁 식사, 렌터카…"
              />
            </label>
            <label>
              금액 (JPY · 엔)
              <input
                v-model.number="amount"
                type="number"
                min="1"
                max="100000000"
                step="1"
                required
              />
            </label>
            <label>
              결제한 사람
              <select v-model="payer">
                <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option>
              </select>
            </label>
            <fieldset>
              <legend>함께 나눌 사람</legend>
              <label v-for="m in members" :key="m.id">
                <input type="checkbox" v-model="participants" :value="m.id" />
                {{ m.name }}
              </label>
            </fieldset>
            <button class="button dark" :disabled="busy || !participants.length">지출 기록</button>
          </form>
          <div>
            <strong class="expense-total">총 {{ expenses.total.toLocaleString() }}엔</strong>
            <div v-for="e in expenses.data" :key="e.id" class="tool-row">
              <div>
                <strong>{{ e.label }}</strong>
                <small>
                  {{ person(e.payerId) }} 결제 · {{ e.amount.toLocaleString() }}엔 ·
                  {{ e.shares.length }}명 분담
                </small>
              </div>
              <button
                class="text-button"
                :disabled="busy"
                @click="mutate('/expenses/' + e.id, 'DELETE')"
              >
                삭제
              </button>
            </div>
            <h3>정산 안내</h3>
            <p v-if="!expenses.transfers.length">주고받을 금액이 없어요.</p>
            <p v-for="(t, i) in expenses.transfers" :key="i" class="transfer">
              {{ person(t.from) }} → {{ person(t.to) }}
              <strong>{{ t.amount.toLocaleString() }}엔</strong>
            </p>
            <button class="text-button" @click="refresh">최신 정산 불러오기</button>
          </div>
        </div>
      </template>
      <template v-if="tab === 'share'">
        <h2>이 여행을 함께 만들어요.</h2>
        <p>초대를 수락한 동행자는 장소·순서·메모·예산을 함께 수정하고 채팅에 참여할 수 있어요.</p>
        <div class="member-chips">
          <span v-for="m in members" :key="m.id">
            {{ m.name }} · {{ m.isOwner ? '소유자' : '동행자' }}
          </span>
        </div>
        <template v-if="isOwner">
          <form class="inline-form" @submit.prevent="invite()">
            <input
              v-model="email"
              type="email"
              required
              aria-label="초대할 이메일"
              placeholder="동행자의 가입 이메일"
            />
            <button class="button dark small" :disabled="busy">초대장 보내기</button>
          </form>
          <button class="button subtle small" :disabled="busy" @click="invite(true)">
            공유 초대 링크 만들기
          </button>
          <p>
            이메일 초대는 서비스 알림함으로 전달됩니다. 링크는 7일 동안 유효하며 1명만 수락할 수
            있어요.
          </p>
          <div v-if="shareUrl" class="inline-form">
            <input
              :value="shareUrl"
              readonly
              aria-label="공유 초대 링크"
              @focus="($event.target as HTMLInputElement).select()"
            />
            <button class="button subtle small" @click="copy">복사</button>
          </div>
          <div v-for="i in invites" :key="i.id" class="tool-row">
            <span>
              {{ i.email || '링크 초대' }} · {{ inviteStatus(i) }} ·
              {{ new Date(i.expiresAt).toLocaleDateString() }} 만료
            </span>
            <button
              v-if="i.status === 'PENDING'"
              class="text-button"
              :disabled="busy"
              @click="mutate('/invitations/' + i.id, 'DELETE')"
            >
              초대 취소
            </button>
          </div>
        </template>
        <p v-else>새로운 동행자 초대는 여행 소유자가 할 수 있어요.</p>
      </template>
      <template v-if="tab === 'chat'">
        <h2>우리 여행 이야기</h2>
        <p>이 여행의 동행자만 볼 수 있어요. 대화는 약 6초마다 갱신됩니다.</p>
        <button v-if="hasMore" class="text-button" :disabled="busy" @click="more">
          이전 대화 보기
        </button>
        <div ref="chatLog" class="chat-log" role="log" aria-label="여행 대화">
          <p v-if="!allMessages.length">첫 이야기를 남겨보세요. “첫날 저녁은 어디로 갈까요?”</p>
          <article
            v-for="m in allMessages"
            :key="m.id"
            :class="['chat-message', { mine: m.userId === state.user?.id }]"
          >
            <small>
              {{ m.name }} ·
              {{
                new Date(m.createdAt).toLocaleString('ko-KR', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              }}
            </small>
            <p>{{ m.body }}</p>
          </article>
        </div>
        <form class="inline-form" @submit.prevent="send">
          <input
            v-model="message"
            required
            maxlength="2000"
            aria-label="채팅 메시지"
            placeholder="동행자에게 이야기 남기기"
          />
          <button class="button dark small" :disabled="busy">전송</button>
        </form>
      </template>
    </div>
  </section>
</template>
<style scoped>
.trip-tools {
  margin: 22px 0;
  border: 1px solid #dfe5e0;
  border-radius: 22px;
  background: #fff;
  overflow: hidden;
}
.tools-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 22px;
  background: #f4f7f4;
}
.tools-bar small {
  display: block;
  font-size: 10px;
  letter-spacing: 2px;
  color: #6a7f70;
  margin-bottom: 7px;
}
.tools-bar strong {
  font-size: 16px;
}
.tool-tabs {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
.tool-tabs button {
  padding: 10px 14px;
  border: 1px solid #d9e2da;
  border-radius: 30px;
  background: white;
  font-size: 13px;
}
.tool-tabs button.active {
  background: #344e43;
  color: white;
}
.tools-panel {
  position: relative;
  padding: 28px;
}
.tools-close {
  position: absolute;
  right: 12px;
  top: 10px;
}
.tools-panel h2 {
  font-size: 24px;
  margin: 0 30px 10px 0;
}
.tools-panel h2 small {
  font-size: 14px;
  color: #748177;
}
.tools-panel p {
  font-size: 14px;
  line-height: 1.6;
  color: #66756b;
}
.tools-panel input:not([type='checkbox']),
.tools-panel select {
  padding: 12px;
  border: 1px solid #d5ded6;
  border-radius: 12px;
  min-width: 0;
  width: 100%;
  background: white;
}
.inline-form {
  display: flex;
  gap: 10px;
  margin: 18px 0;
}
.inline-form input {
  flex: 1;
}
.tool-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 0;
  border-bottom: 1px solid #edf0ed;
  font-size: 14px;
}
.tool-row label {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tool-row small {
  display: block;
  color: #748177;
  margin-top: 7px;
}
.checked {
  text-decoration: line-through;
  color: #89988d;
}
progress {
  width: 100%;
  height: 7px;
  accent-color: #547760;
}
.expense-layout {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 1.5fr;
  gap: 35px;
}
.expense-form {
  display: grid;
  gap: 14px;
}
.expense-form label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.expense-form fieldset {
  border: 1px solid #dce4dd;
  border-radius: 12px;
  padding: 14px;
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.expense-form fieldset label {
  display: flex;
  align-items: center;
}
.expense-total {
  font-size: 30px;
}
.transfer {
  padding: 14px;
  background: #eef4ef;
  border-radius: 12px;
}
.transfer strong {
  float: right;
}
.member-chips {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin: 20px 0;
}
.member-chips span {
  padding: 10px 16px;
  background: #edf2ee;
  border-radius: 20px;
  font-size: 13px;
}
.chat-log {
  max-height: 350px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 15px;
  background: #f5f7f5;
  border-radius: 18px;
}
.chat-message {
  max-width: 85%;
  align-self: flex-start;
  padding: 12px 16px;
  border-radius: 15px;
  background: white;
  overflow-wrap: anywhere;
}
.chat-message.mine {
  align-self: flex-end;
  background: #e2ece4;
}
.chat-message small {
  font-size: 11px;
  color: #6a796e;
}
.chat-message p {
  white-space: pre-wrap;
  margin: 7px 0 0;
  color: #283f31;
}
@media (max-width: 760px) {
  .tools-bar {
    align-items: flex-start;
    flex-direction: column;
  }
  .tools-panel {
    padding: 22px 16px;
  }
  .expense-layout {
    grid-template-columns: 1fr;
  }
  .inline-form {
    flex-wrap: wrap;
  }
  .tool-tabs button {
    font-size: 12px;
    padding: 9px 11px;
  }
}
</style>
