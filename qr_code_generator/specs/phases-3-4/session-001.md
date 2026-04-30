# Session 001 — A_phase3_build

## Goal
實作 Phase 3 Task 7 (PATCH) + Task 8 (DELETE / expiration / cache 過期 / 410) 主體。

## Skill Loaded
`agent-skills:build`（含 incremental-implementation + TDD 指引）

## Workflow

1. 讀 TASK.md / REFERENCE.md / progress.json / 既有 source code（`routes/qr.ts` / `routes/redirect.ts` / `lib/cache.ts` / `tests/e2e.test.ts` / `db/schema.ts` / `lib/errors.ts`）。
2. TDD：
   - 先寫 9 個 failing tests 涵蓋 PATCH（更新 url、更新 expires_at + null、empty body 422、unknown 404、invalid url 422）+ DELETE（200、unknown 404、deleted GET 404）+ Redirect expiration（過去 expires_at → 410、PATCH 改過去 → 410、cache hit 過期 → 410 + invalidate）。
   - 跑 `bun test tests/e2e.test.ts` 確認 9 fail。
3. 實作：
   - `src/routes/qr.ts`：
     - 新增 `patchSchema`（兩欄都 optional；handler 內 throw `ValidationError` 處理「沒給任何欄位」→ 422）。
     - 新增 `PATCH /:token`：找不到/已 deleted → 404；`url` 走 `validateUrl`；`expires_at` 接受 ISO / null；`updatedAt` 由 schema `$onUpdate` 處理；最後 `cache.invalidate(token)` + 回 metadata。
     - 新增 `DELETE /:token`：找不到/已 deleted → 404；`set({ isDeleted: true })` + invalidate cache + 回 `{token, deleted: true}`。
     - 抽 `toMetadataResponse(row)` helper。
   - `src/routes/redirect.ts`（rewrite）：
     - cache hit + 過期 → `cache.invalidate` + `GoneError`
     - cache miss → DB；`!row` → 404、`isDeleted` → 410、`expiresAt <= Date.now()` → 410（**不** warm cache，避免存 stale 過期 entry）；否則 warm + 302。
     - 抽 `isExpired(iso)` helper。
4. Verify Gate：
   - `bun test` → 73 pass / 0 fail（含原 Phase 1/2 + 9 個新 case）。
   - `bun run typecheck` → 綠。
   - `bun run check` → 綠（25 files no fixes）。

## 決策（autonomous，記錄理由）

- **PATCH empty body 用 handler-level `ValidationError` 而非 zod `.refine()`**：
  - 原因：zod fail 透過 `@hono/zod-validator` 預設回 400，但 SPEC 要求「shape 通過但語義空」回 422；手動丟 `ValidationError` 比客製 zValidator hook 簡潔。
  - 後續可討論：是否所有 PATCH-style endpoint 都統一這個策略。
- **expired row 不寫入 cache**：
  - 原因：cache 是 dumb storage；若 warm 已過期 entry，下一次 request 還是會走 cache 過期分支命中 410，但會多一次 invalidate 寫入。直接不 warm 更乾淨。
  - 等價選項：warm 後馬上 invalidate；採前者。

## 檔案變更

- `app/src/routes/qr.ts`：PATCH / DELETE handler + `patchSchema` + `toMetadataResponse` helper。
- `app/src/routes/redirect.ts`：rewrite 為 cache-hit-expired / deleted / expired / not-found 分支版本。
- `app/tests/e2e.test.ts`：新增 PATCH / DELETE / Redirect expiration 三個 describe 區塊，共 9 個 test。

## Verify Output

- `bun test`：73 pass, 0 fail, 145 expect()
- `bun run typecheck`：no error
- `bun run check`：Checked 25 files in 29ms. No fixes applied.

## Next

`B_phase3_test`：補強 e2e 涵蓋 PROMPT verification curl #4 ~ #8 全部對應 case + 兩個 expiration 額外 case 的完整描述（目前 build session 已順手做掉一些，B session 再對齊 PROMPT 用語並補齊）。
