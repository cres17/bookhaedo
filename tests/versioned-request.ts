// Test setup helper: simulate a client loading the day before editing it.
// Concurrency regression tests deliberately use raw requests with stale revisions.
export async function versioned(agent: any, method: string, path: string, payload: any) {
  const match = path.match(
    /^\/api\/trips\/([^/]+)\/days\/([^/]+)\/(?:items|weather-alternatives|day-alternatives)/,
  );
  if (match && payload?.expectedRevision === undefined) {
    const response = await agent.get('/api/trips/' + match[1]);
    const day = response.body?.data?.days?.find((d: any) => d.date === match[2]);
    payload = { ...payload, expectedRevision: day?.revision ?? 0 };
  }
  return agent[method](path).send(payload);
}
