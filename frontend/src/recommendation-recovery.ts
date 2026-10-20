import { reactive } from 'vue';
export type RecoveryContext = { userId: string; tripId: string; date: string };
type Command = RecoveryContext & { commandId: string };
type Entry = {
  tripId: string;
  date: string;
  commandId: string;
  status: 'saving' | 'unknown' | 'checking';
};
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const prefix = 'bookhaedo-course-recovery:v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valid = (entry: Entry) =>
  uuid.test(entry.tripId) && uuid.test(entry.commandId) && /^\d{4}-\d{2}-\d{2}$/.test(entry.date);
export function createRecommendationRecovery(storage?: StoragePort) {
  const entries = reactive(new Map<string, Entry>());
  const successes = reactive(new Map<string, number>());
  const hydrated = new Set<string>();
  const key = (context: RecoveryContext) => `${context.userId}|${context.tripId}|${context.date}`;
  function hydrate(userId: string) {
    if (!uuid.test(userId) || hydrated.has(userId)) return;
    hydrated.add(userId);
    try {
      const saved: unknown = JSON.parse(storage?.getItem(prefix + userId) || '[]');
      if (!Array.isArray(saved)) return;
      for (const raw of saved) {
        if (!raw || typeof raw !== 'object') continue;
        const entry = raw as Entry;
        if (
          typeof entry.tripId !== 'string' ||
          typeof entry.date !== 'string' ||
          typeof entry.commandId !== 'string' ||
          !valid(entry)
        )
          continue;
        // After page reload, a previous in-flight request has an unknown result.
        entries.set(key({ userId, tripId: entry.tripId, date: entry.date }), {
          tripId: entry.tripId,
          date: entry.date,
          commandId: entry.commandId,
          status: 'unknown',
        });
      }
    } catch {
      /* Unavailable storage never prevents in-memory recovery. */
    }
  }
  function persist(userId: string) {
    const saved = [...entries.entries()]
      .filter(([id]) => id.startsWith(userId + '|'))
      .map(([, entry]) => ({ tripId: entry.tripId, date: entry.date, commandId: entry.commandId }));
    try {
      if (saved.length) storage?.setItem(prefix + userId, JSON.stringify(saved));
      else storage?.removeItem(prefix + userId);
    } catch {
      /* Keep the live tab's state if browser storage is denied or full. */
    }
  }
  function get(context: RecoveryContext) {
    hydrate(context.userId);
    return entries.get(key(context));
  }
  function begin(context: RecoveryContext): Command | undefined {
    if (!uuid.test(context.userId) || !uuid.test(context.tripId) || get(context)) return;
    const command = { ...context, commandId: crypto.randomUUID() };
    entries.set(key(context), {
      tripId: context.tripId,
      date: context.date,
      commandId: command.commandId,
      status: 'saving',
    });
    persist(context.userId);
    return command;
  }
  function unknown(command: Command) {
    const entry = get(command);
    if (entry?.commandId !== command.commandId) return;
    entries.set(key(command), { ...entry, status: 'unknown' });
    persist(command.userId);
  }
  function complete(command: Command) {
    if (get(command)?.commandId !== command.commandId) return;
    entries.delete(key(command));
    persist(command.userId);
  }
  function successVersion(context: Pick<RecoveryContext, 'userId' | 'tripId'>) {
    return successes.get(`${context.userId}|${context.tripId}`) || 0;
  }
  function succeeded(command: Command) {
    if (get(command)?.commandId !== command.commandId) return;
    complete(command);
    // Notify the current trip screen even if the originating panel/day is gone.
    successes.set(`${command.userId}|${command.tripId}`, successVersion(command) + 1);
  }
  function check(context: RecoveryContext): Command | undefined {
    const entry = get(context);
    if (entry?.status !== 'unknown') return;
    entries.set(key(context), { ...entry, status: 'checking' });
    return { ...context, commandId: entry.commandId };
  }
  return { get, begin, unknown, complete, succeeded, successVersion, check };
}
let storage: StoragePort | undefined;
try {
  storage = typeof window === 'undefined' ? undefined : window.sessionStorage;
} catch {
  /* Use memory only. */
}
export const recommendationRecovery = createRecommendationRecovery(storage);
