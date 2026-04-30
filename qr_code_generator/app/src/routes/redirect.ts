import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { DB } from "../db/client";
import { scanEvents, urlMappings } from "../db/schema";
import type { Cache } from "../lib/cache";
import { GoneError, NotFoundError } from "../lib/errors";

/**
 * Redirect router for `/r/:token`.
 *
 * Branches:
 *   - cache hit, not expired           → 302
 *   - cache hit, expiresAt past        → invalidate + 410
 *   - cache miss, no DB row            → 404
 *   - cache miss, row.isDeleted        → 410
 *   - cache miss, row.expiresAt past   → 410 (DO NOT warm cache)
 *   - cache miss, otherwise            → warm cache + 302
 *
 * Time comparison is UTC: `Date.now()` vs `expiresAt.getTime()`.
 */
export function createRedirectRoutes(db: DB, cache: Cache) {
  const routes = new Hono();

  routes.get("/:token", async (c) => {
    const token = c.req.param("token");

    const cached = cache.get(token);
    if (cached) {
      if (isExpired(cached.expiresAt)) {
        cache.invalidate(token);
        throw new GoneError("Token expired");
      }
      recordScan(db, c, token);
      return c.redirect(cached.url, 302);
    }

    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, token)).limit(1);
    const row = rows[0];
    if (!row) {
      throw new NotFoundError("Token not found");
    }
    if (row.isDeleted) {
      throw new GoneError("Token deleted");
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      // Expired rows are never warmed into cache — keeps the cache "live URLs
      // only" and avoids stale 410-cache entries hanging around.
      throw new GoneError("Token expired");
    }

    cache.set(token, {
      url: row.originalUrl,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    });
    recordScan(db, c, token);
    return c.redirect(row.originalUrl, 302);
  });

  return routes;
}

/**
 * Fire-and-forget scan event write. We MUST NOT await — the 302 latency
 * cannot include an analytics insert. `.catch` swallows write errors so a
 * disk-full / locked DB cannot bubble out and 500 the redirect.
 */
function recordScan(db: DB, c: Context, token: string): void {
  void db
    .insert(scanEvents)
    .values({
      token,
      userAgent: c.req.header("user-agent") ?? null,
      ipAddress: c.req.header("x-forwarded-for") ?? null,
    })
    .catch((err) => console.warn("scan write failed", err));
}

function isExpired(expiresAtIso: string | null): boolean {
  if (!expiresAtIso) return false;
  return new Date(expiresAtIso).getTime() <= Date.now();
}
