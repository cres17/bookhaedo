import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import DataPolicy from './views/DataPolicy.vue';
import Landing from './views/Landing.vue';
import Auth from './views/Auth.vue';
import Explore from './views/Explore.vue';
import Trips from './views/Trips.vue';
import Planner from './views/Planner.vue';
import Admin from './views/Admin.vue';
import Detail from './views/Detail.vue';
import Invite from './views/Invite.vue';
import { boot, state } from './store';
import { dialog } from './dialog';
import './style.css';
import './readability.css';
import './bookhaedo.css';
import './explore-journey.css';
const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', component: Landing },
    { path: '/terms', component: DataPolicy },
    { path: '/privacy', component: DataPolicy },
    { path: '/login', component: Auth },
    { path: '/signup', component: Auth },
    { path: '/admin', component: Admin, meta: { auth: true, admin: true } },
    { path: '/explore', component: Explore, meta: { auth: true } },
    { path: '/trips', component: Trips, meta: { auth: true } },
    { path: '/invite/:token', component: Invite, meta: { auth: true } },
    { path: '/trips/:id', component: Planner, meta: { auth: true } },
    { path: '/places/:id', component: Detail, meta: { auth: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
const ready = boot();
router.beforeEach(async (to) => {
  await ready;
  if (to.meta.admin && state.user && state.user.role !== 'ADMIN') return '/explore';
  if (to.meta.auth && !state.user) return { path: '/login', query: { redirect: to.fullPath } };
});
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
