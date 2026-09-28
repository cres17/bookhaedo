import { createApp } from 'vue';
import App from './App.vue';
import { boot, state } from './store';
import { dialog } from './dialog';
import { installRouteGuards, router } from './router';
import './style.css';
import './readability.css';
import './bookhaedo.css';
import './explore-journey.css';
const ready = boot();
installRouteGuards(ready);
window.addEventListener('bookhaedo:session-expired', () => {
  if (!state.user) return;
  state.user = null;
  state.activeTrip = '';
  state.activeDate = '';
  localStorage.removeItem('kita-trip');
  localStorage.removeItem('kita-date');
  if (router.currentRoute.value.meta.auth)
    void router.replace({
      path: '/login',
      query: { redirect: router.currentRoute.value.fullPath },
    });
});
createApp(App).directive('dialog', dialog).use(router).mount('#app');
