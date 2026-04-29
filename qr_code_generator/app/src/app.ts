import { Hono } from "hono";
import type { DB } from "./db/client";
import { errorHandler } from "./lib/errors";

export function createApp(_db: DB): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.onError(errorHandler);
  return app;
}
