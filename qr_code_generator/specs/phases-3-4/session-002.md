# Session 002 — B_phase3_test

## Goal
補強 Phase 3 e2e，確保 PROMPT verification curl #4 ~ #8 + 兩個 expiration 額外 case + Task 7 `$onUpdate` 額外 case 都涵蓋；`bun test` / `typecheck` / `check` 全綠。

## Context Audit
讀完 `tests/e2e.test.ts`、`routes/qr.ts`、`routes/redirect.ts`，對照 TASK.md 與 REFERENCE.md 列出 Phase 3 e2e 應有覆蓋：

| 要求 | Test 名 | 狀態 |
|---|---|---|
| #4 PATCH url | `updates url, invalidates cache, redirect reflects new URL` | ✅ 已存在（A 寫入時加） |
| #5 PATCH 後 redirect 是新 URL | 同上 | ✅ |
| #6 DELETE 200 | `soft delete: returns 200, subsequent redirect returns 410` | ✅ |
| #7 deleted → 410 | 同上 | ✅ |
| #8 INVALID → 404 | `returns 404 for unknown token (curl #8 happy slice)` | ✅ |
| Task 8 額外 1: past expires → 410 | `expires_at in past (cache cold) → 410` | ✅ |
| Task 8 額外 2: PATCH expires_at→過去 → 410 | `PATCH expires_at to past invalidates cache and immediate redirect → 410` | ✅ |
| Task 8 額外: cache hit but entry expired → 410 + invalidate | `cache hit but entry expiresAt is past → 410 + cache invalidated` | ✅ |
| **Task 7 額外: PATCH 後 `updated_at > created_at`（驗 `$onUpdate`）** | — | ❌ **缺** |

唯一缺漏項：Task 7 `$onUpdate` verification e2e。

## Work Done
1. **TDD: 寫測試** — 在 `tests/e2e.test.ts` PATCH describe 內新增 `PATCH bumps updated_at past created_at (verifies $onUpdate)`。
   - 因為 `created_at` 用 SQLite `unixepoch()*1000`（整秒）、`updated_at` 用 Drizzle `$onUpdate(() => new Date())`（ms），用 `Bun.sleep(1100)` 跨過下一個整秒邊界，避免在 ms 撞到 0 的極端情況下產生假陰性。
   - 同時驗 `created_at` 在 PATCH 後不變（locking down 行為）。
2. **Prove-It pattern 驗證測試有效**：暫時把 `app/src/db/schema.ts` 的 `.$onUpdate(...)` 拿掉 → 跑該測試 → 確認真的 fail（`Expected: > 1777528263000 / Received: 1777528263000`）→ 還原 schema → 再跑 → pass。證明測試確實會抓到 `$onUpdate` 缺失，不是空跑。

## Verify Gate
```
bun test           → 74 pass / 0 fail / 147 expect
bun run typecheck  → tsc --noEmit clean
bun run check      → biome OK (25 files)
```

## Files Touched
- `app/tests/e2e.test.ts` — 新增 1 個 test
- `tasks/todo.md` — 勾選 Mutations Checkpoint 三項（剩 Human review）
- `specs/phases-3-4/progress.json` — bump session 2、`B_phase3_test` → `passing`、`next_session_goal` → `C_phase3_review`
- `specs/phases-3-4/session-002.md` — 本檔

## Decisions / Notes
- **沒新增 schema/route 變動**：B 階段定位是補測試，build 階段（A）已寫好實作，e2e 補完直接 pass。
- **`Bun.sleep(1100)`**：1.1 秒是「最小 + safety margin」，目的只是確保跨過秒邊界，不是模擬時序。整段 e2e suite 才 1.3s 左右，影響可接受。
- **沒動 `$onUpdate` 機制**：plan REFERENCE 提過萬一 SQLite 不觸發要 fallback 顯式 `set({ updatedAt: new Date() })`，本次驗證證實有觸發，不需 fallback。

## Next Session
`C_phase3_review` — 對 Phase 3 變更做五軸 code review，follow-ups 寫進 `tasks/todo.md` Phase 3 review section。
