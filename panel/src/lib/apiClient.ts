/**
 * Reference Frontend API Client Pattern:
 * - Retries strictly limited to idempotent methods (GET, HEAD, OPTIONS) to prevent double-mutations.
 * - SingleFlight refresh mutex (tryRefresh) prevents concurrent 401 refresh storms.
 * - Centralized header construction (buildHeaders) prevents auth/locale drift in downloads/exports.
 */

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

let refreshPromise: Promise<boolean> | null = null;

export function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (typeof localStorage !== 'undefined') {
    const token = localStorage.getItem('auth_token');
    if (token && !headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  return headers;
}

/**
 * Shared refresh token mutex: concurrent 401 responses await the SAME in-flight
 * refresh call instead of racing against rotating refresh tokens.
 */
export async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include'
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      if (data?.token && typeof localStorage !== 'undefined') {
        localStorage.setItem('auth_token', data.token);
      }
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  maxRetries: number = 2
): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const canRetry = IDEMPOTENT_METHODS.has(method);
  const attempts = canRetry ? Math.max(1, maxRetries + 1) : 1;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: buildHeaders(init.headers as Record<string, string> | undefined)
      });

      if (res.status === 401 && i === 0) {
        const refreshed = await tryRefresh();
        if (refreshed) {
          return fetch(url, {
            ...init,
            headers: buildHeaders(init.headers as Record<string, string> | undefined)
          });
        }
      }

      if (!canRetry || res.status < 500 || i === attempts - 1) {
        return res;
      }
    } catch (err) {
      lastError = err;
      if (!canRetry || i === attempts - 1) throw err;
    }

    await new Promise((r) => setTimeout(r, 150 * (i + 1)));
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}
