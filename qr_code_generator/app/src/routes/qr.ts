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

export function createQrRoutes(db: DB, cache: Cache) {
  const routes = new Hono();

  routes.post("/create", zValidator("json", createSchema), async (c) => {
    const { url, expires_at } = c.req.valid("json");

    const normalized = validateUrl(url);
    const token = await generateToken(db);

    await db.insert(urlMappings).values({
      token,
      originalUrl: normalized,
      expiresAt: expires_at ? new Date(expires_at) : null,
    });

    cache.set(token, { url: normalized, expiresAt: expires_at ?? null });

    return c.json({
      token,
      short_url: shortUrl(token),
      qr_code_url: qrCodeUrl(token),
      original_url: normalized,
      expires_at: expires_at ?? null,
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
