# REFERENCE — Phases 3 & 4 (Mutations + Auxiliary)

> 從 `tasks/plan.md` 與 `tasks/todo.md` 摘錄出 Phase 3 + Phase 4 完整脈絡。實作時以本檔 + TASK.md 為準，避免每次都要往回翻整份 plan。

---

## 來源

- `tasks/plan.md` → `## Phase 3: Mutation Vertical Slice`、`## Phase 4: Auxiliary Endpoints`
- `tasks/todo.md` → 對應兩段
- `qr_code_generator/SPEC.md` → mutation / expiration / cache / image / analytics 章節
- `qr_code_generator/PROMPT.md` → verification curl #4 ~ #10

---

## Plan 摘錄 — Phase 3

### Task 7: `PATCH /api/qr/:token` + cache invalidation + e2e

**Description:** 支援更新 `url` 或 `expires_at`（任一可選）。更新後同步 invalidate cache，redirect 下一次會重新 warm。

**Acceptance criteria:**
- zod schema：`url?` + `expires_at?`（至少一個有值，否則 422）
- 找不到 token（`is_deleted = true` 視為找不到）→ 404
- 更新 `url` 時呼叫 `validateUrl`、寫 DB、`updatedAt` 自動更新（透過 schema `$onUpdate` 或顯式 `set({ updatedAt: new Date() })`）、invalidate cache
- 更新 `expires_at` 時寫 DB、invalidate cache（接受 ISO 字串或 `null` 清除）
- 回 200 + 更新後 metadata（與 Task 6 GET 同 shape）
- e2e：建立 → PATCH 改 URL → 再次 GET /r/:token 應導向新 URL（PROMPT curl #4 / #5）
- e2e 額外：PATCH 後 `GET /api/qr/:token` 的 `updated_at` 必須晚於 `created_at`

**Files likely touched:** `app/src/routes/qr.ts`, `app/src/lib/cache.ts`, `app/tests/e2e.test.ts`

---

### Task 8: `DELETE` + 410 (deleted/expired) + 404 (non-existent) + e2e

**Description:** 軟刪除（`isDeleted = true`），同步 invalidate cache。Redirect 邏輯擴充：deleted → 410、expires_at 過了 → 410、token 從未存在 → 404。Cache hit 也要尊重 `expiresAt` —— 命中即過期 → 直接回 410 + invalidate 該 entry。

**Acceptance criteria:**
- `DELETE /api/qr/:token`：找不到 → 404；找到 → `is_deleted = true`、invalidate cache、回 200
- `GET /r/:token` 邏輯擴充：
  - 查不到 → 404
  - `is_deleted = true` → 410
  - `expires_at` 過了 → 410
  - 否則 → 302 + warm cache
- Cache hit 但 entry 已 `expiresAt` 過 → 直接回 410 + invalidate 該 entry（不 fallthrough 到 DB）
- 時間比較使用 UTC（`Date.now()` vs `new Date(expiresAt).getTime()`）
- e2e 覆蓋 PROMPT curl #6（DELETE 200）、#7（deleted → 410）、#8（INVALID → 404）
- e2e 額外 1：建立 token + 設 `expires_at` 為 1 秒前 → GET /r/:token → 410
- e2e 額外 2：先 GET /r/:token warm cache → PATCH `expires_at` 改成過去 1 秒 → 立即 GET /r/:token → 410

**Files likely touched:** `app/src/routes/qr.ts`, `app/src/routes/redirect.ts`, `app/src/lib/cache.ts`, `app/tests/e2e.test.ts`

---

### Phase 3 Checkpoint（plan.md）
- PROMPT verification curl #1 ~ #8 全綠
- expiration → 410 行為驗證通過
- cache invalidation 在 PATCH/DELETE 都生效
- Human review：redirect handler 的分支邏輯是否清楚

---

## Plan 摘錄 — Phase 4

### Task 9: `lib/qr.ts` + `GET /api/qr/:token/image` + e2e

**Description:** `qrPng(shortUrl)` 用 `qrcode` package 生成 PNG buffer。Route 對 deleted token 回 404；**expired token 仍可查（回 PNG）**，因為使用者可能想看自己過期的 QR 圖片。

**Acceptance criteria:**
- `src/lib/qr.ts`：`qrPng(text: string): Promise<Buffer>`
- `GET /api/qr/:token/image`：
  - 不存在 → 404
  - `is_deleted = true` → 404
  - expired → **仍回 200 + PNG**（與 GET metadata 一致）
  - 否則回 PNG（`Content-Type: image/png`）
- e2e：PROMPT curl #9 → status 200 + content-type `image/png`，body 是合法 PNG（檢查 magic bytes `89 50 4E 47`）
- e2e 額外：expired token GET image → 仍 200 + PNG

**Files likely touched:** `app/src/lib/qr.ts`, `app/src/routes/qr.ts`, `app/tests/e2e.test.ts`

---

### Task 10: Scan event 記錄 + `GET /api/qr/:token/analytics` + e2e

**Description:** Redirect 成功時寫 `scanEvents`（fire-and-forget，不 block 302 回應）。Analytics route 查 `total_scans` 與 `scans_by_day`。Deleted → 404；**expired 仍可查**（行銷活動結束後仍想看歷史流量）。

**Acceptance criteria:**
- Redirect handler **不 await** scan event 寫入；實作為 `void db.insert(scanEvents).values({...}).catch((err) => console.warn("scan write failed", err))`，handler 主流程立即 return 302
- Scan event 含 `token`、`scannedAt`、`userAgent`、`ipAddress`
- **禁止** `await db.insert(scanEvents)...`
- `GET /api/qr/:token/analytics`：
  - 不存在 → 404
  - `is_deleted = true` → 404
  - expired → **仍 200**
  - 否則回 `{token, total_scans, scans_by_day: [{date, count}]}`
- `scans_by_day` 按 `date` 升序；`date` 格式 `YYYY-MM-DD`，**用 UTC**
- e2e：建立 → GET /r/:token 三次 → analytics → `total_scans = 3`
- e2e 額外 1：mock `db.insert(scanEvents)` throw → GET /r/:token 仍回 302
- e2e 額外 2：expired token analytics 仍 200

**Files likely touched:** `app/src/routes/redirect.ts`, `app/src/routes/qr.ts`, `app/tests/e2e.test.ts`

---

### Phase 4 Checkpoint（plan.md）
- PROMPT verification 全部 case 通過（含 image content-type 檢查）
- analytics 計數正確、`scans_by_day` 用 UTC `YYYY-MM-DD`
- redirect 不被 scan 寫入 block（mock throw 仍 302）
- expired token 對 metadata / image / analytics 全部仍 200

---

## 已鎖定的設計決策（plan.md Resolved Decisions）

對 Phase 3 / Phase 4 直接相關的：

- **`updatedAt` 機制**：Drizzle `$onUpdate` 或顯式 `.set({ updatedAt: new Date() })`（Phase 1 schema 已設定，Task 7 e2e 必驗）
- **Cache hit 過期**：回 410 + invalidate 該 entry（Task 8）
- **Cache 邏輯位置**：cache 是 dumb storage，過期判斷與 invalidate 寫在 redirect handler（Task 8）
- **Token collision 偵測**：採 SELECT 偵測，不採 INSERT catch（Phase 2 Task 5 已實作）
- **時區一律 UTC**：`expires_at` 是 ISO string；`scans_by_day.date` 用 UTC `YYYY-MM-DD`
- **DB 注入用 factory pattern**：每條 e2e 用獨立 `createTestDb()` instance，禁 module-level singleton
- **Expired vs deleted 對非 redirect 端點區別**：redirect 兩者皆 410；metadata / image / analytics：deleted → 404，expired → 仍可查
- **Scan event 寫入 timing**：`void db.insert(...).catch(...)` 不 await
- **Prototype scale 假設**：單機 prototype，不做 WAL / connection pool

---

## Risk 對照（plan.md Risks 表）

| Risk | Mitigation |
|------|------------|
| Cache 與 DB 不一致（PATCH 漏 invalidate） | Task 7 e2e 強制驗 PATCH 後 redirect 立即反映新 URL；Task 8 額外驗 PATCH expires_at 後 cache 立即過期 → 410 |
| `expires_at` 時區處理錯誤 | 一律用 UTC `Date`、SQLite 存 ISO string；e2e 用「過去 1 秒」這種顯式 case 驗 |
| Drizzle `$onUpdate` 在 SQLite 行為不確定 | Task 7 必驗 PATCH 後 `updatedAt` 變動；若 `$onUpdate` 不觸發 raw `update().set()`，改用顯式 `set({ updatedAt: new Date() })` |
| QR PNG buffer 跨平台差異 | e2e 只驗 magic bytes 與 content-type，不比對整個 byte stream |
| e2e 並行執行污染 in-memory DB | `createTestDb()` 永遠回新 instance；route 模組禁止 `import { db }` 直接拿 module singleton |
| Scan event 寫入失敗影響 redirect | fire-and-forget + `.catch(console.warn)`；e2e 必驗 mock throw 仍 302 |

---

## Phase 對應 PROMPT verification

| Phase | Tasks | curl |
|-------|-------|------|
| 3 Mutations | 7, 8 | #4, #5, #6, #7, #8（+ expiration、PATCH→cache 過期） |
| 4 Aux | 9, 10 | #9, #10（+ expired 仍可查、scan throw 不影響 redirect） |

---

## 其他注意事項

- API JSON 全 snake_case
- `expires_at` 的 zod schema 用 `z.string().datetime().nullable().optional()`
- soft delete = `is_deleted = true`，不真正刪除 row；deleted token 不再進 cache
- Phase 5（README / final check）**不在本 spec 範圍**，留到 spec 全綠後另行處理
