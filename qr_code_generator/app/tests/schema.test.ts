import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { scanEvents, urlMappings } from "../src/db/schema";
import { createTestDb } from "../src/db/test-db";

describe("urlMappings schema", () => {
  test("token unique constraint rejects duplicate inserts", async () => {
    const db = createTestDb();
    await db.insert(urlMappings).values({
      token: "DUPETOKE",
      originalUrl: "https://example.com/a",
    });
    expect(async () => {
      await db.insert(urlMappings).values({
        token: "DUPETOKE",
        originalUrl: "https://example.com/b",
      });
    }).toThrow();
  });

  test("createdAt and updatedAt populated by default", async () => {
    const db = createTestDb();
    // SQLite `unixepoch()` is second-precision; allow 1s slack on either side.
    const before = Date.now() - 1000;
    await db.insert(urlMappings).values({
      token: "TIMESTMP",
      originalUrl: "https://example.com",
    });
    const after = Date.now() + 1000;
    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, "TIMESTMP"));
    const row = rows[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.createdAt.getTime()).toBeLessThanOrEqual(after);
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.updatedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test("isDeleted defaults to false; expiresAt defaults to null", async () => {
    const db = createTestDb();
    await db.insert(urlMappings).values({
      token: "DEFAULT1",
      originalUrl: "https://example.com",
    });
    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, "DEFAULT1"));
    expect(rows[0]?.isDeleted).toBe(false);
    expect(rows[0]?.expiresAt).toBeNull();
  });
});

describe("scanEvents schema", () => {
  test("insert + select returns event with timestamp", async () => {
    const db = createTestDb();
    // SQLite `unixepoch()` is second-precision; allow 1s slack on either side.
    const before = Date.now() - 1000;
    await db.insert(scanEvents).values({
      token: "SCANEVTA",
      userAgent: "test-agent/1.0",
      ipAddress: "127.0.0.1",
    });
    const after = Date.now() + 1000;
    const rows = await db.select().from(scanEvents).where(eq(scanEvents.token, "SCANEVTA"));
    expect(rows.length).toBe(1);
    const row = rows[0];
    if (!row) return;
    expect(row.userAgent).toBe("test-agent/1.0");
    expect(row.ipAddress).toBe("127.0.0.1");
    expect(row.scannedAt).toBeInstanceOf(Date);
    expect(row.scannedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.scannedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test("userAgent and ipAddress nullable", async () => {
    const db = createTestDb();
    await db.insert(scanEvents).values({
      token: "SCANEVTB",
    });
    const rows = await db.select().from(scanEvents).where(eq(scanEvents.token, "SCANEVTB"));
    expect(rows[0]?.userAgent).toBeNull();
    expect(rows[0]?.ipAddress).toBeNull();
  });
});
