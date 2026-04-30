import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { urlMappings } from "../src/db/schema";
import { createTestDb } from "../src/db/test-db";
import { insertWithFreshToken } from "../src/routes/qr";

describe("insertWithFreshToken", () => {
  test("inserts on first try when token is unique", async () => {
    const db = createTestDb();
    const tokenFactory = async () => "FRESHTOK";
    const token = await insertWithFreshToken(db, "https://example.com/", null, tokenFactory);
    expect(token).toBe("FRESHTOK");
    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, "FRESHTOK"));
    expect(rows).toHaveLength(1);
  });

  test("retries once on UNIQUE collision (simulates SELECT-INSERT race)", async () => {
    const db = createTestDb();
    // Pre-seed the row that will cause the first INSERT to violate UNIQUE.
    await db.insert(urlMappings).values({
      token: "RACETOK1",
      originalUrl: "https://existing.example.com/",
    });

    const candidates = ["RACETOK1", "RETRYTOK"];
    let calls = 0;
    const tokenFactory = async () => {
      const value = candidates[calls] ?? "FALLBACK";
      calls += 1;
      return value;
    };

    const token = await insertWithFreshToken(db, "https://example.com/", null, tokenFactory);
    expect(token).toBe("RETRYTOK");
    expect(calls).toBe(2);
  });

  test("throws when the retry also collides", async () => {
    const db = createTestDb();
    await db.insert(urlMappings).values({
      token: "PERSIST2",
      originalUrl: "https://existing.example.com/",
    });

    const tokenFactory = async () => "PERSIST2";
    await expect(
      insertWithFreshToken(db, "https://example.com/", null, tokenFactory),
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("non-UNIQUE errors are not swallowed", async () => {
    const db = createTestDb();
    const tokenFactory = async () => {
      throw new Error("nanoid blew up");
    };
    await expect(
      insertWithFreshToken(db, "https://example.com/", null, tokenFactory),
    ).rejects.toThrow(/nanoid blew up/);
  });

  test("persists expiresAt when provided", async () => {
    const db = createTestDb();
    const expiresAt = new Date("2030-01-01T02:00:00.000Z");
    const tokenFactory = async () => "WITHEXP1";
    await insertWithFreshToken(db, "https://example.com/", expiresAt, tokenFactory);
    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, "WITHEXP1"));
    expect(rows[0]?.expiresAt?.getTime()).toBe(expiresAt.getTime());
  });
});
