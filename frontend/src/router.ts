import { createRouter, createWebHistory } from 'vue-router';
import { state } from './store';
import Admin from './views/Admin.vue';
import Auth from './views/Auth.vue';
import DataPolicy from './views/DataPolicy.vue';
import Detail from './views/Detail.vue';
import Explore from './views/Explore.vue';
import Invite from './views/Invite.vue';
import Landing from './views/Landing.vue';
import Planner from './views/Planner.vue';
import RegionGuide from './views/RegionGuide.vue';
import Trips from './views/Trips.vue';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, from, savedPosition) => {
    if (savedPosition) return savedPosition;
    if (to.path === from.path && to.path.startsWith('/regions')) return false;
    return { top: 0 };
  },
  routes: [
    { path: '/', component: Landing },
    { path: '/terms', component: DataPolicy },
    { path: '/privacy', component: DataPolicy },
    { path: '/login', component: Auth },
    { path: '/signup', component: Auth },
    { path: '/admin', component: Admin, meta: { auth: true, admin: true } },
    { path: '/explore', component: Explore, meta: { auth: true } },
    { path: '/regions/:id?', component: RegionGuide, meta: { auth: true } },
    { path: '/trips', component: Trips, meta: { auth: true } },
    { path: '/invite/:token', component: Invite, meta: { auth: true } },
    { path: '/trips/:id/:slug?', name: 'trip', component: Planner, meta: { auth: true } },
    { path: '/places/:id', component: Detail, meta: { auth: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

export function installRouteGuards(ready: Promise<void>) {
  router.beforeEach(async (to) => {
    await ready;
    if (to.meta.admin && state.user && state.user.role !== 'ADMIN') return '/explore';
    if (to.meta.auth && !state.user) return { path: '/login', query: { redirect: to.fullPath } };
  });
}
