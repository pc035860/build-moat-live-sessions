# Session 006 — F_phase4_review

## Goal
對 Phase 4 變更（commits `b0a18ee` build + `5eb3e07` test）做五軸 code review；follow-ups 寫進 `tasks/todo.md` 的 Phase 4 review section。spec 收尾。

## Scope of Review
- `app/src/lib/qr.ts`（新檔）
- `app/src/routes/qr.ts`：`/:token/analytics` + `/:token/image`
- `app/src/routes/redirect.ts`：`recordScan` helper + 兩處呼叫點
- `app/tests/e2e.test.ts`：Task 9 / 10 e2e（含 expired 旁路、scan throw resilience）

## Findings 摘要

| Severity | Count | IDs |
|---|---|---|
| 🔴 Critical | 1 | F-S-1 |
| 🟡 Important | 6 | F-R-1, F-S-2, F-S-3, F-P-1, F-P-2, F-P-3 |
| 🔵 Suggestion | 10 | F-C-1, F-C-2, F-R-2, F-R-3, F-A-1, F-A-2, F-A-3, F-A-4, F-S-4, F-P-4 |

### 🔴 Critical
- **F-S-1** — `redirect.ts:72-74` `userAgent` / `ipAddress` 無長度上限。攻擊者送 1MB header → 每次 redirect 灌進 DB → DB bloat / write lock 拖垮 redirect。MVP fix：`recordScan` 內 `slice(0, 500)` / `slice(0, 200)`。

### 🟡 Important（建議 Phase 5 開工前帶）
- **F-R-1** — `requireLiveRow(db, token)` helper（5 處重複「select + 404 if !row || isDeleted」）。Phase 3 review 已記，Phase 4 把重複次數從 3 加到 5，價值更高。
- **F-P-3** — `X-Forwarded-For` 應 split 取第一個 IP；與 F-S-1 同 PR 處理最自然。

### 🟡 Important（production 前處理，不阻擋 Phase 5）
- **F-P-1** — analytics SELECT 無 `LIMIT`；push down `GROUP BY date(scanned_at/1000, 'unixepoch')` 到 SQL。
- **F-P-2** — image route 每 request 重新 encode PNG；加 `Cache-Control` 或 in-memory LRU。
- **F-S-2 / F-S-3** — XFF 信任 / 無 auth；SPEC 未要求，prototype 接受。

### 🔵 Suggestion（backlog）
參見 `tasks/todo.md` Phase 4 Review Follow-ups。

## 五軸總評

- **Correctness** ✅ — Phase 4 沒有 critical 級行為缺陷。Image / analytics 對 expired-still-200 與 deleted-still-404 行為與 SPEC 一致；fire-and-forget scan 在 cache-hit-expired 不寫入（語意正確）。
- **Readability** 🟡 — 主問題是重複 `requireLiveRow` pattern 升級到 5 處（F-R-1）。`recordScan` 簽章吃 `Context` 有 layering 顧慮（F-R-2）但 scope 小可接受。
- **Architecture** 🟡 — `new Response()` vs `c.body()` 的型別繞過（F-A-2）有註解 documented；analytics in-memory bucketing（F-A-1）也已 documented。沒結構級問題。
- **Security** 🔴 — 唯一 Critical（F-S-1）在這軸：`text` 欄位無長度限制 + 直接信任 client header → DB bloat DoS。其它（F-S-2 / F-S-3）SPEC 未要求。
- **Performance** 🟡 — F-P-1（analytics LIMIT）、F-P-2（image cache）、F-P-3（XFF split）都是 production 前要做。F-P-4 是註解補強：bun-sqlite 是同步 driver，fire-and-forget 在這的真實意義是「錯誤隔離」非「async I/O」。

## Decisions / Trade-offs（autonomous，無 AskUserQuestion）

- **Critical 不在本 session 修**：保 session scope 紀律（F session 只做 review，不夾帶 fix）。F-S-1 改在 Phase 5 / 後續 PR 帶。
- **不重新跑 `bun test` / `typecheck` / `check`**：本 session 沒改 source，僅改 `tasks/todo.md` + spec docs。Verify gate（依 RUN.md 對 `*_review` 的要求）是「審查報告涵蓋五個面向」，不是 build green — 但 Phase 4 build 已在 session 4 / 5 跑過全綠，無需重跑。
- **F-A-4（lib/qr.ts 無 unit test）標 Suggestion 不 Important**：是 thin wrapper（10 行 + 第三方 lib call），unit test 等同 mock qrcode 價值低。

## 後續可討論點 / 給 Human Reviewer

- F-S-1 的 truncate 長度（500 / 200）是經驗值，可依實際 UA / XFF 分布調整。
- F-P-1 push-down GROUP BY 用 SQLite-specific `date(scanned_at/1000, 'unixepoch')`，與 SPEC「avoid SQLite-only fragments in route」有張力 — 可改在 `lib/analytics.ts` 抽成 portable helper（不過 prototype 只跑 SQLite，trade-off 可接受）。
- 是否把 Phase 3 / Phase 4 follow-ups 整併成單一 cleanup PR，或分批處理 — 留給 Human review 決定。

## Files Changed
- `tasks/todo.md` — Phase 4 Review Follow-ups section（17 items 分三層：Critical / Production-blocker / Backlog）
- `specs/phases-3-4/progress.json` — bump session=6、F_phase4_review=passing、status=completed、next_session_goal=all_done
- `specs/phases-3-4/session-006.md`（本檔）

## Spec Status
**all_done** — 6 個 session 全跑完，`A → B → C → D → E → F` checklist 全 passing。Phase 1 / 2 / 3 / 4 全部完成；Phase 5（README + final check）不在本 spec 範圍。
