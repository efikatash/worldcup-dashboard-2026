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


def recompute_scores(data: Dict[str, Any]) -> None:
    matches_by_id = {int(m["id"]): m for m in data.get("matches", [])}
    prev_by_name = {p.get("name", ""): p for p in data.get("participants", [])}

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
        p["matchPoints"] = match_points
        p["exact"] = exact
        p["partial"] = partial
        p["gd"] = gd_count
        # Keep open and bonus points from current data.json. Open questions are handled manually/separately.
        p["openPoints"] = int(sum(int(x.get("points", 0) or 0) for x in p.get("open", [])))
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
    meta["dashboardVersion"] = "GitHub Auto FIFA Updater"
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

    recompute_scores(data)
    write_csvs(data)

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    status = "ok" if not conflicts else "needs_review"
    msg = "Dashboard checked against FIFA."
    if updates:
        msg += f" Added {len(updates)} new match result(s)."
    else:
        msg += " No new match results found."
    if conflicts:
        msg += f" {len(conflicts)} conflict(s) need manual review."

    write_status(status, msg, updates=updates, conflicts=conflicts, warnings=warnings, completed_matches=data.get("meta", {}).get("completedFifaMatches"), leader=data.get("participants", [{}])[0].get("name"), leader_points=data.get("participants", [{}])[0].get("total"))
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
