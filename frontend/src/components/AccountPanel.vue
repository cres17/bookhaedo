<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { api, json } from '../api';
import { state, selectTrip, notify } from '../store';
const router = useRouter(),
  opened = ref(false),
  withdraw = ref(false),
  password = ref(''),
  confirmed = ref(false),
  busy = ref(false),
  error = ref(''),
  data = ref<any>({ invitations: [], notifications: [] });
let timer: ReturnType<typeof setInterval>,
  loading = false;
async function load() {
  if (loading || document.hidden) return;
  loading = true;
  try {
    data.value = await api('/notifications');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading = false;
  }
}
async function respond(id: string, accept: boolean) {
  busy.value = true;
  try {
    const r = await api('/invitations/respond', json('POST', { id, accept }));
    await load();
    if (accept) {
      opened.value = false;
      await router.push('/trips/' + r.tripId);
      notify('초대를 수락했어요. 함께 일정을 만들 수 있어요.');
    }
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function read() {
  try {
    await api('/notifications/read', json('PATCH', {}));
    await load();
  } catch (e: any) {
    error.value = e.message;
  }
}
async function remove() {
  if (!confirmed.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api('/auth/me', json('DELETE', { password: password.value }));
    state.user = null;
    selectTrip('', '');
    await router.push('/');
    notify('회원 탈퇴가 완료됐어요.');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  void load();
  timer = setInterval(load, 15000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>
<template>
  <div class="account-panel">
    <button
      class="text-button notification-toggle"
      :aria-expanded="opened"
      @click="
        opened = !opened;
        withdraw = false;
        load();
      "
    >
      알림
      <span
        v-if="data.invitations.length + data.notifications.filter((n: any) => !n.readAt).length"
      >
        {{ data.invitations.length + data.notifications.filter((n: any) => !n.readAt).length }}
      </span>
    </button>
    <section
      v-if="opened"
      class="notification-popover"
      aria-label="초대 및 계정 알림"
      @keydown.esc="opened = false"
    >
      <header>
        <h2>여행 알림</h2>
        <button class="icon-button" aria-label="알림 닫기" @click="opened = false">×</button>
      </header>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="!data.invitations.length && !data.notifications.length">
        아직 도착한 알림이 없어요.
      </p>
      <article v-for="i in data.invitations" :key="i.id">
        <strong>{{ i.title }}</strong>
        <p>{{ i.senderName }} 님이 함께 여행을 만들자고 초대했어요.</p>
        <button class="button dark small" :disabled="busy" @click="respond(i.id, true)">
          수락
        </button>
        <button class="button subtle small" :disabled="busy" @click="respond(i.id, false)">
          거절
        </button>
      </article>
      <article v-for="n in data.notifications" :key="n.id">
        <p>{{ n.readAt ? '' : '● ' }}{{ n.message }}</p>
        <RouterLink v-if="n.tripId" :to="'/trips/' + n.tripId" @click="opened = false">
          여행 보기
        </RouterLink>
      </article>
      <button class="text-button" @click="read">모두 읽음</button>
      <hr />
      <button
        class="text-button"
        @click="
          withdraw = !withdraw;
          error = '';
        "
      >
        계정 관리 · 회원 탈퇴
      </button>
      <form v-if="withdraw" @submit.prevent="remove">
        <h3>회원 탈퇴</h3>
        <p>
          내가 만든 여행과 그 여행의 일정·메모·초대·채팅·정산은 함께 삭제됩니다. 다른 사람의 여행에
          남긴 대화·지출 기록은 탈퇴한 동행자로 남습니다. 복구할 수 없습니다.
        </p>
        <label>
          현재 비밀번호
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            maxlength="128"
          />
        </label>
        <label class="confirm">
          <input v-model="confirmed" type="checkbox" required />
          삭제 범위를 확인했으며 탈퇴에 동의합니다.
        </label>
        <button class="button dark small" :disabled="busy || !confirmed">
          {{ busy ? '처리 중…' : '탈퇴 확정' }}
        </button>
      </form>
    </section>
  </div>
</template>
<style scoped>
.account-panel {
  position: relative;
}
.notification-toggle span {
  background: #c95055;
  color: white;
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 10px;
}
.notification-popover {
  position: absolute;
  right: 0;
  top: 38px;
  width: min(380px, calc(100vw - 24px));
  max-height: 75dvh;
  overflow: auto;
  background: white;
  padding: 24px;
  border: 1px solid #dce4dd;
  border-radius: 20px;
  box-shadow: 0 20px 70px #263d342b;
  z-index: 110;
}
.notification-popover header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.notification-popover h2 {
  font-size: 20px;
  margin: 0;
}
.notification-popover p {
  font-size: 13px;
  line-height: 1.7;
  color: #647367;
}
.notification-popover article {
  padding: 16px 0;
  border-bottom: 1px solid #e6ece7;
}
.notification-popover article a {
  font-size: 13px;
}
.notification-popover form {
  margin-top: 20px;
}
.notification-popover input[type='password'] {
  width: 100%;
  padding: 12px;
  border: 1px solid #cfd9d0;
  border-radius: 10px;
  margin: 8px 0;
}
.notification-popover label {
  font-size: 12px;
}
.confirm {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 0;
}
hr {
  border: 0;
  border-top: 1px solid #e0e6e1;
  margin: 18px 0;
}
@media (max-width: 600px) {
  .notification-popover {
    position: fixed;
    right: 12px;
    top: 72px;
  }
}
</style>
