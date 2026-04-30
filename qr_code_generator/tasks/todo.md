# TODO: QR Code Generator (Bun + TS)

> 對照 `tasks/plan.md` 的詳細描述。每個 task 完成後勾選；每個 phase 結束跑 checkpoint。
> **修補版**（plan-reviewer round 1 後）。

---

## Phase 1: Foundation

- [x] **Task 1** — 專案 scaffolding
  - `app/package.json`（scripts: dev / start / test / typecheck / check / format / db:generate / db:migrate）
  - `app/tsconfig.json`（strict）
  - `app/biome.json`
  - `app/.gitignore`
  - 安裝：hono / drizzle-orm / zod / @hono/zod-validator / nanoid / qrcode + dev 依賴
  - ✅ Verify: `bun install && bun run typecheck && bun run check`

- [x] **Task 2** — Drizzle schema + DB client + migrations
  - `src/db/schema.ts`（urlMappings, scanEvents）
  - **`urlMappings.updatedAt` 用 Drizzle `$onUpdate(() => new Date())`**（或 update query 顯式 set）
  - `src/db/client.ts`（`createDb(path)` factory + `type DB` + 預設 prod `db`）
  - `src/db/test-db.ts`（`createTestDb()` for in-memory + migrations，每次呼叫獨立 instance）
  - `drizzle.config.ts`
  - 跑 `bun run db:generate` 產 migration
  - ✅ Verify: `bun run db:migrate` 成功、schema 有兩張表

- [x] **Task 3** — Hono `createApp(db)` factory + error handler + config
  - `src/config.ts`（BASE_URL / PORT / DB_PATH）
  - `src/lib/errors.ts`（ValidationError / NotFoundError / GoneError + `errorHandler` function）
  - **`src/app.ts`：`export function createApp(db: DB): Hono`**（內部建 cache、組 routes、註冊 onError）
  - `src/index.ts`：`createApp(db)` → Bun.serve
  - `GET /health` → 200
  - ✅ Verify: `bun run dev` 可起，curl /health → 200

### ✅ Checkpoint: Foundation
- [x] 一條龍可起服務
- [x] `bun test` 綠
- [x] `typecheck` & `check` 綠
- [x] **Human review**（rolled up at Phase 5 close-out）

### 🟡 Phase 1 Review Follow-ups（review round 1）
> 來源：Phase 1 五軸審查；I-1 / I-2 / I-3 已修，I-4 待辦。

- [x] **I-3** — `tests/schema.test.ts` unique constraint test 改用 `await expect(promise).rejects.toThrow()`
  - 修法：用 `.execute()` 顯式取真 Promise（Drizzle builder 是 thenable，Bun 的 `rejects` 要 `instanceof Promise` 才認）
  - 驗收：mutation 把第二筆 token 改成不重複 → test 真的 fail（確認沒有假陽性）；改回 duplicate → pass
  - **附帶修正**：發現 `.claude/hooks/format-on-edit.sh` 在 `$CLAUDE_PROJECT_DIR` 跑 biome 找不到 `app/biome.json`，fallback 到 default tab；改成 `cd "$CLAUDE_PROJECT_DIR/app"` 後再跑

- [x] **I-4** — `errorHandler` 在 test 環境壓掉 `console.error` 噪音
  - 現況：`tests/health.test.ts` 的 "unknown error → 500" 觸發 `src/lib/errors.ts:37` 的 `console.error`，stderr 直接吐 stack，CI log 訊雜
  - 修法（兩擇一）：
    - (a) `errorHandler` 內判斷 `process.env.NODE_ENV !== "test"` 才 log
    - (b) 在該 test 用 `spyOn(console, "error")` 暫時靜音
  - 偏好 (a)，因為更通用；若 Phase 2 加 logger abstraction，再一起改成注入式 logger
  - 時機：**Phase 2 開新 PR 時順手帶**，不阻塞

---

## Phase 2: First Vertical Slice (Create + Redirect Happy Path)

- [x] **Task 4** — `lib/url.ts` + unit test
  - `normalizeUrl(input)`：scheme/host 小寫、移除預設 port、percent-encoding 大寫
  - `validateUrl(input)`：長度、scheme、blocklist
  - 不做 http→https upgrade
  - 補 case：IPv6 host、userinfo URL 行為明確
  - ✅ Verify: `bun test tests/url.test.ts`（≥ 10 case）

- [x] **Task 5** — `lib/token.ts` + unit test
  - `generateToken(db, opts?)`：`opts` 含 `maxRetries` 與 `nanoidImpl`（注入點）
  - **採 SELECT 偵測**（不採 INSERT catch）
  - 撞到 → retry（**不 sleep**），預設 3 次失敗 → throw
  - Unit test 用 `createTestDb()` + 預埋 token 製造碰撞 + 注入 `nanoidImpl`
  - ✅ Verify: `bun test tests/token.test.ts`（≥ 4 case：成功、retry 1 次、retry 耗盡、`maxRetries=1` 立即失敗）

- [x] **Task 6** — Create + Redirect + Get info（含 cache）+ e2e
  - `src/lib/cache.ts`：`createCache()` factory，entry shape `{ url: string; expiresAt: string | null }`（**不**存 `is_deleted`）
  - **Cache 為 dumb storage**：`cache.get` 不做過期判斷；過期判斷在 redirect handler（Task 8）
  - `POST /api/qr/create`：
    - 接受 `expires_at` body、寫 DB、warm cache（含 `expiresAt`）
    - Response `{token, short_url, qr_code_url, original_url, expires_at}`
  - `GET /r/:token`（cache → DB → 302/404，暫不處理 deleted/expired）
  - `GET /api/qr/:token`：
    - deleted → 404；其他（含 expired）→ 200
    - Response shape：`{token, original_url, short_url, qr_code_url, expires_at, created_at, updated_at}`
  - API JSON 用 snake_case
  - e2e 涵蓋 PROMPT verification curl #1/#2/#3
  - **e2e 額外**：先 GET warm cache → `db.delete` 砍掉 DB row → 再 GET 仍 302（驗 cache hit，無需 spy）
  - ✅ Verify: PROMPT curl #1/#2/#3 全綠 + cache hit 確認

### ✅ Checkpoint: First Slice
- [x] PROMPT verification curl #1/#2/#3 過
- [x] `bun test` 全綠（≥ 16 case）
- [x] **Human review**：factory 注入是否一致（rolled up at Phase 5 close-out）

---

## Phase 3: Mutation Vertical Slice

- [x] **Task 7** — PATCH + cache invalidation + e2e
  - `PATCH /api/qr/:token`：url? + expires_at?（zod，至少一個有值）
  - 找不到（含 deleted）→ 404
  - 更新 url：validate URL、寫 DB、**`updatedAt` 自動更新**、invalidate cache
  - 更新 `expires_at`：寫 DB、invalidate cache（接受 ISO 字串或 null）
  - 回 200 + 更新後 metadata
  - e2e: PROMPT verification curl #4/#5（PATCH 後 redirect 已是新 URL）
  - **e2e 額外**：PATCH 後 `updated_at > created_at`（驗 `$onUpdate`）
  - ✅ Verify: PROMPT curl #4/#5 + updated_at 變動 全綠

- [x] **Task 8** — DELETE + 410/404 + expiration + cache 過期 + e2e
  - `DELETE /api/qr/:token`：soft delete + invalidate cache
  - Redirect 邏輯擴充：deleted → 410、expired → 410、not found → 404
  - **Cache hit 但 entry 已 expiresAt 過 → 直接回 410 + invalidate 該 entry**（不 fallthrough 到 DB）
  - 時間比較用 UTC（`Date.now()` vs `new Date(expiresAt).getTime()`）
  - e2e: PROMPT verification curl #6/#7/#8
  - **e2e 額外 1**：建立 + 設 `expires_at` 為 1 秒前 → GET /r/:token → 410
  - **e2e 額外 2**：先 GET warm cache → PATCH 把 `expires_at` 改成過去 → 立即 GET → 410（驗 PATCH invalidate + expired 邏輯交互）
  - ✅ Verify: PROMPT curl #6/#7/#8 + 兩個 expiration case 全綠

### ✅ Checkpoint: Mutations
- [x] PROMPT verification curl #1 ~ #8 過
- [x] expiration → 410 通過（cache miss / cache hit 兩條 path）
- [x] cache invalidation 在 PATCH/DELETE 都生效
- [x] **Human review**（rolled up at Phase 5 close-out）

### 🟡 Phase 3 Review Follow-ups（review session C）
> 來源：Phase 3 五軸審查（session-003）。沒有 Critical 問題；以下為 Important / Suggestion，建議在 Phase 4 開工前處理前三項。

**值得 Phase 4 開工前帶**

- [x] **C-1 / A-1 / P-1** — `routes/qr.ts:125-138` PATCH 改用 Drizzle `.returning()` 取代 UPDATE+SELECT readback
  - 理由：兩段 round trip 中間理論上可被 DELETE 插入；`.returning()` 一次完成且原子。
  - 同時消除 [R-2] 註解需求。
  - **Done**：`.returning()` 後保留「row was deleted between precondition and UPDATE」的 race 註解；grep 確認本來就沒有 `[R-2]` 字串可清。
- [x] **R-1** — 抽 `requireLiveRow(db, token)` helper（Phase 4 image / analytics 會再 +2 次 404-by-token 分支）
  - 目前 `routes/qr.ts:93-97 / 109-113 / 143-147` 三處重複「select + 404 if !row || isDeleted」。
  - **Done**：與 F-R-1 同一份 patch；qr.ts 5 處替換完成（GET / PATCH 前置 / analytics / image / DELETE），redirect.ts 因為 410 語意不同保留原樣。
- [x] **C-2** — 移除 `tests/e2e.test.ts:402-430` cache-hit-expired test 中 dead `created` 變數
  - 純 noise，無 assertion 引用，刪掉測試更聚焦。
  - **Done**：原行號其實是 `631-659`（todo 寫錯）；dead `created` 與 self-justifying assertion 一併刪除，順手把多餘的 prelude 註解收斂。

**留 backlog（不阻擋 Phase 4 / 5）**

- [ ] **A-2** — 若 Phase 4 重用 expiry 判斷，再抽 `lib/expiry.ts`（提供 `isExpiredIso` / `isExpiredDate`）。現在不抽，避免投機抽象。
- [ ] **A-3** — DELETE response shape 是否要對齊 PATCH 回完整 metadata（含 `is_deleted: true`）。Optional。
- [ ] **R-3** — `expiringCreated` 變數命名換成 `createdWithPastExpiry`（Minor）。
- [ ] **S-1** — PATCH 422 vs 404 順序洩露 token-existence side-channel。Prototype 可接受，未來若加防枚舉再處理。
- [ ] **S-2** — DELETE / PATCH 無 auth，token 持有者即可改/刪。SPEC 沒要求；prototype 範圍內擱置。
- [ ] **P-2** — In-memory cache 無上限（`Map`），長跑會 OOM；production 前需 bounded LRU + TTL。

---

## Phase 4: Auxiliary Endpoints

- [x] **Task 9** — `lib/qr.ts` + image endpoint + e2e
  - `qrPng(text)` → Buffer
  - `GET /api/qr/:token/image`：
    - 不存在 → 404
    - deleted → 404
    - **expired → 仍 200 + PNG**
  - e2e: PROMPT verification curl #9（status 200 + content-type + PNG magic bytes `89 50 4E 47`）
  - **e2e 額外**：expired token GET image 仍 200
  - ✅ Verify: PROMPT curl #9 通過

- [x] **Task 10** — Scan event + analytics endpoint + e2e
  - Redirect handler **不 await** scan 寫入：`void db.insert(scanEvents).values({...}).catch((err) => console.warn(...))`
  - **禁止** `await` scan write（latency 不可包含 DB write）
  - `GET /api/qr/:token/analytics`：
    - 不存在 / deleted → 404
    - **expired → 仍 200**
    - `{token, total_scans, scans_by_day: [{date, count}]}`
  - **`scans_by_day.date` 用 UTC `YYYY-MM-DD`**（升序）
  - e2e: 建立 → 重定向 3 次 → analytics 顯示 3
  - **e2e 額外 1**：mock `db.insert(scanEvents)` throw → GET /r/:token 仍 302（驗 fire-and-forget）
  - **e2e 額外 2**：expired token analytics 仍 200
  - ✅ Verify: PROMPT curl #10 通過

### ✅ Checkpoint: Aux
- [x] PROMPT verification 全部 case 通過（含 image content-type）
- [x] analytics 計數正確、`scans_by_day` 用 UTC `YYYY-MM-DD`
- [x] redirect 不被 scan 寫入 block
- [x] expired token 對 metadata / image / analytics 全部 200
- [x] **Human review**（rolled up at Phase 5 close-out）

### 🟡 Phase 4 Review Follow-ups（review session F）
> 來源：Phase 4 五軸審查（session-006）。一個 Critical（DB bloat via large header），其餘 Important / Suggestion。建議 Phase 5 開工前處理 F-S-1 + F-R-1 + F-P-3 三項。

**🔴 必處理（Phase 5 開工前）**

- [x] **F-S-1 / Critical** — `redirect.ts:72-74` `userAgent` / `ipAddress` 無長度限制
  - 攻擊者可送 1MB `User-Agent` / `X-Forwarded-For`，每次 redirect 灌進 DB → DB bloat / write lock 拖垮 redirect。
  - Fix（MVP）：在 `recordScan` 內 truncate（`userAgent.slice(0, 500)` / `ipAddress.slice(0, 200)`），或 schema 加 length check。
  - **Done**：UA cap 512、IP cap 64；e2e `tests/e2e.test.ts` 加「10KB UA + multi-hop XFF」case。

- [x] **F-P-3** — `redirect.ts:73` X-Forwarded-For 應 split 取第一個 IP
  - 目前整個 `client, proxy1, proxy2` 字串落 DB，語意（IP 應為單值）+ 效能（過長字串）雙重問題。
  - Fix：`xff?.split(",")[0]?.trim() || null`，與 F-S-1 truncate 同 PR 處理。
  - **Done**：與 F-S-1 同一 patch（`recordScan` 內取 first hop）。

- [x] **F-R-1** — 抽 `requireLiveRow(db, token)` helper（5 處重複）
  - `qr.ts:93-97 / 110-113 / 144-148 / 178-183 / 197-201` 都是「select + 404 if !row || isDeleted」。Phase 4 把重複次數從 3 增到 5。
  - 升級 Phase 3 review 的 R-1（同一份 follow-up，Phase 4 之後價值更高）。
  - **Done**：與 R-1 同一份 patch，helper 放在 `routes/qr.ts` 檔尾；redirect.ts 不納入。

**🟡 Production 前處理（不阻擋 Phase 5）**

- [ ] **F-P-1** — `qr.ts:152-156` analytics SELECT 無 `LIMIT`，應 push down `GROUP BY date(scanned_at/1000, 'unixepoch')` 到 SQL。單一 token 累積大量 event 時記憶體會爆。
- [ ] **F-P-2** — `qr.ts:185` image route 每 request 重 encode PNG。加 `Cache-Control: public, max-age=86400, immutable`，或 in-memory PNG LRU。
- [ ] **F-S-2** — X-Forwarded-For 信任問題；上線需 trust-proxy 中介層。
- [ ] **F-S-3** — analytics / image 無 auth，token 持有者即可看；SPEC 未要求，prototype 接受。

**🔵 Backlog / Suggestion**

- [ ] **F-C-1** — `qr.ts:167` `localeCompare` → 直接字串比較（cosmetic）。
- [ ] **F-C-2** — image route 加 `Cache-Control` header（與 F-P-2 重疊）。
- [ ] **F-R-2** — `recordScan(db, c, token)` 不該吃 Hono `Context`，改成 `recordScan(db, { token, userAgent, ipAddress })`。
- [ ] **F-R-3** — `lib/qr.ts:8` 註解「off-thread」改成「returns a Promise so the call doesn't block」。
- [ ] **F-A-1** — analytics in-memory bucketing（已在 code 註解 documented，與 F-P-1 同源）。
- [ ] **F-A-2** — image 用 `new Response()` 而非 `c.body()`；可改 `qrPng` 回 `Uint8Array` 對齊風格。
- [ ] **F-A-3** — `recordScan` 上移到 `lib/scan.ts`（目前 scope 小不抽）。
- [ ] **F-A-4** — `lib/qr.ts` 無 unit test；thin wrapper，價值低，可略。
- [ ] **F-S-4** — `qrPng(text)` docstring 加「caller responsible for length validation」。
- [ ] **F-P-4** — `redirect.ts:62-66` 註解補一句「bun-sqlite is synchronous; fire-and-forget here = error containment, not async I/O」。

---

## Phase 5: Polish

- [x] **Task 11** — README + final check
  - `app/README.md`（quickstart / scripts / 目錄說明）
  - 全綠：`bun run check && bun run typecheck && bun test`
  - 重跑 PROMPT verification 全部 case
  - ✅ Verify: 新 clone 照 README 能跑起來

### ✅ Checkpoint: Complete
- [x] SPEC.md Success Criteria 全部打勾
- [x] PROMPT.md verification 全部過（live `bun run start` + curl #1-#10，包含 PNG magic bytes 與 `total_scans=3`）
- [x] 沒有 TODO / `console.log` 殘留（殘留檢查 agent 確認；`console.log` 僅 boot/migrate 啟動日誌，`console.warn`/`error` 為 fire-and-forget 容錯與全域 errorHandler）
- [x] **Human final review** + commit（push 由批醬手動決定時機）

---

## Quick Reference

| Phase | Tasks | 對應 PROMPT verification |
|-------|-------|--------------------------|
| 1 Foundation | 1, 2, 3 | （健康檢查） |
| 2 First Slice | 4, 5, 6 | curl #1, #2, #3（+ cache hit） |
| 3 Mutations | 7, 8 | curl #4, #5, #6, #7, #8（+ expiration、PATCH→cache 過期） |
| 4 Aux | 9, 10 | curl #9, #10（+ expired 仍可查、scan throw 不影響 redirect） |
| 5 Polish | 11 | 全部重跑 |
