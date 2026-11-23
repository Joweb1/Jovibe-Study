import { auth } from '../firebase/config';

export interface LiveQuotaSnapshot {
  used: number;
  limit: number;
  remaining: number;
  resetAtIso?: string;
}

type QuotaListener = (snapshot: LiveQuotaSnapshot) => void;
const quotaListeners = new Set<QuotaListener>();

export function emitQuotaSnapshot(snapshot: LiveQuotaSnapshot): void {
  for (const listener of quotaListeners) {
    try {
      listener(snapshot);
    } catch {
      // Never break AI calls from UI listener errors
    }
  }
}

export function subscribeQuotaSnapshot(listener: QuotaListener): () => void {
  quotaListeners.add(listener);
  return () => {
    quotaListeners.delete(listener);
  };
}

export function notifyQuotaFromHeaders(headers: Headers): void {
  const usedRaw = headers.get('x-sotal-quota-used');
  const limitRaw = headers.get('x-sotal-quota-limit');
  const remainingRaw = headers.get('x-sotal-quota-remaining');
  if (usedRaw === null || limitRaw === null || remainingRaw === null) return;

  const used = Number(usedRaw);
  const limit = Number(limitRaw);
  const remaining = Number(remainingRaw);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || !Number.isFinite(remaining)) return;

  emitQuotaSnapshot({
    used,
    limit,
    remaining,
    resetAtIso: headers.get('x-sotal-quota-reset') || undefined,
  });
}

export async function getFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

export async function buildAuthHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  const token = await getFirebaseIdToken(false);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function apiFetchJson<T>(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const headers = await buildAuthHeaders(
    options.body !== undefined ? { 'Content-Type': 'application/json' } : {}
  );
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
  }
  return data;
}
