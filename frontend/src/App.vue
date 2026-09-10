<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { state, notify, dismissToast, selectTrip } from './store';
import { api } from './api';
import Crystal from './components/Crystal.vue';
import Icon from './components/Icon.vue';
const route = useRoute(),
  router = useRouter();
async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
    state.user = null;
    selectTrip('', '');
    await router.push('/');
    notify('로그아웃했어요. 다음 여행에서 만나요.');
  } catch (e: any) {
    notify(e.message);
  }
}
</script>
<template>
  <div class="app-shell">
    <header class="site-header">
      <RouterLink to="/" class="wordmark" aria-label="Book해도. 홈">
        <Crystal />
        <span>
          Book해도
          <span class="wordmark-dot">.</span>
        </span>
      </RouterLink>
      <nav class="primary-nav" aria-label="주요 메뉴">
        <RouterLink
          to="/explore"
          :class="{ current: route.path.includes('explore') || route.path.includes('places') }"
        >
          발견하기
        </RouterLink>
        <RouterLink
          v-if="state.user"
          to="/trips"
          :class="{ current: route.path.includes('trips') }"
        >
          나의 여행
        </RouterLink>
        <a v-else href="/#journey">여행하는 방법</a>
      </nav>
      <div class="account-nav">
        <template v-if="state.user">
          <RouterLink v-if="state.user.role === 'ADMIN'" to="/admin">관리자</RouterLink>
          <span class="user-name">{{ state.user.name }} 님</span>
          <button class="text-button" @click="logout">로그아웃</button>
        </template>
        <template v-else>
          <RouterLink to="/login" class="login-link">로그인</RouterLink>
          <RouterLink to="/signup" class="button small dark">
            시작하기
            <Icon name="arrow" :size="15" />
          </RouterLink>
        </template>
      </div>
    </header>
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
    <nav v-if="state.user" class="mobile-nav" aria-label="모바일 메뉴">
      <RouterLink to="/explore">
        <Icon name="map" />
        발견하기
      </RouterLink>
      <RouterLink to="/trips">
        <Icon name="calendar" />
        나의 여행
      </RouterLink>
    </nav>
    <Transition name="toast">
      <div v-if="state.toast" role="status" class="toast-message">
        <Crystal :size="22" />
        <span>{{ state.toast }}</span>
        <button class="icon-button toast-close" aria-label="알림 닫기" @click="dismissToast">
          <Icon name="close" />
        </button>
      </div>
    </Transition>
  </div>
</template>
