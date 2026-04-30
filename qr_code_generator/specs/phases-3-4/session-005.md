# Session 005 — E_phase4_test

## Goal
補強 Phase 4 e2e，補齊 TASK.md 列出的三個額外 case，使 redirect / image / analytics 三條 path 對 expired 與 fire-and-forget failure 的契約有測試覆蓋。

## What I Did

### 1. Context gathering（parallel Explore agents）
- 確認 D_phase4_build 已實作 image route + analytics route + `recordScan` fire-and-forget。
- 既有 e2e（82 pass / 171 expects）已涵蓋 PROMPT curl #9（image 200 + magic bytes）與 #10（analytics shape + UTC bucketing），缺三個 negative / boundary case。

### 2. 新增 e2e cases（`app/tests/e2e.test.ts`）
1. **`expired token analytics still returns 200 (extra)`** — 行銷活動結束後仍可查歷史流量。建 `expires_at` 為 1 秒前 → GET analytics → 200，body shape 仍正確（`total_scans=0`、`scans_by_day=[]`）。
2. **`expired token image still returns 200 + PNG (extra)`** — 過期後仍能下載自己的 QR 圖。同樣建 past-expiry → GET image → 200 + `content-type: image/png` + PNG magic bytes `89 50 4E 47`。
3. **`Fire-and-forget scan write resilience > scan insert throw → GET /r/:token still 302`** — 在 POST 後 monkey-patch `db.insert` 攔截 `scanEvents` insert 改回 rejected promise，其它 table（`urlMappings` 等）走 originalInsert。GET /r/:token 仍應回 302 + 正確 location；同時用 `console.warn` spy 斷言 `.catch(...)` path 確實被觸發（避免假陽性 — 若有人移掉 `.catch` 仍會被 catch 到，因為 warnings 不會被填滿）。

### 3. Verify
```
bun test       # 85 pass / 0 fail / 185 expects
bun run typecheck  # clean
bun run check      # clean
```
增量：+3 tests / +14 expects（含 console.warn 雙斷言）。

## Decisions / Trade-offs（autonomous，無 AskUserQuestion）
- **Mock 策略**：選 monkey-patch `db.insert` 而非整個 db proxy。理由：原 db 仍要支援 `db.select`（redirect handler 用）、其他 table insert（POST flow）；只攔 `scanEvents` 是 minimal blast radius，貼近 SPEC「fire-and-forget on scan write only」的契約。
- **`console.warn` 斷言**：原本只 silence noise，但這會讓「移除 `.catch(...)`」這種 regression 滑過去（unhandled rejection 在 Bun test 不一定 fail，redirect 仍 302）。改成捕捉並斷言訊息為 `"scan write failed"`，鎖死 contract。
- **Drizzle builder 形狀模仿**：mock 只回傳 `{ values: () => Promise.reject(...) }`，剛好對應 `db.insert(table).values({...}).catch(...)` 的呼叫鏈。這在實作未改 chain shape 前夠用；若未來 chain 變動再升級 mock。

## Files Changed
- `app/tests/e2e.test.ts` — +57 lines（兩個 expired case + 一個 scan-throw case）
- `tasks/todo.md` — Phase 4 Checkpoint 四項主要 bullet 全勾（保留 Human review）
- `specs/phases-3-4/progress.json` — bump session=5、E_phase4_test=passing、next_session_goal=F_phase4_review

## Next Session
`F_phase4_review` — Phase 4 變更做五軸 code review（correctness / readability / architecture / security / performance），follow-ups 寫進 `tasks/todo.md` 的 Phase 4 review section。
