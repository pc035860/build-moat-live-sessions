import { createApp } from "./app";
import { PORT } from "./config";
import { db } from "./db/client";

const app = createApp(db);

Bun.serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Server listening on http://localhost:${PORT}`);
