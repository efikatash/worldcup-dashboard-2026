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


def _norm(name):
    """Normalise a team name for comparison (collapse spaces, drop quotes)."""
    if name is None:
        return None
    s = str(name).strip()
    if not s:
        return None
    s = s.replace('"', '').replace("'", "").replace("”", "").replace("’", "")
    s = re.sub(r"\s+", " ", s)
    return s


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
        if third_adv is True:
            return 7, "resolved"   # came 3rd but advanced
        if third_adv is False:
            return 0, "resolved"   # came 3rd, did not advance
        return 0, "pending"        # 3rd place known but advancement undecided
    if _eq(pick, fourth):
        return 0, "resolved"       # finished last
    # pick not matched to any known finisher
    if decided:
        return 0, "resolved"       # group fully decided -> the team did not advance
    return 0, "pending"            # not enough info yet


def _score_third_row(tp, gr):
    """Score one row of the 'מעפילות ממקום 3' table. Returns (points, status)."""
    team = tp.get("team")
    will = _norm(tp.get("willAdvance"))  # 'כן' / 'לא'
    third = gr.get("third")
    first, second = gr.get("first"), gr.get("second")
    third_adv = gr.get("thirdAdvanced")
    decided = bool(gr.get("decided"))

    pts = 0
    resolved = True

    # team component
    if team:
        if _eq(team, third):
            pts += 10                                  # finished 3rd exactly
        elif _eq(team, first) or _eq(team, second):
            pts += 7                                   # predicted 3rd, advanced as top-2
        elif decided:
            pts += 0
        else:
            resolved = False                           # team fate unknown
    # advancement (כן/לא) component
    if will in ("כן", "לא"):
        if third_adv is None:
            resolved = False
        else:
            actual = "כן" if third_adv else "לא"
            if will == actual:
                pts += 4
    return pts, ("resolved" if resolved else "pending")


def score_participant(p, results):
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
        pts, st = _score_third_row(tp, gr)
        bonuses.append({
            "kind": "third", "group": g,
            "thirdPick": tp.get("team"), "willAdvance": tp.get("willAdvance"),
            "points": pts, "status": st,
        })
        third_exact_flags.append(_eq(tp.get("team"), gr.get("third")))

    bonuses.append({
        "kind": "bonus_third_all",
        "points": 6 if (all_groups_decided and all(third_exact_flags)) else 0,
        "status": "resolved" if all_groups_decided else "pending",
    })

    return bonuses


def score_all(data):
    """Recompute every participant's bonus entries from picks + groupResults."""
    results = data.get("groupResults") or {}
    for p in data.get("participants", []):
        p["bonuses"] = score_participant(p, results)
