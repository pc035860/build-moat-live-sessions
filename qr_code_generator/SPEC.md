# Spec: QR Code Generator (Challenge Track / Bun + TS)

> 對應 `PROMPT.md` 系統需求。Track：**Challenge**（不使用 `scaffold/`）。
> 設計題答案見 `PROMPT.md` 的 Design Questions 段，本 SPEC 只記實作決策。

---

## Objective

建一個 dynamic QR code 短網址服務 prototype，使用者可以：

- 提交長 URL → 拿到 short token、short URL、QR code 圖片
- 後續修改目標 URL（dynamic 的核心價值）
- 軟刪除（deleted → `410 Gone`）
- 設定 `expires_at`（過期 → `410 Gone`）
- 取得掃描分析（總次數 + 每日次數）

**目標使用者**：行銷活動 / 海報 / 名片場景的 URL 擁有者。
**成功定義**：通過 `PROMPT.md` 底部所有 curl verification 案例 + 一組可執行的自動化測試。

---

## Tech Stack

| 層級 | 選擇 | 理由 |
|------|------|------|
| Runtime | **Bun**（latest） | 原生 TS、內建 SQLite、內建 test runner |
| Language | **TypeScript**（`strict: true`） | 型別安全 |
| HTTP framework | **Hono** | 輕量、TS 友善、Bun 主流選擇 |
| DB | **SQLite** via `bun:sqlite` | 零外部依賴 |
| ORM | **Drizzle ORM** + `drizzle-kit` | TS-first、type-safe query、migrations |
| QR code | `qrcode` (npm) | 廣用、API 簡潔 |
| Token | `nanoid` | CSPRNG、URL-safe（對應 PROMPT Q2 答案） |
| Validation | `zod` + `@hono/zod-validator` | request body 驗證 |
| Cache | 程序內 `Map<string, { url: string; expiresAt: string \| null }>` | 模擬 Redis hot path（對應 scaffold 設計意圖） |
| Test | **`bun test`**（內建） | 不另外裝 vitest |
| Lint/Format | **Biome** | 單一工具，取代 ESLint + Prettier |

---

## Commands

於 `app/` 目錄下執行：

```bash
# Install
bun install

# Dev server (hot reload)
bun run dev                # = bun run --hot src/index.ts

# Run server (no reload)
bun run start              # = bun run src/index.ts

# Test
bun test                   # all
bun test tests/url.test.ts # single file

# Type check
bun run typecheck          # = tsc --noEmit

# Lint / format
bun run check              # = biome check .
bun run format             # = biome format --write .

# DB
bun run db:generate        # drizzle-kit generate (schema → SQL migration)
bun run db:migrate         # drizzle-kit migrate (apply migrations)
```

Server listens on `http://localhost:8000`（與 PROMPT verification 對齊）。

---

## Project Structure

```
qr_code_generator/
├── PROMPT.md
├── README.md
├── SPEC.md                       ← 本檔
├── scaffold/                     ← Guided Track 參考（不動，不刪）
└── app/                          ← Challenge Track 主體
    ├── src/
    │   ├── index.ts              # entry: createApp(prodDb) → Bun.serve
    │   ├── app.ts                # createApp(db) factory: 組 routes + onError
    │   ├── config.ts             # BASE_URL、PORT、DB_PATH 等 env
    │   ├── routes/
    │   │   ├── qr.ts             # createQrRoutes(db) → Hono；/api/qr/*
    │   │   └── redirect.ts       # createRedirectRoutes(db) → Hono；/r/:token
    │   ├── db/
    │   │   ├── client.ts         # createDb(path)、prod db、type DB
    │   │   ├── schema.ts         # urlMappings, scanEvents
    │   │   ├── test-db.ts        # createTestDb(): in-memory + migrations
    │   │   └── migrations/       # drizzle-kit 產出
    │   └── lib/
    │       ├── token.ts          # generateToken(db, opts?) with collision retry
    │       ├── url.ts            # normalizeUrl(), validateUrl(), blocklist
    │       ├── qr.ts             # qrPng(shortUrl) → Buffer
    │       ├── cache.ts          # createCache() → { get/set/invalidate/clear }
    │       └── errors.ts         # ValidationError / NotFoundError / GoneError
    ├── tests/
    │   ├── url.test.ts           # unit: normalize + validate
    │   ├── token.test.ts         # unit: 唯一性、retry 行為
    │   └── e2e.test.ts           # fetch-based，覆蓋 PROMPT 全部 curl
    ├── drizzle.config.ts
    ├── biome.json
    ├── tsconfig.json
    ├── package.json
    └── .gitignore                # *.sqlite, node_modules, dist
```

---

## Code Style

### 範例：app factory + route 模組（DB 注入）

> **設計決策**：所有依賴 DB 的模組（routes、cache）都用 **factory function 注入 db**，
> 不從 `import { db }` 拿 module-level singleton。這讓 e2e 每條 test 用獨立 in-memory DB。

```ts
// src/app.ts
import { Hono } from "hono";
import type { DB } from "./db/client";
import { createCache } from "./lib/cache";
import { errorHandler } from "./lib/errors";
import { createQrRoutes } from "./routes/qr";
import { createRedirectRoutes } from "./routes/redirect";

export function createApp(db: DB) {
  const cache = createCache();
  const app = new Hono();
  app.route("/api/qr", createQrRoutes(db, cache));
  app.route("/r", createRedirectRoutes(db, cache));
  app.onError(errorHandler);
  return app;
}

// src/index.ts
import { createApp } from "./app";
import { db } from "./db/client";
import { PORT } from "./config";

const app = createApp(db);
Bun.serve({ fetch: app.fetch, port: PORT });
```

```ts
// src/routes/qr.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { DB } from "../db/client";
import type { Cache } from "../lib/cache";
import { urlMappings } from "../db/schema";
import { generateToken } from "../lib/token";
import { validateUrl } from "../lib/url";
import { BASE_URL } from "../config";

const createSchema = z.object({
  url: z.string().min(1),
  expires_at: z.string().datetime().optional(),
});

export function createQrRoutes(db: DB, cache: Cache) {
  const routes = new Hono();

  routes.post("/create", zValidator("json", createSchema), async (c) => {
    const { url, expires_at } = c.req.valid("json");

    const normalized = validateUrl(url); // throws ValidationError on bad input
    const token = await generateToken(db);

    await db.insert(urlMappings).values({
      token,
      originalUrl: normalized,
      expiresAt: expires_at ? new Date(expires_at) : null,
    });

    cache.set(token, { url: normalized, expiresAt: expires_at ?? null });

    return c.json({
      token,
      short_url: `${BASE_URL}/r/${token}`,
      qr_code_url: `${BASE_URL}/api/qr/${token}/image`,
      original_url: normalized,
      expires_at: expires_at ?? null,
    });
  });

  // ... 其他 handler 類似結構，db / cache 從 closure 取
  return routes;
}
```

```ts
// tests/e2e.test.ts（示意）
import { createApp } from "../src/app";
import { createTestDb } from "../src/db/test-db";

test("POST /api/qr/create returns token", async () => {
  const db = createTestDb();           // 獨立 in-memory DB + migrations
  const app = createApp(db);
  const res = await app.fetch(
    new Request("http://localhost/api/qr/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    }),
  );
  expect(res.status).toBe(200);
});
```

### Conventions

- **檔名**：kebab-case 不強制；單字檔用 `token.ts`、`url.ts`，多字用 `redirect-cache.ts`。
- **變數/函式**：`camelCase`；型別/類別 `PascalCase`；常數 `SCREAMING_SNAKE_CASE`。
- **API JSON 欄位**：`snake_case`（與 PROMPT verification 對齊：`short_url`、`original_url`、`expires_at`、`total_scans`、`scans_by_day`）。內部 TS 物件用 `camelCase`，邊界做轉換。
- **Imports**：ESM；外部套件先、相對路徑後，群組間空一行。
- **Errors**：拋自訂 `ValidationError` / `NotFoundError` / `GoneError`，由 Hono `app.onError` 集中映射成 status code。Handler 內部不直接 `c.json({...}, 4xx)` 做錯誤回應。
- **SQL**：永遠走 Drizzle query builder，禁止字串拼接 SQL。
- **Comments**：函式 docstring 一行就好；複雜分支才加 inline 註解。
- **No `any`**：必要時用 `unknown` + narrowing。
- **DB 注入**：`db` 永遠透過 factory 參數傳入；route 模組與 lib（cache 例外，自己擁有狀態）禁止 `import { db } from "../db/client"`。`src/index.ts` 是唯一拿 prod `db` 的地方。
- **時區**：所有 `expires_at` / `scanned_at` 一律當 **UTC** 處理；DB 存 ISO string；`scans_by_day.date` 用 UTC `YYYY-MM-DD`。
- **Cache 為 dumb storage**：`cache.get(token)` 只回原值（或 `undefined`），**不做過期判斷、不做 invalidate**；過期判斷與 invalidate 寫在 redirect handler。Cache entry 只存 `{ url, expiresAt }`，**不**存 `is_deleted`（deleted token 永遠走 invalidate path 不再進 cache）。
- **Token 碰撞偵測**：`generateToken(db)` 採 **SELECT 偵測**（先查 DB 是否已存在），不採「INSERT 撞 unique error catch」，避免與 `POST /api/qr/create` handler 自己 INSERT 流程打架。

---

## Testing Strategy

### Framework
`bun test`（內建，零設定）。

### 測試層級

| 層級 | 位置 | 對象 |
|------|------|------|
| Unit | `tests/url.test.ts` | `normalizeUrl()`、`validateUrl()`、blocklist |
| Unit | `tests/token.test.ts` | `generateToken()` 唯一性、collision retry（mock DB） |
| E2E | `tests/e2e.test.ts` | 啟動 Hono app、用 `app.fetch(req)` 跑 PROMPT 全部 verification |

### E2E 規範
- 每個 test 用 `createTestDb()` 拿到獨立 in-memory SQLite（`:memory:` + 跑 migrations）。
- 不啟動真的 port，直接 `app.fetch(new Request(...))` 取得 `Response`。
- 必須覆蓋 **PROMPT verification 區塊的所有 case** —— 每條對應一個 `test(...)`，命名與原 curl 註解一致。
- 額外必測 case：
  - cache hit 驗證（先 GET `/r/:token` warm cache → 直接 `db.delete` 砍掉 DB row → 再 GET 仍回 `302`，證明走 cache）
  - PATCH `expires_at` 從未來改到過去 → 立即 GET `/r/:token` 回 `410`（驗 PATCH invalidate + expired 邏輯交互）
  - scan 寫入 throw（mock `db.insert(scanEvents)` reject）→ redirect 仍回 302（驗 fire-and-forget 容錯）

### 不做（MVP 範圍外）
- 覆蓋率門檻
- Property-based testing
- Load test

---

## Boundaries

### Always
- 跑 `bun test` + `bun run typecheck` + `bun run check` 後才 commit
- URL 在進 DB 前先 `validateUrl()`（length / scheme / blocklist）
- 用 Drizzle / parameterized SQL，永不字串拼接
- `update` / `delete` / `expires_at` 改動 → **同步 invalidate cache**
- Cache miss 才打 DB；DB hit 後 warm cache
- Cache hit 但 entry 已 `expiresAt` 過 → 回 `410` 並 invalidate 該 entry
- Redirect (`/r/:token`)：過期或 deleted → `410`；不存在 → `404`
- Metadata (`GET /api/qr/:token`)、Image、Analytics 對 **expired** 仍可查（回 200；其中 metadata 額外含 `expires_at` 欄位），對 **deleted** 才回 `404`
- API JSON 用 `snake_case` 欄位（PROMPT 合約）
- `db` 永遠由 `createApp(db)` / `createXxxRoutes(db)` factory 注入

### Ask first
- 新增 npm dependency（特別是非必要的）
- 改動 `PROMPT.md` 的 verification 合約
- 改 DB schema（要產 migration）
- 改 `BASE_URL` / port / 對外路徑

### Never
- 強制 `http → https` upgrade（PROMPT Q4 已明確）
- 移除追蹤參數（`utm_*`）做 normalization
- Commit `*.sqlite` / `.env` / `node_modules`
- Skip 失敗的測試
- 在 redirect hot path 做同步 IO 之外的重活（analytics 可 fire-and-forget）
- 用 301（PROMPT Q3 已明確）

---

## Success Criteria

完成定義（必須全綠）：

- [ ] `bun install && bun run db:migrate && bun run dev` 一條龍可起服務
- [ ] PROMPT.md verification 區塊**全部 case** 回正確 status / body：
  - [ ] `POST /api/qr/create` → `200` + `{token, short_url, qr_code_url, original_url, expires_at}`
  - [ ] `GET /r/{token}` → `302`
  - [ ] `GET /api/qr/{token}` → `200` + metadata（`{token, original_url, short_url, qr_code_url, expires_at, created_at, updated_at}`）
  - [ ] `PATCH /api/qr/{token}` (url) → `200`
  - [ ] PATCH 後 `GET /r/{token}` 重定向到新 URL
  - [ ] `DELETE /api/qr/{token}` → `200`
  - [ ] deleted 後 `GET /r/{token}` → `410`
  - [ ] 不存在 token `GET /r/INVALID` → `404`
  - [ ] `GET /api/qr/{token}/image` → `200` + `image/png`
  - [ ] `GET /api/qr/{token}/analytics` → `200` + `{token, total_scans, scans_by_day}`
- [ ] `expires_at` 過期 → `GET /r/{token}` 回 `410`（PROMPT 隱含需求）
- [ ] `bun test` 全綠（含 unit + e2e + 額外 cache hit / expired-after-PATCH / scan-throw 三條）
- [ ] `bun run typecheck` 無 error
- [ ] `bun run check` 無 error
- [ ] README（或 `app/README.md`）有 quickstart：`cd app && bun install && bun run db:migrate && bun run dev`

---

## Resolved Decisions（plan-reviewer round 1 後鎖定）

| # | 主題 | 決議 |
|---|------|------|
| 1 | `BASE_URL` 來源 | env var，default `http://localhost:8000` |
| 2 | Blocklist 來源 | MVP 寫死於 `lib/url.ts` |
| 3 | Analytics IP/UA | Prototype 原樣記錄，不匿名化 |
| 4 | Cache 大小/TTL | MVP 不限制（單機足夠） |
| 5 | Token 長度 | `nanoid(8)`（~6.1M 才 50% 碰撞） |
| 6 | DB 注入 | **Factory pattern**（`createApp(db)` / `createXxxRoutes(db)`），不用 module-level singleton |
| 7 | `POST /api/qr/create` 接受 `expires_at` body | **保留**（response 與 cache 都帶回 `expires_at`） |
| 8 | Expired token 對 metadata / image / analytics | **仍可查**（回 200，行為與 alive token 相同；只有 redirect path 才 410） |
| 9 | Deleted token 對 metadata / image / analytics | **404**（與 redirect / GET 一致） |
| 10 | Verification 數量用詞 | 統一寫「PROMPT verification 全部 case」，不寫具體數字 |
| 11 | `updatedAt` 機制 | Drizzle `$onUpdate` 或手動於 update query `set(updatedAt: new Date())`；e2e 必驗 PATCH 後 `updated_at` 變動 |
| 12 | Cache hit 過期行為 | 回 `410` + invalidate 該 entry |
| 13 | Token collision 偵測 | **SELECT 偵測**（不採 INSERT catch），避免與 create handler 流程打架 |
| 14 | Cache 邏輯位置 | Cache 是 **dumb storage**：`cache.get` 只回原值，過期判斷與 invalidate 寫在 redirect handler |
| 15 | Scan event 寫入 timing | **`void db.insert(...).catch(...)` 不 await**；handler 主流程禁止 await scan 寫入 |
| 16 | Prototype scale 假設 | 單機 prototype；不做 connection pool / WAL；負載超 demo 範圍再考慮優化 |

---

> **下一步**：批醬 review 修補後 SPEC → plan-reviewer round 2 → 進入 Phase 4 **Implement**。
