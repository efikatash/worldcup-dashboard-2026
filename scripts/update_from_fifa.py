#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
World Cup Dashboard updater.

Policy:
- Match results are accepted only when found on an official fifa.com page.
- Open-question results are NOT auto-updated here; they stay as already stored in data.json,
  because many open questions need human judgment or non-FIFA sources.
- The script never overwrites a verified score with a different score automatically. If a conflict
  is found, it logs it to automation_status.json for manual review.
"""

from __future__ import annotations

import csv
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Tuple

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_PATH = os.path.join(ROOT, "data.json")
STATUS_PATH = os.path.join(ROOT, "automation_status.json")
MANUAL_OPEN_ANSWERS_PATH = os.path.join(ROOT, "open_question_manual_answers.json")
OPEN_REVIEW_CSV_PATH = os.path.join(ROOT, "open_question_review.csv")

FIFA_SCORES_URL = "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures"
FIFA_MATCH_CENTRE_URL = "https://www.fifa.com/en/match-centre"

# Hebrew names in the dashboard -> possible official/English names on FIFA.
TEAM_ALIASES: Dict[str, List[str]] = {
    "מקסיקו": ["Mexico", "MEX"],
    "דרום אפריקה": ["South Africa", "RSA", "South Africa"],
    "דרום קוריאה": ["Korea Republic", "South Korea", "KOR"],
    "צ'כיה": ["Czechia", "Czech Republic", "CZE"],
    "קנדה": ["Canada", "CAN"],
    "בוסניה": ["Bosnia and Herzegovina", "Bosnia-Herzegovina", "Bosnia", "BIH"],
    "קטאר": ["Qatar", "QAT"],
    "שווייץ": ["Switzerland", "SUI"],
    "ברזיל": ["Brazil", "BRA"],
    "מרוקו": ["Morocco", "MAR"],
    "האיטי": ["Haiti", "HAI"],
    "סקוטלנד": ["Scotland", "SCO"],
    "ארה\"ב": ["USA", "United States", "United States of America", "USMNT", "USA"],
    "פרגוואי": ["Paraguay", "PAR"],
    "אוסטרליה": ["Australia", "AUS", "Socceroos"],
    "טורקיה": ["Türkiye", "Turkey", "Turkiye", "TUR"],
    "גרמניה": ["Germany", "GER"],
    "קורסאו": ["Curaçao", "Curacao", "CUW"],
    "חוף השנהב": ["Côte d'Ivoire", "Cote d'Ivoire", "Ivory Coast", "CIV"],
    "אקוואדור": ["Ecuador", "ECU"],
    "הולנד": ["Netherlands", "NED", "Holland"],
    "יפן": ["Japan", "JPN"],
    "שבדיה": ["Sweden", "SWE"],
    "טוניסיה": ["Tunisia", "TUN"],
    "בלגיה": ["Belgium", "BEL"],
    "מצרים": ["Egypt", "EGY"],
    "איראן": ["IR Iran", "Iran", "IRN"],
    "ניו זילנד": ["New Zealand", "NZL"],
    "ספרד": ["Spain", "ESP"],
    "קייפ ורדה": ["Cabo Verde", "Cape Verde", "CPV"],
    "ערב הסעודית": ["Saudi Arabia", "Saudi", "KSA", "SAU"],
    "אורוגוואי": ["Uruguay", "URU"],
    "צרפת": ["France", "FRA"],
    "סנגל": ["Senegal", "SEN"],
    "עירק": ["Iraq", "IRQ"],
    "נורווגיה": ["Norway", "NOR"],
    "ארגנטינה": ["Argentina", "ARG"],
    "אלג'יריה": ["Algeria", "ALG"],
    "אוסטריה": ["Austria", "AUT"],
    "ירדן": ["Jordan", "JOR"],
    "פורטוגל": ["Portugal", "POR"],
    "קונגו": ["Congo DR", "DR Congo", "Congo", "COD"],
    "אוזבקיסטן": ["Uzbekistan", "UZB"],
    "קולומביה": ["Colombia", "COL"],
    "אנגליה": ["England", "ENG"],
    "קרואטיה": ["Croatia", "CRO"],
    "גאנה": ["Ghana", "GHA"],
    "פנמה": ["Panama", "PAN"],
}

# Known match-centre IDs for matches already encountered during setup. The updater does not depend on these,
# but they provide good source URLs when the generic fixtures page identifies a score.
KNOWN_MATCH_CENTRE: Dict[int, str] = {
    2: "https://www.fifa.com/en/match-centre/match/17/285023/289273/400021441",
    16: "https://www.fifa.com/en/match-centre/match/17/285023/289273/400021463",
}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def local_now_manila() -> str:
    # GitHub runner has UTC. Philippines = UTC+8, no DST.
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=8)).strftime("%Y-%m-%d %H:%M")


def write_status(status: str, message: str, **extra: Any) -> None:
    payload = {
        "status": status,
        "message": message,
        "updated_at_utc": utc_now(),
        **extra,
    }
    with open(STATUS_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def fetch_url(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; worldcup-dashboard-bot/1.0; +https://github.com/efikatash/worldcup-dashboard-2026)",
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        charset = resp.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")


def normalize_text(s: str) -> str:
    s = html.unescape(str(s))
    s = s.replace("\u2013", "-").replace("\u2014", "-").replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def strip_tags(s: str) -> str:
    s = re.sub(r"<script\b[^>]*>.*?</script>", " ", s, flags=re.I | re.S)
    s = re.sub(r"<style\b[^>]*>.*?</style>", " ", s, flags=re.I | re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    return normalize_text(s)


def aliases_for(team_he: str) -> List[str]:
    vals = [team_he] + TEAM_ALIASES.get(team_he, [])
    # FIFA pages sometimes use normal ASCII apostrophes and sometimes curly ones.
    out = []
    for v in vals:
        for x in {v, v.replace("’", "'"), v.replace("'", "’")}:  # de-duplicate later
            if x and x not in out:
                out.append(x)
    return out


def rx_alias(alias: str) -> str:
    # Match as phrase, but be lenient around punctuation/spacing.
    parts = [re.escape(p) for p in alias.split()]
    return r"\b" + r"\s+".join(parts) + r"\b"


def find_score_in_text(text: str, home_he: str, away_he: str) -> Optional[Tuple[int, int, str]]:
    """Return (homeScore, awayScore, evidenceSnippet) from FIFA page text if confidently found."""
    text = normalize_text(text)
    home_aliases = aliases_for(home_he)
    away_aliases = aliases_for(away_he)

    status_words = r"(?:FT|Full[- ]time|Full time|Result|Final|Match report|highlights|beat|edge|draw|defeat|win|victory|earn)"
    score = r"(\d{1,2})\s*[-–]\s*(\d{1,2})"

    for ha in home_aliases:
        for aa in away_aliases:
            h = rx_alias(ha)
            a = rx_alias(aa)
            # Most common: Home 2-0 Away, or Home HOME 2-0 Away.
            patterns = [
                rf"({h}.{{0,180}}?{score}.{{0,180}}?{a})",
                rf"({h}.{{0,220}}?{a}.{{0,120}}?{score})",
                rf"({score}.{{0,160}}?{h}.{{0,180}}?{a})",
            ]
            for pat in patterns:
                for m in re.finditer(pat, text, flags=re.I):
                    snippet = m.group(1)
                    window_start = max(0, m.start() - 120)
                    window_end = min(len(text), m.end() + 120)
                    window = text[window_start:window_end]
                    nums = re.search(score, snippet)
                    if not nums:
                        continue
                    hs, aw = int(nums.group(1)), int(nums.group(2))
                    # Avoid obvious non-football false positives. Football scores rarely exceed 15.
                    if hs > 15 or aw > 15:
                        continue
                    # Require a match-status/result context if possible. FIFA article titles often use "Team 2-0 Team" without FT.
                    # If the pair and score are tight enough, accept even without FT.
                    if re.search(status_words, window, flags=re.I) or len(snippet) <= 220:
                        return hs, aw, normalize_text(window)[:380]

    # Also catch headline/article style: "Team 2-0 Team | Match report".
    for ha in home_aliases:
        for aa in away_aliases:
            pat = rf"({rx_alias(ha)}\s+{score}\s+{rx_alias(aa)}\s*(?:\||-|,|:)?\s*.{{0,80}}?(?:Match report|highlights|FIFA|World Cup))"
            m = re.search(pat, text, flags=re.I)
            if m:
                return int(m.group(2)), int(m.group(3)), normalize_text(m.group(1))[:380]

    return None


def extract_next_json(html_text: str) -> List[Any]:
    found: List[Any] = []
    # Next.js data, if present.
    for m in re.finditer(r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', html_text, flags=re.I | re.S):
        try:
            found.append(json.loads(html.unescape(m.group(1))))
        except Exception:
            pass
    # JSON-LD blocks may contain article headlines with score.
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html_text, flags=re.I | re.S):
        try:
            found.append(json.loads(html.unescape(m.group(1))))
        except Exception:
            pass
    return found


def flatten_json_strings(obj: Any) -> str:
    chunks: List[str] = []
    def rec(x: Any) -> None:
        if isinstance(x, dict):
            for k, v in x.items():
                if isinstance(k, str):
                    chunks.append(k)
                rec(v)
        elif isinstance(x, list):
            for v in x:
                rec(v)
        elif isinstance(x, (str, int, float)):
            chunks.append(str(x))
    rec(obj)
    return normalize_text(" ".join(chunks))


def discover_fifa_results(data: Dict[str, Any]) -> Tuple[Dict[int, Dict[str, Any]], List[str]]:
    """Find completed scores for pending dashboard matches from official fifa.com pages."""
    warnings: List[str] = []
    discovered: Dict[int, Dict[str, Any]] = {}

    urls = [FIFA_SCORES_URL, FIFA_MATCH_CENTRE_URL]
    # Also fetch known official URLs already in the data, useful for validation.
    for m in data.get("matches", []):
        url = m.get("sourceUrl")
        if isinstance(url, str) and "fifa.com" in url and url not in urls:
            urls.append(url)
    for mid, url in KNOWN_MATCH_CENTRE.items():
        if url not in urls:
            urls.append(url)

    combined_text = ""
    fetched: List[str] = []
    for url in urls:
        try:
            page = fetch_url(url)
            fetched.append(url)
            combined_text += "\n\nSOURCE_URL: " + url + "\n" + strip_tags(page)
            for j in extract_next_json(page):
                combined_text += "\n" + flatten_json_strings(j)
        except Exception as e:
            warnings.append(f"Could not fetch FIFA URL {url}: {e}")

    if not fetched:
        warnings.append("No FIFA pages could be fetched. Data was not changed.")
        return discovered, warnings

    for match in data.get("matches", []):
        mid = int(match.get("id", 0) or 0)
        home = str(match.get("home", ""))
        away = str(match.get("away", ""))
        if not home or not away or not mid:
            continue
        found = find_score_in_text(combined_text, home, away)
        if not found:
            continue
        hs, aw, evidence = found
        discovered[mid] = {
            "actualHome": hs,
            "actualAway": aw,
            "sourceUrl": KNOWN_MATCH_CENTRE.get(mid, FIFA_SCORES_URL),
            "sourceTitle": "FIFA official scores/fixtures or match centre",
            "evidence": evidence,
        }
    return discovered, warnings


def score_match_pick(home_pick: str, away_pick: str, actual_home: Optional[int], actual_away: Optional[int]) -> Tuple[int, int, int, int, str]:
    if actual_home is None or actual_away is None:
        return 0, 0, 0, 0, "ממתין לתוצאת משחק"
    try:
        hp = int(str(home_pick).strip())
        ap = int(str(away_pick).strip())
    except Exception:
        return 0, 0, 0, 0, "פספוס"

    if hp == actual_home and ap == actual_away:
        return 10, 1, 0, 0, "בול"

    def sign(x: int) -> int:
        return (x > 0) - (x < 0)

    predicted_dir = sign(hp - ap)
    actual_dir = sign(actual_home - actual_away)
    partial = 5 if predicted_dir == actual_dir else 0
    gd = 2 if partial and (hp - ap) == (actual_home - actual_away) else 0
    points = partial + gd
    label = "כיוון + הפרש" if partial and gd else ("כיוון" if partial else "פספוס")
    return points, 0, 1 if partial else 0, 1 if gd else 0, label



# --- Open questions engine -------------------------------------------------
# The dashboard has two different kinds of data:
# 1) Match results: accepted only from FIFA pages.
# 2) Open questions: may be verified by FIFA, a reliable external source, or a manual admin decision.
#
# This engine is conservative by design:
# - It DOES score open questions that are explicitly closed in open_question_manual_answers.json.
# - It DOES show live leaders for score-based group-stage questions.
# - It DOES NOT give final points for live/superlative questions until the relevant stage is complete.

GROUP_HE = {
    "A": "א", "B": "ב", "C": "ג", "D": "ד", "E": "ה", "F": "ו",
    "G": "ז", "H": "ח", "I": "ט", "J": "י", "K": "יא", "L": "יב",
}


def normalize_answer(value: Any) -> str:
    s = normalize_text(str(value or ""))
    s = s.replace('"', "").replace("'", "").replace("׳", "").replace("״", "")
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()


def answer_bucket(value: int, buckets: List[Tuple[int, int, str]]) -> str:
    for lo, hi, label in buckets:
        if lo <= value <= hi:
            return label
    return str(value)


def bucket_group_goals(value: int) -> str:
    return answer_bucket(value, [
        (0, 10, "לא יותר מ- 10 שערים"),
        (11, 15, "11-15"),
        (16, 20, "16-20"),
        (21, 25, "21-25"),
        (26, 30, "26-30"),
        (31, 999, "לפחות 31 שערים"),
    ])


def bucket_team_goals(value: int) -> str:
    return answer_bucket(value, [
        (0, 0, "0"), (1, 1, "1"), (2, 2, "2"), (3, 5, "3-5"),
        (6, 10, "6-10"), (11, 15, "11-15"), (16, 999, "לפחות 16"),
    ])


def bucket_draws(value: int) -> str:
    return answer_bucket(value, [
        (0, 7, "לא יותר מ- 7 תיקו"), (8, 10, "8-10"), (11, 13, "11-13"),
        (14, 16, "14-16"), (17, 19, "17-19"), (20, 999, "לפחות 20 תיקו"),
    ])


def load_manual_open_answers() -> List[Dict[str, Any]]:
    if not os.path.exists(MANUAL_OPEN_ANSWERS_PATH):
        return []
    try:
        with open(MANUAL_OPEN_ANSWERS_PATH, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(payload, list):
            return [x for x in payload if isinstance(x, dict)]
        if isinstance(payload, dict):
            answers = payload.get("answers", [])
            if isinstance(answers, list):
                return [x for x in answers if isinstance(x, dict)]
    except Exception as exc:
        # Do not fail the whole dashboard just because the manual file is malformed.
        write_status("error", f"open_question_manual_answers.json is not valid JSON: {exc}")
        raise
    return []


def group_stage_complete(data: Dict[str, Any]) -> bool:
    matches = data.get("matches", [])
    # The current master file has 72 group-stage matches.
    return bool(matches) and all(m.get("status") == "verified" for m in matches)


def match_aggregates(data: Dict[str, Any]) -> Dict[str, Any]:
    group_goals: Dict[str, int] = {}
    group_completed: Dict[str, int] = {}
    team_for: Dict[str, int] = {}
    team_against: Dict[str, int] = {}
    team_draws: Dict[str, int] = {}
    total_draws = 0
    completed = 0

    for m in data.get("matches", []):
        if m.get("status") != "verified":
            continue
        try:
            ah, aa = int(m.get("actualHome")), int(m.get("actualAway"))
        except Exception:
            continue
        completed += 1
        group = str(m.get("group", ""))
        home = str(m.get("home", ""))
        away = str(m.get("away", ""))
        group_goals[group] = group_goals.get(group, 0) + ah + aa
        group_completed[group] = group_completed.get(group, 0) + 1
        team_for[home] = team_for.get(home, 0) + ah
        team_for[away] = team_for.get(away, 0) + aa
        team_against[home] = team_against.get(home, 0) + aa
        team_against[away] = team_against.get(away, 0) + ah
        if ah == aa:
            total_draws += 1
            team_draws[home] = team_draws.get(home, 0) + 1
            team_draws[away] = team_draws.get(away, 0) + 1
        else:
            team_draws.setdefault(home, team_draws.get(home, 0))
            team_draws.setdefault(away, team_draws.get(away, 0))

    return {
        "completed": completed,
        "group_goals": group_goals,
        "group_completed": group_completed,
        "team_for": team_for,
        "team_against": team_against,
        "team_draws": team_draws,
        "total_draws": total_draws,
    }


def leaders(mapping: Dict[str, int], mode: str = "max") -> Tuple[List[str], Optional[int]]:
    if not mapping:
        return [], None
    value = max(mapping.values()) if mode == "max" else min(mapping.values())
    names = sorted([k for k, v in mapping.items() if v == value])
    return names, value


def set_live_or_final(q: Dict[str, Any], answers: List[str], display_value: str, complete: bool, source_title: str) -> str:
    if complete:
        q["actualAnswer"] = display_value
        q["acceptedAnswers"] = answers
        q["status"] = "known"
        q["sourceStatus"] = "verified_fifa_aggregate"
        q["sourceUrl"] = FIFA_SCORES_URL
        q["sourceTitle"] = source_title
        return "closed_auto"
    q["actualAnswer"] = "מוביל זמני: " + display_value
    q["acceptedAnswers"] = answers
    q["status"] = "live"
    q["sourceStatus"] = "live_from_fifa_matches"
    q["sourceUrl"] = FIFA_SCORES_URL
    q["sourceTitle"] = source_title + " - מוביל זמני, לא נספר לניקוד"
    return "live_only"


def build_answer_group_questions(qid: int, ag: Dict[str, Any], complete: bool) -> Optional[Tuple[List[str], str, str]]:
    if qid not in (5, 6):
        return None
    groups = ag["group_goals"]
    names, val = leaders(groups, "min" if qid == 5 else "max")
    if val is None:
        return None
    answers = [f"{GROUP_HE.get(g, g)} | מס' השערים שיובקעו: {bucket_group_goals(int(val))}" for g in names]
    display = " / ".join(answers)
    title = "FIFA verified match scores aggregate - group goals"
    return answers, display, title


def build_answer_team_questions(qid: int, ag: Dict[str, Any], complete: bool) -> Optional[Tuple[List[str], str, str]]:
    # q7: team most goals for; q8: most conceded; q9: fewest goals for; q10: fewest conceded; q11: most draws.
    if qid == 7:
        names, val = leaders(ag["team_for"], "max")
        field = "מס' השערים שתבקיע"
        bucket = bucket_team_goals
        title = "FIFA verified match scores aggregate - team goals for"
    elif qid == 8:
        names, val = leaders(ag["team_against"], "max")
        field = "מס' השערים שתספוג"
        bucket = bucket_team_goals
        title = "FIFA verified match scores aggregate - team goals against"
    elif qid == 9:
        names, val = leaders(ag["team_for"], "min")
        field = "מס' השערים שתבקיע"
        bucket = bucket_team_goals
        title = "FIFA verified match scores aggregate - team goals for"
    elif qid == 10:
        names, val = leaders(ag["team_against"], "min")
        field = "מס' השערים שתספוג"
        bucket = bucket_team_goals
        title = "FIFA verified match scores aggregate - team goals against"
    elif qid == 11:
        names, val = leaders(ag["team_draws"], "max")
        field = "מס' תוצאות תיקו"
        bucket = lambda x: str(x)
        title = "FIFA verified match scores aggregate - team draws"
    else:
        return None
    if val is None:
        return None
    answers = [f"{name} | {field}: {bucket(int(val))}" for name in names]
    display = " / ".join(answers)
    return answers, display, title


def build_answer_count_questions(qid: int, ag: Dict[str, Any], complete: bool) -> Optional[Tuple[List[str], str, str]]:
    if qid != 12:
        return None
    val = int(ag["total_draws"])
    answer = bucket_draws(val)
    return [answer], answer, "FIFA verified match scores aggregate - total draws"


def apply_manual_open_answers(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    manual = load_manual_open_answers()
    q_by_id = {int(q.get("id")): q for q in data.get("openQuestions", []) if q.get("id") is not None}
    applied: List[Dict[str, Any]] = []
    for item in manual:
        if not item.get("enabled", True):
            continue
        try:
            qid = int(item.get("qId"))
        except Exception:
            continue
        q = q_by_id.get(qid)
        if not q:
            continue
        answer = str(item.get("answer", "")).strip()
        if not answer:
            continue
        accepted = item.get("acceptedAnswers")
        if not isinstance(accepted, list) or not accepted:
            accepted = [answer]
        q["actualAnswer"] = answer
        q["acceptedAnswers"] = [str(x) for x in accepted]
        q["status"] = item.get("status", "known")
        q["sourceStatus"] = item.get("sourceStatus", "verified_manual")
        q["sourceUrl"] = item.get("sourceUrl", "")
        q["sourceTitle"] = item.get("sourceTitle", "Manual verified open-question answer")
        if item.get("note"):
            q["note"] = item.get("note")
        applied.append({"qId": qid, "answer": answer, "sourceStatus": q.get("sourceStatus"), "sourceTitle": q.get("sourceTitle")})
    return applied


def update_open_questions(data: Dict[str, Any]) -> Dict[str, Any]:
    complete = group_stage_complete(data)
    ag = match_aggregates(data)
    manual_updates = apply_manual_open_answers(data)
    review: List[Dict[str, Any]] = []
    auto_live = []
    auto_closed = []

    for q in data.get("openQuestions", []):
        qid = int(q.get("id", 0) or 0)
        # Do not overwrite questions already verified by manual/uploaded/external unless they are live.
        current_status = str(q.get("status", ""))
        if current_status in ("known", "verified") and q.get("sourceStatus") not in ("live_from_fifa_matches", "verified_fifa_aggregate"):
            review.append({
                "id": qid, "row": q.get("row"), "question": q.get("question"),
                "engineStatus": "already_closed", "actualAnswer": q.get("actualAnswer"),
                "nextAction": "לא נוגע - כבר סגור/מאומת", "sourceStatus": q.get("sourceStatus"),
            })
            continue

        built = build_answer_group_questions(qid, ag, complete) or build_answer_team_questions(qid, ag, complete) or build_answer_count_questions(qid, ag, complete)
        if built:
            answers, display, title = built
            result = set_live_or_final(q, answers, display, complete, title)
            row = {
                "id": qid, "row": q.get("row"), "question": q.get("question"),
                "engineStatus": result, "actualAnswer": q.get("actualAnswer"),
                "nextAction": "נספר סופית רק אחרי סיום 72 משחקי הבתים" if result == "live_only" else "נסגר אוטומטית",
                "sourceStatus": q.get("sourceStatus"),
            }
            review.append(row)
            (auto_closed if result == "closed_auto" else auto_live).append(row)
        else:
            review.append({
                "id": qid, "row": q.get("row"), "question": q.get("question"),
                "engineStatus": "manual_or_future_rule", "actualAnswer": q.get("actualAnswer"),
                "nextAction": "צריך מקור/כלל ידני או כלל סטטיסטי ייעודי", "sourceStatus": q.get("sourceStatus"),
            })

    data["_openQuestionReview"] = review
    meta = data.setdefault("meta", {})
    meta["openQuestionEngine"] = "enabled"
    meta["liveOpenQuestions"] = sum(1 for q in data.get("openQuestions", []) if q.get("status") == "live")
    meta["resolvedOpenQuestions"] = sum(1 for q in data.get("openQuestions", []) if q.get("status") in ("known", "verified"))
    meta["verifiedOpenQuestions"] = meta["resolvedOpenQuestions"]
    meta["openQuestionManualUpdates"] = len(manual_updates)
    return {"manualUpdates": manual_updates, "autoLive": auto_live, "autoClosed": auto_closed, "reviewRows": review}


def score_open_pick(prediction: Any, q: Dict[str, Any]) -> Tuple[int, str]:
    if q.get("status") not in ("known", "verified"):
        if q.get("status") == "live":
            return 0, "מוביל זמני - לא נספר עדיין"
        return 0, "ממתין למקור מאומת"
    actual = q.get("actualAnswer", "")
    accepted = q.get("acceptedAnswers")
    if not isinstance(accepted, list) or not accepted:
        accepted = [actual]
    n_pred = normalize_answer(prediction)
    accepted_norm = {normalize_answer(x) for x in accepted}
    if n_pred in accepted_norm:
        return int(q.get("maxPoints", 10) or 10), "פגיעה"
    return 0, "פספוס"


def recompute_scores(data: Dict[str, Any]) -> None:
    matches_by_id = {int(m["id"]): m for m in data.get("matches", [])}
    open_by_id = {int(q.get("id")): q for q in data.get("openQuestions", []) if q.get("id") is not None}
    prev_by_name = {p.get("name", ""): dict(p) for p in data.get("participants", [])}

    for p in data.get("participants", []):
        match_points = exact = partial = gd_count = 0
        for md in p.get("matches", []):
            mid = int(md.get("matchId", 0) or 0)
            m = matches_by_id.get(mid)
            if not m:
                continue
            ah = m.get("actualHome") if m.get("status") == "verified" else None
            aa = m.get("actualAway") if m.get("status") == "verified" else None
            pts, ex, pa, gd, label = score_match_pick(md.get("homePick", ""), md.get("awayPick", ""), ah, aa)
            md["points"] = pts
            md["exact"] = ex
            md["partial"] = pa
            md["gd"] = gd
            md["label"] = label
            match_points += pts
            exact += ex
            partial += pa
            gd_count += gd
        open_points = 0
        open_hits = 0
        open_resolved = 0
        for od in p.get("open", []):
            qid = int(od.get("qId", 0) or 0)
            q = open_by_id.get(qid)
            if not q:
                continue
            pts, label = score_open_pick(od.get("prediction", ""), q)
            od["points"] = pts
            od["label"] = label
            open_points += pts
            if q.get("status") in ("known", "verified"):
                open_resolved += 1
                if pts > 0:
                    open_hits += 1
        p["matchPoints"] = match_points
        p["exact"] = exact
        p["partial"] = partial
        p["gd"] = gd_count
        p["openPoints"] = int(open_points)
        p["openHits"] = int(open_hits)
        p["openResolved"] = int(open_resolved)
        p["bonusPoints"] = int(sum(int(x.get("points", 0) or 0) for x in p.get("bonuses", [])))
        old_total = int(prev_by_name.get(p.get("name", ""), {}).get("total", 0) or 0)
        old_rank = int(prev_by_name.get(p.get("name", ""), {}).get("rank", 0) or 0)
        new_total = int(p["matchPoints"] + p["openPoints"] + p["bonusPoints"])
        p["prevPoints"] = old_total
        p["total"] = new_total
        p["pointsChange"] = new_total - old_total
        p["prevRank"] = old_rank or None

    # Competition ranking: 1, 2, 2, 4 style.
    participants = data.get("participants", [])
    participants.sort(key=lambda x: (-int(x.get("total", 0) or 0), str(x.get("name", ""))))
    last_score = None
    last_rank = 0
    for idx, p in enumerate(participants, start=1):
        score = int(p.get("total", 0) or 0)
        if score != last_score:
            last_rank = idx
            last_score = score
        old_rank = p.get("prevRank")
        p["rank"] = last_rank
        p["rankChange"] = (int(old_rank) - last_rank) if isinstance(old_rank, int) else None

    meta = data.setdefault("meta", {})
    meta["generatedAt"] = local_now_manila()
    meta["participantsCount"] = len(participants)
    meta["matchesCount"] = len(data.get("matches", []))
    meta["completedFifaMatches"] = sum(1 for m in data.get("matches", []) if m.get("status") == "verified")
    meta["pendingMatches"] = meta["matchesCount"] - meta["completedFifaMatches"]
    meta["openQuestionsCount"] = len(data.get("openQuestions", []))
    meta["resolvedOpenQuestions"] = sum(1 for q in data.get("openQuestions", []) if q.get("status") in ("known", "verified"))
    meta["verifiedOpenQuestions"] = meta["resolvedOpenQuestions"]
    meta["liveOpenQuestions"] = sum(1 for q in data.get("openQuestions", []) if q.get("status") == "live")
    meta["dashboardVersion"] = "GitHub Auto FIFA + Open Questions Updater"
    meta["lastAutomationAtUtc"] = utc_now()

def ensure_source(data: Dict[str, Any], title: str, url: str, note: str = "") -> None:
    sources = data.setdefault("sources", [])
    if not any(s.get("url") == url and s.get("title") == title for s in sources):
        sources.append({"type": "משחקים - FIFA", "title": title, "url": url, "note": note})


def write_csvs(data: Dict[str, Any]) -> None:
    def write_csv(path: str, rows: List[Dict[str, Any]], fields: List[str]) -> None:
        with open(os.path.join(ROOT, path), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)

    leaderboard_rows = []
    for p in data.get("participants", []):
        leaderboard_rows.append({
            "rank": p.get("rank"), "name": p.get("name"), "total": p.get("total"),
            "matchPoints": p.get("matchPoints"), "openPoints": p.get("openPoints"), "bonusPoints": p.get("bonusPoints"),
            "exact": p.get("exact"), "partial": p.get("partial"), "gd": p.get("gd"),
            "pointsChange": p.get("pointsChange"), "rankChange": p.get("rankChange"),
        })
    write_csv("leaderboard.csv", leaderboard_rows, ["rank", "name", "total", "matchPoints", "openPoints", "bonusPoints", "exact", "partial", "gd", "pointsChange", "rankChange"])

    match_rows = []
    for m in data.get("matches", []):
        match_rows.append({
            "id": m.get("id"), "row": m.get("row"), "group": m.get("group"), "date": m.get("date"),
            "home": m.get("home"), "away": m.get("away"), "actualHome": m.get("actualHome", ""),
            "actualAway": m.get("actualAway", ""), "status": m.get("status"),
            "sourceTitle": m.get("sourceTitle", ""), "sourceUrl": m.get("sourceUrl", ""),
        })
    write_csv("matches.csv", match_rows, ["id", "row", "group", "date", "home", "away", "actualHome", "actualAway", "status", "sourceTitle", "sourceUrl"])

    open_rows = []
    for q in data.get("openQuestions", []):
        open_rows.append({
            "id": q.get("id"), "row": q.get("row"), "section": q.get("section"), "question": q.get("question"),
            "actualAnswer": q.get("actualAnswer"), "status": q.get("status"), "sourceStatus": q.get("sourceStatus"),
            "sourceTitle": q.get("sourceTitle"), "sourceUrl": q.get("sourceUrl"), "maxPoints": q.get("maxPoints"),
        })
    write_csv("open_questions.csv", open_rows, ["id", "row", "section", "question", "actualAnswer", "status", "sourceStatus", "sourceTitle", "sourceUrl", "maxPoints"])

    src_rows = []
    for s in data.get("sources", []):
        src_rows.append({"type": s.get("type"), "title": s.get("title"), "url": s.get("url"), "note": s.get("note")})
    write_csv("sources_all.csv", src_rows, ["type", "title", "url", "note"])
    fifa_rows = [r for r in src_rows if "fifa.com" in str(r.get("url", "")).lower()]
    write_csv("sources_fifa.csv", fifa_rows, ["type", "title", "url", "note"])

    review_rows = data.get("_openQuestionReview", [])
    if review_rows:
        write_csv("open_question_review.csv", review_rows, ["id", "row", "question", "engineStatus", "actualAnswer", "nextAction", "sourceStatus"])

    # Personal audit for Efi if present.
    efi = next((p for p in data.get("participants", []) if "אפי" in str(p.get("name", "")) and "קטש" in str(p.get("name", ""))), None)
    if efi:
        rows: List[Dict[str, Any]] = []
        match_by_id = {m.get("id"): m for m in data.get("matches", [])}
        for md in efi.get("matches", []):
            m = match_by_id.get(md.get("matchId"), {})
            rows.append({
                "type": "match", "id": md.get("matchId"), "item": f"{m.get('home','')} - {m.get('away','')}",
                "actual": f"{m.get('actualHome','')}-{m.get('actualAway','')}" if m.get("status") == "verified" else "",
                "prediction": f"{md.get('homePick','')}-{md.get('awayPick','')}", "points": md.get("points"), "label": md.get("label"),
            })
        q_by_id = {q.get("id"): q for q in data.get("openQuestions", [])}
        for od in efi.get("open", []):
            q = q_by_id.get(od.get("qId"), {})
            rows.append({
                "type": "open", "id": od.get("qId"), "item": q.get("question", ""),
                "actual": q.get("actualAnswer", ""), "prediction": od.get("prediction", ""),
                "points": od.get("points"), "label": od.get("label"),
            })
        write_csv("efi_katash_audit.csv", rows, ["type", "id", "item", "actual", "prediction", "points", "label"])


def main() -> int:
    if not os.path.exists(DATA_PATH):
        write_status("error", "data.json was not found", root=ROOT)
        return 1

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    discovered, warnings = discover_fifa_results(data)
    updates: List[Dict[str, Any]] = []
    conflicts: List[Dict[str, Any]] = []

    for m in data.get("matches", []):
        mid = int(m.get("id", 0) or 0)
        hit = discovered.get(mid)
        if not hit:
            continue
        current_verified = m.get("status") == "verified" and m.get("actualHome") is not None and m.get("actualAway") is not None
        if current_verified:
            if int(m.get("actualHome")) != int(hit["actualHome"]) or int(m.get("actualAway")) != int(hit["actualAway"]):
                conflicts.append({
                    "matchId": mid,
                    "match": f"{m.get('home')} - {m.get('away')}",
                    "current": f"{m.get('actualHome')}-{m.get('actualAway')}",
                    "found": f"{hit['actualHome']}-{hit['actualAway']}",
                    "source": hit.get("sourceUrl"),
                    "evidence": hit.get("evidence"),
                })
            continue
        m["actualHome"] = int(hit["actualHome"])
        m["actualAway"] = int(hit["actualAway"])
        m["status"] = "verified"
        m["sourceUrl"] = hit.get("sourceUrl") or FIFA_SCORES_URL
        m["sourceTitle"] = hit.get("sourceTitle") or "FIFA official result"
        updates.append({
            "matchId": mid,
            "match": f"{m.get('home')} - {m.get('away')}",
            "score": f"{m['actualHome']}-{m['actualAway']}",
            "source": m["sourceUrl"],
            "evidence": hit.get("evidence"),
        })
        ensure_source(data, m["sourceTitle"], m["sourceUrl"], f"{m.get('home')} - {m.get('away')} {m['actualHome']}-{m['actualAway']}")

    open_result = update_open_questions(data)
    recompute_scores(data)
    write_csvs(data)

    data.pop("_openQuestionReview", None)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    status = "ok" if not conflicts else "needs_review"
    msg = "Dashboard checked against FIFA."
    if updates:
        msg += f" Added {len(updates)} new match result(s)."
    else:
        msg += " No new match results found."
    if open_result.get("manualUpdates"):
        msg += f" Applied {len(open_result.get("manualUpdates", []))} manual open-question answer(s)."
    if open_result.get("autoClosed"):
        msg += f" Closed {len(open_result.get("autoClosed", []))} open question(s) automatically."
    if open_result.get("autoLive"):
        msg += f" Updated {len(open_result.get("autoLive", []))} live open-question tracker(s)."
    if conflicts:
        msg += f" {len(conflicts)} conflict(s) need manual review."

    write_status(status, msg, updates=updates, conflicts=conflicts, warnings=warnings, open_questions=open_result, completed_matches=data.get("meta", {}).get("completedFifaMatches"), live_open_questions=data.get("meta", {}).get("liveOpenQuestions"), resolved_open_questions=data.get("meta", {}).get("resolvedOpenQuestions"), leader=data.get("participants", [{}])[0].get("name"), leader_points=data.get("participants", [{}])[0].get("total"))
    print(msg)
    if warnings:
        print("Warnings:")
        for w in warnings[:10]:
            print("-", w)
    if conflicts:
        print("Conflicts:")
        for c in conflicts:
            print("-", c)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
