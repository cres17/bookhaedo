<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, json } from '../api';
import Icon from '../components/Icon.vue';
import { state } from '../store';

type User = {
  id: string;
  name: string;
  email: string;
  role: 'MEMBER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
};
type Audit = {
  id: string;
  actorId: string;
  targetId: string;
  before: Pick<User, 'role' | 'status'>;
  after: Pick<User, 'role' | 'status'>;
  createdAt: string;
};

const users = ref<User[]>([]),
  audit = ref<Audit[]>([]),
  q = ref(''),
  offset = ref(0),
  count = ref(0);
const busy = ref(false),
  error = ref(''),
  selected = ref<User | null>(null),
  tab = ref<'users' | 'audit'>('users');
const page = computed(() => Math.floor(offset.value / 20) + 1);
const totalPages = computed(() => Math.max(1, Math.ceil(count.value / 20)));
const visibleAdmins = computed(() => users.value.filter((user) => user.role === 'ADMIN').length);
const visibleSuspended = computed(
  () => users.value.filter((user) => user.status === 'SUSPENDED').length,
);

const roleName = (role: string) => (role === 'ADMIN' ? '관리자' : '회원');
const statusName = (status: string) => (status === 'ACTIVE' ? '정상' : '이용정지');
const formatDate = (date: string) =>
  new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(date),
  );

async function load() {
  busy.value = true;
  error.value = '';
  try {
    if (tab.value === 'users') {
      const response = await api(
        '/admin/users?' + new URLSearchParams({ q: q.value.trim(), offset: String(offset.value) }),
      );
      users.value = response.data;
      count.value = response.count;
    } else audit.value = (await api('/admin/audit')).data;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function save() {
  if (!selected.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api(
      '/admin/users/' + selected.value.id,
      json('PATCH', { role: selected.value.role, status: selected.value.status }),
    );
    selected.value = null;
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function switchTab(value: 'users' | 'audit') {
  if (tab.value === value) return;
  tab.value = value;
  load();
}
function search() {
  offset.value = 0;
  load();
}
function clearSearch() {
  q.value = '';
  offset.value = 0;
  load();
}
function goPage(direction: -1 | 1) {
  offset.value = Math.max(0, offset.value + direction * 20);
  load();
}
onMounted(load);
</script>
<template>
  <main class="admin-page">
    <header class="admin-hero">
      <div>
        <span class="eyebrow">
          <span class="red-dot" />
          BOOKHAEDO ADMINISTRATION
        </span>
        <h1>서비스 관리</h1>
        <p>회원 권한과 이용 상태를 안전하게 관리하고, 모든 변경 기록을 확인합니다.</p>
      </div>
      <RouterLink class="button light" to="/explore">
        <Icon name="back" :size="17" />
        여행 서비스로
      </RouterLink>
    </header>

    <section class="admin-shell">
      <nav class="admin-tabs" aria-label="관리 메뉴">
        <button
          :class="{ active: tab === 'users' }"
          :aria-current="tab === 'users' ? 'page' : undefined"
          :disabled="busy"
          @click="switchTab('users')"
        >
          <Icon name="user" :size="18" />
          회원 관리
        </button>
        <button
          :class="{ active: tab === 'audit' }"
          :aria-current="tab === 'audit' ? 'page' : undefined"
          :disabled="busy"
          @click="switchTab('audit')"
        >
          <Icon name="clock" :size="18" />
          변경 이력
        </button>
      </nav>
      <p v-if="error" class="admin-alert" role="alert">{{ error }}</p>

      <template v-if="tab === 'users'">
        <div class="admin-stats" aria-label="회원 현황">
          <article>
            <small>전체 회원</small>
            <strong>{{ count.toLocaleString() }}</strong>
            <span>검색 조건 기준</span>
          </article>
          <article>
            <small>현재 목록의 관리자</small>
            <strong>{{ visibleAdmins }}</strong>
            <span>현재 페이지 20명 기준</span>
          </article>
          <article>
            <small>현재 목록의 이용정지</small>
            <strong>{{ visibleSuspended }}</strong>
            <span>현재 페이지 20명 기준</span>
          </article>
        </div>

        <section class="admin-panel" aria-labelledby="member-heading">
          <div class="panel-heading">
            <div>
              <span>MEMBERS</span>
              <h2 id="member-heading">회원 관리</h2>
            </div>
            <p>권한과 이용 상태만 변경할 수 있습니다.</p>
          </div>
          <form class="admin-search" role="search" @submit.prevent="search">
            <label>
              <span class="sr-only">회원 검색</span>
              <Icon name="search" :size="18" />
              <input
                v-model="q"
                maxlength="100"
                aria-label="회원 검색"
                placeholder="이름 또는 이메일로 검색"
              />
            </label>
            <button v-if="q" type="button" class="text-button" @click="clearSearch">초기화</button>
            <button class="button dark" :disabled="busy">{{ busy ? '검색 중…' : '검색' }}</button>
          </form>

          <div class="admin-table" :aria-busy="busy">
            <table>
              <thead>
                <tr>
                  <th>회원</th>
                  <th>이메일</th>
                  <th>권한</th>
                  <th>상태</th>
                  <th><span class="sr-only">관리</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in users" :key="user.id">
                  <td data-label="회원">
                    <span class="member-avatar">{{ user.name.slice(0, 1) }}</span>
                    <strong>{{ user.name }}</strong>
                  </td>
                  <td data-label="이메일">{{ user.email }}</td>
                  <td data-label="권한">
                    <span :class="['admin-badge', user.role.toLowerCase()]">
                      {{ roleName(user.role) }}
                    </span>
                  </td>
                  <td data-label="상태">
                    <span :class="['status-badge', user.status.toLowerCase()]">
                      <i />
                      {{ statusName(user.status) }}
                    </span>
                  </td>
                  <td data-label="관리">
                    <button
                      class="manage-button"
                      :disabled="busy || user.id === state.user?.id"
                      @click="selected = { ...user }"
                    >
                      {{ user.id === state.user?.id ? '현재 계정' : '수정' }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="busy" class="table-loading">
              <span class="spinner" />
              회원 정보를 불러오고 있어요
            </div>
            <div v-else-if="!users.length" class="admin-empty">
              <Icon name="search" :size="25" />
              <strong>검색 결과가 없습니다</strong>
              <span>이름이나 이메일을 다시 확인해 주세요.</span>
            </div>
          </div>
          <footer class="admin-pagination">
            <span>
              {{ count.toLocaleString() }}명 중 {{ count ? offset + 1 : 0 }}–{{
                Math.min(offset + 20, count)
              }}명
            </span>
            <div>
              <button :disabled="busy || offset === 0" aria-label="이전 페이지" @click="goPage(-1)">
                <Icon name="back" :size="16" />
              </button>
              <strong>{{ page }} / {{ totalPages }}</strong>
              <button
                :disabled="busy || offset + 20 >= count"
                aria-label="다음 페이지"
                @click="goPage(1)"
              >
                <Icon name="arrow" :size="16" />
              </button>
            </div>
          </footer>
        </section>
      </template>

      <section v-else class="admin-panel audit-panel" aria-labelledby="audit-heading">
        <div class="panel-heading">
          <div>
            <span>AUDIT LOG</span>
            <h2 id="audit-heading">최근 변경 이력</h2>
          </div>
          <p>최신 100건 · 읽기 전용</p>
        </div>
        <div class="audit-list" :aria-busy="busy">
          <article v-for="item in audit" :key="item.id" class="audit-entry">
            <span class="audit-icon"><Icon name="clock" :size="18" /></span>
            <div>
              <time :datetime="item.createdAt">{{ formatDate(item.createdAt) }}</time>
              <strong>
                {{ roleName(item.before.role) }} · {{ statusName(item.before.status) }}
                <Icon name="arrow" :size="14" />
                {{ roleName(item.after.role) }} · {{ statusName(item.after.status) }}
              </strong>
              <span class="sr-only">변경 결과 {{ item.after.role }} {{ item.after.status }}</span>
              <p>대상 {{ item.targetId }}</p>
              <small>변경자 {{ item.actorId }}</small>
            </div>
          </article>
          <div v-if="busy" class="admin-empty">
            <span class="spinner" />
            변경 이력을 불러오고 있어요
          </div>
          <div v-else-if="!audit.length" class="admin-empty">
            <Icon name="clock" :size="25" />
            <strong>아직 변경 이력이 없습니다</strong>
          </div>
        </div>
      </section>
    </section>

    <Teleport to="body">
      <div v-if="selected" class="modal-backdrop" @click.self="selected = null">
        <section
          class="modal admin-modal"
          v-dialog
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-member-heading"
        >
          <button
            class="icon-button modal-close"
            type="button"
            aria-label="닫기"
            :disabled="busy"
            @click="selected = null"
          >
            <Icon name="close" />
          </button>
          <span class="modal-avatar">{{ selected.name.slice(0, 1) }}</span>
          <h2 id="edit-member-heading">회원 설정</h2>
          <p>
            <strong>{{ selected.name }}</strong>
            <br />
            {{ selected.email }}
          </p>
          <form @submit.prevent="save">
            <div class="modal-fields">
              <label>
                권한
                <select v-model="selected.role" aria-label="권한">
                  <option value="MEMBER">회원</option>
                  <option value="ADMIN">관리자</option>
                </select>
              </label>
              <label>
                상태
                <select v-model="selected.status" aria-label="상태">
                  <option value="ACTIVE">정상</option>
                  <option value="SUSPENDED">이용정지</option>
                </select>
              </label>
            </div>
            <aside>
              저장하면 해당 회원의 기존 세션이 종료됩니다. 변경 내용과 관리자 계정은 감사 로그에
              기록됩니다.
            </aside>
            <p v-if="error" class="admin-alert" role="alert">{{ error }}</p>
            <div class="modal-actions">
              <button type="button" class="button subtle" :disabled="busy" @click="selected = null">
                취소
              </button>
              <button class="button dark" :disabled="busy">
                {{ busy ? '저장 중…' : '변경 확인 및 저장' }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </Teleport>
  </main>
</template>
<style scoped>
.admin-page {
  min-height: calc(100svh - 86px);
  padding: 52px clamp(20px, 5vw, 76px) 110px;
  background: linear-gradient(180deg, #edf1f8 0, #f8f9fb 330px);
}
.admin-hero {
  max-width: 1280px;
  margin: 0 auto 28px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 30px;
  padding: 0 6px;
}
.admin-hero h1 {
  font-size: clamp(38px, 5vw, 58px);
  font-weight: 600;
  margin: 15px 0 9px;
}
.admin-hero p {
  color: #697389;
  font-size: 15px;
}
.admin-hero .button {
  border: 1px solid #ffffff80;
  box-shadow: 0 10px 30px #33405e10;
}
.admin-shell {
  max-width: 1280px;
  margin: auto;
}
.admin-tabs {
  display: flex;
  gap: 6px;
  width: max-content;
  padding: 5px;
  background: #e5e9f1;
  border-radius: 14px;
  margin-bottom: 20px;
}
.admin-tabs button {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 18px;
  border-radius: 10px;
  color: #747e92;
  font-size: 14px;
  font-weight: 600;
  transition: 0.2s;
}
.admin-tabs button.active {
  background: #fff;
  color: var(--navy);
  box-shadow: 0 3px 12px #35415d12;
}
.admin-alert {
  padding: 13px 16px !important;
  margin: 0 0 18px !important;
  border: 1px solid #f2cdd2;
  border-radius: 12px;
  background: #fff3f4;
  color: #a32d3b !important;
  font-size: 13px;
}
.admin-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
  margin-bottom: 18px;
}
.admin-stats article {
  background: #fff;
  border: 1px solid #e5e8ef;
  border-radius: 17px;
  padding: 22px 24px;
  box-shadow: 0 8px 24px #36415d08;
}
.admin-stats small,
.admin-stats span {
  display: block;
  color: #8993a6;
  font-size: 11px;
}
.admin-stats strong {
  display: block;
  font:
    600 31px 'DM Sans',
    sans-serif;
  margin: 8px 0;
  color: #303752;
}
.admin-stats article:nth-child(2) strong {
  color: #5266a6;
}
.admin-stats article:nth-child(3) strong {
  color: #bd5867;
}
.admin-panel {
  background: #fff;
  border: 1px solid #e1e5ed;
  border-radius: 22px;
  overflow: hidden;
  box-shadow: 0 15px 45px #34405c09;
}
.panel-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  padding: 26px 28px 20px;
}
.panel-heading span {
  font: 600 9px 'DM Sans';
  letter-spacing: 2px;
  color: #9aa3b3;
}
.panel-heading h2 {
  font-size: 24px;
  margin-top: 7px;
}
.panel-heading p {
  color: #929aa9;
  font-size: 12px;
}
.admin-search {
  display: flex;
  gap: 10px;
  padding: 0 28px 24px;
  border-bottom: 1px solid #edf0f4;
}
.admin-search label {
  height: 46px;
  display: flex;
  align-items: center;
  gap: 11px;
  flex: 1;
  max-width: 580px;
  padding: 0 15px;
  border: 1px solid #dfe4ec;
  border-radius: 11px;
  color: #8995a8;
  background: #fafbfc;
}
.admin-search label:focus-within {
  border-color: #7888b2;
  box-shadow: 0 0 0 3px #7185b518;
}
.admin-search input {
  border: 0;
  outline: 0;
  background: transparent;
  width: 100%;
  font-size: 13px;
}
.admin-search .text-button {
  padding: 0 10px;
}
.admin-search .button {
  min-height: 46px;
  padding: 12px 21px;
}
.admin-table {
  position: relative;
  min-height: 176px;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
}
th,
td {
  text-align: left;
  padding: 16px 22px;
  border-bottom: 1px solid #eef0f4;
  font-size: 13px;
}
th {
  background: #fafbfc;
  color: #8b94a5;
  font-size: 11px;
  font-weight: 600;
}
tbody tr {
  transition: background 0.2s;
}
tbody tr:hover {
  background: #fafbfe;
}
tbody tr:last-child td {
  border-bottom: 0;
}
td:first-child {
  display: flex;
  align-items: center;
  gap: 11px;
}
.member-avatar,
.modal-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #edf0f6;
  color: #53617f;
  font-weight: 700;
}
.member-avatar {
  width: 34px;
  height: 34px;
}
.modal-avatar {
  width: 52px;
  height: 52px;
  font-size: 18px;
}
.admin-badge,
.status-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 20px;
  padding: 6px 10px;
  font-size: 11px;
}
.admin-badge {
  background: #f0f2f7;
  color: #5f6980;
}
.admin-badge.admin {
  background: #e9edf9;
  color: #4f639f;
}
.status-badge {
  gap: 7px;
}
.status-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.status-badge.active {
  background: #eaf6f0;
  color: #378064;
}
.status-badge.suspended {
  background: #fff0f1;
  color: #b64e5b;
}
.manage-button {
  border: 1px solid #dce1e9;
  border-radius: 9px;
  padding: 8px 12px;
  color: #56617a;
  font-size: 12px;
}
.manage-button:hover:not(:disabled) {
  background: #303752;
  color: #fff;
  border-color: #303752;
}
.table-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #ffffffdd;
  color: #758096;
  font-size: 13px;
}
.admin-empty {
  min-height: 190px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  color: #95a0b2;
  font-size: 12px;
}
.admin-empty strong {
  color: #59657b;
  font-size: 14px;
}
.admin-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 17px 24px;
  border-top: 1px solid #edf0f4;
  color: #8a94a6;
  font-size: 11px;
}
.admin-pagination > div {
  display: flex;
  align-items: center;
  gap: 10px;
}
.admin-pagination button {
  width: 34px;
  height: 34px;
  border: 1px solid #e0e4eb;
  border-radius: 9px;
  display: grid;
  place-items: center;
}
.admin-pagination button:hover:not(:disabled) {
  background: #f0f2f7;
}
.admin-pagination strong {
  font: 600 11px 'DM Sans';
  color: #626d82;
}
.audit-panel {
  min-height: 420px;
}
.audit-list {
  border-top: 1px solid #edf0f4;
  padding: 4px 28px 22px;
}
.audit-entry {
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 15px;
  padding: 21px 0;
  border-bottom: 1px solid #edf0f4;
  overflow-wrap: anywhere;
}
.audit-icon {
  width: 42px;
  height: 42px;
  border-radius: 13px;
  background: #eef1f7;
  color: #657392;
  display: grid;
  place-items: center;
}
.audit-entry time,
.audit-entry small {
  display: block;
  color: #98a1b0;
  font-size: 10px;
}
.audit-entry strong {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 7px 0;
  font-size: 14px;
}
.audit-entry p {
  font-size: 11px;
  color: #68738a;
}
.admin-modal {
  text-align: left;
}
.admin-modal h2 {
  margin: 18px 0 8px;
}
.admin-modal > p {
  line-height: 1.7;
}
.admin-modal > p strong {
  color: #3a4257;
}
.modal-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.admin-modal aside {
  background: #f4f6f9;
  border-radius: 12px;
  padding: 14px 16px;
  color: #707b90;
  font-size: 11px;
  line-height: 1.7;
  margin: 8px 0 20px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 700px) {
  .admin-page {
    padding: 30px 14px 90px;
  }
  .admin-hero {
    align-items: flex-start;
  }
  .admin-hero h1 {
    font-size: 36px;
  }
  .admin-hero p {
    font-size: 13px;
  }
  .admin-hero .button {
    min-width: 46px;
    font-size: 0;
    padding: 12px;
  }
  .admin-tabs {
    width: 100%;
  }
  .admin-tabs button {
    flex: 1;
    justify-content: center;
  }
  .admin-stats {
    grid-template-columns: 1fr;
  }
  .admin-stats article {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    padding: 17px 19px;
  }
  .admin-stats strong {
    grid-row: 1/3;
    grid-column: 2;
    margin: 0;
  }
  .admin-stats span {
    margin-top: 5px;
  }
  .panel-heading {
    align-items: flex-start;
    flex-direction: column;
    padding: 22px 18px 16px;
  }
  .admin-search {
    padding: 0 18px 20px;
    flex-wrap: wrap;
  }
  .admin-search label {
    max-width: none;
    flex-basis: 100%;
  }
  .admin-search .button {
    flex: 1;
  }
  .admin-table {
    overflow: visible;
    padding: 0 14px;
  }
  thead {
    display: none;
  }
  table,
  tbody,
  tr,
  td {
    display: block;
    width: 100%;
    white-space: normal;
  }
  tbody tr {
    position: relative;
    padding: 17px 14px;
    border-bottom: 1px solid #edf0f4;
  }
  td,
  td:first-child {
    border: 0;
    padding: 5px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  td:before {
    content: attr(data-label);
    color: #929cac;
    font-size: 10px;
    flex-shrink: 0;
  }
  td:first-child {
    justify-content: flex-start;
    margin-bottom: 8px;
  }
  td:first-child:before {
    display: none;
  }
  td:last-child {
    position: absolute;
    right: 12px;
    top: 14px;
    width: auto;
  }
  .manage-button {
    padding: 7px 9px;
  }
  .admin-pagination {
    padding: 16px 18px;
  }
  .admin-pagination > span {
    display: none;
  }
  .audit-list {
    padding: 2px 18px 18px;
  }
  .audit-entry {
    grid-template-columns: 34px 1fr;
  }
  .audit-icon {
    width: 34px;
    height: 34px;
  }
  .modal-fields {
    grid-template-columns: 1fr;
  }
  .modal-actions .button {
    flex: 1;
    padding: 12px 10px;
  }
}
</style>
