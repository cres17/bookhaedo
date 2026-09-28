import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, json } from '../api';
import { notify, state } from '../store';

export type TripToolsProps = {
  tripId: string;
  isOwner: boolean;
  tripTitle?: string;
  budgetRevision?: string;
};

export function useTripTools(props: TripToolsProps) {
  const tab = ref('');
  const busy = ref(false);
  const error = ref('');
  const members = ref<any[]>([]);
  const checklist = ref<any[]>([]);
  const messages = ref<any[]>([]);
  const expenses = ref<any>({ data: [], budgets: [], transfers: [], total: 0 });
  const invites = ref<any[]>([]);
  const task = ref('');
  const message = ref('');
  const email = ref('');
  const shareUrl = ref('');
  const payer = ref('');
  const participants = ref<string[]>([]);
  const older = ref<any[]>([]);
  const hasMore = ref(false);
  const summaryReady = ref(false);
  const chatLog = ref<HTMLElement | null>(null);
  const base = computed(() => `/trips/${props.tripId}`);
  const progress = computed(() => checklist.value.filter((item) => item.done).length);
  const plannedTotal = computed(() =>
    expenses.value.budgets.reduce(
      (sum: number, item: any) => sum + Number(item.estimatedCost || 0),
      0,
    ),
  );
  let timer: ReturnType<typeof setInterval>;
  let loading = false;
  let refreshAgain = false;
  let alive = true;

  async function refreshSummary() {
    const results = await Promise.allSettled([
      api(base.value + '/checklist'),
      api(base.value + '/expenses'),
      api(base.value + '/members'),
    ]);
    if (!alive) return;
    if (results[0].status === 'fulfilled' && Array.isArray(results[0].value.data))
      checklist.value = results[0].value.data;
    if (results[1].status === 'fulfilled' && typeof results[1].value.total === 'number')
      expenses.value = results[1].value;
    if (results[2].status === 'fulfilled' && Array.isArray(results[2].value.data))
      members.value = results[2].value.data;
    summaryReady.value = results.every((result) => result.status === 'fulfilled');
  }

  const inviteStatus = (invite: any) =>
    invite.status === 'PENDING' && new Date(invite.expiresAt).getTime() < Date.now()
      ? '만료'
      : (
          {
            PENDING: '대기',
            ACCEPTED: '수락 완료',
            DECLINED: '거절',
            REVOKED: '취소',
          } as Record<string, string>
        )[invite.status];

  async function refresh() {
    if (!alive || !tab.value || document.hidden) return;
    if (loading) {
      refreshAgain = true;
      return;
    }
    loading = true;
    try {
      const current = tab.value;
      const path = {
        checklist: '/checklist',
        expenses: '/expenses',
        chat: '/messages',
        share: '/members',
      }[current];
      if (!path) return;
      const data = await api(base.value + path);
      if (!alive || current !== tab.value) return;
      if (current === 'checklist') checklist.value = data.data;
      if (current === 'expenses') expenses.value = data;
      if (current === 'chat') {
        const element = chatLog.value;
        const follow =
          !messages.value.length ||
          (!!element && element.scrollHeight - element.scrollTop - element.clientHeight < 80);
        messages.value = data.data;
        if (!older.value.length) hasMore.value = data.hasMore;
        if (follow) {
          await nextTick();
          if (chatLog.value) chatLog.value.scrollTop = chatLog.value.scrollHeight;
        }
      }
      if (current === 'share') {
        members.value = data.data;
        if (props.isOwner) invites.value = (await api(base.value + '/invitations')).data;
      }
    } catch (cause: any) {
      if (alive) error.value = cause.message;
    } finally {
      loading = false;
      if (refreshAgain) {
        refreshAgain = false;
        void refresh();
      }
    }
  }

  async function open(value: string) {
    tab.value = tab.value === value ? '' : value;
    error.value = '';
    if (!tab.value) return;
    try {
      members.value = (await api(base.value + '/members')).data;
      if (!payer.value) payer.value = state.user!.id;
      if (tab.value === 'expenses' && !participants.value.length)
        participants.value = members.value.map((member) => member.id);
      await refresh();
    } catch (cause: any) {
      error.value = cause.message;
    }
  }

  async function mutate(path: string, method: string, body?: unknown) {
    if (busy.value) return false;
    busy.value = true;
    error.value = '';
    try {
      await api(base.value + path, body === undefined ? { method } : json(method, body));
      await refresh();
      return true;
    } catch (cause: any) {
      error.value = cause.message;
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function addTask() {
    if (await mutate('/checklist', 'POST', { label: task.value })) task.value = '';
  }

  async function send() {
    if (await mutate('/messages', 'POST', { body: message.value })) message.value = '';
  }

  async function invite(link = false) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      const result = await api(
        base.value + '/invitations',
        json('POST', link ? {} : { email: email.value.trim().toLowerCase() }),
      );
      shareUrl.value = location.origin + result.path;
      email.value = '';
      await refresh();
      notify(
        link
          ? '한 사람이 수락할 수 있는 초대 링크를 만들었어요.'
          : '해당 이메일 계정의 알림함에 초대장을 보냈어요.',
      );
    } catch (cause: any) {
      error.value = cause.message;
    } finally {
      busy.value = false;
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      notify('초대 링크를 복사했어요.');
    } catch {
      notify('아래 링크를 직접 선택해 복사해주세요.');
    }
  }

  async function more() {
    if (busy.value) return;
    busy.value = true;
    try {
      const first = older.value[0] || messages.value[0];
      const result = await api(base.value + '/messages?before=' + encodeURIComponent(first.id));
      older.value = [...result.data, ...older.value];
      hasMore.value = result.hasMore;
    } catch (cause: any) {
      error.value = cause.message;
    } finally {
      busy.value = false;
    }
  }

  const allMessages = computed(() => [
    ...new Map([...older.value, ...messages.value].map((item) => [item.id, item])).values(),
  ]);

  onMounted(() => {
    void refreshSummary();
    timer = setInterval(() => {
      if (tab.value) void refresh();
    }, 6000);
  });
  watch(
    () => props.budgetRevision,
    () => void refreshSummary(),
  );
  onBeforeUnmount(() => {
    alive = false;
    clearInterval(timer);
  });

  return {
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
    participants,
    payer,
    progress,
    refresh,
    send,
    shareUrl,
    state,
    summaryReady,
    tab,
    task,
  };
}
