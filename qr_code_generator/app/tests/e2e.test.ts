import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { BASE_URL } from "../src/config";
import { urlMappings } from "../src/db/schema";
import { createTestDb } from "../src/db/test-db";

interface CreateResponse {
  token: string;
  short_url: string;
  qr_code_url: string;
  original_url: string;
  expires_at: string | null;
}

interface InfoResponse {
  token: string;
  original_url: string;
  short_url: string;
  qr_code_url: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

async function createQr(
  app: ReturnType<typeof createApp>,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.fetch(
    new Request("http://localhost/api/qr/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("PROMPT verification curl #1: POST /api/qr/create", () => {
  test("returns 200 with token + short_url + qr_code_url + original_url", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await createQr(app, { url: "https://example.com" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CreateResponse;
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(body.original_url).toBe("https://example.com/");
    expect(body.short_url).toBe(`${BASE_URL}/r/${body.token}`);
    expect(body.qr_code_url).toBe(`${BASE_URL}/api/qr/${body.token}/image`);
    expect(body.expires_at).toBeNull();
  });

  test("normalizes input URL before persisting", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await createQr(app, { url: "HTTP://Example.COM:80/Foo" });
    const body = (await res.json()) as CreateResponse;
    expect(body.original_url).toBe("http://example.com/Foo");
  });

  test("accepts expires_at and echoes it back", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await createQr(app, { url: "https://example.com", expires_at: future });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CreateResponse;
    expect(body.expires_at).toBe(future);
  });

  test("expires_at is canonicalised to UTC ISO; POST and GET return same string", async () => {
    const db = createTestDb();
    const app = createApp(db);
    // Input has no millisecond component; without canonicalisation, POST
    // would echo "...:00Z" while GET (reads Date and toISOString()s) would
    // return "...:00.000Z". They must agree.
    const inputIso = "2030-01-01T02:00:00Z";
    const expectedUtc = new Date(inputIso).toISOString(); // "2030-01-01T02:00:00.000Z"
    expect(expectedUtc).not.toBe(inputIso); // sanity: drift would exist without fix

    const created = (await (
      await createQr(app, { url: "https://example.com", expires_at: inputIso })
    ).json()) as CreateResponse;
    expect(created.expires_at).toBe(expectedUtc);

    const info = (await (
      await app.fetch(new Request(`http://localhost/api/qr/${created.token}`))
    ).json()) as InfoResponse;
    expect(info.expires_at).toBe(expectedUtc);
  });

  test("rejects invalid URL with 422", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await createQr(app, { url: "javascript:alert(1)" });
    expect(res.status).toBe(422);
  });

  test("rejects blocked domain with 422", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await createQr(app, { url: "https://evil.com/" });
    expect(res.status).toBe(422);
  });

  test("rejects missing url body with 400 (zod)", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await app.fetch(
      new Request("http://localhost/api/qr/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("PROMPT verification curl #2: GET /r/:token", () => {
  test("returns 302 redirect to original URL", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    const res = await app.fetch(new Request(`http://localhost/r/${created.token}`), {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/");
  });

  test("returns 404 for unknown token (curl #8 happy slice)", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await app.fetch(new Request("http://localhost/r/INVALID0"));
    expect(res.status).toBe(404);
  });
});

describe("PROMPT verification curl #3: GET /api/qr/:token", () => {
  test("returns metadata with all snake_case fields", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    const res = await app.fetch(new Request(`http://localhost/api/qr/${created.token}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as InfoResponse;
    expect(body.token).toBe(created.token);
    expect(body.original_url).toBe("https://example.com/");
    expect(body.short_url).toBe(`${BASE_URL}/r/${created.token}`);
    expect(body.qr_code_url).toBe(`${BASE_URL}/api/qr/${created.token}/image`);
    expect(body.expires_at).toBeNull();
    expect(typeof body.created_at).toBe("string");
    expect(typeof body.updated_at).toBe("string");
    // ISO 8601
    expect(new Date(body.created_at).toString()).not.toBe("Invalid Date");
    expect(new Date(body.updated_at).toString()).not.toBe("Invalid Date");
  });

  test("returns 404 for unknown token", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await app.fetch(new Request("http://localhost/api/qr/UNKNOWN0"));
    expect(res.status).toBe(404);
  });
});

describe("Cold cache → DB hit warms cache (extra)", () => {
  test("row inserted directly into DB (cache cold) → /r/:token 302 + warms cache", async () => {
    const db = createTestDb();
    const app = createApp(db);

    // Bypass POST so the cache is *not* pre-warmed.
    await db.insert(urlMappings).values({
      token: "COLDPATH",
      originalUrl: "https://cold.example.com/",
    });

    // First request must hit DB and warm the cache.
    const first = await app.fetch(new Request("http://localhost/r/COLDPATH"));
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("https://cold.example.com/");

    // Hard-delete the row; if cache was warmed, the next request still 302s.
    await db.delete(urlMappings).where(eq(urlMappings.token, "COLDPATH"));
    const second = await app.fetch(new Request("http://localhost/r/COLDPATH"));
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toBe("https://cold.example.com/");
  });
});

describe("Cache hit verification (extra)", () => {
  test("redirect still 302 after DB row deleted (proves cache served the response)", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    // Warm cache via first redirect (would be already warm from POST, but be explicit)
    const first = await app.fetch(new Request(`http://localhost/r/${created.token}`));
    expect(first.status).toBe(302);

    // Hard-delete the DB row — cache is the only remaining source of truth.
    await db.delete(urlMappings).where(eq(urlMappings.token, created.token));

    const second = await app.fetch(new Request(`http://localhost/r/${created.token}`));
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toBe("https://example.com/");
  });
});
