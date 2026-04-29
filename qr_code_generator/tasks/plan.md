# Implementation Plan: QR Code Generator (Bun + TS / Challenge Track)

> 對應 `SPEC.md`。實作主體在 `qr_code_generator/app/`。

---

## Overview

把 dynamic QR code 短網址服務分成 5 個 Phase、共 11 個 task：先打地基（scaffolding + DB + Hono skeleton），接著從「使用者建立 QR + 掃描重導」這條最核心的 happy path 切第一刀垂直驗收，再依序加上 mutation（PATCH/DELETE/expiration）、auxiliary（image/analytics）、polish。每個 phase 結尾有 checkpoint，全綠才繼續下一 phase。

---

## Architecture Decisions

| 決策 | 內容 | 理由 |
|------|------|------|
| Vertical slicing | Phase 2 起每個 phase 都做完整 user path（route + lib + e2e） | 早期 close loop，避免「全部 lib 寫完才知道 route 串不起來」 |
| Pure libs 先於 routes | `url`/`token`/`cache`/`qr` 各自有 unit test，再寫 route | 無 framework 依賴，可單獨除錯；route 階段專注串接 |
| In-memory SQLite for e2e | 每條 e2e test 用 `new Database(":memory:")` + 跑 migrations | 隔離、快、不留檔案 |
| Error 集中映射 | 拋自訂 error class → `app.onError` 統一轉 status code | Handler 不重複 `c.json({...}, 4xx)`，符合 SPEC Code Style |
| Cache 在 Phase 2 就引入 | 不延後到「優化階段」 | scaffold 設計意圖、PROMPT 隱含 hot path discussion，越早整合越不會留技術債 |
| Migrations 用 drizzle-kit generate | 不手寫 SQL | 與 schema 對齊、可重跑 |
| **DB 注入用 factory pattern** | `createApp(db)` / `createXxxRoutes(db, cache)`；module-level singleton 只有 `src/index.ts` 用一次 | 每條 e2e 用獨立 in-memory DB，避免 module mock 黑魔法 |
| **時區一律 UTC** | `expires_at` / `scanned_at` ISO string；`scans_by_day.date` 用 UTC `YYYY-MM-DD` | 跨 dev / CI / prod flake-free |
| **Expired vs deleted 對非 redirect 端點區別** | redirect 兩者皆 410；metadata / image / analytics：deleted → 404，expired → 仍可查 | 過期 token 仍可診斷與看歷史流量 |

---

## Phase 1: Foundation

打地基。完成後 `bun run dev` 能起服務、`bun test` 能跑（即使是空的）、health check 200。

### Task 1: 專案 scaffolding（`app/` 目錄）

**Description:** 建立 `app/` 子專案，含 `package.json`（含全部 scripts）、`tsconfig.json`（strict）、`biome.json`、`.gitignore`，安裝 dependencies。

**Acceptance criteria:**
- [ ] `app/package.json` 含 scripts：`dev`、`start`、`test`、`typecheck`、`check`、`format`、`db:generate`、`db:migrate`
- [ ] Dependencies：`hono`、`drizzle-orm`、`zod`、`@hono/zod-validator`、`nanoid`、`qrcode`
- [ ] Dev dependencies：`drizzle-kit`、`typescript`、`@biomejs/biome`、`@types/qrcode`、`@types/bun`
- [ ] `tsconfig.json` 設 `strict: true`、`module: "ESNext"`、`moduleResolution: "bundler"`
- [ ] `.gitignore` 含 `node_modules/`、`*.sqlite`、`*.sqlite-journal`、`dist/`、`.env`

**Verification:**
- [ ] `cd app && bun install` 無錯
- [ ] `bun run typecheck` 無錯（即使沒原始碼）
- [ ] `bun run check` 無錯

**Dependencies:** None
**Files likely touched:** `app/package.json`, `app/tsconfig.json`, `app/biome.json`, `app/.gitignore`
**Estimated scope:** S

---

### Task 2: Drizzle schema + DB client + migrations

**Description:** 定義 `urlMappings` 與 `scanEvents` 兩張表，建立 Drizzle client（包 `bun:sqlite`），設定 `drizzle.config.ts`，產出第一份 migration。提供 `app/src/db/test-db.ts` helper 讓 e2e 用 in-memory DB。

**Acceptance criteria:**
- [ ] `src/db/schema.ts`：`urlMappings`（id/token unique/originalUrl/createdAt/updatedAt/expiresAt nullable/isDeleted default false），`scanEvents`（id/token/scannedAt/userAgent nullable/ipAddress nullable，索引 token+scannedAt）
- [ ] `urlMappings.updatedAt` 使用 Drizzle `$onUpdate(() => new Date())`（或在 update query `.set({ updatedAt: new Date() })` 手動處理；schema 設定後在 Task 7 e2e 必驗 PATCH 後 `updated_at` 變動）
- [ ] `src/db/client.ts` 匯出 `createDb(path)` factory + `type DB = ReturnType<typeof createDb>` + 預設 prod `db = createDb(DB_PATH)`
- [ ] `drizzle.config.ts` 設好 `dialect: "sqlite"`、`schema`、`out: "src/db/migrations"`
- [ ] `bun run db:generate` 產出第一份 migration SQL
- [ ] `bun run db:migrate` 在空的 sqlite 檔上能跑成功
- [ ] `src/db/test-db.ts` 提供 `createTestDb()`：開 `:memory:` + 跑 migrations，回 `DB` instance（每次呼叫獨立 instance，禁止 module-level singleton）

**Verification:**
- [ ] `bun run db:migrate` 後 `qr.sqlite` 內含兩張表（用 `sqlite3 qr.sqlite ".schema"` 檢查）
- [ ] `bun run typecheck` 無錯
- [ ] 一個 placeholder unit test 用 `createTestDb()` 能 insert + select

**Dependencies:** Task 1
**Files likely touched:** `app/drizzle.config.ts`, `app/src/db/schema.ts`, `app/src/db/client.ts`, `app/src/db/test-db.ts`, `app/src/db/migrations/*.sql`, `app/src/config.ts`
**Estimated scope:** M

---

### Task 3: Hono app factory + error handler + config

**Description:** 建 `createApp(db)` factory、Bun.serve entry、集中 error handler（自訂 error class → status code）、config。Factory pattern 是核心 —— 後續 routes 都從 closure 拿 `db` / `cache`。掛一個 `GET /health` 確認可以起。

**Acceptance criteria:**
- [ ] `src/config.ts`：`BASE_URL`（env `BASE_URL`，default `http://localhost:8000`）、`PORT`（env `PORT`，default `8000`）、`DB_PATH`
- [ ] `src/lib/errors.ts`：`ValidationError`（→422）、`NotFoundError`（→404）、`GoneError`（→410）+ `errorHandler` function 可直接給 `app.onError` 用
- [ ] `src/app.ts`：`export function createApp(db: DB): Hono`，內部建立 cache、組 routes、註冊 `onError`；未知 error 回 500
- [ ] `src/index.ts`：`createApp(db)` → `Bun.serve({ fetch: app.fetch, port: PORT })`
- [ ] `GET /health` → `200 {"status": "ok"}`，掛在 `createApp` 裡，e2e 可以用

**Verification:**
- [ ] `bun run dev` 起服務、`curl localhost:8000/health` → 200
- [ ] 在一個臨時 route 拋 `new ValidationError("x")` → 收到 422
- [ ] `bun run typecheck` 無錯

**Dependencies:** Task 1
**Files likely touched:** `app/src/index.ts`, `app/src/app.ts`, `app/src/config.ts`, `app/src/lib/errors.ts`
**Estimated scope:** M

---

### ✅ Checkpoint: Foundation
- [ ] `bun install && bun run db:migrate && bun run dev` 一條龍綠
- [ ] `GET /health` → 200
- [ ] `bun test` 綠（即使只有 placeholder）
- [ ] `bun run typecheck` & `bun run check` 全綠
- [ ] **Human review**：架構與檔案配置是否符合 SPEC

---

## Phase 2: First Vertical Slice — Create + Redirect Happy Path

第一刀完整垂直：使用者送 URL → 拿到 token → 掃 QR → 302 導回。涵蓋 PROMPT verification curl #1、#2、#3。

### Task 4: `lib/url.ts` — normalize + validate + blocklist + unit test

**Description:** 純函式 `normalizeUrl(input)` 與 `validateUrl(input)`（後者呼叫前者）。Normalize 規則照 SPEC：scheme/host 小寫 + 移除 default port + percent-encoding 大寫；**不**做 http→https。Validate 檢查：長度上限 2048、scheme 只能 http/https、host 不在 blocklist。

**Acceptance criteria:**
- [ ] `BLOCKED_DOMAINS` 寫死（含 `evil.com`, `malware.example.com`, `phishing.example.com`）
- [ ] `validateUrl(input)` 回傳 normalized URL；非法時拋 `ValidationError` 帶清楚訊息
- [ ] Unit test 涵蓋：scheme 大小寫、host 大小寫、`:80`/`:443` 移除、percent-encoding 大寫、空字串、過長、非 http/https、blocklist hit
- [ ] Unit test 補：IPv6 host（`http://[::1]/`）行為明確；`userinfo` URL（`http://user:pass@host/`）行為明確 —— 兩者皆透過 `new URL()` parse，仍視為合法 http/https 並保留
- [ ] **不**測試 http→https upgrade（確認 SPEC Boundary）

**Verification:**
- [ ] `bun test tests/url.test.ts` 全綠（≥ 10 個 case）
- [ ] `bun run typecheck` 無錯

**Dependencies:** Task 3（要用 `ValidationError`）
**Files likely touched:** `app/src/lib/url.ts`, `app/tests/url.test.ts`
**Estimated scope:** S

---

### Task 5: `lib/token.ts` — nanoid token + collision retry + unit test

**Description:** `generateToken(db, opts?)` 用 `nanoid(8)` 生成，DB unique constraint 撞了就 retry，預設 3 次後拋 error。`opts` 讓 unit test 可注入 `maxRetries` / `tokenLength` / `nanoidImpl`。

**Acceptance criteria:**
- [ ] `generateToken(db, opts?)` 回傳 8-char URL-safe token；簽名 `(db: DB, opts?: { maxRetries?: number; nanoidImpl?: () => string }) => Promise<string>`
- [ ] 撞 unique constraint 會 retry；超過 `opts.maxRetries`（default 3）拋 `Error("Token collision: exhausted retries")`
- [ ] Retry 之間**不引入 sleep / await delay**（避免增加 hot path latency）
- [ ] 探測 collision 用「先 SELECT 看是否存在」**或**「INSERT 撞 unique error 後 catch」皆可，但 implementation 必須注釋哪一種；e2e 不要求區分
- [ ] Unit test：注入 `nanoidImpl` 模擬前兩次回固定撞值、第三次回新值 → 確認 retry 次數正確；連續失敗 → 拋 error
- [ ] Unit test 不需要真的 DB schema，但需要 mock `db` 介面（建議用 `createTestDb()` + 手動先插一筆 token 模擬碰撞，或用 stub object）

**Verification:**
- [ ] `bun test tests/token.test.ts` 全綠（≥ 4 個 case：成功、retry 1 次成功、retry 耗盡、注入 maxRetries=1 立即失敗）
- [ ] `bun run typecheck` 無錯

**Dependencies:** Task 2（要 schema），Task 3（要 error class）
**Files likely touched:** `app/src/lib/token.ts`, `app/tests/token.test.ts`
**Estimated scope:** S

---

### Task 6: Create + Redirect + Get info（含 cache）+ e2e

**Description:** 實作 `lib/cache.ts`（`createCache()` factory，內部 `Map<string, { url: string; expiresAt: string | null }>`），完成 `POST /api/qr/create`、`GET /r/:token`（cache → DB → 302/404）、`GET /api/qr/:token`，並寫 e2e 涵蓋 PROMPT verification curl #1/#2/#3 + cache hit 驗證。

**Acceptance criteria:**
- [ ] `src/lib/cache.ts`：`createCache()` 回傳物件含 `get(token)`/`set(token, entry)`/`invalidate(token)`/`clear()`；型別 `Cache = ReturnType<typeof createCache>`；entry shape `{ url: string; expiresAt: string | null }`
- [ ] `POST /api/qr/create`：
  - zod 驗 body：`url` 必填、`expires_at` 選填（`z.string().datetime()`）
  - `validateUrl(url)` → `generateToken(db)` → insert（含 `expires_at`）→ warm cache（含 `expiresAt`）
  - Response：`{token, short_url, qr_code_url, original_url, expires_at}`（沒帶就回 `null`）
- [ ] `GET /r/:token`：先查 cache，命中 → 302；miss → 查 DB；找不到 → 404；找到 → 302 + warm cache（暫不處理 deleted/expired，留給 Task 8）
- [ ] `GET /api/qr/:token`：
  - 查 DB；`is_deleted = true` → 404；其他（含 expired）→ 200
  - Response field 明確列出：`{token, original_url, short_url, qr_code_url, expires_at, created_at, updated_at}`（`is_deleted` 不外露，因為 deleted 直接 404）
- [ ] e2e test 開 in-memory DB + `app.fetch` 直打：覆蓋 PROMPT verification curl #1、#2、#3
- [ ] **e2e 額外**：同 token 連打兩次 `GET /r/:token`，第二次走 cache（用 `mock.spyOn(db)` 或 cache hit/miss counter 驗 DB query 只發生一次）
- [ ] API JSON 用 snake_case（`short_url`、`qr_code_url`、`original_url`、`expires_at`、`created_at`、`updated_at`）

**Verification:**
- [ ] `bun test tests/e2e.test.ts` 涵蓋的 case 全綠（含 cache hit 驗證 ≥ 4 條）
- [ ] 手動跑 PROMPT verification curl #1/#2/#3 → 全部回正確 status + body
- [ ] `bun run typecheck` & `bun run check` 全綠

**Dependencies:** Task 4, Task 5
**Files likely touched:** `app/src/lib/cache.ts`, `app/src/routes/qr.ts`, `app/src/routes/redirect.ts`, `app/src/app.ts`（掛 router）, `app/tests/e2e.test.ts`
**Estimated scope:** M

---

### ✅ Checkpoint: First Slice
- [ ] PROMPT verification curl #1/#2/#3 全綠
- [ ] `bun test` 全綠（unit + e2e ≥ 16 個 case，含 cache hit 驗證）
- [ ] `bun run typecheck` & `bun run check` 全綠
- [ ] **Human review**：route handler 風格、error 流是否乾淨、factory 注入是否一致

---

## Phase 3: Mutation Vertical Slice

PATCH / DELETE / expiration → 都會觸發 cache invalidation 和 410 邏輯。涵蓋 PROMPT verification curl #4 ~ #8。

### Task 7: `PATCH /api/qr/:token` + cache invalidation + e2e

**Description:** 支援更新 `url` 或 `expires_at`（任一可選）。更新後同步 invalidate cache，redirect 下一次會重新 warm。

**Acceptance criteria:**
- [ ] zod schema：`url?` + `expires_at?`（至少一個有值，否則 422）
- [ ] 找不到 token（`is_deleted = true` 視為找不到）→ 404
- [ ] 更新 `url` 時呼叫 `validateUrl`、寫 DB、**`updatedAt` 自動更新**（透過 schema `$onUpdate` 或顯式 `set({ updatedAt: new Date() })`）、invalidate cache
- [ ] 更新 `expires_at` 時寫 DB、invalidate cache（接受 ISO 字串或 `null` 清除）
- [ ] 回 200 + 更新後 metadata（與 Task 6 GET 同 shape）
- [ ] e2e：建立 → PATCH 改 URL → 再次 GET /r/:token 應導向新 URL（PROMPT verification curl #4、#5）
- [ ] **e2e 額外**：PATCH 後 `GET /api/qr/:token` 的 `updated_at` 必須晚於 `created_at`（Drizzle `$onUpdate` 在 SQLite 行為驗證）

**Verification:**
- [ ] `bun test tests/e2e.test.ts` 新 case 全綠
- [ ] 手動 PROMPT verification curl #4、#5 全綠
- [ ] cache invalidation 驗證：PATCH 後立刻 GET /r/:token，redirect_url 已是新 URL

**Dependencies:** Task 6
**Files likely touched:** `app/src/routes/qr.ts`, `app/src/lib/cache.ts`（若要加 helper）, `app/tests/e2e.test.ts`
**Estimated scope:** S

---

### Task 8: `DELETE` + 410 (deleted/expired) + 404 (non-existent) + e2e

**Description:** 軟刪除（`isDeleted = true`），同步 invalidate cache。Redirect 邏輯擴充：deleted → 410、expires_at 過了 → 410、token 從未存在 → 404。Cache hit 也要尊重 `expiresAt` —— 命中即過期 → 直接回 410 + invalidate 該 entry。

**Acceptance criteria:**
- [ ] `DELETE /api/qr/:token`：找不到 → 404；找到 → `is_deleted = true`、invalidate cache、回 200
- [ ] `GET /r/:token` 邏輯擴充：
  - 查不到 → 404
  - `is_deleted = true` → 410
  - `expires_at` 過了 → 410
  - 否則 → 302 + warm cache
- [ ] **Cache hit 但 entry 已 `expiresAt` 過 → 直接回 410 + invalidate 該 entry**（與 PATCH/DELETE 路徑語意一致；不 fallthrough 到 DB）
- [ ] 時間比較使用 UTC（`Date.now()` vs `new Date(expiresAt).getTime()`）
- [ ] e2e 覆蓋 PROMPT verification curl #6（DELETE 200）、#7（deleted → 410）、#8（INVALID → 404）
- [ ] **e2e 額外 1**：建立 token + 設 `expires_at` 為 1 秒前 → GET /r/:token → 410
- [ ] **e2e 額外 2**：先 GET /r/:token warm cache（still alive）→ PATCH `expires_at` 改成過去 1 秒 → 立即 GET /r/:token → 410（驗 PATCH invalidate cache + Task 8 expired 邏輯交互）

**Verification:**
- [ ] `bun test tests/e2e.test.ts` 全綠
- [ ] 手動 PROMPT verification curl #6/#7/#8 全綠
- [ ] expiration 過的 token redirect 回 410（cache miss / cache hit 兩條 path 都通）

**Dependencies:** Task 7
**Files likely touched:** `app/src/routes/qr.ts`, `app/src/routes/redirect.ts`, `app/src/lib/cache.ts`, `app/tests/e2e.test.ts`
**Estimated scope:** S

---

### ✅ Checkpoint: Mutations
- [ ] PROMPT verification curl #1 ~ #8 全綠
- [ ] expiration → 410 行為驗證通過
- [ ] cache invalidation 在 PATCH/DELETE 都生效
- [ ] **Human review**：redirect handler 的分支邏輯是否清楚

---

## Phase 4: Auxiliary Endpoints

QR image + analytics。涵蓋 PROMPT verification curl #9、#10。

### Task 9: `lib/qr.ts` + `GET /api/qr/:token/image` + e2e

**Description:** `qrPng(shortUrl)` 用 `qrcode` package 生成 PNG buffer。Route 對 deleted token 回 404；**expired token 仍可查（回 PNG）**，因為使用者可能想看自己過期的 QR 圖片。

**Acceptance criteria:**
- [ ] `src/lib/qr.ts`：`qrPng(text: string): Promise<Buffer>`
- [ ] `GET /api/qr/:token/image`：
  - 不存在 → 404
  - `is_deleted = true` → 404
  - expired → **仍回 200 + PNG**（與 GET metadata 一致）
  - 否則回 PNG（`Content-Type: image/png`）
- [ ] e2e：PROMPT verification curl #9 → status 200 + content-type `image/png`，body 是合法 PNG（檢查 magic bytes `89 50 4E 47`）
- [ ] **e2e 額外**：expired token GET image → 仍 200 + PNG（驗證 expired metadata 規則一致）

**Verification:**
- [ ] `bun test` 全綠
- [ ] 手動 PROMPT verification curl #9 → 200 + `image/png`，存檔後可開

**Dependencies:** Task 8
**Files likely touched:** `app/src/lib/qr.ts`, `app/src/routes/qr.ts`, `app/tests/e2e.test.ts`
**Estimated scope:** S

---

### Task 10: Scan event 記錄 + `GET /api/qr/:token/analytics` + e2e

**Description:** Redirect 成功時寫 `scanEvents`（fire-and-forget，不 block 302 回應）。Analytics route 查 `total_scans` 與 `scans_by_day`。Deleted → 404；**expired 仍可查**（行銷活動結束後仍想看歷史流量）。

**Acceptance criteria:**
- [ ] Redirect 302 之前（或 in parallel via `queueMicrotask` / 不 await）寫一筆 `scanEvents`，含 user-agent 與 ip
- [ ] 寫 scan 失敗不 break redirect（用 try/catch + `console.warn`）
- [ ] `GET /api/qr/:token/analytics`：
  - 不存在 → 404
  - `is_deleted = true` → 404
  - expired → **仍 200**（與 metadata / image 一致）
  - 否則回 `{token, total_scans, scans_by_day: [{date, count}]}`
- [ ] `scans_by_day` 按 `date` 升序；`date` 格式 `YYYY-MM-DD`，**用 UTC**（與 `expires_at` 同時區規則）
- [ ] e2e：建立 → GET /r/:token 三次 → analytics → `total_scans = 3`
- [ ] **e2e 額外 1**：mock `db.insert(scanEvents)` throw → GET /r/:token 仍回 302（驗 fire-and-forget 容錯）
- [ ] **e2e 額外 2**：expired token analytics 仍 200

**Verification:**
- [ ] `bun test` 全綠
- [ ] 手動 PROMPT verification curl #10 → 200 + 結構正確

**Dependencies:** Task 9
**Files likely touched:** `app/src/routes/redirect.ts`, `app/src/routes/qr.ts`, `app/tests/e2e.test.ts`
**Estimated scope:** S

---

### ✅ Checkpoint: Aux
- [ ] PROMPT verification 全部 case 通過（含 image content-type 檢查）
- [ ] analytics 計數正確、`scans_by_day` 用 UTC `YYYY-MM-DD`
- [ ] redirect 不被 scan 寫入 block（mock throw 仍 302）
- [ ] expired token 對 metadata / image / analytics 全部仍 200
- [ ] **Human review**：analytics 計數實作是否合理

---

## Phase 5: Polish

### Task 11: README + 全綠 final check

**Description:** 寫 `app/README.md`（quickstart + 簡介），跑一次完整 lint/typecheck/test，重新跑 PROMPT 全部 curl 確認端到端。

**Acceptance criteria:**
- [ ] `app/README.md` 含：簡介、prerequisite（Bun version）、quickstart（`bun install && bun run db:migrate && bun run dev`）、test 指令、目錄說明
- [ ] `bun run check && bun run typecheck && bun test` 全綠
- [ ] PROMPT.md verification 區塊全部 case 手動跑過、結果記錄在 `app/README.md` 或 commit message
- [ ] 倉庫無 stray file（`*.sqlite`、`node_modules/` 都在 `.gitignore` 內）

**Verification:**
- [ ] 全部指令一次跑完無錯
- [ ] 新人 clone 後照 README 能跑起來

**Dependencies:** Task 10
**Files likely touched:** `app/README.md`, （視情況）`.gitignore`
**Estimated scope:** S

---

### ✅ Checkpoint: Complete
- [ ] SPEC.md Success Criteria 全部打勾
- [ ] PROMPT.md 全部 verification 過
- [ ] 沒有 TODO 或 `console.log` 殘留
- [ ] **Human final review** + commit + push

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bun + Drizzle SQLite migration 第一次設定踩坑 | High | Task 2 先做最小可跑的 migration（兩張表）即收工，遇到怪行為不繼續往下擴張 |
| `bun:sqlite` 與 Drizzle 版本相容性 | Med | 鎖 `drizzle-orm` 最新穩定版 + 對應 `drizzle-kit`；Task 1 安裝後立刻在 Task 2 驗證 |
| Cache 與 DB 不一致（PATCH 漏 invalidate） | Med | Task 7 e2e 強制驗 PATCH 後 redirect 立即反映新 URL；Task 8 額外驗 PATCH expires_at 後 cache 立即過期 → 410 |
| `expires_at` 時區處理錯誤 | Med | 一律用 UTC `Date`、SQLite 存 ISO string；e2e 用「過去 1 秒」這種顯式 case 驗 |
| nanoid 在 Bun 環境的 ESM/CJS 問題 | Low | Task 5 unit test 提早暴露；如出問題改用 `crypto.randomBytes` + base62 |
| QR PNG buffer 跨平台差異 | Low | e2e 只驗 magic bytes 與 content-type，不比對整個 byte stream |
| **Drizzle `$onUpdate` 在 SQLite 行為不確定** | Med | Task 2 schema 設定後，Task 7 必驗 PATCH 後 `updatedAt` 變動；若 `$onUpdate` 不觸發 raw `update().set()`，改用顯式 `set({ updatedAt: new Date() })` |
| **e2e 並行執行污染 in-memory DB** | High | `createTestDb()` 永遠回新 instance；route 模組禁止 `import { db }` 直接拿 module singleton（factory injection 強制） |
| **`expires_at` 接受格式不一致**（ISO vs epoch ms） | Low | zod 強制 `z.string().datetime()`（ISO only）；cache entry 型別固定 `string \| null`；DB 用 Drizzle timestamp mode 統一 Date 物件 |

---

## Resolved Decisions（plan-reviewer round 1 後鎖定）

對應 SPEC.md `Resolved Decisions` 表：

1. `BASE_URL` env var（Task 3）
2. Blocklist 寫死於 `lib/url.ts`（Task 4）
3. Analytics 原樣記 IP/UA（Task 10）
4. Cache 無 LRU/TTL（Task 6）
5. Token 長度 = 8（Task 5）
6. **DB 注入用 factory pattern**（Task 3 / Task 6）
7. **`POST /api/qr/create` 接受 `expires_at` body**（Task 6）
8. **Expired token 對 metadata / image / analytics 仍可查**（Task 6 / Task 9 / Task 10）
9. **Deleted token 對所有非 redirect endpoint 都 404**（Task 6 / Task 9 / Task 10）
10. **Verification 用詞**：統一寫「PROMPT verification 全部 case」
11. **`updatedAt` 機制**：Drizzle `$onUpdate` 或顯式 `.set({ updatedAt: new Date() })`（Task 2 + Task 7 e2e 驗）
12. **Cache hit 過期**：回 410 + invalidate 該 entry（Task 8）

> 這 12 點 SPEC 與 plan 都已採用，列在這裡僅為實作時對照。

---

## Parallelization Notes

- **可並行**：Task 4 與 Task 5（兩個獨立 pure lib），都依賴 Task 3 完成。
- **必須序列**：Task 1 → 2 → 3（地基）；Task 6 → 7 → 8（同一條 redirect 流持續擴充）；Task 9 → 10（先 image 再 analytics 不強制，但 10 依賴 8 的 redirect）。
- **批醬如果想加速**：可以一個 session 同時開兩個 file — Task 4 + Task 5 對應的 lib + test 平行寫，再進 Task 6。
