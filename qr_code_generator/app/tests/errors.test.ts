import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createTestDb } from "../src/db/test-db";
import { GoneError, NotFoundError, ValidationError } from "../src/lib/errors";

describe("ValidationError", () => {
  test("has status 422 and preserves message", () => {
    const err = new ValidationError("bad input");
    expect(err.status).toBe(422);
    expect(err.message).toBe("bad input");
    expect(err.name).toBe("ValidationError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("NotFoundError", () => {
  test("defaults to status 404 with default message", () => {
    const err = new NotFoundError();
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not Found");
    expect(err.name).toBe("NotFoundError");
  });

  test("accepts custom message", () => {
    const err = new NotFoundError("token missing");
    expect(err.status).toBe(404);
    expect(err.message).toBe("token missing");
  });

  test("via createApp → 404 response with message body", async () => {
    const db = createTestDb();
    const app = createApp(db);
    app.get("/_missing", () => {
      throw new NotFoundError("token missing");
    });
    const res = await app.fetch(new Request("http://localhost/_missing"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("token missing");
  });
});

describe("GoneError", () => {
  test("defaults to status 410 with default message", () => {
    const err = new GoneError();
    expect(err.status).toBe(410);
    expect(err.message).toBe("Gone");
    expect(err.name).toBe("GoneError");
  });

  test("accepts custom message", () => {
    const err = new GoneError("token expired");
    expect(err.status).toBe(410);
    expect(err.message).toBe("token expired");
  });

  test("via createApp → 410 response with message body", async () => {
    const db = createTestDb();
    const app = createApp(db);
    app.get("/_gone", () => {
      throw new GoneError("token expired");
    });
    const res = await app.fetch(new Request("http://localhost/_gone"));
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("token expired");
  });
});
