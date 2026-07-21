# UCL 2026/27 Prediction App — Build Blueprint & Handoff

> **How to use this document:** the app will be built on **your local machine** (Claude Code local),
> which has Docker + full internet + persistent disk — everything the cloud sandbox lacked.
> Clone this repo locally, then point a local Claude Code session at this file:
> *"Build the app described in `UCL_APP_BLUEPRINT.md`, starting with Phase 0 then the MVP."*
> The scoring domain it ports is fully specified in **`PROJECT_DOCUMENTATION.md`** (same repo) — read both.

> Working name: **placeholder "Toto CL"** (rename anytime). Hebrew/RTL, ultra‑professional, target Google Play.

---

## Context — why this is being built

The pool is run over **Excel** today: the manager emails a workbook, each participant fills predictions and emails it back, and every day he emails an updated standings file. We just operated exactly this model for the World Cup (242 participants, 146 questions, a static `data.json` dashboard). The goal is to **replace the whole Excel round‑trip with a real multi‑user app** for **UEFA Champions League 2026/27**:

- Participants log in (username + password), fill their **slip** (predictions + admin‑authored questions) until an admin‑set **deadline**, after which picks **lock**.
- Results update **online** (hybrid: football API auto‑fill + admin manual override = source of truth).
- The app shows **daily standings** like the current dashboard and the reference app `hamishak.vercel.app` (share screenshots for UI parity — it was network‑blocked from the sandbox).
- A full **admin console** controls every aspect (seasons, questions, deadlines, fixtures, results, voids, adjustments, roles, rescoring, audit).
- "Level 100" look/feel, publishable to **Google Play**.

The correctness‑critical domain (scoring, bonuses, daily delta, ranking, two‑component questions, buckets, voids) is proven from the World Cup and captured in `PROJECT_DOCUMENTATION.md`. Port it into a **pure, unit‑tested scoring engine** and reuse the WC results as a regression fixture (`data.json` in this repo).

---

## Tech stack (decided)

React 19 + TypeScript + **Vite**, **Tailwind v4** (CSS‑variable tokens), **TanStack Query v5**, React Router v7, **supabase‑js v2**, **vite‑plugin‑pwa** (Workbox), **Framer Motion**. **pnpm** workspace monorepo. Testing: **Vitest** (engine) + **Playwright** (e2e/screenshots) + **pgTAP** (RLS). Play Store via **Trusted Web Activity** (Bubblewrap → signed AAB). Rationale: web is demonstrable/screenshottable, RTL‑mature, one artifact for web+mobile+TWA, Supabase‑native; Expo/RN rejected (fragile RTL, weaker web admin, harder preview).

---

## Local bootstrap (once)

Prereqs: **Node ≥ 20, pnpm, Docker Desktop (running), Supabase CLI, git**. Then:
1. Create a new **GitHub repo** (e.g. `ucl-predictor`) and clone it.
2. `pnpm init` workspace; scaffold the structure below.
3. `supabase init` → `supabase start` (local Postgres + Auth + Realtime + Studio in Docker).
4. `.env.local` ← local `SUPABASE_URL` / `ANON_KEY` from `supabase start` output.
5. `pnpm --filter web dev`; Studio at `localhost:54323`.

Live cloud later: create a Supabase **cloud** project, `supabase link`, `supabase db push`; deploy web to Vercel/host; GitHub Actions for CI (migrations + tests + deploy). Football API key at Phase 2.

---

## Repository structure (pnpm monorepo)

```
ucl-predictor/
├─ packages/
│  ├─ engine/        # PURE scoring engine — zero deps, zero I/O (the crown jewel)
│  │  ├─ src/  scoreMatch · scoreOpen (buckets, two-component, void) · bonuses
│  │  │        · delta · rank · recompute · audit · types · index
│  │  └─ test/ fixtures/wc2026/ (exported from data.json) + *.test.ts (vitest)
│  ├─ schema/        # shared: db.types.ts (supabase gen) + zod runtime validation
│  └─ config/        # shared tsconfig/eslint/prettier
├─ apps/web/
│  └─ src/  app/(shell,router,providers) · features/{auth,slip,leaderboard,
│           matches,questions,admin,yossi-cup} · lib/(supabaseClient,query,realtime)
│           · ui/(design system) · styles/tokens.css
│     e2e/  Playwright smoke + screenshot suite
├─ supabase/
│  ├─ migrations/    0001_init.sql · 0002_rls.sql · 0003_scoring.sql …
│  ├─ functions/     _shared/engine.bundle.ts (generated) · score-season/ ·
│  │                 create-participant/ · ingest-results/ (phase 2)
│  └─ seed/          UCL 26/27 teams + demo season
├─ scripts/  bundle-engine.mjs · export-wc-fixtures.mjs · screenshot.mjs
└─ android/  (Bubblewrap TWA output — phase 4)
```

**Core principle:** the engine never touches Supabase. `score-season` Edge Function is a thin adapter: SELECT full season state → `recompute(state)` (pure) → transactional replace of `score`/`bonus_award` rows + append `standings_snapshot` → `audit(state, output)` → log `automation_run`. The same engine runs in the browser for the admin "preview rescore before commit" feature.

---

## Scoring engine (port of the WC ruleset — see PROJECT_DOCUMENTATION §5–8)

- `scoreMatch` — exact=10; correct direction=5; +2 if goal‑difference exact (=7); miss=0.
- `scoreOpen` — dispatch on `rule_type` (`exact | bucket | two_component | multi_select`); `max_points` **always** from the question (2/3/5/10/20/70 — never assumed); `resolveBucket(value, options)` maps a number to its range (20→"16‑20"); `parseTwoComponent` handles `"TEAM - PLAYER | …: N"`, `"TEAM + …: BUCKET"`, ties via `" / "`, scores 10 name + 10 number independently; **void** → 0, maxPoints 0.
- `bonuses` — **rule‑primitive interpreters** (`set_pick_per_slot`, `all_of_set_exact`, `per_correct_in_stage`, `stage_all_correct`, `per_group_direction`) driven by `bonus_definition.rule + params jsonb`, so UCL's league‑phase/knockout picks are new rows, not new code.
- `computeDelta` — daily `pointsChange` = current‑matchday stage‑advance points + stage all‑correct bonus only on the day the field closes + open questions with `resolvedMatchday == currentMatchday`. Invariant `total == roundBaseline + pointsChange`.
- `rank(rows, mode)` — **competition (1,2,2,4)** as UCL default (`season.ranking_mode`), **dense (1,2,2,3)** retained for WC regression.
- `recompute(state)` — pure, idempotent (`recompute(recompute(s)) === recompute(s)`).
- `audit(state, output)` — port of `scratchpad/audit.py`: re‑derives every open score, checks `total == match+open+bonus+adminAdj`, delta invariant, rank consistency, no scoring of unresolved questions, void‑neutrality. **Runs inside every scoring job and blocks snapshot publish on failure.**

**Regression proof:** `export-wc-fixtures.mjs` converts this repo's `data.json` (146 closed questions + final leaderboard) into engine fixtures; the suite asserts the engine reproduces the real final WC totals under `dense` — the strongest faithful‑port proof.

---

## MVP — vertical slice (LIVE against local Supabase)

**Done = a Playwright run performs the whole flow against local `supabase start` and screenshots each step, audit green.**

**Flow:** admin logs in → creates season + 4 teams + 2 fixtures → 2 match questions + 1 open question (maxPoints 5) + deadline → participant logs in → fills slip → lock (admin force‑lock in MVP) → **DB rejects late edit (proves RLS)** → admin enters results → "Run scoring" → Edge Function runs engine → leaderboard renders live via Realtime → participant detail shows breakdown → audit passes.

**IN:** username+password auth (username→synthetic email; admin provisions via `create-participant`); 11 tables (`season, profile, role_assignment, team, participant, fixture, question, prediction, result, score, standings_snapshot` + `audit_log, automation_run`); slip screen (score pickers + open input, autosave, lock countdown, read‑only when locked); **lock enforced in RLS**; match + simple‑open + void scoring; recompute + both ranking modes; leaderboard (desktop table + mobile cards, Realtime); participant detail (KPI grid + matches tab); minimal admin console (season/fixture/question CRUD, result entry, Run‑scoring, audit‑log list); full Hebrew RTL + dark theme + design tokens from day one; engine unit tests + idempotence + audit‑in‑job.

**DEFERRED:** all bonuses, buckets, two‑component questions, daily delta, per‑question/stage lock windows, distribution bars, sources/help views, light theme, share links, admin adjustments, hybrid API ingestion (MVP = manual results only), Yossi Cup, PWA/TWA packaging.

---

## Supabase — schema subset + critical RLS

Separate **`score`** table (not `points_awarded` on prediction) → clean RLS + idempotent delete‑insert. Load‑bearing policies:
- **`prediction` write:** own rows only **and** `now() < effective lock` (question `lock_at` ← fallback season deadline) **and** no result yet. DB‑enforced, never client‑trusted.
- **`prediction` read:** own rows always; others' rows only once the question is locked (peek guard, also powers distribution bars).
- **`score` / `result` / `standings_snapshot`:** **no authenticated write policy** → only service‑role (scoring job) writes; read = authenticated.
- **`audit_log` / `automation_run`:** insert‑only.
- **admin tables:** gated by `role_assignment ∈ {super_admin, season_admin, scorer}`.

**Scoring** runs in a Supabase Edge Function (`score-season`), triggered by admin button (JWT role‑checked), a DB webhook on `result` change (debounced), and an hourly `pg_cron` safety pass. **Realtime:** clients subscribe to `standings_snapshot` + `result` inserts → invalidate TanStack Query caches; no client‑side score math ever. **Hybrid ingestion (Phase 2):** `ingest-results` cron pulls **football‑data.org** (free UCL tier; API‑Football fallback), writes `verification_status='auto'`; manual entry sets `verified` and always wins; reconciliation queue in admin.

---

## Design system ("level 100")

Tokens first (`tokens.css`): semantic color (surface/text/accent, positive/negative for rank moves, medal tones for top‑3), spacing, radius, type scale, elevation, motion; **light + dark** via `[data-theme]` (dark default). **Heebo** + `font-variant-numeric: tabular-nums` on all numbers. **RTL:** root `dir="rtl"`, logical properties only; `<ScoreDigits>` wraps scores in `dir="ltr"` + `unicode-bidi:isolate`. Components: AppShell (+mobile bottom‑tab), StatusPill, KpiStrip, LeaderboardTable/Card, RankMove ▲▼, DistributionBar, CountdownTimer (slip hero), ScorePicker, Sheet/Dialog, Toast, Skeletons, AdminDataGrid, AuditTrailRow. Motion (Framer, `prefers-reduced-motion`‑gated): layout‑animated rank reordering on live updates, KPI count‑ups, slide‑in sheets. Data‑viz: custom SVG bars. **Load the `dataviz` skill before any chart code and `artifact-design` during UI build.**

---

## Roadmap

- **Phase 0 (setup):** repo + workspace + `supabase start`; migrations 0001–0003; engine package with MVP rules + tests green; CI.
- **Phase 1 — MVP vertical slice** (above). *Gate: audit green; RLS lock rejection proven; screenshots.*
- **Phase 2 — Completeness + parity:** full open rules (buckets, two‑component), bonus primitives, delta, **WC‑2026 regression green**; full leaderboard columns/sort/search; participant detail 3 sub‑tabs; matches/open/sources/help views; distribution bars; deep links; hybrid ingestion + reconciliation; lock windows; admin adjustments + void flow. *Gate: every on‑screen number reproducible by `audit.ts`.*
- **Phase 3 — Polish + new capabilities:** light theme, share links, CSV bulk import, **Yossi Cup** 1v1 bracket module, standings‑over‑time sparkline, web‑push notifications.
- **Phase 4 — Google Play:** PWA hardening (offline shell, icons/screenshots, Lighthouse ≥ 90), Bubblewrap TWA + `assetlinks.json`, Play Console internal → closed testing (the league group) → production.

---

## Verification

1. **Engine unit tests** — every match branch; bucket boundaries; two‑component parser corpus (incl. `" / "` ties) from WC data; property tests (idempotence, void‑neutrality, delta invariant).
2. **Golden regression** — engine reproduces known final WC totals per participant.
3. **Audit‑in‑production** — `audit.ts` gates every scoring run.
4. **RLS tests** — pgTAP: can't write another's pick, can't write after lock, can't touch `score`/`result`.
5. **Headless preview** — `pnpm dev`/`vite preview` + Playwright (390×844 mobile + 1440×900 desktop, both themes) → per‑screen PNGs; full‑flow e2e against local `supabase start`.

---

## Open decisions (defaults chosen; change anytime)

- App name = placeholder "Toto CL". Ranking default = **competition (1,2,2,4)**, admin‑configurable. New repo `ucl-predictor`. Football API = **football‑data.org** free tier (Phase 2). Provide `hamishak` screenshots for UI parity.

## First concrete steps (on the local machine)

1. Scaffold monorepo + `supabase init/start`; commit Phase 0 skeleton.
2. Build `packages/engine` with MVP rules + Vitest green (no backend needed).
3. Write migrations 0001–0003 (schema + RLS) + `score-season` function.
4. Build `apps/web` MVP screens against local Supabase; wire Realtime.
5. Playwright full‑flow run + screenshots for review; iterate to "level 100".
