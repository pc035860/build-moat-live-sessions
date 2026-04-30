import { Hono } from "hono";
import type { DB } from "./db/client";
import { createCache } from "./lib/cache";
import { errorHandler } from "./lib/errors";
import { createQrRoutes } from "./routes/qr";
import { createRedirectRoutes } from "./routes/redirect";
import { indexHtml } from "./web";

export function createApp(db: DB): Hono {
  const app = new Hono();
  const cache = createCache();

  app.get("/", (c) => c.html(indexHtml));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/api/qr", createQrRoutes(db, cache));
  app.route("/r", createRedirectRoutes(db, cache));

  app.onError(errorHandler);
  return app;
}
