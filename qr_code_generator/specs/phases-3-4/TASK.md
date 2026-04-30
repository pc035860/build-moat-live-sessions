# Phases 3 & 4 — Mutations + Auxiliary Endpoints

## Context

接續 `tasks/plan.md` / `tasks/todo.md` 的 **Phase 3（Mutation Vertical Slice）** 與 **Phase 4（Auxiliary Endpoints）**。Phase 1（Foundation）與 Phase 2（First Vertical Slice）已完成並 commit；本 spec 將兩個 phase **連續跑完**，每個 phase 依序在不同 session 跑 build → test → review，共 **6 個 session**。

Source: `tasks/plan.md`（Phase 3 / Phase 4 區段）, `tasks/todo.md`（同上）, `qr_code_generator/SPEC.md`, `qr_code_generator/PROMPT.md`
Target:
- Phase 3：`app/src/routes/qr.ts`, `app/src/routes/redirect.ts`, `app/src/lib/cache.ts`, `app/tests/e2e.test.ts`
- Phase 4：`app/src/lib/qr.ts`, `app/src/routes/qr.ts`, `app/src/routes/redirect.ts`, `app/tests/e2e.test.ts`

## Scope

### Phase 3 — Task 7：`PATCH /api/qr/:token` + cache invalidation + e2e
- zod schema：`url?` + `expires_at?`（至少一個有值，否則 422）
- 找不到 token（含 `is_deleted = true`）→ 404
- 更新 url：`validateUrl` → 寫 DB → `updatedAt` 自動更新 → invalidate cache
- 更新 expires_at：寫 DB → invalidate cache（接受 ISO 字串或 null）
- 200 + 更新後 metadata
- e2e：PROMPT verification curl #4 / #5
- e2e 額外：PATCH 後 `updated_at > created_at`（驗 `$onUpdate`）

### Phase 3 — Task 8：`DELETE` + 410 / 404 + expiration + cache 過期 + e2e
- `DELETE /api/qr/:token` → soft delete + invalidate cache
- redirect 邏輯擴充：deleted → 410、expired → 410、not found → 404
- cache hit 已過期 → 直接 410 + invalidate（不 fallthrough 到 DB）
- 時間比較使用 UTC（`Date.now()` vs `new Date(expiresAt).getTime()`）
- e2e：PROMPT verification curl #6 / #7 / #8
- e2e 額外 1：`expires_at` 為過去 1 秒 → GET /r/:token → 410
- e2e 額外 2：先 GET warm cache → PATCH `expires_at` 改成過去 → 立即 GET → 410

### Phase 4 — Task 9：`lib/qr.ts` + `GET /api/qr/:token/image` + e2e
- `qrPng(text: string): Promise<Buffer>`
- `GET /api/qr/:token/image`：
  - 不存在 → 404
  - `is_deleted = true` → 404
  - **expired → 仍 200 + PNG**
  - 否則 200 + `Content-Type: image/png`
- e2e：PROMPT verification curl #9（status 200 + content-type + PNG magic bytes `89 50 4E 47`）
- e2e 額外：expired token GET image → 仍 200

### Phase 4 — Task 10：Scan event 記錄 + `GET /api/qr/:token/analytics` + e2e
- redirect handler **不 await** scan 寫入：`void db.insert(scanEvents).values({...}).catch(err => console.warn("scan write failed", err))`
- scan event 含 `token` / `scannedAt` / `userAgent`（`c.req.header("user-agent")`）/ `ipAddress`（`x-forwarded-for`）
- **禁止** `await db.insert(scanEvents)`
- `GET /api/qr/:token/analytics`：
  - 不存在 / deleted → 404
  - **expired → 仍 200**
  - `{token, total_scans, scans_by_day: [{date, count}]}`
- `scans_by_day.date` 用 UTC `YYYY-MM-DD`，升序
- e2e：建立 → GET /r/:token 三次 → analytics `total_scans = 3`
- e2e 額外 1：mock `db.insert(scanEvents)` throw → GET /r/:token 仍 302
- e2e 額外 2：expired token analytics 仍 200

### Combined Checkpoint（兩 phase 全做完之後）
- PROMPT verification curl #1 ~ #10 全綠
- expiration → 410 行為驗證通過（cache miss / cache hit 兩條 path）
- cache invalidation 在 PATCH / DELETE 都生效
- analytics 計數正確、`scans_by_day` 用 UTC `YYYY-MM-DD`
- redirect 不被 scan 寫入 block（mock throw 仍 302）
- expired token 對 metadata / image / analytics 全部仍 200
- `cd app && bun run check && bun run typecheck && bun test` 全綠

## Boundaries

### ✅ Always
- 跑 `bun test`、`bun run typecheck`、`bun run check`
- 對 Task 7 / 8 / 9 / 10 加必要的 e2e test 與 unit test
- 對既有實作做 refactor（只要不破壞 Phase 1 / 2 已 passing 的行為）
- 修改 `tasks/todo.md` 把對應完成項勾選
- 每個 session 結束以 Conventional Commits 格式 commit
- SPEC 已鎖定的決策（cache dumb storage / SELECT 偵測 / UTC / soft delete / fire-and-forget scan）直接遵循

### ⚠️ Ask First
- 改 Phase 1 / 2 已完成的 schema 或 lib（除非為了讓 Phase 3 / 4 通過必須改）
- 引入新的 dependency（drizzle / hono / zod / qrcode / nanoid 之外的 npm 套件）
- 把 PROMPT verification 中的 expected case 跳過或改判定
- **autonomous 模式：不得呼叫 AskUserQuestion**。遇到此類情況一律採 MVP 方式自行決定，於 session log 記錄理由與後續可討論點

### 🚫 Never
- 跳過 PROMPT verification curl 對應的 case
- 把 scan event 寫入改成 `await`（latency 不可包含 DB write）
- 改用 INSERT catch 取代 Phase 2 已採的 SELECT 偵測（token collision）
- 跨 spec 提前實作 Phase 5 的 task（README / final check）
- 在 cache 內存 `is_deleted` 欄位（cache 仍是 dumb storage）
- 一個 session 同時跑兩個 checklist item（違反 Session Scope Limit）
- 跳過 commit（每個 session 結束必須 commit）

## Success Criteria

### Phase 3
- [ ] `A_phase3_build` — Task 7 + Task 8 主體實作完成、初步測試到能跑、`bun test` 全綠
- [ ] `B_phase3_test` — e2e 涵蓋 PROMPT curl #4 ~ #8 + 兩個 expiration 額外 case；`bun run typecheck` & `bun run check` 全綠
- [ ] `C_phase3_review` — Phase 3 變更做五軸 code review（correctness / readability / architecture / security / performance），follow-ups 寫進 `tasks/todo.md` 的 Phase 3 review section

### Phase 4
- [ ] `D_phase4_build` — Task 9 + Task 10 主體實作完成（image route + analytics route + fire-and-forget scan）、`bun test` 全綠
- [ ] `E_phase4_test` — e2e 涵蓋 PROMPT curl #9 / #10 + image PNG magic bytes + scan throw 仍 302 + expired token 對 image / analytics 仍 200
- [ ] `F_phase4_review` — Phase 4 變更做五軸 code review，follow-ups 寫進 `tasks/todo.md` 的 Phase 4 review section

### Final Combined Gate
- [ ] PROMPT verification curl #1 ~ #10 全綠（手動或 e2e）
- [ ] `cd app && bun run check && bun run typecheck && bun test` 全綠
- [ ] `tasks/todo.md` 的 Phase 3 / Phase 4 checkbox 全勾

## Reference

See `REFERENCE.md` for the full Phase 3 + Phase 4 plan & todo excerpt and locked design decisions.
