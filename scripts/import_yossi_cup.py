#!/usr/bin/env python3
"""
import_yossi_cup.py — Excel → JSON for גביע יוסי - מונדיאל 2026

Reads:
  scripts/yossi_cup_source/ranking.xlsx  (242 frozen participants)
  scripts/yossi_cup_source/round1.xlsx   (128 bracket rows = 14 BYE + 114 active)

Writes:
  data/yossiCup/participants.json
  data/yossiCup/round1Bracket.json
  data/yossiCup/cupRounds.json
  data/yossiCup/cupRules.json

Uses stdlib only (zipfile + ElementTree). No openpyxl / pandas required.
"""

import sys, os, json, zipfile, re
from xml.etree import ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_RANKING = os.path.join(ROOT, 'scripts', 'yossi_cup_source', 'ranking.xlsx')
SRC_ROUND1  = os.path.join(ROOT, 'scripts', 'yossi_cup_source', 'round1.xlsx')
OUT_DIR     = os.path.join(ROOT, 'data', 'yossiCup')

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
ERRORS = 0; WARNINGS = 0

def err(msg):
    global ERRORS
    ERRORS += 1
    print(f'  ❌ ERROR: {msg}')

def warn(msg):
    global WARNINGS
    WARNINGS += 1
    print(f'  ⚠️  WARN:  {msg}')

def info(msg):
    print(f'  ✅ {msg}')

def _colnum(ref):
    m = re.match(r'([A-Z]+)(\d+)', ref)
    n = 0
    for ch in m.group(1): n = n * 26 + (ord(ch) - 64)
    return n, int(m.group(2))

def load_xlsx(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall(f'{NS}si'):
            shared.append(''.join(t.text or '' for t in si.iter(f'{NS}t')))
    sheets = sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml', n))
    root = ET.fromstring(z.read(sheets[0]))
    rows = {}
    for c in root.iter(f'{NS}c'):
        ref = c.get('r'); t = c.get('t')
        v = c.find(f'{NS}v'); isn = c.find(f'{NS}is')
        val = None
        if t == 's' and v is not None: val = shared[int(v.text)]
        elif t == 'inlineStr' and isn is not None:
            val = ''.join(x.text or '' for x in isn.iter(f'{NS}t'))
        elif v is not None: val = v.text
        col, row = _colnum(ref)
        rows.setdefault(row, {})[col] = val
    return rows

def to_int(x):
    try: return int(x)
    except: return None

def to_int_f(x):
    try: return int(float(x))
    except: return None

# ────────────────────────────────────────────────
# 1. Parse ranking file
# ────────────────────────────────────────────────
print('\n── Reading ranking file ──')
ra = load_xlsx(SRC_RANKING)
max_row_a = max(ra)
info(f'{max_row_a - 1} data rows found (expected 242)')

seeds = {}
for r in range(2, max_row_a + 1):
    c = ra.get(r, {})
    seed = to_int(c.get(1))
    name = (c.get(2) or '').strip()
    score = to_int_f(c.get(3))
    if seed is None:
        err(f'Row {r}: non-integer seed "{c.get(1)}"'); continue
    if not name:
        err(f'Row {r}: empty name for seed {seed}'); continue
    if seed in seeds:
        err(f'Duplicate seed {seed}: "{seeds[seed][0]}" and "{name}"'); continue
    seeds[seed] = (name, score)

missing = [s for s in range(1, 243) if s not in seeds]
if missing: err(f'Missing seeds 1-242: {missing}')
if len(seeds) == 242: info('242 unique seeds 1–242 ✓')

# ────────────────────────────────────────────────
# 2. Parse round-1 bracket file
# ────────────────────────────────────────────────
print('\n── Reading round-1 bracket file ──')
rb = load_xlsx(SRC_ROUND1)
max_row_b = max(rb)
info(f'{max_row_b - 1} bracket rows found (expected 128)')

active = []; byes = []
for r in range(2, max_row_b + 1):
    c = rb.get(r, {})
    mnum = to_int(c.get(1))
    sA   = to_int(c.get(2)); nA = (c.get(3) or '').strip()
    sB   = to_int(c.get(4)); nB = (c.get(5) or '').strip()
    if mnum is None: err(f'Row {r}: non-integer match number'); continue
    is_bye = (not nB) or (sB is not None and sB > 242)
    if is_bye:
        byes.append((mnum, sA, nA, sB, nB))
    else:
        active.append((mnum, sA, nA, sB, nB))

info(f'Active duels: {len(active)} (expected 114)')
info(f'BYE rows: {len(byes)} (expected 14)')
if len(active) != 114: err(f'Expected 114 active duels, got {len(active)}')
if len(byes)   != 14:  err(f'Expected 14 BYE rows, got {len(byes)}')

# Validate active pairs sum to 257
bad_sum = [(m, a, b) for (m, a, na, b, nb) in active if (a or 0) + (b or 0) != 257]
if bad_sum: warn(f'Active pairs not summing to 257: {bad_sum}')
else: info('All active pairs sum to 257 (standard seeding ✓)')

# Validate names match ranking
mismatches = 0
for (m, a, na, b, nb) in active:
    for s, n in ((a, na), (b, nb)):
        expected = seeds.get(s, (None,))[0]
        if expected is not None and n and expected != n:
            warn(f'Match {m}: seed {s} bracket name="{n}" vs ranking name="{expected}"')
            mismatches += 1
if mismatches == 0: info('All active bracket names match ranking ✓')

# BYE seeds should all be 1-14
bye_seeds = sorted(a for (m, a, na, b, nb) in byes if a and a <= 242)
if bye_seeds == list(range(1, 15)): info(f'BYE seeds are exactly 1–14 ✓')
else: warn(f'BYE seeds: {bye_seeds}')

# ────────────────────────────────────────────────
# 3. Build participants.json
# ────────────────────────────────────────────────
print('\n── Generating participants.json ──')
participants = []
for seed in range(1, 243):
    name, score = seeds.get(seed, (None, None))
    if name is None: continue
    participants.append({
        'id':   f'seed-{seed:03d}',
        'seed': seed,
        'name': name,
        'initialScore': score,
        'status': 'active',
        'autoQualifiedRound2': seed <= 14
    })
info(f'{len(participants)} participants built')

# ────────────────────────────────────────────────
# 4. Build round1Bracket.json
# ────────────────────────────────────────────────
print('\n── Generating round1Bracket.json ──')
bracket = []

# BYE rows first (ordered by match number from file)
for (mnum, sA, nA, sB, nB) in sorted(byes, key=lambda x: x[0]):
    bracket.append({
        'id': f'r1-m{mnum:03d}',
        'round': 1,
        'matchNumber': mnum,
        'playerASeed': sA,
        'playerAName': nA or seeds.get(sA, (None,))[0],
        'playerBSeed': sB,
        'playerBName': None,
        'isBye': True,
        'status': 'bye',
        'winnerSeed': sA,
        'winnerName': nA or seeds.get(sA, (None,))[0],
        'winnerReason': 'automatic_round_2_qualification'
    })

# Active duels (ordered by match number)
for (mnum, sA, nA, sB, nB) in sorted(active, key=lambda x: x[0]):
    bracket.append({
        'id': f'r1-m{mnum:03d}',
        'round': 1,
        'matchNumber': mnum,
        'playerASeed': sA,
        'playerAName': nA,
        'playerBSeed': sB,
        'playerBName': nB,
        'isBye': False,
        'status': 'pending',
        'winnerSeed': None,
        'winnerName': None,
        'winnerReason': None,
        'roundScoreA': None,
        'roundScoreB': None,
        'tieBreakerUsed': None
    })

# Sort full bracket by match number
bracket.sort(key=lambda x: x['matchNumber'])
info(f'{len(bracket)} bracket rows built ({sum(1 for x in bracket if x["isBye"])} BYE + {sum(1 for x in bracket if not x["isBye"])} active)')

# ────────────────────────────────────────────────
# 5. Build cupRounds.json
# ────────────────────────────────────────────────
print('\n── Generating cupRounds.json ──')
cup_rounds = [
    {
        'round': 1,
        'name': 'סיבוב ראשון',
        'description': 'מחזור שני של שלב הבתים',
        'status': 'pending',
        'participantCountStart': 242,
        'activeMatchCount': 114,
        'byeCount': 14,
        'participantCountEnd': 128,
        'closedBySummaryEmail': False,
        'summaryEmailDate': None,
        'roundScoreSnapshots': {}
    },
    {
        'round': 2,
        'name': 'סיבוב שני',
        'description': 'מחזור שלישי בתים 1–6',
        'status': 'upcoming',
        'participantCountStart': 128,
        'activeMatchCount': 64,
        'byeCount': 0,
        'participantCountEnd': 64,
        'closedBySummaryEmail': False,
        'summaryEmailDate': None,
        'roundScoreSnapshots': {}
    },
    {
        'round': 3,
        'name': 'סיבוב שלישי',
        'description': 'מחזור שלישי בתים 7–12',
        'status': 'upcoming',
        'participantCountStart': 64,
        'activeMatchCount': 32,
        'byeCount': 0,
        'participantCountEnd': 32,
        'closedBySummaryEmail': False,
        'summaryEmailDate': None,
        'roundScoreSnapshots': {}
    },
    {
        'round': 4,
        'name': 'שלב הנוק-אאוט',
        'description': 'המשך המפעל עם שלב הנוק-אאוט',
        'status': 'upcoming',
        'participantCountStart': 32,
        'activeMatchCount': None,
        'byeCount': 0,
        'participantCountEnd': None,
        'closedBySummaryEmail': False,
        'summaryEmailDate': None,
        'roundScoreSnapshots': {}
    },
    {
        'round': 99,
        'name': 'גמר גביע יוסי',
        'description': 'הגמר הגדול — שני המשתתפים הנותרים יתמודדו על תואר מחזיק גביע יוסי הראשון',
        'status': 'upcoming',
        'participantCountStart': 2,
        'activeMatchCount': 1,
        'byeCount': 0,
        'participantCountEnd': 1,
        'closedBySummaryEmail': False,
        'summaryEmailDate': None,
        'roundScoreSnapshots': {}
    }
]
info(f'{len(cup_rounds)} rounds defined')

# ────────────────────────────────────────────────
# 6. Build cupRules.json
# ────────────────────────────────────────────────
print('\n── Generating cupRules.json ──')
cup_rules = {
    'title': 'חוקי גביע יוסי',
    'general': [
        'גביע יוסי הוא מפעל נוק-אאוט המבוסס על הניקוד של המשתתפים במשחק הטוטו הרגיל.',
        'בכל סיבוב — מי שמפסיד בדו-קרב — יוצא מהמפעל.',
        'סיבוב רע אחד — ואתם בחוץ.'
    ],
    'bye': [
        '14 המשתתפים המדורגים 1–14 עלו אוטומטית לסיבוב השני ללא דו-קרב.',
        'הבראקט נקבע לפי דירוג מוקפא לפני תחילת הסיבוב הראשון.'
    ],
    'roundClose': [
        'הניקוד הקובע לכל סיבוב הוא הניקוד שפורסם במייל הסיכום הראשון של יוסי אחרי סיום הסיבוב.',
        'אם יוסי השהה את מייל הסיכום וכלל בו ניקוד ממשחקים שהתקיימו אחרי הנקודה הרשמית — סיום הסיבוב נדחה בהתאם.',
        'לכן המערכת תומכת בסגירה ידנית של כל סיבוב בהתאם למייל הסיכום.'
    ],
    'tieBreakerRules': [
        {'key': 'A', 'label': 'ניקוד הסיבוב הנוכחי', 'description': 'מי שצבר יותר נקודות בסיבוב הנוכחי — מנצח.'},
        {'key': 'B', 'label': 'ניקוד מצטבר בגביע', 'description': 'סך הנקודות שנצברו מאז תחילת סיבוב ראשון (לא כולל ניקוד התחלתי).'},
        {'key': 'C', 'label': 'ניקוד התחלתי', 'description': 'ניקוד גבוה יותר בדירוג המוקפא — מנצח.'},
        {'key': 'D-E', 'label': 'פער ניצחון בסיבובים קודמים', 'description': 'מי שניצח בסיבוב הקודם בפער גדול יותר מנצח. אם שווה — בודקים סיבוב לפני, וכן הלאה.'},
        {'key': 'F', 'label': 'זרע מקורי', 'description': 'זרע 1 מנצח על זרע 128 וכן הלאה — הדירוג המוקפא קובע.'}
    ],
    'pilot': 'מפעל זה הוא פיילוט — הזוכה יזכה בפרס משני ממפעל הטוטו.'
}
info('Cup rules defined')

# ────────────────────────────────────────────────
# 7. Write JSON files
# ────────────────────────────────────────────────
print('\n── Writing JSON files ──')
os.makedirs(OUT_DIR, exist_ok=True)

def write_json(filename, data):
    path = os.path.join(OUT_DIR, filename)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    info(f'Wrote {filename} ({os.path.getsize(path):,} bytes)')

write_json('participants.json', participants)
write_json('round1Bracket.json', bracket)
write_json('cupRounds.json', cup_rounds)
write_json('cupRules.json', cup_rules)

# ────────────────────────────────────────────────
# 8. Summary
# ────────────────────────────────────────────────
print(f'\n{"═"*55}')
print(f'  גביע יוסי Import Complete')
print(f'  {len(participants)} participants · {len([x for x in bracket if not x["isBye"]])} active + {len([x for x in bracket if x["isBye"]])} BYE')
print(f'  Errors: {ERRORS}  Warnings: {WARNINGS}')
print(f'{"═"*55}')
sys.exit(1 if ERRORS > 0 else 0)
