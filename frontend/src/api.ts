export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('bookhaedo:session-expired'));
    throw new ApiError(
      data?.error || '요청을 처리할 수 없습니다.',
      response.status,
      data?.code,
      response.headers.get('X-Request-ID') || undefined,
    );
  }
  if (data === null) throw new ApiError('응답을 읽지 못했습니다. 다시 시도해주세요.', 502);
  return data;
}
export const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
