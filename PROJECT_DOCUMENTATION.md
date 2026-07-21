# דשבורד ניחושי מונדיאל 2026 — תיעוד פרויקט מלא

> מסמך ייחוס והעברה (handoff) לפרויקט **טוטו מונדיאל 2026** (`efikatash/worldcup-dashboard-2026`).
> מכסה: ארכיטקטורה, מודל נתונים, כללי ניקוד, סקריפטים, אוטומציה, נהלי תפעול, קונבנציות וכללים קבועים.
> **עודכן לאחרונה:** 19 ביולי 2026 — **הטורניר הסתיים** (ספרד אלופה, כל 146 השאלות סגורות).

---

## 1. סקירה כללית

- **מה זה:** ליגת ניחושים בעברית (RTL) ל-242 משתתפים על מונדיאל FIFA 2026 (48 נבחרות).
- **Repo:** `efikatash/worldcup-dashboard-2026`.
- **ענפי פיתוח:** עבודה על `claude/wonderful-hopper-gixj1c`; כל עדכון נדחף ל**שני** הענפים — `main` ו-`claude/wonderful-hopper-gixj1c`.
- **אתר חי:** `https://efikatash.github.io/worldcup-dashboard-2026/` (GitHub Pages, "deploy from branch" `main`).
- **שפה:** עברית — כל התקשורת עם מנהל המשחק בעברית.
- **בעל העניין:** **מנהל המשחק** (`efikatash@gmail.com`) — מוביל את כל העדכונים ומספק את תוצאות האמת.

---

## 2. מצב סופי של הטורניר (19/7/2026)

- 🏆 **אלופת העולם: ספרד** 🇪🇸 — ניצחה את ארגנטינה **1-0 בהארכה** בגמר (0-0 ב-90 דקות).
- 🥈 סגנית: ארגנטינה. חצאי הגמר: ספרד ניצחה 2-0 את צרפת; ארגנטינה ניצחה 2-1 את אנגליה (מהפך בדקה 92).
- ⚽ **מלך השערים:** אמבפה (צרפת) — 10 שערים. **מלך הבישולים:** אוליסה (צרפת) — 7 בישולים.
- **כל 72 המשחקים סגורים; כל 146 השאלות הפתוחות סגורות** (145 נענו + 1 בוטלה — ראו §8).
- **טבלה סופית (טופ 5):** 1. אייל חסון (2167) · 2. אריאל אנגל (2143) · 3. גיא טלסניק (2110) · 4. אושרי ברזילי (2108) · 5. יובל גרשון (2097).
- 242 משתתפים · ניקוד ממוצע ~1826.

---

## 3. ארכיטקטורה

- **Front-end בקובץ יחיד:** `index.html` — HTML + CSS + JS inline + בלוק `embeddedData` (עותק fallback של הנתונים).
- **מקור נתונים ראשי:** `data.json` (~14.8MB). ה-front-end טוען אותו **חי** לפי סדר עדיפות:
  1. `raw.githubusercontent.com/.../main/data.json`
  2. `data.json` באותו origin (GitHub Pages)
  3. בלוק `embeddedData` המוטמע (fallback ישן בלבד, אם ה-fetch נכשל)
  → **מסקנה מעשית:** עדכון `data.json` ב-`main` = הדשבורד מתעדכן. אין צורך לעדכן את `embeddedData` בכל שינוי (הוא מתרענן ע"י `patch_embedded_data.js` מדי פעם).
- **רענון:** הדשבורד בודק עדכונים אוטומטית (~כל 60-180 שניות). המשתמשים לא צריכים לעשות דבר.
- **אין build step ל-front-end** — קובץ סטטי. שינוי ב-`index.html` נכנס לתוקף לאחר build של Pages (~1-2 דקות) ורענון מלא בדפדפן (Ctrl+Shift+R).

---

## 4. מודל הנתונים (`data.json`)

מפתחות עליונים: `meta`, `matches[]`, `openQuestions[]`, `participants[]`, `sources[]`, `groupResults{}`, `knockout{}`.

### 4.1 `participants[]` (242)
| שדה | משמעות |
|------|--------|
| `name` | שם המשתתף (מפתח לוגי; ייחודי) |
| `total` | ניקוד כולל = `matchPoints + openPoints + bonusPoints` |
| `matchPoints` / `openPoints` / `bonusPoints` | רכיבי הניקוד |
| `exact` / `partial` / `gd` | ספירת פגיעות משחקים (מדויק / כיוון / הפרש) |
| `openHits` / `openResolved` | פגיעות שאלות פתוחות |
| `pointsChange` | **שינוי הניקוד ביום המשחקים הנוכחי בלבד** (ראו §6) |
| `rankChange` / `prevRank` / `rank` | תנועת דירוג |
| `matches[]` | ניחושי משחקים + נקודות |
| `open[]` | ניחושי שאלות פתוחות: `{qId, prediction, points, label}` |
| `bonuses[]` | בונוסים מחושבים (ראו §5.3) |
| `bonusPicks{}` | הבחירות הגולמיות לבונוסים (finalAdvance וכו') |

### 4.2 `openQuestions[]` (146)
`{id, row, num, section, question, actualAnswer, status, sourceStatus, sourceUrl, sourceTitle, maxPoints, block, ruleType, policyStatus}`
- `status`: `pending` / `known` / `verified`. `sourceStatus`: `pending` / `verified_external` / `verified_fifa` / `verified_uploaded_file`.
- שאלה נחשבת "פתורה" אם `status ∈ {known, verified}` **או** `sourceStatus ∈ {verified_*}`.
- `ruleType: "leader_or_superlative_do_not_close_early"` = שאלת מוביל/סופרלטיב (לא לסגור מוקדם).

### 4.3 `knockout{}`
מפתחות מרכזיים: `r16advancers[16]`, `qfAdvancers[8]`, `sfAdvancers[4]`, `finalAdvancers[2]`; דגלי `*Decided`; `currentStage` (`r16`/`qf`/`sf`/`final`); `currentMatchday` (תאריך ISO של יום המשחקים הנוכחי — כרגע `2026-07-19`); `matchdayAdvancers{date: [teams]}` — מיפוי כל יום משחקים לנבחרות שעלו בו (בסיס לחישוב "שינוי יומי").

### 4.4 `meta{}`
מוני סטטוס (`resolvedOpenQuestions`, `verifiedExternalOpenQuestions` וכו'), `scoringRules` (טקסט), `roundBaseline{name:{pts}}` + `roundBaselineLabel` (בסיס לחישוב `pointsChange`).

---

## 5. כללי ניקוד

### 5.1 משחקים (72, שלב הבתים)
**10** נק' לתוצאה מדויקת · **5** לכיוון נכון (1/X/2) · **+2** אם גם הפרש השערים נכון (סה"כ 7).

### 5.2 שאלות פתוחות
- **רוב השאלות:** `maxPoints` מלא אם `prediction == actualAnswer`, אחרת 0. רוב השאלות = 10 נק'.
- **ניקוד משתנה:** חלק מהשאלות בעלות `maxPoints` שונה — למשל 146=**2**, 145=**3**, 144=**5**, 102 (אלופה)=**70**. **תמיד לקרוא `maxPoints` מהשאלה, לא להניח 10.**
- **שאלות "בקט" (טווח):** חלק מהשאלות מנחשים בטווחים (`3-4`, `16-20`, `פחות מ-3`). התשובה נקבעת לפי הבקט שמכיל את הערך בפועל (למשל 20 שערים → בקט `16-20`).
- **שאלות דו-רכיביות (ניקוד כפול, `maxPoints=20`):** מלך שערים/בישולים/פנדלים לזכות/לחובה + הנבחרת עם הכי הרבה שערים (שאלות **13,15,16,17,75,76,77,78,79**). מנוקדות **10 לרכיב השם/הקבוצה + 10 לרכיב המספר/הבקט** בנפרד. פורמט התשובה: `"קבוצה - שחקן | מס' ...: N"` או `"קבוצה + מס' ...: בקט"`. תיקו בין שתיים מיוצג ב-`/` (למשל `"ארגנטינה / אנגליה + ...: 3-4"`).

### 5.3 בונוסים (`participants[].bonuses[]`, נבנים ע"י `score_group_bonus.score_all`)
`bonus_all_advanced` (כל 24 עלו, 12) · `bonus_all_position` (מיקום מדויק, 12) · `bonus_third_all` (מ-3 מדויק, 6) · `bonus_r16_all`/`bonus_qf_all`/`bonus_sf_all`/`bonus_final_all` (כל העולות לשלב: 16/16/8/**8**) · `group_directions` (כל הכיוונים בבית, 6/בית) · בונוסי התקדמות: `r16advance`/`qfAdvance`/`sfAdvance`/`finalAdvance` (40 לעולה בשלבים המתקדמים).

---

## 6. "שינוי יומי" — כלל קבוע קריטי

עמודות **"שינוי בניקוד"/"שינוי במיקום"** משקפות **אך ורק את הנקודות שנצברו ביום המשחקים הנוכחי** (`knockout.currentMatchday`), לפי **לוח גביע העולם** — לא שעון קיר.

לוגיקת החישוב ב-`update_from_fifa.recompute()`:
```
pointsChange = (נקודות עולה בשלב הנוכחי ביום זה) + (בונוס-כל-השלב אם השדה נסגר היום) + (שאלות פתוחות שנפתרו ביום זה)
```
- `matchdayAdvancers[currentMatchday]` קובע אילו נקודות עולה נספרות.
- בונוס-כל-השלב (למשל `bonus_final_all` +8) נכלל **רק ביום שבו שדה השלב נסגר** (מיפוי `currentStage`→בונוס+דגל).
- `roundBaseline[name].pts = total - pointsChange` — נשמר כדי לשמור על האינווריאנטה `total == baseline + pointsChange`.
- כשמתחיל שלב/יום חדש: לעדכן `currentMatchday` (למשל הגמר → `2026-07-19`) כדי שהשאלות יקובצו נכון.

---

## 7. סקריפטים ותפעול

### 7.1 קבצים מרכזיים
| נתיב | תפקיד |
|------|-------|
| `scripts/update_from_fifa.py` | `recompute(data)` — מחשב מחדש נקודות, דירוגים, `pointsChange`, מוני meta |
| `scripts/score_group_bonus.py` | `score_all(data)` — בונה מחדש את כל `participants[].bonuses`; מכיל `_norm` (קנוניזציה של שמות נבחרות) |
| `scripts/patch_embedded_data.js` | מטמיע את `data.json` לתוך `embeddedData` ב-`index.html` |
| `scratchpad/audit.py` | מאמת עצמאי (ניקוד שאלות, סכומים, דירוגים). נתיב סשן: `/tmp/claude-0/.../scratchpad/audit.py` |
| `updated_predictions_audit.csv` | **לוג שינויי ניחושים** — מכיל בעמודת `oldPrediction` את הניחושים המקוריים (כולל מספרים שהוסרו משאלות 75/76 — ראו §8) |

### 7.2 נוהל סגירת שאלה (Playbook)
```python
# 1. fetch origin/main (בגלל תהליך גביע יוסי המקביל!)
# 2. לקרוא maxPoints והתפלגות הניחושים של השאלה
# 3. להגדיר: q['actualAnswer'], q['status']='known',
#           q['sourceStatus']='verified_external', q['resolvedMatchday']=currentMatchday
# 4. לנקד: לכל participant.open עם qId זה: points = maxPoints אם pred==ans אחרת 0
# 5. score_all(d); recompute(d)
# 6. לשחזר סדר משתתפים של origin/main (למניעת diff ענק — ראו §9)
# 7. json.dump(..., ensure_ascii=False, indent=2)
# 8. cp data.json /tmp/cl_main.json && python3 scratchpad/audit.py   → חייב "NO PROBLEMS FOUND"
# 9. git commit; git push origin HEAD:main; git push origin HEAD:claude/... --force-with-lease
```
**תמיד להריץ `score_all(d)` ואז `recompute(d)`** אחרי עריכת ניחושים/תשובות. בונוסים נמשכים ב-`data.json` ונבנים מחדש רק כשמריצים `score_all`.

### 7.3 אוטומציה (`.github/workflows/`)
- `update-dashboard.yml` — ריצה ידנית (`workflow_dispatch`); ה-schedule מושבת.
- `live-score-loop.yml` — לולאת ניקוד חי.
- **GitHub Pages** משתמש ב-build האוטומטי ("pages build and deployment"), ללא workflow ייעודי.

---

## 8. קונבנציות ומקרים מיוחדים

### 8.1 ביטול שאלה (void)
כשתנאי השאלה גורם לביטול (למשל שאלה 131 — דו-קרב פנדלים, אך הגמר הוכרע בהארכה):
`q['voided']=True`, `q['maxPoints']=0`, `status='known'`, `actualAnswer` מסביר את הביטול, וכל המשתתפים מקבלים **0**. הניקוד נשאר ניטרלי (אף אחד לא מרוויח/מפסיד).

### 8.2 שחזור מספרים חסרים בשאלות דו-רכיביות
בשאלות **75 (מלך שערים)** ו-**76 (מלך בישולים)** תהליך קודם **הסיר** את רכיב מספר השערים מהניחושים. המספרים המקוריים שמורים ב-`updated_predictions_audit.csv` עמודת `oldPrediction` (`"... : N"`). שוחזרו משם לכל 242 המשתתפים ונוקדו כפול. (שאלות 77,78,79 שמרו את המספרים/בקטים ב-`data.json` עצמו.)

### 8.3 דירוג — "צפוף" מול "תחרותי"
`computeDisplayRanks` בדשבורד משתמש ב**דירוג צפוף** (dense: 1,2,2,3). אפליקציות לוח-תוצאות טיפוסיות (למשל hamishak) משתמשות ב**דירוג תחרותי סטנדרטי** (1,2,2,4). זהו **מקור ההבדל היחיד** במספרי המקומות בין הדשבורד לאפליקציה — הניקוד (הטוטלים) זהה. **הוחלט להשאיר כפי שהוא** (הבדל תצוגתי, לא באג).

### 8.4 audit חייב לדלג על שאלות דו-רכיביות
`scratchpad/audit.py` מדלג בבדיקת ההתאמה על שאלות `{5,6,7,8,9,10,11,13,15,16,17,75,76,77,78,79}` (ניקוד מפוצל שאינו התאמה מדויקת אחת). אימות ייעודי לניקוד הכפול נעשה בנפרד.

---

## 9. תהליך "גביע יוסי" המקביל — טיפול בהתנגשויות

קיים **סשן/תהליך מקביל** שעורך את אותו repo עבור פיצ'ר **גביע יוסי** (`data/yossiCup/*`, `js/yossiCup/*`, `scripts/close_r*.js`) — מערכת נוקאאוט משתתף-מול-משתתף, **נפרדת** מברקט המונדיאל. הוא דוחף ל-`main` ולעיתים:
- מייצר `data.json` בסדר משתתפים **שונה** (ממוין אחרת) → diff ענק (עד ~175K שורות) גם על שינוי זעיר.
- **פתרון:** לפני כל דחיפה — `git fetch origin main`; אם התקדם, לאמת שכל עבודת המונדיאל שלנו קיימת בגרסתם, לאפס אליהם (`reset --hard origin/main`), להחיל מחדש רק את השינוי שלנו, **ולשמר את סדר המשתתפים של origin/main** (`sort` לפי אינדקס origin/main) → diff נקי (מאות שורות במקום עשרות אלפים).
- דחיפה ל-`main` (fast-forward) ולענף הפיצ'ר עם `--force-with-lease`.

---

## 10. כללים קבועים (מהמנהל — תמיד לכבד)

1. **בקש אישור לפני כל סגירה/עדכון של שאלה.** בפועל — הוראת "סגור שאלה" מפורשת *היא* האישור.
2. **תן ניקוד רק לעולות שעלו בפועל. אל תניח הנחות.** לאמת מהמקור; הפתעות קורות.
3. **"שינוי יומי" = יום המשחקים הנוכחי בלבד** לפי לוח FIFA (§6).
4. **ענה בעברית.**
5. אחרי כל עדכון — **audit נקי** ("NO PROBLEMS FOUND") לפני דחיפה.
6. דחיפה ל**שני** הענפים (`main` + `claude/wonderful-hopper-gixj1c`).

---

## 11. בדיקת תקינות (`audit.py`)

מאמת שלושה דברים:
- **open scoring** — נקודות כל ניחוש = הצפי לפי `maxPoints`/התאמה (מדלג על דו-רכיביות §8.4).
- **total/component** — `total == matchPoints + openPoints + bonusPoints`; והרכיבים תואמים לסכום הפריטים.
- **ranks** — עקביות הדירוג מול הניקוד.

הרצה: `cp data.json /tmp/cl_main.json && python3 <scratchpad>/audit.py`. יעד: `=== NO PROBLEMS FOUND ===`.

---

## 12. קבצי נתונים נלווים (CSV/JSON)

`leaderboard.csv`, `matches.csv`, `open_questions.csv`, `participants_share_links.csv` (קישורים אישיים), `sources_fifa.csv`/`sources_all.csv`, `updated_predictions_audit.csv` (§8.2), `open_question_manual_answers.json`, `match_results_cache.json`. `.nojekyll` מונע עיבוד Jekyll ב-Pages.

---

*תיעוד זה מתאר את מצב הפרויקט בתום הטורניר. מסמכי ייחוס נוספים: `PROJECT_KNOWLEDGE.md` (handoff מוקדם יותר, שלב רבע-גמר), `README.md` (הוראות פרסום Pages).*
