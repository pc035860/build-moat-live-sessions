# QR Code Generator

> Dynamic QR-code shortener built with Bun + Hono + Drizzle (SQLite).

Each short link is a `nanoid(8)` token; the underlying URL and expiry can be
mutated after creation, soft-deletes 410 the redirect, and every redirect
fires a (non-blocking) scan event for analytics.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3 (verified on 1.3.3)
- POSIX shell

No separate Node toolchain needed — Bun handles install, run, test, and the
SQLite driver (`bun:sqlite`).

## Quickstart

```sh
cd app
bun install
bun run db:migrate     # creates qr.sqlite with the two tables
bun run dev            # → http://localhost:8000
```

Smoke test:

```sh
curl -s http://localhost:8000/health
# {"status":"ok"}
```

## Scripts

| Command | Purpose |
| --- | --- |
| `bun run dev` | hot-reload server on `PORT` (default 8000) |
| `bun run start` | one-shot server (no hot reload) |
| `bun test` | unit + e2e suite (in-memory SQLite per test) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run check` | Biome lint |
| `bun run format` | Biome write-format |
| `bun run db:generate` | regenerate migration SQL from `src/db/schema.ts` |
| `bun run db:migrate` | apply migrations to `DB_PATH` |

## Configuration

All config is env-var driven, no `.env` file required for local dev.

| Env var | Default | Notes |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:8000` | used to build `short_url` / `qr_code_url` in API responses |
| `PORT` | `8000` | listening port |
| `DB_PATH` | `qr.sqlite` | SQLite file path (relative to cwd) |

## API

All JSON responses use `snake_case`. Error responses follow `{error: string}`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/qr/create` | create a short link + QR (body: `{url, expires_at?}`) |
| `GET` | `/r/:token` | 302 to the original URL |
| `GET` | `/api/qr/:token` | metadata (`token`, `original_url`, `short_url`, `qr_code_url`, `expires_at`, `created_at`, `updated_at`) |
| `PATCH` | `/api/qr/:token` | update `url` and/or `expires_at` (at least one required) |
| `DELETE` | `/api/qr/:token` | soft-delete |
| `GET` | `/api/qr/:token/image` | PNG render of `short_url` |
| `GET` | `/api/qr/:token/analytics` | `{total_scans, scans_by_day: [{date, count}]}` (UTC `YYYY-MM-DD`, ascending) |
| `GET` | `/health` | liveness probe |

### Deleted vs expired

- **Deleted** (`DELETE` was called): 410 on `/r/:token`; 404 on metadata / image / analytics.
- **Expired** (`expires_at` is in the past): 410 on `/r/:token`; **still 200** on metadata / image / analytics — campaign owners can keep inspecting historical traffic and re-render the QR after the link itself stops resolving.

## Layout

```
app/
├── src/
│   ├── index.ts          # Bun.serve entry
│   ├── app.ts            # createApp(db) factory; mounts routes + onError
│   ├── config.ts         # env var loading
│   ├── lib/              # pure helpers: url, token, cache, qr, errors
│   ├── db/               # schema, client, migrate, test-db, migrations/
│   └── routes/           # qr.ts (CRUD) + redirect.ts (302 + scan log)
├── tests/                # unit + e2e (each spins up its own in-memory DB)
├── drizzle.config.ts
├── biome.json
├── tsconfig.json
└── package.json
```

## Testing

`bun test` runs everything against fresh in-memory SQLite — no on-disk file,
no leftover state between tests. The e2e suite walks every PROMPT.md
verification case (curl #1–#10) plus extras for cache hits,
expired-after-PATCH, scan-write resilience, and oversized-header
truncation.
