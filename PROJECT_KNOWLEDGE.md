# World Cup 2026 Dashboard — Project Knowledge & Operations Manual

> Reference/handoff document for the `efikatash/worldcup-dashboard-2026` fantasy-prediction
> dashboard ("טוטו מונדיאל 2026"). Captures data model, scoring rules, workflows, conventions,
> standing rules, fixes, and the live tournament state. Last updated: **8 July 2026** (WC matchday 7/7,
> quarter-finals about to begin).

---

## 1. Project overview

- **Repo:** `efikatash/worldcup-dashboard-2026`. Work on branch `claude/wonderful-hopper-gixj1c`; all
  data is pushed to **both** `main` and the feature branch.
- **Live site:** `https://efikatash.github.io/worldcup-dashboard-2026/` (GitHub Pages, "deploy from branch").
- **Language:** Hebrew (RTL). Respond to the manager in Hebrew.
- **242 participants**, a Hebrew fantasy pool for the 48-team FIFA World Cup 2026.
- **Single-file front-end:** `index.html` (HTML + CSS + inline JS + a large embedded-data fallback block).
- **Master data:** `data.json` (~13.8 MB on the wire). Front-end fetches it **live** from
  `raw.githubusercontent.com/.../main/data.json` first, then same-origin `data.json`, then the stale
  embedded fallback.

### The stakeholder
The **game manager** (מנהל המשחק, the user `efikatash@gmail.com`) drives all updates. There is a
**separate parallel session** editing the same `index.html` for the "גביע יוסי" (Yossi Cup) feature —
its commits sometimes clobber manual JS edits (see §9).

---

## 2. STANDING RULES (from the game manager — always honor)

1. **אל תשנה כלום בלי אישורי** — never change anything without approval.
2. **לפני כל סגירה או עדכון של שאלה בקש אישור שלי** — ask before EVERY question close/update. In practice
   the manager issues explicit "סגור שאלה" instructions that ARE the approval.
3. **תן ניקוד רק לניחושים של עולות שעלו בפועל. אל תניח הנחות** — only credit advancers that ACTUALLY
   advanced (verify from FIFA); never assume. Do not guess match winners — upsets happen (Paraguay beat
   Germany, Morocco beat Netherlands, Norway beat Brazil, Switzerland beat Colombia on pens).
4. **Daily change = current WC matchday only.** The "שינוי בניקוד"/"שינוי במיקום" columns must reflect
   ONLY the points earned on the **current tournament matchday**, per the **FIFA World Cup schedule**
   (NOT Israel/Manila wall-clock). This recurred often — see §6.
5. Respond in **Hebrew**.

---

## 3. Repo layout & key files

| Path | Purpose |
|------|---------|
| `data.json` | Master store: `meta`, `matches[]` (72 group), `openQuestions[]` (146), `participants[]` (242), `sources[]`, `groupResults{}`, `knockout{}` |
| `index.html` | Whole dashboard (UI + JS + embedded fallback). Fetch/refresh logic ~line 560+; KPI render ~640; `renderBonusDetails`/`renderKnockoutBars` for knockout tables & panels |
| `scripts/update_from_fifa.py` | `recompute(data)` — recomputes match/open/bonus points, ranks, `pointsChange`/`rankChange`, meta counters. `match_manila_date()` |
| `scripts/score_group_bonus.py` | `score_all(data)` rebuilds every participant's `p["bonuses"]`. Contains `_norm` (team-name canonicalizer) and per-stage scorers |
| `data/yossiCup/*` | Separate "Yossi Cup" feature (participant-vs-participant elimination) — NOT the WC bracket |
| `scratchpad/audit.py` | Independent verifier (open scoring, totals, ranks). Path: `/tmp/claude-0/.../scratchpad/audit.py` |
| `.github/workflows/` | `update-dashboard.yml`, `live-score-loop.yml`. Pages uses the auto "pages build and deployment" (no custom workflow) |

**`scripts/` are NOT imported by the automation's recompute unless invoked** — bonuses persist in
`data.json` and are only rebuilt when `score_group_bonus.score_all()` is run manually. Always run
`score_all(d)` then `u.recompute(d)` after editing picks/answers.

---

## 4. Scoring rules

### 4.1 Match predictions (group stage, 72 matches)
- Exact score = **10**; correct direction = **5**; +**2** if the goal difference is also correct (so
  direction+GD = 7). Stored per participant in `p["matches"][]`.

### 4.2 Open questions (146 total; `p["open"][]`, keyed by `qId`)
- Yes/No and single-answer: `maxPoints` (usually 10) for an exact match to `actualAnswer`.
- **Multi-answer / ties**: `actualAnswer` joined by `" / "` (e.g. `"מסי (ארגנטינה) / אמבפה (צרפת)"`);
  any listed part scores. Used when there was a genuine tie.
- **Two-component questions (team + number, max 20)** — Q7–Q11, Q13, Q15, Q16, Q17: **team component 10**
  (accept any of the tied teams) **+ number component 10**, scored **independently**.
  - **Q5 / Q6 ("הבית עם הכי הרבה/מעט שערים")**: originally the official 25.6/26.6 file scored ONLY the
    number (group letter not scored). The **updated 27.6_1 file corrected this** to group(10)+number(10),
    matching the dashboard. So Q5/Q6 DO score both components.
  - **Number matching is range-aware**: a specific number that falls inside the answer's range bucket
    scores (e.g. predicting `"8"` when the answer is `"6-10"` → correct). Also parse the number from
    short-format predictions `"TEAM | NUMBER"` (no colon), not just `"TEAM | label: NUMBER"`.
- **Minute-bucket questions** (fastest/latest goal, red-card minute): predictions are buckets like
  `"דקות 7-8"`, `"דקה 100 +"`. Score exact bucket match; the actual minute maps to its bucket. A
  format variant that equals the exact minute (e.g. `"90+5"` = minute 95) may be credited **only with
  manager approval** — done for אמרי צידון on Q53 via a multi-answer answer `"דקות 94-95 / 90+5"`.

### 4.3 Group-advancement bonuses (`score_group_bonus.py`)
Predictions in `p["bonusPicks"]`: `top2` (ראש בית/סגנית per group A–L), `third` (מעפילות ממקום 3).
- top2: +10 advanced, +5 exact position (15 max/slot); 10 if advanced in the other top-2 spot; **7** if
  a predicted top-2 team advanced from 3rd; +12 all-24-advanced bonus; +12 all-positions bonus.
- third: 10 (exact 3rd) / 7 (predicted-3rd but finished top-2) + **4** for correct כן/לא; +6 all-third bonus.
- "כל הכיוונים בבית": +6/group if every match direction in the group was correct (the official file
  counts this inside the MATCH section, the dashboard inside bonusPoints — totals still match).

### 4.4 Knockout advancer stages (the big feature — see §5)
Each stage = a list of teams a participant predicts to reach the NEXT round, with per-team points and an
all-correct bonus. Scored in `score_group_bonus.py` by `_score_r16_advancers`, `_score_qf_advancers`,
`_score_sf_advancers` (and the same pattern would extend to the final).

| Stage (`bonusPicks` key) | Picks | Pts/correct | All-correct bonus | Master rows |
|---|---|---|---|---|
| `r16advance` — reach round of 16 (שמינית) | 16 | 20 | +16 | 282–297 |
| `qfAdvance` — reach quarter (רבע) | 8 | 25 | +16 | 324–331 |
| `sfAdvance` — reach semi (חצי) | 4 | 30 | +8 | 358–361 |
| (final — reach final) | 2 | (TBD) | (TBD) | 386+ |

**Advancer scoring logic (per pick):**
- **advanced** (team in `knockout.<stage>Advancers`) → full points, resolved, shows "כן" (green).
- **out** → 0, resolved, shows "לא" (red). A pick is "out" if it (a) lost its match this round
  (`<stage>Eliminated`), OR (b) never reached the previous round (not in the prior stage's advancer set,
  once that field is decided), OR (c) the whole round is decided (`<stage>Decided`).
- otherwise **pending** → 0, shows "ממתין".

---

## 5. `knockout` object in data.json (current schema)

```
knockout: {
  r16advancers: [16 teams that reached the round of 16],   r16eliminated: [...],  r32decided: true,
  qfAdvancers:  [8 teams that reached the quarters],        qfEliminated:  [...],  qfDecided: true,
  sfAdvancers:  [teams that reached the semis],             sfEliminated:  [...],  sfDecided: false,
  r32matches: [16 {date,home,away}],   // round-of-32 bracket
  r16matches: [8  {date,home,away}],   // round-of-16 bracket
  qfMatches:  [4  {date,home,away}],   // quarter-final bracket
  matchdayAdvancers: { "YYYY-MM-DD": [teams that advanced that day] },
  matchdayEliminated:{ "YYYY-MM-DD": [teams eliminated that day] },
  currentStage:   "qf",            // r16 | qf | sf | final  → maps to r16advance/qfAdvance/sfAdvance/finalAdvance
  currentMatchday:"2026-07-07",    // drives pointsChange (see §6)
}
```

The stage-advance bonus entries in `p["bonuses"]` have `kind` ∈ `r16advance|qfAdvance|sfAdvance` plus
`bonus_r16_all|bonus_qf_all|bonus_sf_all`, each with `slot,pick,advanced,eliminated,points,status`.

---

## 6. Daily change = current matchday (the recurring pitfall)

`recompute()` computes `pointsChange` per participant. **When `knockout.currentMatchday` is set**, it
uses a stage-aware branch:
- `stage_kind = {r16:"r16advance", qf:"qfAdvance", sf:"sfAdvance", final:"finalAdvance"}[currentStage]`.
- `pointsChange = Σ(points of that-stage advance entries whose pick ∈ matchdayAdvancers[currentMatchday])
  + Σ(points of open questions whose resolvedMatchday == currentMatchday)`.
- It also **auto-syncs** `meta.roundBaseline[name] = {pts: total − pointsChange}` and the label so the
  invariant `total == baseline + pointsChange` stays valid (avoids false "consistency" alarms).

**Operational rule:** when a NEW matchday's first result comes in, set `currentMatchday` to that date
(and `currentStage` when the round changes). Keeping it stale makes the daily change accumulate across
days — this is the bug the manager kept catching. Group-stage questions resolved "today" get
`resolvedMatchday` set to the current matchday so their +points land in the day's change.

---

## 7. Standard update workflow (per match / per question)

```bash
git fetch origin main && git reset --hard origin/main        # base on latest (yossi/automation may have pushed)
python3 - <<'PY'
import json,sys; sys.path.insert(0,'scripts')
import score_group_bonus as sgb, update_from_fifa as u
d=json.load(open('data.json',encoding='utf-8'))
# ... edit knockout advancers / question actualAnswer + per-participant points ...
sgb.score_all(d); u.recompute(d)
json.dump(d,open('data.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
PY
cp data.json /tmp/cl_main.json
python3 /tmp/.../scratchpad/audit.py       # expect: 0 violations, "NO PROBLEMS FOUND"
git add data.json && git commit -m "..." 
git push -u origin main && git push origin main:claude/wonderful-hopper-gixj1c --force-with-lease
```

- **Verify every result from FIFA** (WebSearch → `fifa.com/en/match-centre/...`, ESPN, NBC, Yahoo).
  Confirm the winner from ≥2 sources before crediting; never assume.
- **Consistency check:** `roundBaseline[name].pts + pointsChange == total` for all who have a baseline;
  the real integrity check is `matchPoints+openPoints+bonusPoints(+adminAdjustment) == total` (audit).
- Data-only commits update the browser immediately via the raw fetch (no Pages deploy needed).
  Commits that change `index.html` REQUIRE a successful Pages deploy to reach users.

---

## 8. "Upcoming matches" distribution panel (`renderKnockoutBars`)

The "התפלגות ניחושים · משחקים קרובים" panel (`#topBars`) is **stage-aware**: it walks stages in order
and shows the first with unplayed matches, using that stage's bracket + advancer picks:
- r32matches + `r16advance` picks → "מי תעלה לשמינית?"
- r16matches + `qfAdvance` picks → "מי תעלה לרבע?"
- qfMatches + `sfAdvance` picks → "מי תעלה לחצי?"
A match is "played" if either team is in that stage's advancers/eliminated. `knockoutNorm` canonicalizes
team names (שוויץ/שוייץ→שווייץ).

---

## 9. Deployment / GitHub Pages notes (recurring issues)

- Pages is **"deploy from branch"** → an auto **"pages build and deployment"** workflow runs on every
  push. Concurrent pushes (this session + Yossi-Cup session + the `worldcup-dashboard-bot` automation)
  cause GitHub to reject some deploys with `##[error]Deployment failed, try again later.` — a **transient
  GitHub-side** error, not a repo problem.
- **Fix:** re-run the failed deploy via GitHub MCP `actions_run_trigger` → `rerun_failed_jobs`, or push
  again. Verify via `actions_list` (list_workflow_runs, event=dynamic) that the latest
  `pages build and deployment` for the current HEAD is `success`.
- A failed deploy of a **data-only** commit does NOT affect users (index.html unchanged + data fetched
  live from raw). Only index.html-changing commits need a successful deploy.
- The Yossi-Cup session regenerates `index.html` and has **clobbered manual JS edits** twice. Mitigation:
  always `git reset --hard origin/main` before editing index.html so you build on the latest, and
  re-apply if clobbered.
- From this sandbox, `github.io` is unreachable (HTTP 000 via proxy) but `raw.githubusercontent.com`
  works — verify deploy status through the Actions API, and live data through raw.
- The GitHub MCP `actions_list` output is huge; it's saved to a file — parse it with python.

### Reliability fix applied
Auto-refresh interval changed **30s → 180s** (index.html `countdown=180`) to cut load on
raw.githubusercontent ~6× and avoid rate-limiting that made the dashboard fall back to stale data.

### KPI fixes applied
- "משחקים ששוחקו" now = 72 group + knockout matches played
  (`Σ len(r16advancers)+len(qfAdvancers)+len(sfAdvancers)+...`).
- "עדכון אחרון" shown as `DD/MM/YYYY HH:MM` with `direction:ltr` (was RTL-reversed).

---

## 10. Conventions & gotchas

- **Hebrew group letters:** א=A ב=B ג=C ד=D ה=E ו=F ז=G ח=H ט=I י=J יא=K יב=L.
- **Team-name spelling:** `_norm` / `knockoutNorm` canonicalize שוויץ, שוייץ → **שווייץ**; אקוודור →
  אקוואדור. USA = `ארה"ב`. DR Congo = קונגו.
- **f-strings:** Python f-strings can't contain a backslash inside the expression — build such strings
  with `%`-formatting or precompute variables (bit repeatedly).
- **Heredocs:** avoid stray quotes; prefer `python3 - <<'PY'` blocks written to files when complex.
- Two participants had **short-format** two-component predictions (`"ב | 11-15"`) that the old parser
  missed — fixed by range-aware/short-format number parsing.
- The official file itself had bugs the dashboard was RIGHT about (Q18 penalties, Q5/Q6 group scoring),
  later corrected in the 27.6_1 upload. Always reconcile against the LATEST official file.

---

## 11. Manager corrections applied (participants who filled incorrectly)

Applied from the manager's decision list (source of truth = the corrected official file 27.6_1):
- Duplicate R16 picks replaced by the alphabetical first un-picked potential advancer:
  איתמר שנפ+עידו כנען (ספרד→אוסטריה), and (already in the imported file) אביב+עידן זיו, איתי שפרן,
  אריק גליקמן, דניאל קולסניק, ליאור רוזן, מיכאל זוהר, פאפאספורט.
- **ליאור רוזן** later re-corrected: R16 completion אוסטריה → **ספרד** (his declared winner) → +20.
- Third-place / top2 fixes: יאיר אללוף (3rd A → דרום קוריאה), עדי אדיוס (C/K willAdvance), דוד+שגיא
  אברמסון (2nd L → קרואטיה), לידור עטרי (3rd L → גאנה), תומר כהן (willAdvance).
- בוריס גורובוי+לירן בר זאב: Q28 (head-to-head #10) completed to "לא".
- Quarter-final duplicate corrections (חן יעקב, עדי אדיוס ברזיל, נתנאל שישפורטיש) were already reflected
  in the imported `qfAdvance` picks.
- "שווייץ as ראש בית" typo (רובי מערבי, אורי גלבוע, תומר עמבר): already credited by the dashboard's
  `_norm` canonicalization.

---

## 12. LIVE TOURNAMENT STATE (as of 7/7 matchday, quarters upcoming)

**Group stage:** complete. All 12 groups + all group-stage open questions resolved.

**Round of 32 (1/16):** complete. 16 advancers:
`קנדה, ברזיל, פרגוואי, מרוקו, נורווגיה, צרפת, מקסיקו, אנגליה, בלגיה, ארה"ב, ספרד, פורטוגל, שווייץ, מצרים, ארגנטינה, קולומביה`.
All R32 bonus questions (Q35–Q44) closed. Nobody hit the all-16 bonus (best 15/16, 2 people).

**Round of 16 (שמינית):** complete. **8 quarter-finalists** (`qfAdvancers`):
`מרוקו, צרפת, נורווגיה, אנגליה, ספרד, בלגיה, ארגנטינה, שווייץ`. `qfDecided=true`.
Eliminated in R16: קנדה, פרגוואי, ברזיל, מקסיקו, פורטוגל, ארה"ב, מצרים, קולומביה.
All R16 bonus questions (Q45–Q54) closed. Nobody hit the all-8 bonus (best 7/8, 3 people).
Notable R16 results: Morocco 3-0 Canada; France 1-0 Paraguay; **Norway 2-1 Brazil** (Haaland brace);
England 3-2 Mexico (Bellingham brace, 10 men); Spain 1-0 Portugal (Merino stoppage); Belgium 3-1 USA
(De Ketelaere brace); Argentina beat Egypt (Messi+Enzo comeback); Switzerland 0-0 Colombia (4-3 pens).

**Quarter-finals (רבע גמר) — bracket set, not yet played (`sfAdvancers` empty):**
- צרפת – מרוקו (9/7)
- ספרד – בלגיה (10/7)
- נורווגיה – אנגליה (11/7)
- ארגנטינה – שווייץ (12/7)

`currentStage=qf`, `currentMatchday=2026-07-07`. **80 open questions resolved** so far.
`bonusPicks` per participant now hold: `top2, third, r16advance, qfAdvance, sfAdvance`.

**Next steps as the tournament proceeds:**
1. Per QF match: verify FIFA → append winner to `qfAdvancers` + matchdayAdvancers[date], loser to
   `qfEliminated`/matchdayEliminated, set `currentMatchday`, `score_all`+`recompute`, audit, push. When
   all 4 done set `qfDecided=true` and resolve `bonus_qf_all`; roll `currentStage` to `sf`.
2. Build the **final-advancer stage** (2 picks) the same way when semis approach: import from master rows
   386+, add `_score_final_advancers`, `finalAdvance` display, `sfMatches` bracket for the panel.
3. Close QF/SF/final bonus questions (Q55–Q74, Q127–Q146, etc.) on the manager's instruction.
