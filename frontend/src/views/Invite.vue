<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, json } from '../api';
const route = useRoute(),
  router = useRouter(),
  invitation = ref<any>(null),
  error = ref(''),
  loading = ref(true),
  busy = ref(false);
watch(
  () => route.params.token,
  async () => {
    invitation.value = null;
    error.value = '';
    loading.value = true;
    try {
      invitation.value = await api('/invitations/link/' + route.params.token);
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
async function respond(accept: boolean) {
  if (busy.value || loading.value) return;
  error.value = '';
  busy.value = true;
  error.value = '';
  try {
    const result = await api(
      '/invitations/respond',
      json('POST', { token: route.params.token, accept }),
    );
    await router.push(accept ? '/trips/' + result.tripId : '/trips');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="invite-page">
    <section class="invite-card" :class="{ busy }">
      <div class="invite-orbit" aria-hidden="true">
        <i></i>
        <i></i>
        <i></i>
      </div>
      <header>
        <small>여행 초대</small>
        <h1>{{ invitation?.title || (loading ? '초대장 확인 중' : '초대장') }}</h1>
      </header>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <template v-else-if="invitation">
        <div class="invite-features" aria-label="함께 할 수 있는 기능">
          <span>일정</span>
          <span>지출</span>
          <span>채팅</span>
        </div>
        <template v-if="invitation.alreadyMember">
          <p>
            {{
              invitation.isOwner
                ? '내가 만든 여행의 초대장이에요. 함께 갈 사람에게 링크를 공유해주세요.'
                : '이미 참여 중인 여행이에요. 바로 여행을 열 수 있어요.'
            }}
          </p>
          <RouterLink class="button dark" :to="'/trips/' + invitation.tripId">여행 보기</RouterLink>
        </template>
        <div v-else class="invite-actions">
          <button class="button dark invite-accept" :disabled="busy" @click="respond(true)">
            {{ busy ? '들어가는 중…' : '여행 참여' }}
            <b>→</b>
          </button>
          <button class="invite-decline" :disabled="busy" @click="respond(false)">거절</button>
        </div>
      </template>
      <p v-else-if="loading" class="invite-loading" role="status">초대장 확인 중</p>
      <RouterLink v-else class="button subtle" to="/trips">나의 여행</RouterLink>
    </section>
  </main>
</template>
<style scoped>
.invite-page {
  display: grid;
  min-height: min(720px, calc(100dvh - 140px));
  place-items: center;
  padding: 30px 18px;
}
.invite-card {
  position: relative;
  width: min(100%, 680px);
  overflow: hidden;
  padding: clamp(34px, 7vw, 68px);
  border: 1px solid #d7deea;
  border-radius: 32px;
  background: linear-gradient(145deg, #fff 0%, #f8f9fc 52%, #e9edf5 100%);
  box-shadow: 0 26px 80px #30375118;
}
.invite-card header {
  position: relative;
  z-index: 1;
}
.invite-card header small {
  display: block;
  color: #607294;
  font-size: 16px;
  font-weight: 750;
  letter-spacing: 0.08em;
}
.invite-card h1 {
  max-width: 12ch;
  margin: 12px 0 34px;
  color: #2e314e;
  font-size: clamp(38px, 6vw, 62px);
  line-height: 1.08;
  letter-spacing: -0.065em;
  overflow-wrap: anywhere;
}
.invite-orbit {
  position: absolute;
  right: -82px;
  top: -76px;
  width: 270px;
  height: 270px;
  border: 1px solid #cbd5e5;
  border-radius: 50%;
}
.invite-orbit::before,
.invite-orbit::after {
  content: '';
  position: absolute;
  inset: 34px;
  border: 1px solid #dae2ee;
  border-radius: inherit;
}
.invite-orbit::after {
  inset: 72px;
  background: #7185a433;
  box-shadow: 0 0 50px #7185a455;
}
.invite-orbit i {
  position: absolute;
  z-index: 1;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #536887;
  box-shadow: 0 0 0 7px #e8edf5;
  animation: float 3.4s ease-in-out infinite;
}
.invite-orbit i:nth-child(1) {
  left: 34px;
  top: 24px;
}
.invite-orbit i:nth-child(2) {
  right: 42px;
  bottom: 43px;
  animation-delay: -1.1s;
}
.invite-orbit i:nth-child(3) {
  left: 80px;
  bottom: 8px;
  animation-delay: -2.2s;
}
.invite-features {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 9px;
  margin-bottom: 34px;
}
.invite-features span {
  padding: 10px 15px;
  border: 1px solid #d6dfea;
  border-radius: 999px;
  background: #fff;
  color: #465a79;
  font-size: 18px;
  font-weight: 700;
}
.invite-actions {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 16px;
}
.invite-accept {
  min-height: 64px;
  padding: 0 26px;
  border-radius: 18px;
  font-size: 21px;
  box-shadow: 0 12px 25px #30375132;
  transition:
    transform 0.18s,
    box-shadow 0.18s;
}
.invite-accept:hover:not(:disabled) {
  transform: translateY(-3px);
  box-shadow: 0 18px 30px #3037513e;
}
.invite-accept b {
  margin-left: 13px;
  font-size: 27px;
}
.invite-decline {
  min-height: 52px;
  border: 0;
  background: transparent;
  color: #65728a;
  font: inherit;
  font-size: 18px;
  font-weight: 700;
}
.invite-decline:hover:not(:disabled) {
  color: #303751;
  text-decoration: underline;
}
.invite-loading {
  position: relative;
  z-index: 1;
  color: #65728a;
  font-size: 20px;
}
.invite-card.busy .invite-orbit {
  animation: spin 1.4s linear infinite;
}
@keyframes float {
  50% {
    transform: translateY(-10px);
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .invite-orbit,
  .invite-orbit i {
    animation: none !important;
  }
}
@media (max-width: 520px) {
  .invite-page {
    padding: 18px 14px;
  }
  .invite-card {
    min-height: 470px;
    padding: 34px 28px;
    border-radius: 26px;
  }
  .invite-card h1 {
    font-size: 40px;
  }
  .invite-actions {
    align-items: stretch;
    flex-direction: column;
    gap: 4px;
  }
  .invite-accept {
    width: 100%;
  }
}
</style>
