export const ACCESS_REQUIRED_EVENT = 'canopy:access-required';
export const ACCESS_REQUIRED_MESSAGE = 'Your access session ended. Sign in again to resume live updates.';
export class AccessRequiredError extends Error {
  constructor() { super(ACCESS_REQUIRED_MESSAGE); this.name = 'AccessRequiredError'; }
}
function requireAccess(): never {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACCESS_REQUIRED_EVENT));
  throw new AccessRequiredError();
}
export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(12000);
  let response: Response;
  try {
    // Stop expired-session redirects before the browser blocks a cross-origin login fetch.
    response = await fetch(path, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, credentials: 'same-origin', cache: 'no-store', redirect: 'manual' });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('You’re offline. Reconnect to resume live updates.');
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error('The server took too long to respond. Retrying…');
    throw new Error('Couldn’t reach your server. Check your connection, then retry.');
  }
  if (signal?.aborted) throw signal.reason;
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400) || response.status === 401 || response.status === 428) requireAccess();
  if (!response.headers.get('content-type')?.includes('application/json')) {
    if (response.ok || response.status === 403) requireAccess();
    throw new Error('The server is temporarily unavailable. Retrying…');
  }
  const value = await response.json();
  if (!response.ok) throw new Error(value.detail || 'The server could not complete this read.');
  return value as T;
}
export function query(path: string, values: Record<string, string | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value));
  return `${path}?${params}`;
}
export function bytes(value: number | null | undefined, precision = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.max(0, Math.min(4, Math.floor(Math.log(Math.abs(value)) / Math.log(1024))));
  return `${(value / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: index ? precision : 0 })} ${units[index]}`;
}
export const percent = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1).replace(/\.0$/, '')}%`;
export function duration(value: number | null | undefined) {
  if (value == null) return '—';
  const seconds = Math.max(0, Math.floor(value));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
}
export const clock = (timestamp: number) => new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
