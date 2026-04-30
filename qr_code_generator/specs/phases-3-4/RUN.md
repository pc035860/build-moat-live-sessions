# RUN — phases-3-4 (Long-running SOP)

## Local Test Env
- App: http://localhost:8000
- 啟動指令：`cd app && bun run dev`
- 測試資料：每條 e2e 用 `createTestDb()`（in-memory SQLite + migrations，獨立 instance）
- E2E 方式：**不**使用瀏覽器 / chrome-devtools；以 `app.fetch` + `bun test` 直接打 Hono 應用做端對端，必要時手動跑 `tasks/PROMPT.md` 列的 curl

> ⚠️ **環境注意事項**
>
> - 這是 **Bun + Hono backend** 專案，沒有 UI；本 spec **不**載入 `/e2e-dev-loop` skill。
> - `cd app` 後再跑 bun 指令；`biome.json` 在 `app/` 內，根目錄沒有。
> - SQLite 檔案開發用 `qr.sqlite`，e2e 用 `:memory:`；不要把 dev sqlite 當 e2e 來源。
> - Phase 1 / Phase 2 已完成並 commit；本 spec 涵蓋 Phase 3（Task 7 + 8）+ Phase 4（Task 9 + 10），共 6 個 session。
> - 任何 schema 變動必須跑 `bun run db:generate` 同步 migration（本 spec 預期不需要改 schema）。

## Role & Context
- You are a coding agent continuing a long-running task for `qr_code_generator`.
- This is a fresh context window; do not rely on chat memory.
- **⚠️ 嚴禁使用 AskUserQuestion**：這是 autonomous agent session，不允許任何形式的使用者互動詢問。遇到不確定的情況時，應自行做出合理判斷並繼續執行，或在 session log 中記錄待確認事項。

## Authoritative State (must read before coding)
- `specs/phases-3-4/TASK.md`
- `specs/phases-3-4/REFERENCE.md`
- `specs/phases-3-4/progress.json`（source of truth for checklist & next goal）
- `tasks/plan.md`（Phase 3 / Phase 4 詳細計畫）
- `tasks/todo.md`（勾選進度與 review follow-ups）

## Boundaries (from TASK.md)
Read the Boundaries section in TASK.md. These are hard constraints:
- ✅ **Always**：Execute these without hesitation
- ⚠️ **Ask First**：autonomous mode → 採 MVP 方式自行決定，並在 session log 記錄理由
- 🚫 **Never**：違反一律 immediate `blocked`

## Session Scope Limit
**每個 session 僅完成一項 checklist item。** 完成當前 `next_session_goal` 指定的項目後，即進入收尾流程，**不得**繼續處理下一項（即使下一項看起來只差一點點）。本 spec 預期跑 6 個 session，依序如下：

| # | Checklist Item | Session Goal | 載入的 Skill |
|---|----------------|--------------|--------------|
| 1 | `A_phase3_build` | 實作 Phase 3 Task 7 + Task 8 主體（PATCH / DELETE / cache 過期 / 410 邏輯） | `agent-skills:build` |
| 2 | `B_phase3_test` | 補強 e2e（PROMPT curl #4 ~ #8 + 兩個 expiration 額外 case），確保 `bun test` 全綠 | `agent-skills:test` |
| 3 | `C_phase3_review` | Phase 3 變更做五軸 code review，follow-ups 寫進 `tasks/todo.md` | `agent-skills:review` |
| 4 | `D_phase4_build` | 實作 Phase 4 Task 9 + Task 10 主體（image route + analytics + fire-and-forget scan） | `agent-skills:build` |
| 5 | `E_phase4_test` | 補強 e2e（PROMPT curl #9 / #10 + image PNG magic bytes + scan throw 仍 302 + expired 仍 200） | `agent-skills:test` |
| 6 | `F_phase4_review` | Phase 4 變更做五軸 code review，follow-ups 寫進 `tasks/todo.md` | `agent-skills:review` |

完成 6 之後 `next_session_goal` 設為 `"all_done"`，spec 進入結案。

## Workflow (do not skip or reorder)

1. **Read the authoritative state**（TASK.md / REFERENCE.md / progress.json / 相關 source code）。
2. **Context Gathering（Parallel Explore Agents）**
   - 使用 Explore agent 並行蒐集：本 session 將觸碰的檔案、相關 lib、既有 e2e、Phase 2 已有的 cache / route 風格。
   - 每個 agent 專注不同面向，結果合併使用。
3. **Restate** current checklist 與 `next_session_goal`，並在 session log 寫下「本次要做哪一項」。
4. **載入對應 skill 並執行**（依 `next_session_goal`）：
   - `*_build`（A / D） → 透過 `Skill` tool 載入 **`agent-skills:build`**，按該 skill 的 build → test → verify → commit 流程實作該 phase 的 Task 主體。
   - `*_test`（B / E） → 透過 `Skill` tool 載入 **`agent-skills:test`**，先補失敗測試（依 TASK.md 列出的 PROMPT curl + 額外 case），再讓實作通過；確認 `bun test` 全綠。
   - `*_review`（C / F） → 透過 `Skill` tool 載入 **`agent-skills:review`**，對該 phase 變更做 correctness / readability / architecture / security / performance 五軸審查；review 報告寫進 session log，把 follow-up 條列加到 `tasks/todo.md`「Phase X Review Follow-ups」段落（沒有就新建）。
5. **Verify Gate**（依 checklist item 不同；任一失敗即 `blocked`）：
   - `*_build`：`cd app && bun test && bun run typecheck && bun run check` 必須全綠。
   - `*_test`：除上述全綠外，e2e 必須涵蓋 TASK.md 對應 phase 列出的 PROMPT verification curl 與所有額外 case；缺一即 `blocked`。
   - `*_review`：審查報告必須涵蓋五個面向；只是「沒問題」一行視為未審查，標記 `blocked`。
   - **不得基於推測預判失敗**；先實際跑指令，遇到具體錯誤再標 `blocked` 並附訊息。
6. **Update `specs/phases-3-4/progress.json`**：
   - bump `session`
   - 標記當前 checklist item 為 `passing` 或 `blocked`
   - 更新 `next_session_goal` 為下一個 checklist item，順序：A → B → C → D → E → F → `"all_done"`
   - 更新 `last_updated`、`runner.last_runner`
7. **Write a brief session log**：`specs/phases-3-4/session-XXX.md`
   - 簡述本次做了什麼、跑了哪些指令、遇到什麼決策、產出哪些檔案變更。
   - 若有 ⚠️ Ask First 事項自行採 MVP 解決，須在此明列「決策 / 理由 / 後續可討論點」。
8. **主動 commit 本次進度與修改內容**：
   - 確認本次變更（程式碼、`progress.json`、`session-XXX.md`、`tasks/todo.md` 勾選等）都已加入暫存。
   - 使用 Conventional Commits 格式，session 別寫入 commit subject。建議格式：
     - `feat(qr): phase-3 build — patch + delete + expiration` (A)
     - `test(qr): phase-3 e2e — curl #4~#8 + expiration cases` (B)
     - `chore(qr): phase-3 five-axis review` (C)
     - `feat(qr): phase-4 build — image + analytics + fire-and-forget scan` (D)
     - `test(qr): phase-4 e2e — curl #9 #10 + scan throw + expired aux` (E)
     - `chore(qr): phase-4 five-axis review` (F)
   - 視情況可用 `git commit --no-verify` 跳過 hooks。
   - commit 操作的 timeout 時間設為 30 秒（pre-commit hooks 可能花較久）。
9. **Stop after step 8**。**不要**自行起下一個 session。下一輪由 spec-runner 起新 session 繼續。

## Quality Bar
- `cd app && bun test` 全綠（依當前 phase，PROMPT curl 對應 case 全過）。
- `bun run typecheck` & `bun run check` 全綠。
- 沒有 `console.log` 殘留（`console.warn` 用於 fire-and-forget 容錯例外）。
- redirect handler 對 deleted / expired / not-found 的分支邏輯清楚可讀。
- Phase 1 / 2 既有 test 不可被破壞；Phase 3 完成後不可被 Phase 4 變更破壞。
- 所有時間欄位用 UTC；`scans_by_day.date` 格式 `YYYY-MM-DD`。

## Start Immediately (must do)
讀完本文件後 **不要停下來等待指示**，請立刻開始本 session，按 Workflow 執行：

- 立刻進入 **Workflow step1**。
- 除非遇到 **嚴格 Gate / blocked 條件**，否則不得中途暫停或詢問「要不要繼續」。
- **🚫 絕對禁止使用 `AskUserQuestion` tool**：這是 autonomous session，任何互動詢問都會中斷自動化流程。
  - 遇到設計決策不確定時 → 採用 MVP 方式實作，在 session log 記錄決策理由
  - 遇到技術問題不確定時 → 參考 Phase 2 既有實作（`routes/qr.ts`、`routes/redirect.ts`、`lib/cache.ts`、`tests/e2e.test.ts`）
  - 遇到 blocked 狀態時 → 直接標記 blocked 並記錄原因，不要詢問是否跳過
- **不得**跨 session 一次做完多個 checklist item；session 結束就 stop，下一輪由 spec-runner 起新 session。
- 若當前 `next_session_goal` 是 `"all_done"`，回報 spec 已完成、`bun test` 跑一次最終確認，不再啟動新工作。
