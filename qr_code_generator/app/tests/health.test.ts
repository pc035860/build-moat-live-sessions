import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createTestDb } from "../src/db/test-db";
import { ValidationError } from "../src/lib/errors";

describe("createApp", () => {
  test("GET /health returns 200 with status ok", async () => {
    const db = createTestDb();
    const app = createApp(db);
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("ValidationError → 422 via central error handler", async () => {
    const db = createTestDb();
    const app = createApp(db);
    app.get("/_throw", () => {
      throw new ValidationError("bad input");
    });
    const res = await app.fetch(new Request("http://localhost/_throw"));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad input");
  });

  test("unknown error → 500", async () => {
    const db = createTestDb();
    const app = createApp(db);
    app.get("/_boom", () => {
      throw new Error("boom");
    });
    const res = await app.fetch(new Request("http://localhost/_boom"));
    expect(res.status).toBe(500);
  });
});
