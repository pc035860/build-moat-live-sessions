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

async function patchQr(
  app: ReturnType<typeof createApp>,
  token: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/api/qr/${token}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("PATCH /api/qr/:token (Task 7)", () => {
  test("updates url, invalidates cache, redirect reflects new URL", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    // Warm cache.
    await app.fetch(new Request(`http://localhost/r/${created.token}`));

    const res = await patchQr(app, created.token, { url: "https://updated.example.com" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as InfoResponse;
    expect(body.original_url).toBe("https://updated.example.com/");

    const redirect = await app.fetch(new Request(`http://localhost/r/${created.token}`));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://updated.example.com/");
  });

  test("updates expires_at, accepts ISO and null", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await patchQr(app, created.token, { expires_at: future });
    expect(res.status).toBe(200);
    expect(((await res.json()) as InfoResponse).expires_at).toBe(future);

    const cleared = await patchQr(app, created.token, { expires_at: null });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as InfoResponse).expires_at).toBeNull();
  });

  test("PATCH with empty body returns 422 (must update at least one field)", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    const res = await patchQr(app, created.token, {});
    expect(res.status).toBe(422);
  });

  test("returns 404 for unknown token", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await patchQr(app, "MISSING0", { url: "https://example.com" });
    expect(res.status).toBe(404);
  });

  test("returns 422 for invalid url (validateUrl rejects)", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    const res = await patchQr(app, created.token, { url: "javascript:alert(1)" });
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/qr/:token (Task 8)", () => {
  test("soft delete: returns 200, subsequent redirect returns 410", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    // Warm cache so we also exercise invalidation.
    await app.fetch(new Request(`http://localhost/r/${created.token}`));

    const del = await app.fetch(
      new Request(`http://localhost/api/qr/${created.token}`, { method: "DELETE" }),
    );
    expect(del.status).toBe(200);

    const redirect = await app.fetch(new Request(`http://localhost/r/${created.token}`));
    expect(redirect.status).toBe(410);
  });

  test("returns 404 for unknown token", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await app.fetch(
      new Request("http://localhost/api/qr/MISSING0", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
  });

  test("deleted token: GET metadata returns 404 (already covered by Phase 2)", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    await app.fetch(new Request(`http://localhost/api/qr/${created.token}`, { method: "DELETE" }));

    const res = await app.fetch(new Request(`http://localhost/api/qr/${created.token}`));
    expect(res.status).toBe(404);
  });
});

describe("Redirect expiration (Task 8)", () => {
  test("expires_at in past (cache cold) → 410", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const past = new Date(Date.now() - 1_000).toISOString();
    const created = (await (
      await createQr(app, { url: "https://example.com", expires_at: past })
    ).json()) as CreateResponse;

    const res = await app.fetch(new Request(`http://localhost/r/${created.token}`));
    expect(res.status).toBe(410);
  });

  test("PATCH expires_at to past invalidates cache and immediate redirect → 410", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    // Warm cache.
    const first = await app.fetch(new Request(`http://localhost/r/${created.token}`));
    expect(first.status).toBe(302);

    const past = new Date(Date.now() - 1_000).toISOString();
    const patched = await patchQr(app, created.token, { expires_at: past });
    expect(patched.status).toBe(200);

    const after = await app.fetch(new Request(`http://localhost/r/${created.token}`));
    expect(after.status).toBe(410);
  });

  test("cache hit but entry expiresAt is past → 410 + cache invalidated", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    // Warm cache with a future expiry, then mutate DB directly to past — cache
    // still holds the future expiry until a redirect re-evaluates. To exercise
    // the "cache hit but expired" branch we set the cache via POST with a past
    // expiry (POST writes through to cache) — the redirect must read cache and
    // still return 410.
    const past = new Date(Date.now() - 1_000).toISOString();
    const expiringCreated = (await (
      await createQr(app, { url: "https://expired.example.com", expires_at: past })
    ).json()) as CreateResponse;

    const res = await app.fetch(new Request(`http://localhost/r/${expiringCreated.token}`));
    expect(res.status).toBe(410);

    // Hard-delete the DB row; if cache was invalidated on the previous request,
    // a second hit cannot find anything anywhere → 404.
    await db.delete(urlMappings).where(eq(urlMappings.token, expiringCreated.token));
    const second = await app.fetch(new Request(`http://localhost/r/${expiringCreated.token}`));
    expect(second.status).toBe(404);

    // Touch `created` to silence unused warnings if linter complains.
    expect(created.token).toBeTruthy();
  });
});
