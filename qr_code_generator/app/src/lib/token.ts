import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import type { DB } from "../db/client";
import { urlMappings } from "../db/schema";

const TOKEN_LENGTH = 8;
const URL_SAFE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

const defaultNanoid = customAlphabet(URL_SAFE_ALPHABET, TOKEN_LENGTH);

export interface GenerateTokenOptions {
  maxRetries?: number;
  nanoidImpl?: () => string;
}

/**
 * Generate a unique 8-char URL-safe token. Uses SELECT to detect collisions
 * (intentionally not relying on INSERT unique-violation, so the caller owns
 * the INSERT). Retries without sleep up to `maxRetries` times.
 */
export async function generateToken(db: DB, opts: GenerateTokenOptions = {}): Promise<string> {
  const maxRetries = opts.maxRetries ?? 3;
  const nanoid = opts.nanoidImpl ?? defaultNanoid;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const candidate = nanoid();
    const existing = await db
      .select({ token: urlMappings.token })
      .from(urlMappings)
      .where(eq(urlMappings.token, candidate))
      .limit(1);
    if (existing.length === 0) {
      return candidate;
    }
  }

  throw new Error("Token collision: exhausted retries");
}
