import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { BASE_URL } from "../src/config";
import { scanEvents, urlMappings } from "../src/db/schema";
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

  test("PATCH bumps updated_at past created_at (verifies $onUpdate)", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    const before = (await (
      await app.fetch(new Request(`http://localhost/api/qr/${created.token}`))
    ).json()) as InfoResponse;
    // created_at uses sqlite `unixepoch()*1000` (whole-second granularity);
    // updated_at uses Drizzle `$onUpdate(() => new Date())` (millisecond
    // granularity). To make `updated_at > created_at` meaningful even in the
    // pathological case where the insert happened on a whole second, sleep
    // past the next second boundary before issuing PATCH.
    await Bun.sleep(1100);

    const patched = (await (
      await patchQr(app, created.token, { url: "https://renamed.example.com" })
    ).json()) as InfoResponse;
    expect(patched.created_at).toBe(before.created_at);
    expect(new Date(patched.updated_at).getTime()).toBeGreaterThan(
      new Date(patched.created_at).getTime(),
    );
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

interface AnalyticsResponse {
  token: string;
  total_scans: number;
  scans_by_day: Array<{ date: string; count: number }>;
}

describe("Scan event recording + GET /api/qr/:token/analytics (Task 10)", () => {
  test("redirects record scan events; analytics counts them", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    for (let i = 0; i < 3; i += 1) {
      const r = await app.fetch(new Request(`http://localhost/r/${created.token}`));
      expect(r.status).toBe(302);
    }

    // Fire-and-forget scan writes are not awaited by the redirect handler.
    // Yield once so any pending microtask/IO from the unawaited insert can
    // settle before we read back. Microtask queue drain.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const res = await app.fetch(new Request(`http://localhost/api/qr/${created.token}/analytics`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalyticsResponse;
    expect(body.token).toBe(created.token);
    expect(body.total_scans).toBe(3);
    // All three scans land on the same UTC day → exactly one bucket.
    expect(body.scans_by_day).toHaveLength(1);
    expect(body.scans_by_day[0]?.count).toBe(3);
    // YYYY-MM-DD shape
    expect(body.scans_by_day[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("captures user-agent and ip from headers", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    await app.fetch(
      new Request(`http://localhost/r/${created.token}`, {
        headers: {
          "user-agent": "Mozilla/5.0 (Test Agent)",
          "x-forwarded-for": "203.0.113.7",
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    const events = await db.select().from(scanEvents).where(eq(scanEvents.token, created.token));
    expect(events).toHaveLength(1);
    expect(events[0]?.userAgent).toBe("Mozilla/5.0 (Test Agent)");
    expect(events[0]?.ipAddress).toBe("203.0.113.7");
  });

  test("truncates oversized UA and stores only first XFF hop (security)", async () => {
    // Attacker sends 10KB User-Agent + multi-hop X-Forwarded-For.
    // Without truncation, every redirect bloats scan_events; without XFF
    // splitting, downstream IP analysis sees `client, proxy1, proxy2` as
    // one opaque string.
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    const giantUa = "M".repeat(10_000);
    await app.fetch(
      new Request(`http://localhost/r/${created.token}`, {
        headers: {
          "user-agent": giantUa,
          "x-forwarded-for": "203.0.113.7, 10.0.0.1, 192.168.1.1",
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    const events = await db.select().from(scanEvents).where(eq(scanEvents.token, created.token));
    expect(events).toHaveLength(1);
    expect(events[0]?.userAgent?.length).toBe(512);
    expect(events[0]?.userAgent).toBe(giantUa.slice(0, 512));
    expect(events[0]?.ipAddress).toBe("203.0.113.7");
  });

  test("scans_by_day buckets by UTC date in ascending order", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    // Pre-seed events on three different UTC days so we don't depend on wall
    // clock. Mix the insert order to prove the route sorts ascending.
    await db.insert(scanEvents).values([
      { token: created.token, scannedAt: new Date("2026-04-15T12:00:00Z") },
      { token: created.token, scannedAt: new Date("2026-04-13T05:00:00Z") },
      { token: created.token, scannedAt: new Date("2026-04-15T23:30:00Z") },
      { token: created.token, scannedAt: new Date("2026-04-14T00:00:00Z") },
    ]);

    const res = await app.fetch(new Request(`http://localhost/api/qr/${created.token}/analytics`));
    const body = (await res.json()) as AnalyticsResponse;
    expect(body.total_scans).toBe(4);
    expect(body.scans_by_day).toEqual([
      { date: "2026-04-13", count: 1 },
      { date: "2026-04-14", count: 1 },
      { date: "2026-04-15", count: 2 },
    ]);
  });

  test("returns 404 for unknown token", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await app.fetch(new Request("http://localhost/api/qr/MISSING0/analytics"));
    expect(res.status).toBe(404);
  });

  test("returns 404 for soft-deleted token", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;
    await app.fetch(new Request(`http://localhost/api/qr/${created.token}`, { method: "DELETE" }));

    const res = await app.fetch(new Request(`http://localhost/api/qr/${created.token}/analytics`));
    expect(res.status).toBe(404);
  });

  test("expired token analytics still returns 200 (extra)", async () => {
    // Campaign ended yesterday; owner still wants to see historical traffic.
    const db = createTestDb();
    const app = createApp(db);
    const past = new Date(Date.now() - 1_000).toISOString();
    const created = (await (
      await createQr(app, { url: "https://example.com", expires_at: past })
    ).json()) as CreateResponse;

    const res = await app.fetch(new Request(`http://localhost/api/qr/${created.token}/analytics`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalyticsResponse;
    expect(body.token).toBe(created.token);
    expect(body.total_scans).toBe(0);
    expect(body.scans_by_day).toEqual([]);
  });
});

describe("Fire-and-forget scan write resilience (Task 10)", () => {
  test("scan insert throw → GET /r/:token still 302", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    // Monkey-patch db.insert *after* the POST has settled, so urlMappings
    // insert (the create flow) was unaffected. From now on, any insert into
    // scanEvents rejects — this is the simulated "disk-full / locked DB"
    // case the fire-and-forget .catch is meant to swallow.
    const originalInsert = db.insert.bind(db);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle builder shape
    (db as any).insert = (table: unknown) => {
      if (table === scanEvents) {
        return {
          values: () => Promise.reject(new Error("simulated scan write failure")),
        };
      }
      // biome-ignore lint/suspicious/noExplicitAny: passthrough
      return originalInsert(table as any);
    };

    // Capture (and silence) the expected `console.warn("scan write failed",
    // ...)`. We assert it fires so the test isn't a false positive — without
    // this, removing the `.catch(...)` clause would still pass on the 302
    // assertion alone.
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const res = await app.fetch(new Request(`http://localhost/r/${created.token}`));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://example.com/");
      // Yield so the rejected Promise's .catch microtask runs before we exit.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.[0]).toBe("scan write failed");
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("GET /api/qr/:token/image (Task 9)", () => {
  test("returns 200 with image/png content-type for live token", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;

    const res = await app.fetch(new Request(`http://localhost/api/qr/${created.token}/image`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const body = new Uint8Array(await res.arrayBuffer());
    // PNG magic bytes 89 50 4E 47
    expect(body[0]).toBe(0x89);
    expect(body[1]).toBe(0x50);
    expect(body[2]).toBe(0x4e);
    expect(body[3]).toBe(0x47);
  });

  test("returns 404 for unknown token", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await app.fetch(new Request("http://localhost/api/qr/MISSING0/image"));
    expect(res.status).toBe(404);
  });

  test("returns 404 for soft-deleted token", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const created = (await (
      await createQr(app, { url: "https://example.com" })
    ).json()) as CreateResponse;
    await app.fetch(new Request(`http://localhost/api/qr/${created.token}`, { method: "DELETE" }));

    const res = await app.fetch(new Request(`http://localhost/api/qr/${created.token}/image`));
    expect(res.status).toBe(404);
  });

  test("expired token image still returns 200 + PNG (extra)", async () => {
    // Owner wants to download the QR image after a campaign ended — image
    // route MUST NOT 410 like redirect does.
    const db = createTestDb();
    const app = createApp(db);
    const past = new Date(Date.now() - 1_000).toISOString();
    const created = (await (
      await createQr(app, { url: "https://example.com", expires_at: past })
    ).json()) as CreateResponse;

    const res = await app.fetch(new Request(`http://localhost/api/qr/${created.token}/image`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const body = new Uint8Array(await res.arrayBuffer());
    // PNG magic bytes 89 50 4E 47
    expect(body[0]).toBe(0x89);
    expect(body[1]).toBe(0x50);
    expect(body[2]).toBe(0x4e);
    expect(body[3]).toBe(0x47);
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

    // POST with a past expiry writes through to the cache, so the redirect
    // hits the "cache hit but expired" branch on first read.
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
  });
});
