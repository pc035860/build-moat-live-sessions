# Session 003 — C_phase3_review

## Goal
Phase 3（Task 7 PATCH / Task 8 DELETE / expiration / cache invalidation）變更做五軸 code review；follow-ups 寫進 `tasks/todo.md`。

## Skill Loaded
`agent-skills:review`（→ code-review-and-quality）

## Workflow
1. 讀 TASK.md / REFERENCE.md / progress.json / session-001.md / session-002.md。
2. Memory search（quick mode）→ 取得 cache architecture / dumb-storage / 過期處理上下文。
3. 列出 Phase 3 變更檔案（diff `ff08c14..HEAD`）：
   - `app/src/routes/qr.ts`（PATCH / DELETE / `insertWithFreshToken` / canonicalize expires_at / `toMetadataResponse`）
   - `app/src/routes/redirect.ts`（rewrite 6 條 branch）
   - `app/tests/e2e.test.ts`（PATCH / DELETE / Redirect expiration 三個 describe，10 個新 test）
   - `app/tests/qr.routes.test.ts`（新檔，5 個 unit test for `insertWithFreshToken`）
   - `app/src/lib/cache.ts` / `app/src/db/schema.ts` / `app/src/lib/errors.ts`：本 phase **無變動**（Phase 1/2 既存）。
4. Verify Gate（baseline）：
   - `bun test` → 74 pass / 0 fail / 147 expect
   - `bun run typecheck` → 綠
   - `bun run check` → 綠（25 files no fixes）
5. 五軸審查（correctness / readability / architecture / security / performance）。
6. follow-ups 條列寫進 `tasks/todo.md`「Phase 3 Review Follow-ups」段落。

## Findings 概要

### Critical
- 無。

### Important（建議 Phase 4 開工前處理）
- **C-1 / A-1 / P-1** `qr.ts:125-138` PATCH 用 UPDATE + SELECT readback，非原子；改 `.returning()` 一次完成。
- **C-2** `tests/e2e.test.ts:402-430` cache-hit-expired test 留有 dead `created` 變數（無 assertion 引用），純 noise。

### Suggestion
- **R-1** `qr.ts:93-97 / 109-113 / 143-147` 三處重複 `select + 404 if !row || isDeleted` → 抽 `requireLiveRow` helper（Phase 4 會再加兩次）。
- **R-2** PATCH 第二次 SELECT 缺註解（會被 [C-1] 取代）。
- **R-3** 變數名 `expiringCreated` 語感怪。
- **A-2** Phase 4 真的重用 expiry 判斷時再抽 `lib/expiry.ts`。
- **A-3** DELETE response shape 是否對齊 PATCH 全 metadata。
- **S-1** PATCH 422 vs 404 順序洩露 token-existence side-channel（prototype 可接受）。
- **S-2** PATCH/DELETE 無 auth（SPEC 沒要求）。
- **P-2** In-memory cache 無上限，長跑會 OOM（prototype 可接受）。

### 五軸結論
| 軸 | 評價 |
|---|---|
| Correctness | ✅ 6 條 redirect branch / `$onUpdate` / SELECT-INSERT race retry 都正確；唯一非原子點是 PATCH readback。|
| Readability | ✅ 註解充足；helper 與 docstring 到位；3 處 minor 可改善。|
| Architecture | ✅ DI / cache dumb storage / 鎖定決策皆遵循；PATCH 同 [C-1] 可更原子。|
| Security | ✅ `validateUrl` PATCH 有跑、Drizzle parameterised；2 處 prototype-scope 限制。|
| Performance | ✅ 點查 + index + cache fast path；PATCH 多一次 round trip 同 [C-1]。|

## Decisions / Notes
- 本 session 不動程式碼，只審查 + 列 follow-ups（符合 `agent-skills:review` 與 RUN.md 對 review session 的定位）。
- follow-ups 中前三項（C-1 / R-1 / C-2）建議在 Phase 4 開工前處理：因為 Phase 4 會新增 image / analytics 兩條 404-by-token 路徑，先抽 helper 才不會把重複 pattern 攤到 5 處；改 `.returning()` 也適合搭 Phase 4 的 PATCH/DELETE 風格延伸一起做。但這些是建議，非 Phase 4 的硬性前提。

## Verify Gate
- baseline `bun test` / `typecheck` / `check` 全綠（見 Workflow #4）。
- review 報告涵蓋五軸（correctness / readability / architecture / security / performance），不只「沒問題」一行。

## Files Touched
- `tasks/todo.md` — 新增「Phase 3 Review Follow-ups」段落（3 個 Important + 6 個 Suggestion）。
- `specs/phases-3-4/progress.json` — bump session 3、`C_phase3_review` → `passing`、`next_session_goal` → `D_phase4_build`。
- `specs/phases-3-4/session-003.md` — 本檔。

## Next Session
`D_phase4_build` — 實作 Phase 4 Task 9（image route）+ Task 10（analytics + fire-and-forget scan）主體。
