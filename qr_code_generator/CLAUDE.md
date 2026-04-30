# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo Layout

This repo is an exercise. The actual implementation lives in **`app/`** (Challenge Track, Bun + TypeScript). The `scaffold/` directory is a Python/FastAPI starter for the Guided Track and is **not** the active codebase — ignore it unless explicitly asked.

Top-level files:
- `PROMPT.md` — original spec + design questions + curl verification cases
- `SPEC.md` — implementation decisions for the Challenge Track
- `tasks/plan.md`, `tasks/todo.md` — phased build plan & status
- `specs/handover/`, `specs/phases-3-4/` — checkpoint reports

All build/test commands below must be run from inside `app/`.

## Commands (run in `app/`)

```bash
bun install
bun run db:migrate         # apply migrations to DB_PATH (default: qr.sqlite)
bun run dev                # hot-reload server on PORT (default 8000)
bun run start              # one-shot run, no reload
bun test                   # full suite (in-memory SQLite per test)
bun test tests/url.test.ts # single file
bun test -t "expired"      # filter by test name
bun run typecheck          # tsc --noEmit
bun run check              # biome lint
bun run format             # biome write-format
bun run db:generate        # regenerate migration SQL from src/db/schema.ts
```

A PostToolUse hook (`.claude/hooks/format-on-edit.sh`) runs `biome check --write` on every Edit/Write inside `app/`. It always exits 0; residual lint errors surface on the next read.

Env vars (no `.env` needed): `BASE_URL`, `PORT`, `DB_PATH`. `BASE_URL` is baked into `short_url` / `qr_code_url` in JSON responses, so changing it changes API output.

## Architecture

### App wiring (`src/app.ts`)
`createApp(db)` is a factory that mounts routes and one shared in-process cache. Tests build their own app per test with a fresh in-memory DB; `src/index.ts` is the only place that uses the singleton `db` from `src/db/client.ts`. **Pass `db` explicitly** — don't import the singleton inside route handlers.

Routes:
- `GET /` → bundled HTML (string literal in `src/web.ts`, served via `c.html()`)
- `GET /health`
- `/api/qr/*` → `routes/qr.ts` (CRUD + image + analytics)
- `/r/*` → `routes/redirect.ts` (302 + scan log)
- `app.onError(errorHandler)` translates app errors → JSON

### Error model (`src/lib/errors.ts`)
Three custom classes: `ValidationError` (422), `NotFoundError` (404), `GoneError` (410). Throw them from anywhere; `errorHandler` formats `{error: string}`. Anything else → 500.

Note: `ValidationError → 422`, not 400. This is a deliberate split from zod's default 400. The PATCH endpoint keeps its zod schema permissive (all fields optional) and throws `ValidationError` manually for "shape parsed but semantically empty" (e.g. PATCH with `{}`). Don't tighten the zod schema to reject this — it would return 400 instead of the 422 the spec wants.

### Deleted vs Expired (load-bearing distinction)
This split shows up in every read endpoint and most tests:

| State | `/r/:token` | `/api/qr/:token` (metadata) | `/image`, `/analytics` |
| --- | --- | --- | --- |
| Deleted (`isDeleted=true`) | 410 | **404** | **404** |
| Expired (`expiresAt` in past) | 410 | **200** | **200** |

Rationale: campaign owners should keep inspecting historical traffic and re-rendering the QR after the link itself stops resolving — but a soft-deleted record is gone for everyone.

`requireLiveRow(db, token)` in `routes/qr.ts` enforces "exists and not deleted" (ignores expiry). Don't reuse it for the redirect path — that one needs the 410 branch. The redirect handler does its own row inspection.

### Cache (`src/lib/cache.ts`)
Plain `Map`. **Invariant: only live URLs are cached.** Expired rows must NOT be warmed in (see `routes/redirect.ts` cache-miss branch — it throws `GoneError` before the `cache.set`). The cache is intentionally dumb: `get` doesn't check expiry; the redirect handler owns expiry logic and calls `invalidate` when an entry is past `expiresAt` or after a mutating route. Mutations (PATCH, DELETE) must `cache.invalidate(token)`.

### Scan logging (`routes/redirect.ts`)
Fire-and-forget `void db.insert(...).catch(...)`. **Never `await`** — redirect latency cannot include an analytics insert, and a disk-full / locked DB must not bubble out and 500 the redirect. User-Agent is hard-capped at 512 chars; `X-Forwarded-For` is split on `,` and only the first hop is kept (truncated to 64), so an attacker-controlled chain can't bloat `scan_events`.

### Token generation (`src/lib/token.ts` + `routes/qr.ts`)
Two-layer collision handling:
1. `generateToken(db)` — SELECT-based collision check, retries up to 3× without sleep.
2. `insertWithFreshToken(db, ...)` — wraps the INSERT and retries once on a UNIQUE constraint violation (covers the race window between SELECT and INSERT).

Both layers exist on purpose. Don't collapse them. `tokenFactory` is injectable so tests can deterministically force the retry path.

### PATCH atomicity
PATCH uses `.update(...).returning()` to make UPDATE + readback atomic — no window for a concurrent DELETE to slip between writing and reading our own row. If `.returning()` yields no row, we throw `NotFoundError` (the row was deleted between the precondition select and the UPDATE).

### Time
`expires_at` is canonicalised to a UTC ISO string at create time and stored as `timestamp_ms`. All comparisons use `Date.now()` vs `expiresAt.getTime()`. Analytics days are bucketed in-memory by `toISOString().slice(0, 10)` (UTC `YYYY-MM-DD`, ascending) — at prototype scale this beats pushing SQLite-specific `strftime` into the query.

### DB & tests
- Production: `src/db/client.ts` opens a file via `bun:sqlite` and wraps with Drizzle.
- Tests: `src/db/test-db.ts` opens `:memory:` and applies migrations from `src/db/migrations/`. Each test file builds its own DB + app — there is no shared fixture state.
- Migrations are committed under `src/db/migrations/`. `db:generate` regenerates SQL from `src/db/schema.ts`; `db:migrate` applies them.

## Conventions

- All JSON responses use `snake_case`; internal TS code uses `camelCase`. The boundary is the route handler (see `toMetadataResponse` in `routes/qr.ts`).
- `strict: true` TS, `noExplicitAny` enforced, `useImportType` enforced — use `import type` for type-only imports.
- Biome owns formatting (2-space, 100-col, double quotes, trailing commas).
- The PNG endpoint returns `new Response(png, ...)` directly because Hono's `c.body()` typings reject Node `Buffer`. Don't try to "fix" this — the runtime accepts it fine.
