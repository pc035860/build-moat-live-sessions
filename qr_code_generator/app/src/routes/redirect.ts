import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { DB } from "../db/client";
import { urlMappings } from "../db/schema";
import type { Cache } from "../lib/cache";
import { NotFoundError } from "../lib/errors";

/**
 * Redirect router for `/r/:token`. Phase 2 implements the happy path:
 * cache hit → 302; cache miss → DB lookup → 302 + warm cache; otherwise
 * 404. `is_deleted` and `expires_at` handling is added in Task 8.
 */
export function createRedirectRoutes(db: DB, cache: Cache) {
  const routes = new Hono();

  routes.get("/:token", async (c) => {
    const token = c.req.param("token");

    const cached = cache.get(token);
    if (cached) {
      return c.redirect(cached.url, 302);
    }

    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, token)).limit(1);
    const row = rows[0];
    if (!row || row.isDeleted) {
      throw new NotFoundError("Token not found");
    }

    cache.set(token, {
      url: row.originalUrl,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    });
    return c.redirect(row.originalUrl, 302);
  });

  return routes;
}
