import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { BASE_URL } from "../config";
import type { DB } from "../db/client";
import { urlMappings } from "../db/schema";
import type { Cache } from "../lib/cache";
import { NotFoundError } from "../lib/errors";
import { generateToken } from "../lib/token";
import { validateUrl } from "../lib/url";

const createSchema = z.object({
  url: z.string().min(1),
  expires_at: z.string().datetime().optional(),
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
    return c.json({
      token: row.token,
      original_url: row.originalUrl,
      short_url: shortUrl(row.token),
      qr_code_url: qrCodeUrl(row.token),
      expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    });
  });

  return routes;
}
