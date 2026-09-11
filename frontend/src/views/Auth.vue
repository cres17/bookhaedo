<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, json } from '../api';
import { state } from '../store';
import Crystal from '../components/Crystal.vue';
import Icon from '../components/Icon.vue';
const route = useRoute(),
  router = useRouter(),
  signup = computed(() => route.path === '/signup');
const name = ref(''),
  email = ref(''),
  password = ref(''),
  passwordConfirmation = ref(''),
  error = ref(''),
  busy = ref(false);
async function submit() {
  if (busy.value) return;
  if (signup.value && password.value !== passwordConfirmation.value) {
    error.value = '비밀번호가 일치하지 않아요. 다시 확인해주세요.';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const data = await api(
      '/auth/' + (signup.value ? 'register' : 'login'),
      json('POST', { name: name.value, email: email.value, password: password.value }),
    );
    state.user = data.user;
    const target =
      typeof route.query.redirect === 'string' &&
      route.query.redirect.startsWith('/') &&
      !route.query.redirect.startsWith('//')
        ? route.query.redirect
        : '/explore';
    await router.push(target);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="auth-page">
    <section class="auth-image">
      <img src="/images/yotei.jpg" alt="요테이산의 겨울 풍경" />
      <div class="auth-image-shade" />
      <div>
        <Crystal :size="70" />
        <h1>
          {{ signup ? '눈 내린 홋카이도에' : '멈춰둔 여행의' }}
          <br />
          {{ signup ? '첫 장면을 남겨보세요.' : '다음 장면을 이어가요.' }}
        </h1>
        <p>
          {{
            signup
              ? '가고 싶은 곳이 하나씩, 나만의 여행이 됩니다.'
              : '담아둔 설렘이 그대로 기다리고 있어요.'
          }}
        </p>
      </div>
    </section>
    <section class="auth-form-wrap">
      <form class="auth-form" @submit.prevent="submit">
        <span class="eyebrow">WELCOME TO Book해도.</span>
        <h1>{{ signup ? '첫 여행을 시작해볼까요?' : '다시 만나 반가워요.' }}</h1>
        <p>
          {{
            signup
              ? '나만의 홋카이도를 차곡차곡 담아보세요.'
              : '저장한 여행에서 이야기를 이어가세요.'
          }}
        </p>
        <label v-if="signup">
          이름
          <input
            v-model="name"
            autocomplete="name"
            required
            maxlength="40"
            placeholder="여행에서 불릴 이름"
          />
        </label>
        <label>
          이메일
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            required
            placeholder="hello@example.com"
            maxlength="254"
          />
        </label>
        <label>
          비밀번호
          <input
            v-model="password"
            type="password"
            :autocomplete="signup ? 'new-password' : 'current-password'"
            required
            minlength="10"
            maxlength="128"
            placeholder="10자 이상 입력해주세요"
          />
        </label>
        <label v-if="signup">
          비밀번호 재확인
          <input
            v-model="passwordConfirmation"
            type="password"
            autocomplete="new-password"
            required
            minlength="10"
            maxlength="128"
            placeholder="비밀번호를 한 번 더 입력해주세요"
          />
        </label>
        <p v-if="route.query.redirect" class="auth-invite-notice">
          로그인 또는 회원가입 후 원래 보던 페이지로 돌아갑니다.
        </p>
        <p v-if="error" role="alert" class="form-error">{{ error }}</p>
        <button class="button dark wide" :disabled="busy">
          {{ busy ? '잠시만 기다려주세요' : signup ? '계정 만들고 시작하기' : '로그인' }}
          <Icon name="arrow" />
        </button>
        <p class="auth-switch">
          {{ signup ? '이미 계정이 있나요?' : '아직 Book해도. 계정이 없나요?' }}
          <RouterLink :to="{ path: signup ? '/login' : '/signup', query: route.query }">
            {{ signup ? '로그인' : '회원가입' }}
          </RouterLink>
        </p>
      </form>
    </section>
  </main>
</template>
