import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { BASE_URL } from "../config";
import type { DB } from "../db/client";
import { scanEvents, urlMappings } from "../db/schema";
import type { Cache } from "../lib/cache";
import { NotFoundError, ValidationError } from "../lib/errors";
import { qrPng } from "../lib/qr";
import { generateToken } from "../lib/token";
import { validateUrl } from "../lib/url";

const createSchema = z.object({
  url: z.string().min(1),
  expires_at: z.string().datetime().optional(),
});

// PATCH must update at least one field. zod's default error path returns 400,
// but our SPEC wants 422 for "shape parsed but semantically empty" — so we
// keep the schema permissive and enforce non-empty in the handler, throwing
// ValidationError (→ 422 via errorHandler).
const patchSchema = z.object({
  url: z.string().min(1).optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

function shortUrl(token: string) {
  return `${BASE_URL}/r/${token}`;
}
function qrCodeUrl(token: string) {
  return `${BASE_URL}/api/qr/${token}/image`;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

/**
 * `generateToken` checks via SELECT, but two concurrent creators can both
 * pass that check and race the INSERT. The DB unique constraint catches it
 * — we just need to retry with a fresh token. One retry is enough; if it
 * happens twice in a row something else is wrong.
 *
 * Exported so unit tests can inject `tokenFactory` to deterministically
 * exercise the retry path.
 */
export async function insertWithFreshToken(
  db: DB,
  originalUrl: string,
  expiresAt: Date | null,
  tokenFactory: () => Promise<string> = () => generateToken(db),
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await tokenFactory();
    try {
      await db.insert(urlMappings).values({ token, originalUrl, expiresAt });
      return token;
    } catch (err) {
      if (attempt === 1 || !isUniqueViolation(err)) throw err;
    }
  }
  throw new Error("insertWithFreshToken: unreachable");
}

export function createQrRoutes(db: DB, cache: Cache) {
  const routes = new Hono();

  routes.post("/create", zValidator("json", createSchema), async (c) => {
    const { url, expires_at } = c.req.valid("json");

    const normalized = validateUrl(url);
    // Canonicalise expires_at once so DB / cache / response all agree on
    // the same UTC ISO string. Avoids "POST echoes user input but GET
    // returns toISOString()" drift.
    const expiresAtDate = expires_at ? new Date(expires_at) : null;
    const expiresAtIso = expiresAtDate ? expiresAtDate.toISOString() : null;

    const token = await insertWithFreshToken(db, normalized, expiresAtDate);

    cache.set(token, { url: normalized, expiresAt: expiresAtIso });

    return c.json({
      token,
      short_url: shortUrl(token),
      qr_code_url: qrCodeUrl(token),
      original_url: normalized,
      expires_at: expiresAtIso,
    });
  });

  routes.get("/:token", async (c) => {
    const token = c.req.param("token");
    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, token)).limit(1);
    const row = rows[0];
    if (!row || row.isDeleted) {
      throw new NotFoundError("Token not found");
    }
    return c.json(toMetadataResponse(row));
  });

  routes.patch("/:token", zValidator("json", patchSchema), async (c) => {
    const token = c.req.param("token");
    const { url, expires_at } = c.req.valid("json");

    if (url === undefined && expires_at === undefined) {
      throw new ValidationError("Must provide at least one of url, expires_at");
    }

    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, token)).limit(1);
    const row = rows[0];
    if (!row || row.isDeleted) {
      throw new NotFoundError("Token not found");
    }

    // Build the partial update. `updatedAt` is bumped via Drizzle's
    // `$onUpdate` on the schema, so we don't set it explicitly.
    const patch: Partial<typeof urlMappings.$inferInsert> = {};
    if (url !== undefined) {
      patch.originalUrl = validateUrl(url);
    }
    if (expires_at !== undefined) {
      patch.expiresAt = expires_at === null ? null : new Date(expires_at);
    }

    await db.update(urlMappings).set(patch).where(eq(urlMappings.token, token));
    cache.invalidate(token);

    const refreshed = await db
      .select()
      .from(urlMappings)
      .where(eq(urlMappings.token, token))
      .limit(1);
    const updated = refreshed[0];
    if (!updated) {
      // Should never happen — we just updated the row in the same connection.
      throw new NotFoundError("Token not found");
    }
    return c.json(toMetadataResponse(updated));
  });

  routes.get("/:token/analytics", async (c) => {
    const token = c.req.param("token");
    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, token)).limit(1);
    const row = rows[0];
    // Deleted → 404. Expired → still 200 (campaign analytics still useful
    // after the link itself stops resolving).
    if (!row || row.isDeleted) {
      throw new NotFoundError("Token not found");
    }

    const events = await db
      .select({ scannedAt: scanEvents.scannedAt })
      .from(scanEvents)
      .where(eq(scanEvents.token, token));

    // Bucket in-memory by UTC YYYY-MM-DD. At prototype scale this beats
    // pushing a SQLite-specific `strftime(... 'unixepoch')` into the query;
    // we revisit if event volume per token grows beyond a single page.
    const dayCounts = new Map<string, number>();
    for (const ev of events) {
      const day = ev.scannedAt.toISOString().slice(0, 10);
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }
    const scans_by_day = [...dayCounts.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return c.json({
      token,
      total_scans: events.length,
      scans_by_day,
    });
  });

  routes.get("/:token/image", async (c) => {
    const token = c.req.param("token");
    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, token)).limit(1);
    const row = rows[0];
    // Deleted → 404. Expired → still 200 + PNG (users may want to view their
    // own past QR codes after a campaign ends).
    if (!row || row.isDeleted) {
      throw new NotFoundError("Token not found");
    }
    const png = await qrPng(shortUrl(token));
    // Use the standard Response constructor — Hono's `c.body()` typings reject
    // Node `Buffer` (Buffer<ArrayBufferLike> ≠ Uint8Array<ArrayBuffer>), but
    // the underlying runtime accepts BodyInit including Buffer just fine.
    return new Response(png, {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  });

  routes.delete("/:token", async (c) => {
    const token = c.req.param("token");
    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, token)).limit(1);
    const row = rows[0];
    if (!row || row.isDeleted) {
      throw new NotFoundError("Token not found");
    }
    await db.update(urlMappings).set({ isDeleted: true }).where(eq(urlMappings.token, token));
    cache.invalidate(token);
    return c.json({ token, deleted: true });
  });

  return routes;
}

function toMetadataResponse(row: typeof urlMappings.$inferSelect) {
  return {
    token: row.token,
    original_url: row.originalUrl,
    short_url: shortUrl(row.token),
    qr_code_url: qrCodeUrl(row.token),
    expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
