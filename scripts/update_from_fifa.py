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
FIFA_LIVE_DEBUG_CSV_PATH = os.path.join(ROOT, "fifa_live_debug.csv")

FIFA_SCORES_URL = "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures"
FIFA_LIVE_UPDATES_URL = "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/todays-matches-live-updates"
FIFA_MATCH_CENTRE_URL = "https://www.fifa.com/en/match-centre"
FIFA_MATCH_CENTRE_LIVE_URL = "https://www.fifa.com/en/match-centre/live"
FIFA_MATCH_CENTRE_LIVE_ROOT_URL = "https://www.fifa.com/live"

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
    # Matchday 4 - needed for live scoring. FIFA scores/fixtures page often hides live score in JS,
    # so we fetch the official Match Centre page directly.
    25: "https://www.fifa.com/en/match-centre/match/17/285023/289273/400021464",  # Germany vs Curacao
    26: "https://www.fifa.com/en/match-centre/match/17/285023/289273/400021467",  # Cote d Ivoire vs Ecuador
    29: "https://www.fifa.com/en/match-centre/match/17/285023/289273/400021470",  # Netherlands vs Japan
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


def fetch_rendered_url(url: str, timeout_ms: int = 65000) -> str:
    """Render a FIFA page with a real Chromium browser and return visible text + HTML text.

    FIFA often hydrates live scores through client-side JavaScript, so urllib can see the shell
    but not the live score. This function is intentionally optional: if Playwright is not installed
    or FIFA blocks the runner, the updater logs a warning and falls back to normal HTML parsing.
    """
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
    except Exception as exc:  # pragma: no cover - only happens on GitHub if install failed
        raise RuntimeError(f"Playwright is not available: {exc}")

    user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
        )
        context = browser.new_context(
            user_agent=user_agent,
            locale="en-US",
            timezone_id="Asia/Manila",
            viewport={"width": 1440, "height": 1200},
        )
        page = context.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            # Try to dismiss cookie/consent overlays without failing if no overlay exists.
            for label in ["Accept all", "Accept All", "I accept", "Agree", "Allow all", "Continue"]:
                try:
                    btn = page.get_by_role("button", name=label)
                    if btn.count() > 0:
                        btn.first.click(timeout=2500)
                        break
                except Exception:
                    pass
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                pass
            # Give live widgets a little extra time to hydrate.
            page.wait_for_timeout(8000)
            try:
                visible_text = page.locator("body").inner_text(timeout=15000)
            except Exception:
                visible_text = ""
            try:
                html_text = page.content()
            except Exception:
                html_text = ""
            return normalize_text(visible_text + "\n" + strip_tags(html_text))
        finally:
            context.close()
            browser.close()


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
    """Return (homeScore, awayScore, evidenceSnippet) from FIFA page text if confidently found.

    Important RTL/dashboard safety note:
    We only accept a score when the score is physically between the two relevant team names
    or in a tight rendered scoreboard pattern that clearly belongs to that exact pair.
    This prevents a live score like "Germany 4-1 Curaçao" from being accidentally attached
    to nearby upcoming fixtures such as "Côte d'Ivoire vs Ecuador" that appear on the same FIFA page.
    """
    text = normalize_text(text)
    home_aliases = aliases_for(home_he)
    away_aliases = aliases_for(away_he)

    status_words = r"(?:FT|Full[- ]time|Full time|Result|Final|Match report|highlights|beat|edge|draw|defeat|win|victory|earn|LIVE|Live|live|In progress|First half|Second half|Half-time|Halftime|HT)"
    score = r"(\d{1,2})\s*[-–]\s*(\d{1,2})"

    def sane_score(hs: int, aw: int) -> bool:
        return 0 <= hs <= 15 and 0 <= aw <= 15

    def ctx_ok(window: str) -> bool:
        # Require football context. This is deliberately stricter than earlier versions.
        return bool(re.search(status_words, window, flags=re.I) or re.search(r"\bGroup\s+[A-L]\b|World Cup|MATCH DETAILS|Match Centre", window, flags=re.I))

    def good_window(start: int, end: int) -> str:
        return text[max(0, start - 140): min(len(text), end + 140)]

    # Best case: Team A 4-1 Team B / TEAM A 4 - 1 TEAM B.
    # The score must be BETWEEN the two team aliases. We do NOT accept "4-1 Team A Team B" or
    # "Team A Team B 4-1", because those caused false positives from other matches on the same page.
    for ha in home_aliases:
        for aa in away_aliases:
            h = rx_alias(ha)
            a = rx_alias(aa)
            pat = rf"({h}.{{0,80}}?{score}.{{0,80}}?{a})"
            for m in re.finditer(pat, text, flags=re.I):
                snippet = m.group(1)
                hs, aw = int(m.group(2)), int(m.group(3))
                window = good_window(m.start(), m.end())
                if sane_score(hs, aw) and ctx_ok(window):
                    return hs, aw, normalize_text(window)[:500]

    # Rendered tile without hyphen: Team A 4 Team B 1.
    # Keep this very tight and reject obvious time rows like 07:00.
    for ha in home_aliases:
        for aa in away_aliases:
            h = rx_alias(ha)
            a = rx_alias(aa)
            pat = rf"({h}\W{{0,35}}(\d{{1,2}})\W{{0,70}}{a}\W{{0,35}}(\d{{1,2}}))"
            for m in re.finditer(pat, text, flags=re.I):
                snippet = m.group(1)
                if re.search(r"\b\d{1,2}:\d{2}\b", snippet):
                    continue
                try:
                    hs, aw = int(m.group(2)), int(m.group(3))
                except Exception:
                    continue
                window = good_window(m.start(), m.end())
                if sane_score(hs, aw) and ctx_ok(window):
                    return hs, aw, normalize_text(window)[:500]

    # Article/headline style, still strict: Team A 2-0 Team B | Match report.
    for ha in home_aliases:
        for aa in away_aliases:
            pat = rf"({rx_alias(ha)}\s+{score}\s+{rx_alias(aa)}\s*(?:\||-|,|:)?.{{0,80}}?(?:Match report|highlights|FIFA|World Cup|Full Time|LIVE|Live))"
            m = re.search(pat, text, flags=re.I)
            if m:
                hs, aw = int(m.group(2)), int(m.group(3))
                if sane_score(hs, aw):
                    window = good_window(m.start(), m.end())
                    if ctx_ok(window):
                        return hs, aw, normalize_text(window)[:500]

    return None


def classify_fifa_match_status(evidence: str) -> str:
    """Classify a FIFA score as verified final or live. Unknown scores are ignored for pending matches."""
    txt = normalize_text(evidence).lower()
    final_cues = [
        "ft", "full-time", "full time", "final", "match report", "highlights",
        "beat", "defeat", "victory", "win over", "earn battling draws", "round-up", "review"
    ]
    live_cues = [
        "live", "in progress", "first half", "second half", "half-time", "halftime",
        "ht", "kick-off", "kickoff", "minute", "mins", "added time", "stoppage time"
    ]
    minute_cue = re.search(r"(?:\b\d{1,3}\s*(?:'|’|min|mins|minute)\b|\b\d{1,2}\+\d{1,2}\s*(?:'|’))", txt)
    if any(cue in txt for cue in final_cues):
        return "verified"
    if minute_cue or any(cue in txt for cue in live_cues):
        return "live"
    return "unknown"


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

    urls = [FIFA_SCORES_URL, FIFA_LIVE_UPDATES_URL, FIFA_MATCH_CENTRE_URL, FIFA_MATCH_CENTRE_LIVE_URL, FIFA_MATCH_CENTRE_LIVE_ROOT_URL]
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

    # Browser-rendered pass: this is the heavy but necessary path for live scores rendered by JavaScript.
    # Keep it focused on the central fixtures/live pages and known match-centre URLs.
    rendered_urls: List[str] = []
    for url in [FIFA_SCORES_URL, FIFA_MATCH_CENTRE_LIVE_URL, FIFA_MATCH_CENTRE_LIVE_ROOT_URL]:
        if url not in rendered_urls:
            rendered_urls.append(url)
    for mid, url in KNOWN_MATCH_CENTRE.items():
        if url not in rendered_urls:
            rendered_urls.append(url)
    for url in rendered_urls:
        try:
            rendered = fetch_rendered_url(url)
            fetched.append(url + " [rendered]")
            combined_text += "\n\nRENDERED_SOURCE_URL: " + url + "\n" + rendered
        except Exception as e:
            warnings.append(f"Could not render FIFA URL {url}: {e}")

    if not fetched:
        warnings.append("No FIFA pages could be fetched. Data was not changed.")
        return discovered, warnings

    debug_rows: List[Dict[str, Any]] = []
    for match in data.get("matches", []):
        mid = int(match.get("id", 0) or 0)
        home = str(match.get("home", ""))
        away = str(match.get("away", ""))
        if not home or not away or not mid:
            continue

        home_aliases = aliases_for(home)
        away_aliases = aliases_for(away)
        home_found_aliases = [a for a in home_aliases if re.search(rx_alias(a), combined_text, flags=re.I)]
        away_found_aliases = [a for a in away_aliases if re.search(rx_alias(a), combined_text, flags=re.I)]

        found = find_score_in_text(combined_text, home, away)
        debug_row: Dict[str, Any] = {
            "matchId": mid,
            "match": f"{home} - {away}",
            "currentStatus": match.get("status", ""),
            "currentScore": f"{match.get('actualHome', '')}-{match.get('actualAway', '')}",
            "homeAliasesFound": " | ".join(home_found_aliases[:8]),
            "awayAliasesFound": " | ".join(away_found_aliases[:8]),
            "candidateScore": "",
            "candidateStatus": "not_found",
            "evidence": "",
        }

        if not found:
            debug_rows.append(debug_row)
            continue

        hs, aw, evidence = found
        match_status = classify_fifa_match_status(evidence)
        debug_row["candidateScore"] = f"{hs}-{aw}"
        debug_row["candidateStatus"] = match_status
        debug_row["evidence"] = evidence
        debug_rows.append(debug_row)

        # Guardrail: do not turn scheduled future 0-0 fixtures into live scores unless context is strong.
        # If a rendered FIFA/Match Centre page shows a plausible non-clock score for this exact team pair,
        # treat it as live. Final locking still requires final/FT/report cues.
        if match_status == "unknown" and str(match.get("status", "")) not in ("verified", "live"):
            if mid in KNOWN_MATCH_CENTRE and (hs != 0 or aw != 0):
                match_status = "live"
            else:
                continue
        if match_status == "unknown":
            match_status = "verified" if str(match.get("status", "")) == "verified" else "live"
        discovered[mid] = {
            "actualHome": hs,
            "actualAway": aw,
            "matchStatus": match_status,
            "sourceUrl": KNOWN_MATCH_CENTRE.get(mid, FIFA_SCORES_URL),
            "sourceTitle": "FIFA official live score" if match_status == "live" else "FIFA official final result",
            "evidence": evidence,
        }

    # Diagnostic file: tells us exactly what the GitHub runner can see from FIFA.
    # This is critical because FIFA often renders live scores through client-side JavaScript/API calls.
    try:
        with open(FIFA_LIVE_DEBUG_CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
            fields = ["matchId", "match", "currentStatus", "currentScore", "homeAliasesFound", "awayAliasesFound", "candidateScore", "candidateStatus", "evidence"]
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(debug_rows)
    except Exception as exc:
        warnings.append(f"Could not write fifa_live_debug.csv: {exc}")

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


# Open questions are grouped in the original master file. A row can look generic, but its section/block
# can completely change the meaning. Example: "red card to one of the players" inside the heavy-gunners
# block refers only to Diaz/Vinicius/Messi/Kane/Ronaldo/Mbappe/Mane/En-Nesyri/Salah, not to any player.
def open_question_block(section: Any, question: Any) -> str:
    sec = normalize_text(section or "")
    q = normalize_text(question or "")
    if any(x in sec for x in ["התותחים", "דיאז", "ויניסיוס", "מסי", "קיין", "רונאלדו", "אמבפה", "מאנה", "נסירי", "סלאח"]):
        return "ראש בראש כוכבים - התותחים הכבדים"
    if any(x in sec for x in ["שלב הבתים", "בית", "בתים"]):
        return "שלב הבתים"
    if any(x in sec for x in ["שמינית", "1/16", "נוקאאוט"]):
        return "שלב 1/16 / נוקאאוט"
    if any(x in sec for x in ["רבע"]):
        return "רבע הגמר"
    if any(x in sec for x in ["חצי"]):
        return "חצי הגמר"
    if any(x in sec for x in ["גמר"]):
        return "גמר"
    if any(x in q for x in ["מלך השערים", "הנבחרת הזוכה"]):
        return "כל הטורניר"
    return "לא מסווג - דורש בדיקת מנהל"


def open_question_rule_type(qid: int, section: Any, question: Any) -> str:
    sec = normalize_text(section or "")
    q = normalize_text(question or "")
    if qid in (1, 2, 3, 4):
        return "closed_from_opening_match"
    if qid in (5, 6, 7, 8, 9, 10, 11, 12):
        return "live_aggregate_until_group_stage_complete"
    if any(x in q for x in ["האם", "לפחות", "יישלף", "יכבוש", "יובקע"]):
        if open_question_block(sec, q) == "ראש בראש כוכבים - התותחים הכבדים":
            return "specific_player_group_manual"
        return "threshold_or_yes_no_manual"
    if any(x in q for x in ["הכי", "מלך", "הנבחרת", "מס'", "מספר", "הפרש", "תוצאה"]):
        return "leader_or_superlative_do_not_close_early"
    return "manual_context_required"

def is_fast_track_section(section: Any) -> bool:
    sec = normalize_text(section or "")
    return "המסלול המהיר" in sec


def is_opening_match_exception(qid: int) -> bool:
    # These four questions are already settled by the opening match and may remain scored.
    return qid in (1, 2, 3, 4)


def is_section_locked_until_stage_end(section: Any, question: Any) -> bool:
    sec = normalize_text(section or "")
    # User decision: do not answer these open-question sections for now.
    locked_markers = [
        "שלב הבתים",
        "התותחים", "דיאז", "ויניסיוס", "מסי", "קיין", "רונאלדו", "אמבפה", "מאנה", "נסירי", "סלאח",
        "1/16", "שמינית", "רבע", "חצי",
        "הניחושים המיוחדים",
        "מסלול ה\"גמר\"", "מסלול הגמר",
    ]
    if is_fast_track_section(sec):
        return False
    return any(marker in sec for marker in locked_markers)


def open_question_policy_status(q: Dict[str, Any]) -> str:
    qid = int(q.get("id", 0) or 0)
    if is_opening_match_exception(qid):
        return "opening_match_exception_closed"
    if is_fast_track_section(q.get("section", "")):
        return "fast_track_daily_check"
    if is_section_locked_until_stage_end(q.get("section", ""), q.get("question", "")):
        return "locked_not_answered_now"
    return "manual_context_required"


def reset_locked_live_question(q: Dict[str, Any]) -> None:
    # Previous versions wrote live leaders for group-stage/superlative questions.
    # Per admin decision, locked sections should not be answered now, even as live scoring inputs.
    if q.get("status") == "live":
        q["status"] = "pending"
        q["actualAnswer"] = "לא ידוע"
        q["acceptedAnswers"] = []
        q["sourceStatus"] = "locked_not_answered_now"
        q["sourceUrl"] = ""
        q["sourceTitle"] = "לא נענה כרגע לפי החלטת מנהל - השאלה תיסגר רק במועד המתאים"


def add_review_row(review: List[Dict[str, Any]], q: Dict[str, Any], engine_status: str, actual_answer: Any, next_action: str, source_status: Any) -> None:
    section = q.get("section", "")
    review.append({
        "id": q.get("id"),
        "row": q.get("row"),
        "section": section,
        "block": open_question_block(section, q.get("question", "")),
        "ruleType": open_question_rule_type(int(q.get("id", 0) or 0), section, q.get("question", "")),
        "policyStatus": open_question_policy_status(q),
        "question": q.get("question"),
        "engineStatus": engine_status,
        "actualAnswer": actual_answer,
        "nextAction": next_action,
        "sourceStatus": source_status,
    })



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


def apply_manual_open_answers(data: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    manual = load_manual_open_answers()
    q_by_id = {int(q.get("id")): q for q in data.get("openQuestions", []) if q.get("id") is not None}
    applied: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []
    for item in manual:
        if not item.get("enabled", True):
            continue
        try:
            qid = int(item.get("qId"))
        except Exception:
            skipped.append({"item": item, "reason": "missing_or_invalid_qId"})
            continue
        q = q_by_id.get(qid)
        if not q:
            skipped.append({"qId": qid, "reason": "question_not_found"})
            continue

        # Default guardrail: for now, manual answers are allowed automatically only for fast-track questions
        # and the four opening-match exceptions. Locked sections can still be closed later with
        # overrideProtectedSection=true, but only after admin decision.
        if (
            not is_fast_track_section(q.get("section", ""))
            and not is_opening_match_exception(qid)
            and not item.get("overrideProtectedSection", False)
        ):
            skipped.append({
                "qId": qid,
                "row": q.get("row"),
                "reason": "protected_section_not_enabled_for_manual_updates",
                "section": q.get("section", ""),
                "policyStatus": open_question_policy_status(q),
            })
            continue

        # Context guardrail: manual entries may include expectedSectionContains/questionContains/blockContains.
        # If provided, the bot refuses to apply the answer unless the question is in the intended block.
        section = normalize_text(q.get("section", ""))
        question = normalize_text(q.get("question", ""))
        block = normalize_text(open_question_block(section, question))
        expected_section = item.get("expectedSectionContains", [])
        if isinstance(expected_section, str):
            expected_section = [expected_section]
        if expected_section and not all(str(x) in section for x in expected_section):
            skipped.append({
                "qId": qid, "reason": "section_guard_failed",
                "expectedSectionContains": expected_section,
                "actualSection": section,
            })
            continue
        expected_block = item.get("expectedBlockContains", [])
        if isinstance(expected_block, str):
            expected_block = [expected_block]
        if expected_block and not all(str(x) in block for x in expected_block):
            skipped.append({
                "qId": qid, "reason": "block_guard_failed",
                "expectedBlockContains": expected_block,
                "actualBlock": block,
            })
            continue
        expected_question = item.get("expectedQuestionContains", [])
        if isinstance(expected_question, str):
            expected_question = [expected_question]
        if expected_question and not all(str(x) in question for x in expected_question):
            skipped.append({
                "qId": qid, "reason": "question_guard_failed",
                "expectedQuestionContains": expected_question,
                "actualQuestion": question,
            })
            continue

        answer = str(item.get("answer", "")).strip()
        if not answer:
            skipped.append({"qId": qid, "reason": "empty_answer"})
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
        q["block"] = open_question_block(section, question)
        q["ruleType"] = open_question_rule_type(qid, section, question)
        q["policyStatus"] = open_question_policy_status(q)
        if item.get("note"):
            q["note"] = item.get("note")
        applied.append({
            "qId": qid,
            "row": q.get("row"),
            "block": q.get("block"),
            "answer": answer,
            "sourceStatus": q.get("sourceStatus"),
            "sourceTitle": q.get("sourceTitle"),
        })
    return {"applied": applied, "skipped": skipped}


def update_open_questions(data: Dict[str, Any]) -> Dict[str, Any]:
    # User-approved policy as of Step 8:
    # - Do NOT answer now: group-stage open questions, heavy-gunners block, 1/16, round of 16,
    #   quarter-finals, semi-finals, final, special guesses, final path.
    # - Check the fast-track section after every matchday.
    # - Existing verified/known answers remain untouched.
    complete = group_stage_complete(data)
    ag = match_aggregates(data)
    manual_result = apply_manual_open_answers(data)
    manual_updates = manual_result.get("applied", [])
    manual_skipped = manual_result.get("skipped", [])
    review: List[Dict[str, Any]] = []
    auto_live: List[Dict[str, Any]] = []
    auto_closed: List[Dict[str, Any]] = []
    fast_track_review: List[Dict[str, Any]] = []

    for q in data.get("openQuestions", []):
        qid = int(q.get("id", 0) or 0)
        q["block"] = open_question_block(q.get("section", ""), q.get("question", ""))
        q["ruleType"] = open_question_rule_type(qid, q.get("section", ""), q.get("question", ""))
        q["policyStatus"] = open_question_policy_status(q)

        current_status = str(q.get("status", ""))

        # Already verified answers stay. This preserves the four opening questions, q99 from the uploaded file,
        # and q116 from the fast-track evidence.
        if current_status in ("known", "verified") and q.get("sourceStatus") not in ("live_from_fifa_matches", "verified_fifa_aggregate"):
            add_review_row(review, q, "already_closed", q.get("actualAnswer"), "לא נוגע - כבר סגור/מאומת", q.get("sourceStatus"))
            if is_fast_track_section(q.get("section", "")):
                fast_track_review.append({
                    "id": qid, "row": q.get("row"), "question": q.get("question"),
                    "status": "closed", "actualAnswer": q.get("actualAnswer"),
                    "nextAction": "כבר נסגר וניקוד מחושב",
                    "sourceTitle": q.get("sourceTitle", ""), "sourceUrl": q.get("sourceUrl", ""),
                })
            continue

        # Locked sections: do not answer now. Also remove previous live-only values from older versions.
        if is_section_locked_until_stage_end(q.get("section", ""), q.get("question", "")) and not is_opening_match_exception(qid):
            reset_locked_live_question(q)
            add_review_row(
                review, q,
                "locked_not_answered_now",
                q.get("actualAnswer"),
                "לא נענה עכשיו לפי החלטת מנהל; ייסגר רק בסיום השלב/האירוע המתאים או עם override מפורש",
                q.get("sourceStatus"),
            )
            continue

        # Fast track: do not guess. Create a daily checklist. Only manual verified fast-track answers score.
        if is_fast_track_section(q.get("section", "")):
            if current_status == "live":
                q["status"] = "pending"
                q["actualAnswer"] = "לא ידוע"
                q["acceptedAnswers"] = []
                q["sourceStatus"] = "fast_track_daily_check_required"
                q["sourceTitle"] = "מסלול מהיר - דורש בדיקת סטטיסטיקה יומית"
                q["sourceUrl"] = ""
            if q.get("status") not in ("known", "verified"):
                q["status"] = "pending"
                q.setdefault("actualAnswer", "לא ידוע")
                q["sourceStatus"] = "fast_track_daily_check_required"
                q["sourceTitle"] = "מסלול מהיר - דורש בדיקת סטטיסטיקה יומית"
            add_review_row(
                review, q,
                "fast_track_daily_check_required",
                q.get("actualAnswer"),
                "לבדוק אחרי יום משחקים; לסגור רק אם התנאי קרה בוודאות עם מקור",
                q.get("sourceStatus"),
            )
            fast_track_review.append({
                "id": qid, "row": q.get("row"), "question": q.get("question"),
                "status": q.get("status"), "actualAnswer": q.get("actualAnswer"),
                "nextAction": "בדיקה יומית לאחר משחקים; אם התקיים - להוסיף ל-open_question_manual_answers.json עם expectedSectionContains=המסלול המהיר",
                "sourceTitle": q.get("sourceTitle", ""), "sourceUrl": q.get("sourceUrl", ""),
            })
            continue

        # Fallback: no automatic scoring unless explicitly designed later.
        add_review_row(review, q, "manual_context_required", q.get("actualAnswer"), "צריך כלל ידני/מקור/החלטת מנהל", q.get("sourceStatus"))

    data["_openQuestionReview"] = review
    data["_fastTrackReview"] = fast_track_review
    meta = data.setdefault("meta", {})
    meta["openQuestionEngine"] = "enabled_step8_fast_track_only"
    meta["openQuestionPolicy"] = "Only fast-track is reviewed daily; locked sections are not answered now"
    meta["fastTrackReviewCount"] = len(fast_track_review)
    meta["lockedOpenQuestionCount"] = sum(1 for r in review if r.get("engineStatus") == "locked_not_answered_now")
    meta["liveOpenQuestions"] = sum(1 for q in data.get("openQuestions", []) if q.get("status") == "live")
    meta["resolvedOpenQuestions"] = sum(1 for q in data.get("openQuestions", []) if q.get("status") in ("known", "verified"))
    meta["verifiedOpenQuestions"] = meta["resolvedOpenQuestions"]
    meta["openQuestionManualUpdates"] = len(manual_updates)
    return {"manualUpdates": manual_updates, "manualSkipped": manual_skipped, "autoLive": auto_live, "autoClosed": auto_closed, "reviewRows": review, "fastTrackReview": fast_track_review}

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
            match_status = str(m.get("status", ""))
            is_scored = match_status in ("verified", "known", "live")
            ah = m.get("actualHome") if is_scored else None
            aa = m.get("actualAway") if is_scored else None
            pts, ex, pa, gd, label = score_match_pick(md.get("homePick", ""), md.get("awayPick", ""), ah, aa)
            if match_status == "live" and ah is not None and aa is not None:
                label = "לייב - " + label
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

    # Dense ranking: 1, 2, 2, 3 style.
    # Same score = same rank. The next different score gets the next rank, without skipping numbers.
    participants = data.get("participants", [])
    participants.sort(key=lambda x: (-int(x.get("total", 0) or 0), str(x.get("name", ""))))
    last_score = None
    last_rank = 0
    for p in participants:
        score = int(p.get("total", 0) or 0)
        if score != last_score:
            last_rank += 1
            last_score = score
        old_rank = p.get("prevRank")
        p["rank"] = last_rank
        p["rankChange"] = (int(old_rank) - last_rank) if isinstance(old_rank, int) else None

    meta = data.setdefault("meta", {})
    meta["generatedAt"] = local_now_manila()
    meta["participantsCount"] = len(participants)
    meta["matchesCount"] = len(data.get("matches", []))
    meta["completedFifaMatches"] = sum(1 for m in data.get("matches", []) if m.get("status") == "verified")
    meta["liveFifaMatches"] = sum(1 for m in data.get("matches", []) if m.get("status") == "live")
    meta["scoredMatchesForLeaderboard"] = meta["completedFifaMatches"] + meta["liveFifaMatches"]
    meta["pendingMatches"] = meta["matchesCount"] - meta["completedFifaMatches"] - meta["liveFifaMatches"]
    meta["openQuestionsCount"] = len(data.get("openQuestions", []))
    meta["resolvedOpenQuestions"] = sum(1 for q in data.get("openQuestions", []) if q.get("status") in ("known", "verified"))
    meta["verifiedOpenQuestions"] = meta["resolvedOpenQuestions"]
    meta["liveOpenQuestions"] = sum(1 for q in data.get("openQuestions", []) if q.get("status") == "live")
    meta["dashboardVersion"] = "GitHub Auto FIFA + Block-Aware Open Questions Updater"
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
            "id": q.get("id"), "row": q.get("row"), "section": q.get("section"),
            "block": q.get("block") or open_question_block(q.get("section", ""), q.get("question", "")),
            "ruleType": q.get("ruleType") or open_question_rule_type(int(q.get("id", 0) or 0), q.get("section", ""), q.get("question", "")),
            "policyStatus": q.get("policyStatus") or open_question_policy_status(q),
            "question": q.get("question"),
            "actualAnswer": q.get("actualAnswer"), "status": q.get("status"), "sourceStatus": q.get("sourceStatus"),
            "sourceTitle": q.get("sourceTitle"), "sourceUrl": q.get("sourceUrl"), "maxPoints": q.get("maxPoints"),
        })
    write_csv("open_questions.csv", open_rows, ["id", "row", "section", "block", "ruleType", "policyStatus", "question", "actualAnswer", "status", "sourceStatus", "sourceTitle", "sourceUrl", "maxPoints"])

    src_rows = []
    for s in data.get("sources", []):
        src_rows.append({"type": s.get("type"), "title": s.get("title"), "url": s.get("url"), "note": s.get("note")})
    write_csv("sources_all.csv", src_rows, ["type", "title", "url", "note"])
    fifa_rows = [r for r in src_rows if "fifa.com" in str(r.get("url", "")).lower()]
    write_csv("sources_fifa.csv", fifa_rows, ["type", "title", "url", "note"])

    review_rows = data.get("_openQuestionReview", [])
    if review_rows:
        write_csv("open_question_review.csv", review_rows, ["id", "row", "section", "block", "ruleType", "policyStatus", "question", "engineStatus", "actualAnswer", "nextAction", "sourceStatus"])

    fast_rows = data.get("_fastTrackReview", [])
    if fast_rows:
        write_csv("fast_track_review.csv", fast_rows, ["id", "row", "question", "status", "actualAnswer", "nextAction", "sourceTitle", "sourceUrl"])

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

    live_updates: List[Dict[str, Any]] = []

    for m in data.get("matches", []):
        mid = int(m.get("id", 0) or 0)
        hit = discovered.get(mid)
        if not hit:
            continue
        hit_status = str(hit.get("matchStatus") or "verified")
        current_status = str(m.get("status", ""))
        current_has_score = m.get("actualHome") is not None and m.get("actualAway") is not None
        current_verified = current_status == "verified" and current_has_score

        if current_verified:
            # A verified final result is locked. Only another verified FIFA final result can create a conflict.
            if hit_status == "verified" and (int(m.get("actualHome")) != int(hit["actualHome"]) or int(m.get("actualAway")) != int(hit["actualAway"])):
                conflicts.append({
                    "matchId": mid,
                    "match": f"{m.get('home')} - {m.get('away')}",
                    "current": f"{m.get('actualHome')}-{m.get('actualAway')}",
                    "found": f"{hit['actualHome']}-{hit['actualAway']}",
                    "source": hit.get("sourceUrl"),
                    "evidence": hit.get("evidence"),
                })
            continue

        changed = (not current_has_score) or int(m.get("actualHome") or -999) != int(hit["actualHome"]) or int(m.get("actualAway") or -999) != int(hit["actualAway"]) or current_status != hit_status
        if not changed:
            continue

        m["actualHome"] = int(hit["actualHome"])
        m["actualAway"] = int(hit["actualAway"])
        m["status"] = "live" if hit_status == "live" else "verified"
        m["sourceStatus"] = "live_fifa" if hit_status == "live" else "verified_fifa"
        m["sourceUrl"] = hit.get("sourceUrl") or FIFA_SCORES_URL
        m["sourceTitle"] = hit.get("sourceTitle") or ("FIFA official live score" if hit_status == "live" else "FIFA official final result")

        payload = {
            "matchId": mid,
            "match": f"{m.get('home')} - {m.get('away')}",
            "score": f"{m['actualHome']}-{m['actualAway']}",
            "status": m["status"],
            "source": m["sourceUrl"],
            "evidence": hit.get("evidence"),
        }
        if m["status"] == "live":
            live_updates.append(payload)
        else:
            updates.append(payload)
        ensure_source(data, m["sourceTitle"], m["sourceUrl"], f"{m.get('home')} - {m.get('away')} {m['actualHome']}-{m['actualAway']} ({m['status']})")

    open_result = update_open_questions(data)
    recompute_scores(data)
    write_csvs(data)

    data.pop("_openQuestionReview", None)
    data.pop("_fastTrackReview", None)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    status = "ok" if not conflicts else "needs_review"
    msg = "Dashboard checked against FIFA."
    if updates:
        msg += f" Added {len(updates)} new final match result(s)."
    else:
        msg += " No new final match results found."
    if live_updates:
        msg += f" Updated {len(live_updates)} live match score(s)."
    if open_result.get("manualUpdates"):
        msg += f" Applied {len(open_result.get('manualUpdates', []))} manual open-question answer(s)."
    if open_result.get("manualSkipped"):
        msg += f" Skipped {len(open_result.get('manualSkipped', []))} manual open-question answer(s) because of guardrails."
    if open_result.get("autoClosed"):
        msg += f" Closed {len(open_result.get('autoClosed', []))} open question(s) automatically."
    if open_result.get("autoLive"):
        msg += f" Updated {len(open_result.get('autoLive', []))} live open-question tracker(s)."
    if open_result.get("fastTrackReview"):
        msg += f" Fast-track daily review prepared for {len(open_result.get('fastTrackReview', []))} question(s)."
    if conflicts:
        msg += f" {len(conflicts)} conflict(s) need manual review."

    write_status(status, msg, updates=updates, live_updates=live_updates, conflicts=conflicts, warnings=warnings, open_questions=open_result, completed_matches=data.get("meta", {}).get("completedFifaMatches"), live_matches=data.get("meta", {}).get("liveFifaMatches"), live_open_questions=data.get("meta", {}).get("liveOpenQuestions"), resolved_open_questions=data.get("meta", {}).get("resolvedOpenQuestions"), leader=data.get("participants", [{}])[0].get("name"), leader_points=data.get("participants", [{}])[0].get("total"))
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
