<script setup lang="ts">
import PanelHeader from './PanelHeader.vue';
import ExpensePanel from './ExpensePanel.vue';
import Icon from './Icon.vue';
import { useTripTools } from '../composables/useTripTools';
const toolIcons: Record<string, string> = {
  checklist: 'check',
  expenses: 'wallet',
  share: 'user',
  chat: 'chat',
};
const props = defineProps<{
  tripId: string;
  isOwner: boolean;
  tripTitle?: string;
  budgetRevision?: string;
}>();
const {
  addTask,
  allMessages,
  busy,
  chatLog,
  checklist,
  copy,
  email,
  error,
  expenses,
  hasMore,
  invite,
  invites,
  inviteStatus,
  members,
  message,
  more,
  mutate,
  open,
  plannedTotal,
  progress,
  refresh,
  send,
  shareUrl,
  state,
  summaryReady,
  tab,
  task,
} = useTripTools(props);
</script>
<template>
  <section class="trip-tools" aria-label="여행 도구">
    <div class="tools-bar">
      <div class="tool-tabs">
        <button
          v-for="[key, name] in [
            ['checklist', '준비'],
            ['expenses', '지출'],
            ['share', '초대'],
            ['chat', '채팅'],
          ]"
          :key="key"
          :aria-label="name"
          :aria-expanded="tab === key"
          :class="{ active: tab === key }"
          @click="open(key!)"
        >
          <span class="tool-label">
            <Icon :name="toolIcons[key!]!" :size="21" />
            {{ name }}
            <Icon class="tool-chevron" :name="tab === key ? 'up' : 'down'" :size="16" />
          </span>
          <strong v-if="key === 'checklist'">
            {{ summaryReady ? `준비 ${progress} / ${checklist.length}` : '준비물 확인' }}
          </strong>
          <strong v-else-if="key === 'expenses'">
            {{ summaryReady ? `예상 ${plannedTotal.toLocaleString()}엔` : '예산 보기' }}
          </strong>
          <strong v-else-if="key === 'share'">
            {{ summaryReady ? members.length + '명' : '동행자' }}
          </strong>
          <strong v-else>대화</strong>
        </button>
      </div>
    </div>
    <div v-if="tab" class="tools-panel">
      <p v-if="error" role="alert" class="form-error">{{ error }}</p>
      <template v-if="tab === 'checklist'">
        <PanelHeader title="가볍게 떠날 준비" close-label="여행 도구 닫기" @close="tab = ''">
          <small class="preparation-count">{{ progress }} / {{ checklist.length }} 완료</small>
        </PanelHeader>
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
        <p v-if="!checklist.length" class="empty-copy">준비물 없음</p>
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
        <button class="text-button" @click="refresh">새로고침</button>
      </template>
      <ExpensePanel
        v-if="tab === 'expenses'"
        :trip-id="tripId"
        :title="tripTitle || '여행 정산'"
        :members="members"
        :revision="budgetRevision"
        @updated="expenses = $event"
        @close="tab = ''"
      />
      <template v-if="tab === 'share'">
        <PanelHeader
          title="이 여행을 함께 만들어요."
          close-label="여행 도구 닫기"
          @close="tab = ''"
        />
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
              placeholder="이메일"
            />
            <button class="button dark small" :disabled="busy">초대장 보내기</button>
          </form>
          <button class="button subtle small" :disabled="busy" @click="invite(true)">
            공유 초대 링크 만들기
          </button>
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
        <p v-else>소유자만 초대할 수 있어요.</p>
      </template>
      <template v-if="tab === 'chat'">
        <PanelHeader title="우리 여행 이야기" close-label="여행 도구 닫기" @close="tab = ''" />
        <button v-if="hasMore" class="text-button" :disabled="busy" @click="more">
          이전 대화 보기
        </button>
        <div ref="chatLog" class="chat-log" role="log" aria-label="여행 대화">
          <p v-if="!allMessages.length">대화 없음</p>
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
            placeholder="메시지"
          />
          <button class="button dark small" :disabled="busy">전송</button>
        </form>
      </template>
    </div>
  </section>
</template>
<style scoped>
.preparation-count {
  display: block;
  font-size: 15px;
  color: #8b7c99;
  margin-top: 7px;
}
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

/* Shared travel tools: readable labels, clear selected state, generous touch targets. */
.trip-tools {
  border-color: #e2deec;
  background: #fff;
  box-shadow: 0 3px 14px #48356404;
}
.tools-bar {
  display: block;
  padding: 12px;
  background: #f8f7fb;
}
.tool-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.tool-tabs button {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  min-width: 0;
  padding: 22px;
  border: 1px solid #e5e0ed;
  border-radius: 16px;
  background: white;
  text-align: left;
  color: #50495e;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.tool-tabs button:hover {
  background: #f4f1f9;
  border-color: #c4b7d5;
}
.tool-tabs button.active {
  background: #f0eaf8;
  border-color: #a993c2;
  color: #56406e;
  box-shadow: inset 0 -3px #a993c2;
}
.tool-label {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
}
.tool-label > svg {
  flex-shrink: 0;
  color: #8b76a4;
}
.tool-label .tool-chevron {
  margin-left: auto;
}
.tool-tabs button strong {
  display: block;
  font-size: 24px;
  line-height: 1.3;
  font-weight: 650;
  letter-spacing: -0.5px;
  color: #393346;
}
.tools-bar .tool-description {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  letter-spacing: 0;
  color: #8a8195;
}
.tools-panel {
  padding: 30px;
  border-top: 1px solid #e4dfec;
  background: linear-gradient(#fcfbfd, #fff 100px);
}
.tools-panel h2 {
  font-size: 25px;
  line-height: 1.45;
  margin-bottom: 12px;
}
.tools-panel h2 small {
  font-size: 16px;
  margin-left: 8px;
}
.tools-panel p {
  font-size: 16px;
  line-height: 1.75;
  color: #786e82;
}
.tools-panel input:not([type='checkbox']),
.tools-panel select {
  font-size: 16px;
  min-height: 48px;
  border-color: #dcd6e4;
}
.tools-panel .button,
.tools-panel .text-button {
  font-size: 15px;
  min-height: 44px;
}
.tools-panel .tools-close {
  width: 44px;
  height: 44px;
  font-size: 24px;
}
.tool-row {
  font-size: 16px;
  min-height: 60px;
  padding: 16px 0;
  border-color: #eeeaf3;
}
.tool-row label {
  cursor: pointer;
  flex: 1;
  min-height: 44px;
}
.tool-row input[type='checkbox'],
.expense-form input[type='checkbox'] {
  width: 21px;
  height: 21px;
  accent-color: #80649d;
  flex-shrink: 0;
}
.tool-row small {
  font-size: 14px;
  line-height: 1.6;
}
.expense-form label {
  font-size: 16px;
  gap: 9px;
}
.expense-form legend {
  font-size: 15px;
}
.expense-form {
  gap: 20px;
}
.expense-form fieldset {
  gap: 18px;
  border-color: #e0d9e8;
}
.member-chips span {
  font-size: 15px;
  background: #f0ebf7;
}
.transfer {
  background: #f1edf7;
}
.chat-log {
  padding: 20px;
  background: #f6f3f9;
  gap: 16px;
  min-height: 180px;
}
.chat-message {
  padding: 15px 18px;
}
.chat-message.mine {
  background: #eae1f3;
}
.chat-message small {
  font-size: 13px;
}
.empty-copy {
  padding: 22px;
  border-radius: 14px;
  background: #f7f4fa;
  text-align: center;
}
progress {
  height: 9px;
  accent-color: #9676b1;
}
@media (max-width: 1000px) {
  .tool-tabs button {
    padding: 18px 14px;
  }
  .tool-label {
    font-size: 16px;
    gap: 7px;
  }
  .tool-tabs button strong {
    font-size: 22px;
  }
  .tool-description {
    display: none;
  }
}
@media (max-width: 600px) {
  .tools-bar {
    padding: 10px;
  }
  .tool-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .tool-tabs button {
    padding: 16px 12px;
    gap: 14px;
    min-height: 112px;
  }
  .tool-label {
    font-size: 15px;
    gap: 6px;
  }
  .tool-label > svg {
    width: 18px;
  }
  .tool-label .tool-chevron {
    width: 14px;
  }
  .tool-tabs button strong {
    font-size: 20px;
  }
  .tools-panel {
    padding: 26px 18px;
  }
  .tools-panel h2 {
    font-size: 23px;
  }
  .tools-panel h2 small {
    display: block;
    margin: 7px 0 0;
  }
  .expense-total {
    font-size: 28px;
  }
  .inline-form {
    gap: 8px;
  }
  .inline-form input {
    flex-basis: 180px;
  }
  .tools-panel .tool-row {
    gap: 8px;
  }
  .chat-log {
    padding: 14px;
  }
  .chat-message {
    max-width: 95%;
  }
}

/* Travel tools use the app's existing navy, with lighter blue-grey layers. */
.trip-tools {
  border-color: #d7deea;
  box-shadow: 0 3px 14px #30375108;
}
.tools-bar {
  background: #f7f9fc;
}
.tool-tabs button {
  border-color: #d9e0eb;
  color: #3d475d;
}
.tool-tabs button:hover {
  background: #eef2f7;
  border-color: #afbdd1;
}
.tool-tabs button.active {
  background: #e8edf5;
  border-color: #7f90ab;
  color: #2e314e;
  box-shadow: inset 0 -3px #627697;
}
.tool-label > svg {
  color: #607294;
}
.tool-tabs button strong,
.tools-panel h2 {
  color: #2e314e;
}
.tools-bar .tool-description,
.tools-panel p,
.tool-row small,
.chat-message small {
  color: #748198;
}
.tools-panel {
  border-top-color: #dce3ed;
  background: linear-gradient(#fafbfe, #fff 100px);
}
.tools-panel input:not([type='checkbox']),
.tools-panel select {
  border-color: #d3dce8;
}
.tool-row {
  border-color: #e8edf3;
}
.tool-row input[type='checkbox'],
.expense-form input[type='checkbox'],
progress {
  accent-color: #526887;
}
.member-chips span,
.transfer {
  background: #edf1f6;
}
.chat-log {
  background: #f4f7fb;
}
.chat-message.mine {
  background: #e3eaf3;
}
.empty-copy {
  background: #f2f5f9;
}
</style>
