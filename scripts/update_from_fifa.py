#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Clean World Cup dashboard updater.

Hard rules:
1) A corrected predictions workbook must never erase already-final match results.
2) match_results_cache.json is the authority for already-final results.
3) ESPN is used only for live/final scoreboard updates because it provides structured JSON.
4) The updater does not close open questions automatically, except those already stored in data.json.
5) The script recalculates all participant totals from matches + open question points every run.
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import os
import re
import sys
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_PATH = os.path.join(ROOT, "data.json")
CACHE_PATH = os.path.join(ROOT, "match_results_cache.json")
STATUS_PATH = os.path.join(ROOT, "automation_status.json")
LEADERBOARD_CSV = os.path.join(ROOT, "leaderboard.csv")
MATCHES_CSV = os.path.join(ROOT, "matches.csv")
OPEN_QUESTIONS_CSV = os.path.join(ROOT, "open_questions.csv")
OPEN_REVIEW_CSV = os.path.join(ROOT, "open_question_review.csv")
FAST_TRACK_REVIEW_CSV = os.path.join(ROOT, "fast_track_review.csv")
ESPN_DEBUG_CSV = os.path.join(ROOT, "espn_live_debug.csv")
EFI_AUDIT_CSV = os.path.join(ROOT, "efi_katash_audit.csv")
SOURCES_ALL_CSV = os.path.join(ROOT, "sources_all.csv")
SOURCES_FIFA_CSV = os.path.join(ROOT, "sources_fifa.csv")

ESPN_SCOREBOARD_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"

TEAM_ALIASES: Dict[str, List[str]] = {
    "מקסיקו": ["Mexico", "MEX"],
    "דרום אפריקה": ["South Africa", "RSA"],
    "דרום קוריאה": ["Korea Republic", "South Korea", "KOR"],
    "צ'כיה": ["Czechia", "Czech Republic", "CZE"],
    "קנדה": ["Canada", "CAN"],
    "בוסניה": ["Bosnia and Herzegovina", "Bosnia", "BIH"],
    "קטאר": ["Qatar", "QAT"],
    "שווייץ": ["Switzerland", "SUI"],
    "ברזיל": ["Brazil", "BRA"],
    "מרוקו": ["Morocco", "MAR"],
    "האיטי": ["Haiti", "HAI"],
    "סקוטלנד": ["Scotland", "SCO"],
    "ארה\"ב": ["USA", "United States", "United States of America", "USMNT"],
    "פרגוואי": ["Paraguay", "PAR"],
    "אוסטרליה": ["Australia", "AUS"],
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


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def manila_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=8)


def norm(s: Any) -> str:
    text = str(s or "").strip().lower()
    text = text.replace("’", "'").replace("`", "'")
    text = re.sub(r"\s+", " ", text)
    return text


def compact(s: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", norm(s))


def team_alias_set(team_he: str) -> set[str]:
    vals = [team_he] + TEAM_ALIASES.get(team_he, [])
    out = set()
    for v in vals:
        out.add(norm(v))
        out.add(compact(v))
    return {x for x in out if x}


def espn_tokens(comp: Dict[str, Any]) -> set[str]:
    team = comp.get("team") or {}
    vals = [
        team.get("displayName"),
        team.get("shortDisplayName"),
        team.get("name"),
        team.get("location"),
        team.get("abbreviation"),
        comp.get("id"),
    ]
    out = set()
    for v in vals:
        if v is None:
            continue
        out.add(norm(v))
        out.add(compact(v))
    return {x for x in out if x}


def comp_matches_team(team_he: str, comp: Dict[str, Any]) -> bool:
    return bool(team_alias_set(team_he) & espn_tokens(comp))


def parse_int(v: Any) -> Optional[int]:
    try:
        if v is None or v == "":
            return None
        return int(float(str(v).strip()))
    except Exception:
        return None


def load_json(path: str, default: Any) -> Any:
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default


def save_json(path: str, payload: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def fetch_json(url: str, timeout: int = 25) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (worldcup-dashboard; +https://github.com/efikatash/worldcup-dashboard-2026)",
            "Accept": "application/json,text/plain;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode(resp.headers.get_content_charset() or "utf-8", errors="replace")
    return json.loads(raw)


def espn_urls() -> List[str]:
    # Wide enough to recover after manual data.json replacement, light enough for GitHub Actions.
    today = manila_now().date()
    start = dt.date(2026, 6, 11)
    end = today + dt.timedelta(days=2)
    dates = []
    cur = start
    while cur <= end:
        dates.append(cur.strftime("%Y%m%d"))
        cur += dt.timedelta(days=1)
    urls = [ESPN_SCOREBOARD_BASE + "?limit=500"]
    urls += [ESPN_SCOREBOARD_BASE + "?limit=500&dates=" + d for d in dates]
    result = []
    for u in urls:
        if u not in result:
            result.append(u)
    return result


def load_cache() -> Dict[str, Any]:
    cache = load_json(CACHE_PATH, {"version": 1, "updatedAtUtc": utc_now(), "matches": {}})
    if not isinstance(cache, dict):
        cache = {"version": 1, "updatedAtUtc": utc_now(), "matches": {}}
    if not isinstance(cache.get("matches"), dict):
        cache["matches"] = {}
    return cache


def save_cache(cache: Dict[str, Any]) -> None:
    cache["version"] = 1
    cache["updatedAtUtc"] = utc_now()
    cache.setdefault("matches", {})
    save_json(CACHE_PATH, cache)


def is_final_match(m: Dict[str, Any]) -> bool:
    return m.get("actualHome") is not None and m.get("actualAway") is not None and str(m.get("status") or "") in {"verified", "known"}


def cache_current_finals(data: Dict[str, Any], cache: Dict[str, Any]) -> int:
    count = 0
    store = cache.setdefault("matches", {})
    for m in data.get("matches", []):
        if not is_final_match(m):
            continue
        mid = str(m.get("id"))
        store[mid] = {
            "id": m.get("id"),
            "row": m.get("row"),
            "home": m.get("home"),
            "away": m.get("away"),
            "actualHome": int(m.get("actualHome")),
            "actualAway": int(m.get("actualAway")),
            "status": "verified",
            "sourceStatus": m.get("sourceStatus") or "verified_imported_or_espn_final",
            "sourceTitle": m.get("sourceTitle") or "Final result preserved in cache",
            "sourceUrl": m.get("sourceUrl") or "",
            "cachedAtUtc": utc_now(),
        }
        count += 1
    return count


def apply_cache(data: Dict[str, Any], cache: Dict[str, Any]) -> List[Dict[str, Any]]:
    restored = []
    store = cache.get("matches") or {}
    for m in data.get("matches", []):
        mid = str(m.get("id"))
        c = store.get(mid)
        if not isinstance(c, dict):
            continue
        ch, ca = parse_int(c.get("actualHome")), parse_int(c.get("actualAway"))
        if ch is None or ca is None:
            continue
        current_has = m.get("actualHome") is not None and m.get("actualAway") is not None
        current_same = current_has and parse_int(m.get("actualHome")) == ch and parse_int(m.get("actualAway")) == ca
        # Never overwrite a different verified score silently.
        if current_has and str(m.get("status") or "") == "verified" and not current_same:
            continue
        if current_same and str(m.get("status") or "") == "verified":
            continue
        m["actualHome"] = ch
        m["actualAway"] = ca
        m["status"] = "verified"
        m["sourceStatus"] = c.get("sourceStatus") or "verified_cache"
        m["sourceTitle"] = c.get("sourceTitle") or "Final result restored from cache"
        m["sourceUrl"] = c.get("sourceUrl") or ""
        restored.append({"matchId": m.get("id"), "match": f"{m.get('home')} - {m.get('away')}", "score": f"{ch}-{ca}"})
    return restored


def get_comp_score(comp: Dict[str, Any]) -> Optional[int]:
    return parse_int(comp.get("score"))


def discover_espn_scores(data: Dict[str, Any]) -> Tuple[Dict[int, Dict[str, Any]], List[Dict[str, Any]], List[str]]:
    found: Dict[int, Dict[str, Any]] = {}
    debug: List[Dict[str, Any]] = []
    warnings: List[str] = []
    events: List[Dict[str, Any]] = []
    seen = set()

    for url in espn_urls():
        try:
            payload = fetch_json(url)
            for ev in payload.get("events", []) if isinstance(payload, dict) else []:
                eid = str(ev.get("id") or "")
                if eid and eid in seen:
                    continue
                if eid:
                    seen.add(eid)
                if isinstance(ev, dict):
                    events.append(ev)
        except Exception as exc:
            warnings.append(f"ESPN fetch failed: {url} :: {exc}")

    for m in data.get("matches", []):
        mid = int(m.get("id") or 0)
        home = str(m.get("home") or "")
        away = str(m.get("away") or "")
        row = {
            "matchId": mid,
            "match": f"{home} - {away}",
            "currentStatus": m.get("status", ""),
            "currentScore": f"{m.get('actualHome', '')}-{m.get('actualAway', '')}",
            "espnEventId": "",
            "espnName": "",
            "candidateScore": "",
            "candidateStatus": "not_found",
            "clock": "",
            "sourceUrl": "",
            "note": "",
        }
        for ev in events:
            comps = ((ev.get("competitions") or [{}])[0] or {}).get("competitors") or []
            if len(comps) < 2:
                continue
            c0, c1 = comps[0], comps[1]
            hscore = ascore = None
            if comp_matches_team(home, c0) and comp_matches_team(away, c1):
                hscore, ascore = get_comp_score(c0), get_comp_score(c1)
            elif comp_matches_team(home, c1) and comp_matches_team(away, c0):
                hscore, ascore = get_comp_score(c1), get_comp_score(c0)
            else:
                continue
            if hscore is None or ascore is None:
                continue

            st = ((ev.get("status") or {}).get("type") or {})
            state = str(st.get("state") or "").lower()
            completed = bool(st.get("completed"))
            name = str(st.get("name") or "")
            desc = str(st.get("description") or st.get("detail") or "")
            clock = str((ev.get("status") or {}).get("displayClock") or "")
            source_url = "https://www.espn.com/soccer/match/_/gameId/" + str(ev.get("id") or "")
            status = "pending"
            name_u = name.upper()
            desc_l = desc.lower()
            is_scheduled = (
                state == "pre"
                or name_u in {"STATUS_SCHEDULED", "STATUS_PRE", "PRE"}
                or "schedul" in desc_l
            )
            if completed or state == "post" or name_u in {"STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_FINAL_PEN", "FT"}:
                status = "verified"
            elif is_scheduled:
                continue
            elif state == "in" or "half" in desc_l or clock:
                status = "live"
            else:
                continue

            found[mid] = {
                "actualHome": int(hscore),
                "actualAway": int(ascore),
                "status": status,
                "sourceStatus": "verified_espn_final" if status == "verified" else "live_espn",
                "sourceTitle": "ESPN final scoreboard" if status == "verified" else "ESPN live scoreboard",
                "sourceUrl": source_url,
                "eventId": ev.get("id"),
                "eventName": ev.get("name") or ev.get("shortName") or "",
                "clock": clock,
            }
            row.update({
                "espnEventId": ev.get("id") or "",
                "espnName": ev.get("name") or ev.get("shortName") or "",
                "candidateScore": f"{hscore}-{ascore}",
                "candidateStatus": status,
                "clock": clock,
                "sourceUrl": source_url,
                "note": desc,
            })
            break
        debug.append(row)
    return found, debug, warnings


def apply_espn(data: Dict[str, Any], scores: Dict[int, Dict[str, Any]], cache: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    final_updates = []
    live_updates = []
    conflicts = []
    cache_store = cache.setdefault("matches", {})
    for m in data.get("matches", []):
        mid = int(m.get("id") or 0)
        s = scores.get(mid)
        if not s:
            # If a non-cached live score disappears from ESPN, return it to pending. Do not touch verified finals.
            if str(m.get("status") or "") == "live":
                cached = cache_store.get(str(mid))
                if cached:
                    m["actualHome"] = cached.get("actualHome")
                    m["actualAway"] = cached.get("actualAway")
                    m["status"] = "verified"
                    m["sourceStatus"] = cached.get("sourceStatus") or "verified_cache"
                    m["sourceTitle"] = cached.get("sourceTitle") or "Final result restored from cache"
                    m["sourceUrl"] = cached.get("sourceUrl") or ""
                else:
                    m["actualHome"] = None
                    m["actualAway"] = None
                    m["status"] = "pending"
                    m["sourceStatus"] = "pending"
                    m["sourceTitle"] = "ממתין לתוצאת משחק"
                    m["sourceUrl"] = ""
            continue

                nh, na = s["actualHome"], s["actualAway"]
        if str(m.get("status") or "") == "verified" and m.get("actualHome") is not None:
            oh, oa = parse_int(m.get("actualHome")), parse_int(m.get("actualAway"))
            if oh != nh or oa != na:
                conflicts.append({"matchId": mid, "match": f"{m.get('home')} - {m.get('away')}", "current": f"{oh}-{oa}", "espn": f"{nh}-{na}"})
            elif s.get("status") == "verified":
                ss = str(m.get("sourceStatus") or "")
                url = str(m.get("sourceUrl") or "").lower()
                title = str(m.get("sourceTitle") or "").lower()
                if "verified_fifa" not in ss and "fifa.com" not in url and "fifa" not in title:
                    m["sourceStatus"] = "verified_espn_final"
                    m["sourceUrl"] = s.get("sourceUrl") or m.get("sourceUrl") or ""
                    m["sourceTitle"] = "ESPN final scoreboard"
            continue

        m["actualHome"] = nh
        m["actualAway"] = na
        m["status"] = s["status"]
        m["sourceStatus"] = s["sourceStatus"]
        m["sourceTitle"] = s["sourceTitle"]
        m["sourceUrl"] = s["sourceUrl"]
        item = {"matchId": mid, "match": f"{m.get('home')} - {m.get('away')}", "score": f"{nh}-{na}", "status": s["status"]}
        if s["status"] == "verified":
            final_updates.append(item)
            cache_store[str(mid)] = {
                "id": mid,
                "row": m.get("row"),
                "home": m.get("home"),
                "away": m.get("away"),
                "actualHome": nh,
                "actualAway": na,
                "status": "verified",
                "sourceStatus": "verified_espn_final",
                "sourceTitle": "ESPN final scoreboard",
                "sourceUrl": s["sourceUrl"],
                "cachedAtUtc": utc_now(),
            }
        else:
            live_updates.append(item)
    return final_updates, live_updates, conflicts


def score_prediction(hp: Optional[int], ap: Optional[int], ah: Optional[int], aa: Optional[int]) -> Tuple[int, int, int, int, str]:
    if hp is None or ap is None or ah is None or aa is None:
        return 0, 0, 0, 0, "ממתין לתוצאת משחק"
    if hp == ah and ap == aa:
        return 10, 1, 0, 0, "בול"
    pick_diff = hp - ap
    actual_diff = ah - aa
    same_direction = (pick_diff == 0 and actual_diff == 0) or (pick_diff > 0 and actual_diff > 0) or (pick_diff < 0 and actual_diff < 0)
    if same_direction:
        gd = 1 if pick_diff == actual_diff else 0
        pts = 5 + (2 if gd else 0)
        return pts, 0, 1, gd, "כיוון + הפרש" if gd else "כיוון"
    return 0, 0, 0, 0, "פספוס"


def recompute(data: Dict[str, Any]) -> None:
    actual_by_id = {int(m.get("id")): m for m in data.get("matches", []) if m.get("id") is not None}
    for p in data.get("participants", []):
        match_points = exact = partial = gd_total = 0
        for pm in p.get("matches", []):
            mid = int(pm.get("matchId") or 0)
            m = actual_by_id.get(mid)
            hp, ap = parse_int(pm.get("homePick")), parse_int(pm.get("awayPick"))
            ah = parse_int(m.get("actualHome")) if m else None
            aa = parse_int(m.get("actualAway")) if m else None
            pts, ex, part, gd, label = score_prediction(hp, ap, ah, aa)
            pm["points"] = pts
            pm["exact"] = ex
            pm["partial"] = part
            pm["gd"] = gd
            pm["label"] = label
            match_points += pts
            exact += ex
            partial += part
            gd_total += gd
        open_points = sum(int(o.get("points") or 0) for o in p.get("open", []))
        bonus_points = sum(int(b.get("points") or 0) for b in p.get("bonuses", []))
        p["matchPoints"] = match_points
        p["openPoints"] = open_points
        p["bonusPoints"] = bonus_points
        p["total"] = match_points + open_points + bonus_points
        p["exact"] = exact
        p["partial"] = partial
        p["gd"] = gd_total
        p["openHits"] = sum(1 for o in p.get("open", []) if int(o.get("points") or 0) > 0)
        p["openResolved"] = sum(1 for o in p.get("open", []) if "ממתין" not in str(o.get("label") or ""))

    sorted_players = sorted(data.get("participants", []), key=lambda x: (-int(x.get("total") or 0), str(x.get("name") or "")))
    current_rank = 0
    last_total = None
    for p in sorted_players:
        total = int(p.get("total") or 0)
        if last_total is None or total != last_total:
            current_rank += 1
            last_total = total
        p["rank"] = current_rank

    completed = sum(1 for m in data.get("matches", []) if m.get("actualHome") is not None and m.get("actualAway") is not None and str(m.get("status") or "") == "verified")
    live = sum(1 for m in data.get("matches", []) if str(m.get("status") or "") == "live")
    meta = data.setdefault("meta", {})
    meta["completedFifaMatches"] = completed
    meta["completedMatches"] = completed
    meta["liveMatches"] = live
    meta["pendingMatches"] = len(data.get("matches", [])) - completed - live
    meta["dashboardBuiltAt"] = manila_now().strftime("%Y-%m-%d %H:%M")


def write_csv(path: str, rows: List[Dict[str, Any]], fields: List[str]) -> None:
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def export_csvs(data: Dict[str, Any], espn_debug: List[Dict[str, Any]]) -> None:
    players = sorted(data.get("participants", []), key=lambda p: (int(p.get("rank") or 9999), -int(p.get("total") or 0), str(p.get("name") or "")))
    write_csv(LEADERBOARD_CSV, players, ["rank", "name", "total", "matchPoints", "openPoints", "bonusPoints", "exact", "partial", "gd", "openHits", "pointsChange", "rankChange"])
    write_csv(MATCHES_CSV, data.get("matches", []), ["id", "row", "group", "date", "home", "away", "actualHome", "actualAway", "status", "sourceStatus", "sourceTitle", "sourceUrl"])
    write_csv(OPEN_QUESTIONS_CSV, data.get("openQuestions", []), ["id", "row", "num", "section", "question", "actualAnswer", "status", "sourceStatus", "sourceTitle", "sourceUrl", "maxPoints"])
    sources = data.get("sources", [])
    write_csv(SOURCES_ALL_CSV, sources, ["type", "title", "url", "note"])
    write_csv(SOURCES_FIFA_CSV, [s for s in sources if "fifa" in str(s.get("url", "")).lower()], ["type", "title", "url", "note"])
    write_csv(ESPN_DEBUG_CSV, espn_debug, ["matchId", "match", "currentStatus", "currentScore", "espnEventId", "espnName", "candidateScore", "candidateStatus", "clock", "sourceUrl", "note"])

    review = []
    fast = []
    for q in data.get("openQuestions", []):
        section = str(q.get("section") or "")
        status = q.get("status") or "pending"
        row = {
            "id": q.get("id"),
            "row": q.get("row"),
            "section": section,
            "question": q.get("question"),
            "engineStatus": "already_closed" if status == "known" else "locked_not_answered_now",
            "actualAnswer": q.get("actualAnswer") or "לא ידוע",
            "sourceStatus": q.get("sourceStatus") or "pending",
            "nextAction": "לא נוגע - כבר סגור/מאומת" if status == "known" else "לא נסגר אוטומטית; דורש בדיקת מנהל לפי הסקשן",
        }
        review.append(row)
        if "המסלול המהיר" in section:
            fast.append(row)
    write_csv(OPEN_REVIEW_CSV, review, ["id", "row", "section", "question", "engineStatus", "actualAnswer", "sourceStatus", "nextAction"])
    write_csv(FAST_TRACK_REVIEW_CSV, fast, ["id", "row", "section", "question", "engineStatus", "actualAnswer", "sourceStatus", "nextAction"])

    efi = next((p for p in players if "אפי" in str(p.get("name", "")) and "קטש" in str(p.get("name", ""))), None)
    if efi:
        audit = []
        byid = {int(m.get("id")): m for m in data.get("matches", [])}
        for pm in efi.get("matches", []):
            m = byid.get(int(pm.get("matchId") or 0), {})
            audit.append({
                "type": "match",
                "id": pm.get("matchId"),
                "item": f"{m.get('home','')} - {m.get('away','')}",
                "prediction": f"{pm.get('homePick','')}-{pm.get('awayPick','')}",
                "actual": f"{m.get('actualHome','')}-{m.get('actualAway','')}",
                "points": pm.get("points", 0),
                "label": pm.get("label", ""),
            })
        for oq in efi.get("open", []):
            audit.append({"type": "open", "id": oq.get("qId"), "item": "", "prediction": oq.get("prediction"), "actual": "", "points": oq.get("points", 0), "label": oq.get("label", "")})
        write_csv(EFI_AUDIT_CSV, audit, ["type", "id", "item", "prediction", "actual", "points", "label"])


def main() -> int:
    if not os.path.exists(DATA_PATH):
        save_json(STATUS_PATH, {"status": "error", "message": "data.json not found", "updated_at_utc": utc_now()})
        return 1
    data = load_json(DATA_PATH, {})
    cache = load_cache()

    cached_before = len(cache.get("matches", {}))
    cache_current_finals(data, cache)
    restored = apply_cache(data, cache)

    espn_scores, espn_debug, warnings = discover_espn_scores(data)
    final_updates, live_updates, conflicts = apply_espn(data, espn_scores, cache)

    cache_current_finals(data, cache)
    save_cache(cache)
    recompute(data)
    save_json(DATA_PATH, data)
    export_csvs(data, espn_debug)

    players = sorted(data.get("participants", []), key=lambda p: (int(p.get("rank") or 9999), -int(p.get("total") or 0), str(p.get("name") or "")))
    leader = players[0] if players else {}
    completed = sum(1 for m in data.get("matches", []) if str(m.get("status") or "") == "verified" and m.get("actualHome") is not None)
    live = sum(1 for m in data.get("matches", []) if str(m.get("status") or "") == "live")
    status = {
        "status": "ok",
        "message": "Clean updater ran. Results cache applied first; ESPN live/final scoreboard applied second; participant totals recalculated.",
        "updated_at_utc": utc_now(),
        "completed_matches": completed,
        "live_matches": live,
        "cache_size_before": cached_before,
        "cache_size_after": len(cache.get("matches", {})),
        "restored_from_cache": restored,
        "final_updates": final_updates,
        "live_updates": live_updates,
        "conflicts": conflicts,
        "warnings": warnings,
        "leader": leader.get("name", ""),
        "leader_points": leader.get("total", 0),
    }
    save_json(STATUS_PATH, status)
    return 0


if __name__ == "__main__":
    sys.exit(main())
