# Session 004 — D_phase4_build

## Goal
實作 Phase 4 Task 9（image route）+ Task 10（fire-and-forget scan + analytics route）主體。
TDD 兩個 vertical slice，各自 RED → GREEN，最後一次 commit。

## Slices

### Slice 1 — Task 9 image route
- **RED** — 加 3 個 e2e（`tests/e2e.test.ts:370-409` 區段）：
  - GET image → 200 + `image/png` + PNG magic bytes
  - unknown token → 404
  - soft-deleted → 404
  - 第一個 test 失敗確認 RED（其餘兩個是 default-404 fallback，留作 guard）。
- **GREEN**：
  - 新增 `app/src/lib/qr.ts` — `qrPng(text)` 包 `qrcode.toBuffer({ type: "png" })`。
  - `app/src/routes/qr.ts` 加 `GET /:token/image`：select row → 不存在 / `isDeleted` → 404，否則 `qrPng(shortUrl(token))` 回 PNG。
  - **TS 修正**：`c.body(buf, ...)` 因 `Buffer<ArrayBufferLike>` 與 `Uint8Array<ArrayBuffer>` 嚴格不相容報 TS2769；改用 `new Response(png, { status, headers })` 旁路，runtime 行為一致。

### Slice 2 — Task 10 scan + analytics
- **RED** — 加 5 個 e2e：
  - 3 次 redirect → analytics `total_scans = 3` + `scans_by_day` 一桶 / YYYY-MM-DD shape
  - 帶 `user-agent` / `x-forwarded-for` → DB 紀錄欄位正確
  - 直接 seed 4 個跨日 scan event → `scans_by_day` UTC 升序、跨日 bucket 正確
  - unknown token → 404
  - soft-deleted token → 404
- **GREEN**：
  - `app/src/routes/redirect.ts`：抽 `recordScan(db, c, token)` helper，`void db.insert(scanEvents).values({...}).catch((err) => console.warn(...))`，**不 await**。在 cache hit 有效 + cache miss warm 兩條 302 path 各呼叫一次。
  - `app/src/routes/qr.ts` 加 `GET /:token/analytics`：select row → 404 if 不存在 / deleted；select scan events → in-memory bucket by `toISOString().slice(0,10)`（UTC YYYY-MM-DD）→ 升序排序回 `{token, total_scans, scans_by_day}`。

## Verify Gate（全綠）
- `bun test` — **82 pass / 0 fail / 171 expect()**
- `bun run typecheck` — clean（`tsc --noEmit` 無輸出）
- `bun run check` — clean（`biome check .` 26 files / no fixes）

## 決策（autonomous，採 MVP）

1. **Image route 回傳機制**：用標準 `Response` 構造子取代 `c.body(buf)`，因為 Hono 的 `Data` 型別不收 Node `Buffer`。runtime 一致；後續若要對齊風格可再抽 `c.newResponse` 或把 `qrPng` 改回 `Uint8Array`。
2. **Analytics 聚合策略**：in-memory `Map` bucket，沒下推 SQL `strftime`。理由：prototype 規模事件量小、避免 SQLite-only 片段污染 route，可讀性優先。後續若 per-token event 量大再 push down。
3. **Scan write fire-and-forget pattern**：用 `void ... .catch()`，drizzle bun-sqlite 在 thenable 觸發時同步執行 SQL，後續 `await` 任何東西即把 microtask drain 完成寫入。e2e 仍加 10ms `setTimeout` buffer 保穩定（E session 會驗 mock-throw 時 latency 不放大）。
4. **Scope**：Phase 3 review follow-ups（C-1 / R-1 / C-2）**不**在本 session 處理 — 保 session scope 紀律，留給後續 session 或 Phase 5。

## 後續可討論點 / 給 reviewer
- `recordScan` 在 redirect.ts，未來如果 cache hit / DB warm 兩處還要再加 metadata，可以考慮把 helper 上移或改用 middleware；現階段重複呼叫一行很合理。
- `scans_by_day` 沒做空陣列 vs 缺欄位的差異處理；目前 token 若無事件回 `[]`，符合 SPEC 含意。

## Files changed
- `app/src/lib/qr.ts`（new）
- `app/src/routes/qr.ts`（+image route, +analytics route, +scanEvents import）
- `app/src/routes/redirect.ts`（+recordScan helper, +scanEvents import, +scan write 在兩條 302 path）
- `app/tests/e2e.test.ts`（+3 image tests, +5 analytics tests, scanEvents import）
- `tasks/todo.md`（Task 9 / Task 10 勾選）
- `specs/phases-3-4/progress.json`（session 4 / D_phase4_build = passing / next = E_phase4_test）
- `specs/phases-3-4/session-004.md`（本檔）

## Next session
`E_phase4_test` — 補強 e2e（PROMPT curl #9 / #10 + image PNG magic bytes 已有 / scan throw 仍 302 / expired token 對 image / analytics 仍 200）。
