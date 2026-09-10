<script setup lang="ts">
import { ref } from 'vue';
import { api, json } from '../api';
import { state, selectTrip, notify } from '../store';
import Icon from './Icon.vue';
const props = defineProps<{
  trip: { id: string; title: string; transportMode: string; isOwner?: boolean };
}>();
const emit = defineEmits<{ changed: []; deleted: [] }>();
const action = ref(''),
  title = ref(''),
  busy = ref(false),
  error = ref('');
function choose(kind: string) {
  action.value = kind;
  title.value = props.trip.title;
  error.value = '';
}
async function save() {
  busy.value = true;
  try {
    if (action.value === 'delete') {
      await api('/trips/' + props.trip.id, { method: 'DELETE' });
      if (state.activeTrip === props.trip.id) selectTrip('', '');
      action.value = '';
      notify('여행과 종속 일정을 삭제했어요. 장소 정보는 유지됩니다.');
      emit('deleted');
    } else {
      await api(
        '/trips/' + props.trip.id,
        json('PATCH', { title: title.value, transportMode: props.trip.transportMode }),
      );
      action.value = '';
      emit('changed');
    }
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <details class="trip-menu">
    <summary :aria-label="trip.title + ' 여행 메뉴'">
      <span aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </summary>
    <div class="trip-menu-popover">
      <button @click="choose('rename')">
        <Icon name="user" :size="16" />
        여행 이름 수정
      </button>
      <button v-if="trip.isOwner !== false" class="danger" @click="choose('delete')">
        <Icon name="trash" :size="16" />
        여행 삭제
      </button>
    </div>
  </details>
  <Teleport to="body">
    <div v-if="action" class="modal-backdrop" @click.self="!busy && (action = '')">
      <section
        class="modal"
        v-dialog
        role="dialog"
        aria-modal="true"
        :aria-label="action === 'delete' ? '여행 삭제 확인' : '여행 이름 수정'"
      >
        <button
          class="icon-button modal-close"
          type="button"
          aria-label="닫기"
          :disabled="busy"
          @click="action = ''"
        >
          <Icon name="close" />
        </button>
        <h2>{{ action === 'delete' ? '이 여행을 삭제할까요?' : '여행 이름 수정' }}</h2>
        <p v-if="action === 'delete'">
          “{{ trip.title }}”의 날짜·장소 순서·메모·예산·체크리스트·초대·채팅·정산이 삭제되며
          동행자도 더 이상 접근할 수 없습니다. 되돌릴 수 없습니다. 다른 여행과 장소 기본정보는
          남습니다.
        </p>
        <form @submit.prevent="save">
          <label v-if="action === 'rename'">
            여행 이름
            <input v-model="title" required maxlength="100" />
          </label>
          <p v-if="error" role="alert" class="form-error">{{ error }}</p>
          <div class="trip-modal-actions">
            <button type="button" class="button subtle" :disabled="busy" @click="action = ''">
              취소
            </button>
            <button class="button dark" :disabled="busy">
              {{ busy ? '처리 중…' : action === 'delete' ? '여행 삭제' : '저장' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.trip-menu {
  position: absolute;
  right: 18px;
  top: 18px;
  z-index: 5;
  width: 40px;
  height: 40px;
}
.trip-menu summary {
  list-style: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid #ffffffa8;
  border-radius: 12px;
  background: #ffffffd9;
  backdrop-filter: blur(12px);
  box-shadow: 0 5px 18px #35415d14;
  cursor: pointer;
  transition: 0.2s;
}
.trip-menu summary::-webkit-details-marker {
  display: none;
}
.trip-menu summary:hover,
.trip-menu[open] summary {
  background: #fff;
  transform: translateY(-1px);
}
.trip-menu summary > span {
  display: flex;
  gap: 3px;
}
.trip-menu summary i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #536078;
}
.trip-menu-popover {
  position: absolute;
  right: 0;
  top: 48px;
  width: 174px;
  padding: 7px;
  border: 1px solid #e1e5ec;
  border-radius: 13px;
  background: #fff;
  box-shadow: 0 18px 45px #29344e2b;
}
.trip-menu-popover button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px 12px;
  border-radius: 9px;
  color: #59657b;
  font-size: 12px;
  text-align: left;
}
.trip-menu-popover button:hover {
  background: #f1f3f7;
}
.trip-menu-popover button.danger {
  color: #ad4654;
}
.trip-menu-popover button.danger:hover {
  background: #fff0f1;
}
.trip-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
.trip-modal-actions .button {
  margin-top: 8px;
}
@media (max-width: 650px) {
  .trip-menu {
    right: 14px;
    top: 14px;
  }
  .trip-menu-popover {
    width: 165px;
  }
}
</style>
