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
- [ ] **Human review**

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
- [ ] **Human review**：factory 注入是否一致

---

## Phase 3: Mutation Vertical Slice

- [ ] **Task 7** — PATCH + cache invalidation + e2e
  - `PATCH /api/qr/:token`：url? + expires_at?（zod，至少一個有值）
  - 找不到（含 deleted）→ 404
  - 更新 url：validate URL、寫 DB、**`updatedAt` 自動更新**、invalidate cache
  - 更新 `expires_at`：寫 DB、invalidate cache（接受 ISO 字串或 null）
  - 回 200 + 更新後 metadata
  - e2e: PROMPT verification curl #4/#5（PATCH 後 redirect 已是新 URL）
  - **e2e 額外**：PATCH 後 `updated_at > created_at`（驗 `$onUpdate`）
  - ✅ Verify: PROMPT curl #4/#5 + updated_at 變動 全綠

- [ ] **Task 8** — DELETE + 410/404 + expiration + cache 過期 + e2e
  - `DELETE /api/qr/:token`：soft delete + invalidate cache
  - Redirect 邏輯擴充：deleted → 410、expired → 410、not found → 404
  - **Cache hit 但 entry 已 expiresAt 過 → 直接回 410 + invalidate 該 entry**（不 fallthrough 到 DB）
  - 時間比較用 UTC（`Date.now()` vs `new Date(expiresAt).getTime()`）
  - e2e: PROMPT verification curl #6/#7/#8
  - **e2e 額外 1**：建立 + 設 `expires_at` 為 1 秒前 → GET /r/:token → 410
  - **e2e 額外 2**：先 GET warm cache → PATCH 把 `expires_at` 改成過去 → 立即 GET → 410（驗 PATCH invalidate + expired 邏輯交互）
  - ✅ Verify: PROMPT curl #6/#7/#8 + 兩個 expiration case 全綠

### ✅ Checkpoint: Mutations
- [ ] PROMPT verification curl #1 ~ #8 過
- [ ] expiration → 410 通過（cache miss / cache hit 兩條 path）
- [ ] cache invalidation 在 PATCH/DELETE 都生效
- [ ] **Human review**

---

## Phase 4: Auxiliary Endpoints

- [ ] **Task 9** — `lib/qr.ts` + image endpoint + e2e
  - `qrPng(text)` → Buffer
  - `GET /api/qr/:token/image`：
    - 不存在 → 404
    - deleted → 404
    - **expired → 仍 200 + PNG**
  - e2e: PROMPT verification curl #9（status 200 + content-type + PNG magic bytes `89 50 4E 47`）
  - **e2e 額外**：expired token GET image 仍 200
  - ✅ Verify: PROMPT curl #9 通過

- [ ] **Task 10** — Scan event + analytics endpoint + e2e
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
- [ ] PROMPT verification 全部 case 通過（含 image content-type）
- [ ] analytics 計數正確、`scans_by_day` 用 UTC `YYYY-MM-DD`
- [ ] redirect 不被 scan 寫入 block
- [ ] expired token 對 metadata / image / analytics 全部 200
- [ ] **Human review**

---

## Phase 5: Polish

- [ ] **Task 11** — README + final check
  - `app/README.md`（quickstart / scripts / 目錄說明）
  - 全綠：`bun run check && bun run typecheck && bun test`
  - 重跑 PROMPT verification 全部 case
  - ✅ Verify: 新 clone 照 README 能跑起來

### ✅ Checkpoint: Complete
- [ ] SPEC.md Success Criteria 全部打勾
- [ ] PROMPT.md verification 全部過
- [ ] 沒有 TODO / `console.log` 殘留
- [ ] **Human final review** + commit + push

---

## Quick Reference

| Phase | Tasks | 對應 PROMPT verification |
|-------|-------|--------------------------|
| 1 Foundation | 1, 2, 3 | （健康檢查） |
| 2 First Slice | 4, 5, 6 | curl #1, #2, #3（+ cache hit） |
| 3 Mutations | 7, 8 | curl #4, #5, #6, #7, #8（+ expiration、PATCH→cache 過期） |
| 4 Aux | 9, 10 | curl #9, #10（+ expired 仍可查、scan throw 不影響 redirect） |
| 5 Polish | 11 | 全部重跑 |
