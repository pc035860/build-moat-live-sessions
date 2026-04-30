export interface CacheEntry {
  url: string;
  expiresAt: string | null;
}

export interface Cache {
  get(token: string): CacheEntry | undefined;
  set(token: string, entry: CacheEntry): void;
  invalidate(token: string): void;
  clear(): void;
}

/**
 * In-process Map cache for redirect hot path. Dumb storage by design:
 * `get` does NOT check expiration; the redirect handler owns expiry logic
 * and calls `invalidate` when an entry is past its expiresAt or after a
 * mutating route updates the underlying row.
 */
export function createCache(): Cache {
  const store = new Map<string, CacheEntry>();
  return {
    get(token) {
      return store.get(token);
    },
    set(token, entry) {
      store.set(token, entry);
    },
    invalidate(token) {
      store.delete(token);
    },
    clear() {
      store.clear();
    },
  };
}
