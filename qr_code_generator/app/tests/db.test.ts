import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { urlMappings } from "../src/db/schema";
import { createTestDb } from "../src/db/test-db";

describe("createTestDb", () => {
  test("isolated in-memory DB allows insert + select", async () => {
    const db = createTestDb();
    await db.insert(urlMappings).values({
      token: "TESTTKN1",
      originalUrl: "https://example.com",
    });
    const rows = await db.select().from(urlMappings).where(eq(urlMappings.token, "TESTTKN1"));
    expect(rows.length).toBe(1);
    expect(rows[0]?.originalUrl).toBe("https://example.com");
    expect(rows[0]?.isDeleted).toBe(false);
  });

  test("each createTestDb() is independent", async () => {
    const db1 = createTestDb();
    const db2 = createTestDb();
    await db1.insert(urlMappings).values({
      token: "ONLYDB1A",
      originalUrl: "https://a.example.com",
    });
    const inDb2 = await db2.select().from(urlMappings).where(eq(urlMappings.token, "ONLYDB1A"));
    expect(inDb2.length).toBe(0);
  });
});
