<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, json } from '../api';
const route = useRoute(),
  router = useRouter(),
  invitation = ref<any>(null),
  error = ref(''),
  busy = ref(false);
onMounted(async () => {
  try {
    invitation.value = await api('/invitations/link/' + route.params.token);
  } catch (e: any) {
    error.value = e.message;
  }
});
async function respond(accept: boolean) {
  busy.value = true;
  try {
    const r = await api(
      '/invitations/respond',
      json('POST', { token: route.params.token, accept }),
    );
    await router.push(accept ? '/trips/' + r.tripId : '/trips');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="invite-page">
    <small>YOU’RE INVITED</small>
    <h1>함께 떠날 준비가 됐나요?</h1>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <template v-if="invitation">
      <h2>{{ invitation.title }}</h2>
      <p>수락하면 동행자와 일정·메모·예산을 함께 수정하고 여행 채팅에 참여할 수 있어요.</p>
      <button class="button dark" :disabled="busy" @click="respond(true)">
        초대 수락하고 여행 보기
      </button>
      <button class="button subtle" :disabled="busy" @click="respond(false)">거절</button>
    </template>
    <RouterLink v-else to="/trips">나의 여행으로</RouterLink>
  </main>
</template>
<style scoped>
.invite-page {
  max-width: 660px;
  margin: 8vh auto;
  padding: 40px;
  border: 1px solid #dce5de;
  border-radius: 24px;
  background: #f7faf7;
}
.invite-page small {
  letter-spacing: 3px;
  color: #5a7864;
}
.invite-page h1 {
  font-size: 32px;
}
.invite-page p {
  line-height: 1.8;
  margin: 24px 0;
}
@media (max-width: 700px) {
  .invite-page {
    margin: 30px 16px;
    padding: 25px;
  }
}
</style>
