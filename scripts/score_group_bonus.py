"""
Group-advancement bonus scoring ("ראש בית / סגנית" + "מעפילות ממקום 3").

Predictions live per participant in data.json under p["bonusPicks"]:
  {
    "top2":  {"A": {"first": <team>, "second": <team>}, ... "L": ...},
    "third": {"A": {"team": <team>, "willAdvance": "כן"|"לא"}, ... "L": ...}
  }

Actual group outcomes live in data["groupResults"]:
  {
    "A": {
      "first":  <team or null>,   # group winner   (ראש בית)
      "second": <team or null>,   # runner-up      (סגנית)
      "third":  <team or null>,   # 3rd place
      "fourth": <team or null>,   # 4th place
      "thirdAdvanced": true/false/null,  # did this group's 3rd place reach the round of 32
      "decided": true/false       # all four positions finalised
    }, ...
  }

Scoring rules (supplied by the organiser):
  ראש בית / סגנית table
    +10  predicted team advanced (to 1/32)
    + 5  exact position correct (ראש בית / סגנית)         -> 15 max per slot
     10  advanced but in the opposite of the two top spots
      7  predicted as top-2 but ultimately advanced from 3rd place
    +12  bonus if ALL 24 predicted teams advanced (½ pt each)
    +12  bonus if the position of ALL 24 advancing teams is exact
  מעפילות ממקום 3 table
     10  predicted the team that finished 3rd in the group
      4  correctly predicted whether that group's 3rd place advances (כן/לא)
      7  predicted a team to finish 3rd (as advancing) but it advanced as ראש בית / סגנית
      6  bonus if all 12 third-place teams predicted correctly
  Only what is *determinable* from the known results is resolved; the rest stays
  pending and is scored automatically once more results are filled in.
"""
import re

GROUPS = list("ABCDEFGHIJKL")

# Hebrew spelling variants that must score as the canonical team name (some
# participants typed a team slightly differently from the official result).
_SPELLING_CANON = {
    "שוויץ": "שווייץ",      # Switzerland — one yud vs two
    "אקוודור": "אקוואדור",  # Ecuador — missing a vav
}


def _norm(name):
    """Normalise a team name for comparison (collapse spaces, drop quotes,
    strip the Hebrew geresh, and canonicalise known spelling variants)."""
    if name is None:
        return None
    s = str(name).strip()
    if not s:
        return None
    s = s.replace('"', '').replace("'", "").replace("”", "").replace("’", "").replace("׳", "").replace("`", "")
    s = re.sub(r"\s+", " ", s)
    return _SPELLING_CANON.get(s, s)


def _eq(a, b):
    return a is not None and b is not None and _norm(a) == _norm(b)


def _score_top2_slot(pick, predicted_pos, gr):
    """Return (points, status) for one top-2 slot.

    predicted_pos is 1 (ראש בית) or 2 (סגנית).
    status is 'resolved' or 'pending'.
    """
    if not pick:
        return 0, "resolved"  # empty pick can never earn points
    first, second, third = gr.get("first"), gr.get("second"), gr.get("third")
    fourth = gr.get("fourth")
    third_adv = gr.get("thirdAdvanced")
    decided = bool(gr.get("decided"))

    if _eq(pick, first):
        return (15 if predicted_pos == 1 else 10), "resolved"
    if _eq(pick, second):
        return (15 if predicted_pos == 2 else 10), "resolved"
    if _eq(pick, third):
        # Predicted as ראש בית / סגנית but finished 3rd: 7 points ONLY once the
        # team is confirmed to have advanced from 3rd place.  This matches the
        # official file, which does not credit this provisionally — so while a
        # group's 3rd-place advancement is undecided the slot stays 0/pending.
        if third_adv is True:
            return 7, "resolved"   # came 3rd but advanced
        if third_adv is False:
            return 0, "resolved"   # came 3rd, did not advance
        return 0, "pending"        # advancement undecided -> no credit yet
    if _eq(pick, fourth):
        return 0, "resolved"       # finished last
    # pick not matched to any known finisher
    if decided:
        return 0, "resolved"       # group fully decided -> the team did not advance
    return 0, "pending"            # not enough info yet


def _score_third_row(tp, gr):
    """Score one row of the 'מעפילות ממקום 3' table.

    The row has two independent components — the team pick (10/7/0) and the
    advance-or-not pick (+4) — that resolve at different times.  Returns a dict
    so the UI can show the already-earned team points even while the
    advancement (+4) is still pending.
    """
    team = tp.get("team")
    will = _norm(tp.get("willAdvance"))  # 'כן' / 'לא'
    third = gr.get("third")
    first, second = gr.get("first"), gr.get("second")
    third_adv = gr.get("thirdAdvanced")
    decided = bool(gr.get("decided"))

    # team component (10 if exactly 3rd, 7 if predicted-3rd-but-finished-top-2)
    team_pts, team_status = 0, "resolved"
    if team:
        if _eq(team, third):
            team_pts = 10
        elif _eq(team, first) or _eq(team, second):
            team_pts = 7
        elif decided:
            team_pts = 0
        else:
            team_status = "pending"                     # group not decided yet
    # advancement (כן/לא) component (+4 if correct)
    adv_pts, adv_status = 0, "resolved"
    if will in ("כן", "לא"):
        if third_adv is None:
            adv_status = "pending"
        else:
            actual = "כן" if third_adv else "לא"
            if will == actual:
                adv_pts = 4
    status = "resolved" if (team_status == "resolved" and adv_status == "resolved") else "pending"
    return {
        "points": team_pts + adv_pts, "status": status,
        "teamPoints": team_pts, "teamStatus": team_status,
        "advPoints": adv_pts, "advStatus": adv_status,
    }


def _match_direction(h, a):
    """Sign of a scoreline: 0 draw, 1 home win, -1 away win; None if unknown."""
    if h is None or a is None:
        return None
    return 0 if h == a else (1 if h > a else -1)


def _score_group_directions(pick_by_mid, group_match_list):
    """Score the 'כל הכיוונים בבית' bonus for one group.

    +6 if the participant got the direction (1/X/2) right on every match in the
    group.  group_match_list is [(matchId, actualHome, actualAway), ...].
    Returns (points, status).  Resolvable only when all matches in the group
    have a result; otherwise pending.
    """
    if not group_match_list or any(ah is None or aa is None for _, ah, aa in group_match_list):
        return 0, "pending"
    for mid, ah, aa in group_match_list:
        pm = pick_by_mid.get(mid)
        if not pm:
            return 0, "resolved"
        try:
            hp, ap = int(pm.get("homePick")), int(pm.get("awayPick"))
        except (TypeError, ValueError):
            return 0, "resolved"
        if _match_direction(hp, ap) != _match_direction(ah, aa):
            return 0, "resolved"
    return 6, "resolved"


def score_participant(p, results, group_matches=None):
    """Compute every bonus entry for one participant and return the flat
    p['bonuses'] list (each entry carries a 'points' field that recompute sums)."""
    picks = p.get("bonusPicks") or {}
    top2 = picks.get("top2") or {}
    third = picks.get("third") or {}
    bonuses = []

    all_groups_decided = all(results.get(g, {}).get("decided") for g in GROUPS)

    # --- ראש בית / סגנית, one entry per group ---
    advanced_flags = []   # for the all-advanced bonus
    position_flags = []   # for the all-position bonus
    for g in GROUPS:
        gr = results.get(g, {})
        pk = top2.get(g, {})
        fp, fst = _score_top2_slot(pk.get("first"), 1, gr)
        sp, sst = _score_top2_slot(pk.get("second"), 2, gr)
        bonuses.append({
            "kind": "top2", "group": g,
            "firstPick": pk.get("first"), "secondPick": pk.get("second"),
            "firstPoints": fp, "secondPoints": sp,
            "firstStatus": fst, "secondStatus": sst,
            "points": fp + sp,
            "status": "resolved" if (fst == "resolved" and sst == "resolved") else "pending",
        })
        advanced_flags.append(fp >= 7)   # this pick's team advanced (7 = 3rd-place adv, 10/15 = top-2)
        advanced_flags.append(sp >= 7)
        position_flags.append(fp == 15)   # exact position
        position_flags.append(sp == 15)

    # --- two top-2 bonuses (only resolvable once every group is decided) ---
    bonuses.append({
        "kind": "bonus_all_advanced",
        "points": 12 if (all_groups_decided and all(advanced_flags)) else 0,
        "status": "resolved" if all_groups_decided else "pending",
    })
    bonuses.append({
        "kind": "bonus_all_position",
        "points": 12 if (all_groups_decided and all(position_flags)) else 0,
        "status": "resolved" if all_groups_decided else "pending",
    })

    # --- מעפילות ממקום 3, one entry per group ---
    third_exact_flags = []
    for g in GROUPS:
        gr = results.get(g, {})
        tp = third.get(g, {})
        r = _score_third_row(tp, gr)
        bonuses.append({
            "kind": "third", "group": g,
            "thirdPick": tp.get("team"), "willAdvance": tp.get("willAdvance"),
            "points": r["points"], "status": r["status"],
            "teamPoints": r["teamPoints"], "teamStatus": r["teamStatus"],
            "advPoints": r["advPoints"], "advStatus": r["advStatus"],
        })
        third_exact_flags.append(_eq(tp.get("team"), gr.get("third")))

    bonuses.append({
        "kind": "bonus_third_all",
        "points": 6 if (all_groups_decided and all(third_exact_flags)) else 0,
        "status": "resolved" if all_groups_decided else "pending",
    })

    # --- כל הכיוונים בבית, one entry per group (+6 if every direction in the group hit) ---
    if group_matches:
        pick_by_mid = {int(pm.get("matchId")): pm for pm in p.get("matches", []) if pm.get("matchId") is not None}
        for g in GROUPS:
            pts, st = _score_group_directions(pick_by_mid, group_matches.get(g, []))
            bonuses.append({"kind": "group_directions", "group": g, "points": pts, "status": st})

    return bonuses


def score_all(data):
    """Recompute every participant's bonus entries from picks + groupResults."""
    results = data.get("groupResults") or {}
    # Build {group: [(matchId, actualHome, actualAway), ...]} for the directions bonus.
    group_matches = {}
    for m in data.get("matches", []):
        g = m.get("group")
        if not g or m.get("id") is None:
            continue
        group_matches.setdefault(g, []).append((int(m["id"]), m.get("actualHome"), m.get("actualAway")))
    for p in data.get("participants", []):
        p["bonuses"] = score_participant(p, results, group_matches)
