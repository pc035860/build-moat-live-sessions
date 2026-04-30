import { describe, expect, test } from "bun:test";
import { urlMappings } from "../src/db/schema";
import { createTestDb } from "../src/db/test-db";
import { generateToken } from "../src/lib/token";

describe("generateToken", () => {
  test("returns 8-char URL-safe token on first try when no collision", async () => {
    const db = createTestDb();
    const token = await generateToken(db, { nanoidImpl: () => "ABCDEFGH" });
    expect(token).toBe("ABCDEFGH");
    expect(token).toHaveLength(8);
  });

  test("default impl returns 8-char token", async () => {
    const db = createTestDb();
    const token = await generateToken(db);
    expect(token).toHaveLength(8);
    // URL-safe alphabet: A-Za-z0-9_-
    expect(token).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });

  test("retries on collision and returns next non-colliding token", async () => {
    const db = createTestDb();
    await db.insert(urlMappings).values({
      token: "COLLIDE0",
      originalUrl: "https://existing.example.com/",
    });

    const candidates = ["COLLIDE0", "FRESH001"];
    let calls = 0;
    const nanoidImpl = () => {
      const value = candidates[calls] ?? "FALLBACK";
      calls += 1;
      return value;
    };

    const token = await generateToken(db, { nanoidImpl });
    expect(token).toBe("FRESH001");
    expect(calls).toBe(2);
  });

  test("throws after exhausting default 3 retries on persistent collision", async () => {
    const db = createTestDb();
    await db.insert(urlMappings).values({
      token: "PERSIST1",
      originalUrl: "https://existing.example.com/",
    });

    let calls = 0;
    const nanoidImpl = () => {
      calls += 1;
      return "PERSIST1";
    };

    await expect(generateToken(db, { nanoidImpl })).rejects.toThrow(/collision/i);
    expect(calls).toBe(3);
  });

  test("maxRetries=1 fails immediately on first collision", async () => {
    const db = createTestDb();
    await db.insert(urlMappings).values({
      token: "ONESHOT1",
      originalUrl: "https://existing.example.com/",
    });

    let calls = 0;
    const nanoidImpl = () => {
      calls += 1;
      return "ONESHOT1";
    };

    await expect(generateToken(db, { nanoidImpl, maxRetries: 1 })).rejects.toThrow(/collision/i);
    expect(calls).toBe(1);
  });
});
