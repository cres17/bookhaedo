import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { api } from '../api';
import type { Trip } from '../types';

const signature = (trip: Trip) =>
  JSON.stringify([trip.title, trip.transportMode, trip.days.map((day) => [day.id, day.revision])]);

export function useTripSynchronization(
  trip: Ref<Trip | null>,
  saving: Ref<boolean>,
  tripId: () => string,
  onUnavailable: (message: string) => void,
) {
  const remoteChanged = ref(false);
  let timer: ReturnType<typeof setInterval>;
  let checking = false;

  async function check() {
    if (checking || saving.value || document.hidden || !trip.value) return;
    checking = true;
    try {
      const result = await api<{ data: Trip }>('/trips/' + tripId());
      remoteChanged.value = signature(result.data) !== signature(trip.value);
    } catch (error: any) {
      if (error.status === 404 || error.status === 401) onUnavailable(error.message);
    } finally {
      checking = false;
    }
  }

  onMounted(() => {
    timer = setInterval(check, 15_000);
  });
  onBeforeUnmount(() => clearInterval(timer));

  return {
    remoteChanged,
    markSynchronized: () => (remoteChanged.value = false),
  };
}
