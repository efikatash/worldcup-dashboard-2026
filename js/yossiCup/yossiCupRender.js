'use strict';
/* ───────────────────────────────────────────────────────────────────────
   גביע יוסי — Render Module  (multi-round, mobile-first)
   window.YossiCup.render() is called every time the 'yossicup' tab is shown.
   ─────────────────────────────────────────────────────────────────────── */
(function () {

  var yc  = window.YC  || {};
  var esc = window.esc || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g,
      function (s) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]; });
  };

  // ── state ──────────────────────────────────────────────────────────────
  var _init         = false;
  var _rawBracket   = [];   // frozen R1 rows (from #ycBracket)
  var _rawBracketR2 = [];   // frozen R2 rows (from #ycBracketR2)
  var _rawBracketR3 = [];   // frozen R3 rows (from #ycBracketR3)
  var _bracket      = [];   // enriched active-round bracket (live scores + provisional)
  var _participants = [];   // from #ycParticipants
  var _rounds       = [];
  var _rules        = {};
  var _search       = '';
  var _filter       = 'all';
  var _activeRound  = 1;    // first round not yet closed
  var _viewRound    = null; // which round the user is currently viewing (null = active)
  var _lastUpdate   = null;

  // ── boot ───────────────────────────────────────────────────────────────
  function _loadData() {
    try {
      _participants = _parse('ycParticipants') || [];
      _rawBracket   = _parse('ycBracket')      || [];
      _rawBracketR2 = _parse('ycBracketR2')    || [];
      _rawBracketR3 = _parse('ycBracketR3')    || [];
      _rounds       = _parse('ycRounds')       || [];
      _rules        = _parse('ycRules')        || {};
      _activeRound  = _computeActiveRound();
      _viewRound    = _activeRound;   // default: show the current active round
      _recomputeLive();
    } catch (e) {
      console.error('[YossiCup] data load error', e);
    }
  }

  function _parse(id) {
    var el = document.getElementById(id);
    return el ? JSON.parse(el.textContent) : null;
  }

  function _computeActiveRound() {
    for (var i = 0; i < _rounds.length; i++) {
      if (_rounds[i] && _rounds[i].status !== 'closed') return _rounds[i].round;
    }
    return _rounds.length ? _rounds[_rounds.length - 1].round : 1;
  }

  function _bracketForRound(round) {
    if (round === 1) return _rawBracket;
    if (round === 2) return _rawBracketR2;
    return _rawBracketR3;
  }

  // ── live recompute ─────────────────────────────────────────────────────
  function _roundHasStarted(roundNum) {
    var info = _rounds.find(function (r) { return r.round === roundNum; });
    if (!info || !info.roundStart) return true; // no gate set → treat as started
    return new Date() >= new Date(info.roundStart);
  }

  function _roundStartLabel(roundNum) {
    var info = _rounds.find(function (r) { return r.round === roundNum; });
    if (!info || !info.roundStart) return null;
    var d = new Date(info.roundStart);
    return d.toLocaleString('he-IL', {
      timeZone: 'Asia/Jerusalem',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }) + ' (שעון ישראל)';
  }

  function _recomputeLive() {
    var live = (typeof DATA !== 'undefined' ? DATA : (window.DATA || null));
    var liveParts = (live && live.participants) || [];

    // Build per-seed baseline for rounds > 1
    var baselineBySeed = {};
    if (_activeRound >= 2) {
      _participants.forEach(function (p) {
        var bKey = _activeRound >= 3 ? 'baselineScoreR3' : 'baselineScoreR2';
        if (p[bKey] != null) baselineBySeed[p.seed] = p[bKey];
      });
    }

    var activeBracket = _bracketForRound(_activeRound);
    _bracket = (yc.buildCupBracket || function (b) { return b; })(
      activeBracket, liveParts, _participants,
      {
        activeRound: _activeRound,
        baselineBySeed: _activeRound >= 2 ? baselineBySeed : null,
        roundHasStarted: _roundHasStarted(_activeRound)
      });
    _lastUpdate = new Date();
  }

  // ── event binding ──────────────────────────────────────────────────────

  // Refresh whichever bracket body is currently shown (closed or active round)
  function _refreshBracketBody() {
    var vr = _viewRound || _activeRound;
    var roundInfo = _rounds.find(function (r) { return r.round === vr; });
    var isClosed = roundInfo && roundInfo.status === 'closed' && vr !== _activeRound;
    if (isClosed) {
      _renderClosedBracketBody(_bracketForRound(vr));
    } else {
      _renderBracketBody();
    }
  }

  function _bindEvents() {
    var searchEl = document.getElementById('ycSearch');
    if (searchEl && !searchEl._ycBound) {
      searchEl._ycBound = true;
      searchEl.oninput = function () {
        _search = (this.value || '').trim().toLowerCase();
        _refreshBracketBody();
      };
    }
    document.querySelectorAll('.yc-filter-btn').forEach(function (btn) {
      if (btn._ycBound) return;
      btn._ycBound = true;
      btn.onclick = function () {
        document.querySelectorAll('.yc-filter-btn').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        _filter = this.dataset.filter || 'all';
        _refreshBracketBody();
      };
    });
    document.querySelectorAll('.yc-round-tab').forEach(function (btn) {
      if (btn._ycBound) return;
      btn._ycBound = true;
      btn.onclick = function () {
        _viewRound = Number(this.dataset.round);
        _renderRoundView();
      };
    });
    var rulesToggle = document.getElementById('ycRulesToggle');
    if (rulesToggle && !rulesToggle._ycBound) {
      rulesToggle._ycBound = true;
      rulesToggle.onclick = function () {
        var body = document.getElementById('ycRulesBody');
        if (body) {
          var open = body.style.display !== 'none';
          body.style.display = open ? 'none' : 'block';
          this.textContent = open ? '▼ הצג חוקים' : '▲ הסתר';
        }
      };
    }
    var explToggle = document.getElementById('ycExplToggle');
    if (explToggle && !explToggle._ycBound) {
      explToggle._ycBound = true;
      explToggle.onclick = function () {
        var body = document.getElementById('ycExplBody');
        if (body) {
          var open = body.style.display !== 'none';
          body.style.display = open ? 'none' : 'block';
          this.textContent = open ? '▼ הסבר' : '▲ הסתר';
        }
      };
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────
  function _fmtScore(v) { return (v === null || v === undefined) ? '—' : String(v); }

  function _roundLabel(round, short) {
    var r = _rounds.find(function (x) { return x.round === round; });
    if (short) return r ? r.name : 'סיבוב ' + round;
    return r ? r.name + ' — ' + r.description : 'סיבוב ' + round;
  }

  // Score cell: for COMPLETED matches shows the final round score; for live shows provisional
  function _scoreCell(m, side) {
    var rs    = side === 'A' ? m.roundScoreA    : m.roundScoreB;
    var total = side === 'A' ? m.liveScoreA     : m.liveScoreB;
    var init  = side === 'A' ? m.initialScoreA  : m.initialScoreB;

    // Completed round — show official round score
    if (m.winnerSeed && rs !== null) {
      var won = (side === 'A' && m.winnerSeed === m.playerASeed) ||
                (side === 'B' && m.winnerSeed === m.playerBSeed);
      // All rounds show round-only delta (+N) — no carryover from previous rounds
      var prefix = (rs > 0) ? '+' : '';
      return '<span class="yc-mscore' + (won ? ' yc-mscore-win' : ' yc-mscore-lose') + '">' +
        prefix + rs + '</span>';
    }

    // Round hasn't started yet — hide all scores
    if (!m.hasLiveData && !m.winnerSeed)
      return '<span class="hint">—</span>';

    // No live data
    if (total === null || total === undefined)
      return '<span class="hint">—</span>';

    // Live / pending round — always show round delta (never cumulative total)
    // Compute round baseline: total - roundScore = score at start of this round
    var roundBaseline = (rs !== null) ? (total - rs) : null;
    if (rs !== null) {
      var gainStr = (rs > 0 ? '+' : '') + rs;
      var tip = 'סה״כ ' + _fmtScore(total) + ' · פתיחת סיבוב ' + _fmtScore(roundBaseline) + ' · שינוי במחזור ' + gainStr;
      if (m.roundStarted) {
        return '<span class="yc-mscore" title="' + esc(tip) + '">' +
          gainStr +
          ' <span class="yc-tot-hint">(' + total + ')</span></span>';
      }
      // Round hasn't moved yet (both deltas are 0) — show +0 muted
      return '<span class="yc-mscore hint" title="' + esc(tip) + '">+0</span>';
    }
    // No baseline at all — show total as fallback
    var tip2 = 'ניקוד כולל · פתיחת הגביע ' + _fmtScore(init);
    return '<span class="yc-mscore" title="' + esc(tip2) + '">' + _fmtScore(total) + '</span>';
  }

  function _matchCard(m, roundIsClosed) {
    if (m.isBye) {
      return '<div class="yc-card yc-bye-card">' +
        '<div class="yc-card-top">' +
          '<span class="yc-match-num">#' + esc(m.playerASeed) + '</span>' +
          '<span class="pill green" style="font-size:11px">עלה אוטומטית</span>' +
        '</div>' +
        '<div class="yc-card-name">' + esc(m.playerAName) + '</div>' +
        '</div>';
    }

    var leadA = m.isProvisional && m.provisionalWinnerSeed === m.playerASeed;
    var leadB = m.isProvisional && m.provisionalWinnerSeed === m.playerBSeed;
    var winA  = m.winnerSeed === m.playerASeed;
    var winB  = m.winnerSeed === m.playerBSeed;
    var provClass = m.isProvisional ? ' yc-provisional' : '';
    var closedClass = roundIsClosed ? ' yc-closed-card' : '';

    // Status line
    var status;
    if (m.winnerSeed) {
      // Official result
      var wName = m.winnerName || (winA ? m.playerAName : m.playerBName);
      var tbBadge = (m.tieBreakerUsed && m.tieBreakerUsed !== 'A')
        ? ' <span class="pill gold" style="font-size:10px" title="שובר שוויון ' + esc(m.tieBreakerUsed) + '">שוב״ש ' + esc(m.tieBreakerUsed) + '</span>' : '';
      status = '<span class="pill green">✓ ' + esc(wName) + ' ניצח</span>' + tbBadge;
    } else if (m.isProvisional) {
      var roundLabel = m.roundStarted ? 'חי' : 'לפני המחזור';
      var tbNote = (m.provisionalTieBreaker && m.provisionalTieBreaker !== 'A')
        ? '<span class="pill gold" style="font-size:10px">שוב״ש ' + esc(m.provisionalTieBreaker) + '</span> ' : '';
      status =
        '<span class="pill orange" style="font-size:11px"><span class="yc-live-dot"></span> ' + roundLabel + '</span> ' +
        tbNote +
        '<b>' + esc(m.provisionalWinnerName) + '</b> מוביל';
    } else if (!m.hasLiveData) {
      status = '<span class="pill" style="font-size:11px;background:#444;color:#aaa">⏳ ממתין לתחילת הסיבוב</span>';
    } else {
      status = '<span class="pill" style="font-size:11px">ממתין לנתונים</span>';
    }

    return '<div class="yc-card yc-match-card' + provClass + closedClass + '">' +
      '<div class="yc-card-top">' +
        '<span class="yc-match-num">#' + esc(m.matchNumber) + '</span>' +
        '<div class="yc-status-line">' + status + '</div>' +
      '</div>' +
      '<div class="yc-player-row' + (winA ? ' yc-winner-row' : '') + (leadA ? ' yc-lead-row' : '') + '">' +
        '<div class="yc-player-info">' +
          '<span class="yc-seed-badge">' + esc(m.playerASeed) + '</span>' +
          '<span class="yc-player-name">' + esc(m.playerAName) + (winA ? ' <span class="yc-crown">👑</span>' : '') + '</span>' +
        '</div>' +
        _scoreCell(m, 'A') +
      '</div>' +
      '<div class="yc-vs-line">נגד</div>' +
      '<div class="yc-player-row' + (winB ? ' yc-winner-row' : '') + (leadB ? ' yc-lead-row' : '') + '">' +
        '<div class="yc-player-info">' +
          '<span class="yc-seed-badge">' + esc(m.playerBSeed) + '</span>' +
          '<span class="yc-player-name">' + esc(m.playerBName) + (winB ? ' <span class="yc-crown">👑</span>' : '') + '</span>' +
        '</div>' +
        _scoreCell(m, 'B') +
      '</div>' +
    '</div>';
  }

  // ── section renderers ──────────────────────────────────────────────────

  function _renderHero() {
    var el = document.getElementById('yc-hero');
    if (!el) return;
    var liveCount = _bracket.filter(function (m) { return m.isProvisional; }).length;
    var statusBadge = liveCount > 0
      ? '<span class="pill orange yc-live-pill"><span class="yc-live-dot"></span> ' + liveCount + ' דו-קרבים חיים</span>'
      : (_activeRound > 1 ? '<span class="pill blue">סיבוב ' + _activeRound + ' פעיל</span>'
                           : '<span class="pill">ממתין לתחילת המחזור</span>');
    el.innerHTML =
      '<div class="yc-hero-inner card">' +
        '<div class="yc-hero-left">' +
          '<div class="yc-crest" id="yc-crest-box">' +
            '<img src="assets/yossi-cup/yossi-cup-2026.png" alt="גביע יוסי" class="yc-crest-img" ' +
              'onerror="this.style.display=\'none\';document.getElementById(\'yc-crest-svg\').style.display=\'flex\'">' +
            '<div class="yc-crest-svg" id="yc-crest-svg">' +
              '<div class="yc-crest-inner">' +
                '<div class="yc-crest-trophy">🏆</div>' +
                '<div class="yc-crest-name">גביע יוסי</div>' +
                '<div class="yc-crest-year">★ מונדיאל 2026 ★</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="yc-hero-right">' +
          '<div class="yc-eyebrow">מפעל נוק-אאוט · מונדיאל 2026</div>' +
          '<h1 class="yc-title">גביע יוסי</h1>' +
          '<div class="yc-badges">' +
            '<span class="pill gold">פיילוט</span>' +
            statusBadge +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function _renderExplanation() {
    var el = document.getElementById('yc-explanation');
    if (!el) return;
    el.innerHTML =
      '<section class="card section yc-section yc-explainer">' +
        '<div class="sectionHead">' +
          '<h2>🎯 מה זה גביע יוסי?</h2>' +
          '<button id="ycExplToggle" class="secondary" style="font-size:13px;padding:7px 12px">▼ הסבר</button>' +
        '</div>' +
        '<div id="ycExplBody" style="display:none">' +
          '<div class="yc-expl-grid">' +
            '<div class="yc-expl-item">' +
              '<div class="yc-expl-icon">⚔️</div>' +
              '<div><b>דו-קרב אחד-על-אחד</b><br>' +
              '<span class="hint">כל משתתף מוצמד ליריב אחד. הם נלחמים ביניהם על ניקוד שיצברו במהלך המחזור.</span></div>' +
            '</div>' +
            '<div class="yc-expl-item">' +
              '<div class="yc-expl-icon">📊</div>' +
              '<div><b>מנצח = יותר נקודות במחזור</b><br>' +
              '<span class="hint">רק הניקוד שנצבר <em>בתוך</em> מחזור הגביע קובע — לא הניקוד הכולל מתחילת הטוטו.</span></div>' +
            '</div>' +
            '<div class="yc-expl-item">' +
              '<div class="yc-expl-icon">📧</div>' +
              '<div><b>הניקוד הקובע</b><br>' +
              '<span class="hint">הניצחון נקבע לפי הניקוד במייל הסיכום הראשון של יוסי בסוף המחזור — לא לפי עדכונים חיים.</span></div>' +
            '</div>' +
            '<div class="yc-expl-item">' +
              '<div class="yc-expl-icon">🔢</div>' +
              '<div><b>שוברי שוויון</b><br>' +
              '<span class="hint">תיקו בניקוד → שובר שוויון לפי ניקוד כולל, ניקוד פתיחה לגביע, ופרמטרים נוספים. מספר הסיד גובר בסוף.</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
    _bindEvents();
  }

  function _renderKpis() {
    var el = document.getElementById('yc-kpis');
    if (!el) return;
    var roundNum = _activeRound;
    var advancing = 128;
    if (roundNum === 2) advancing = 64;
    else if (roundNum === 3) advancing = 32;
    var kpis = [
      { num: '242',         label: 'משתתפים מקוריים' },
      { num: '128',         label: 'עלו לסיבוב 2' },
      { num: String(64),    label: 'דו-קרבים בסיבוב 2' },
      { num: '36',          label: 'הפתעות בסיבוב 1' },
      { num: '1',           label: 'מנצח אחד בסוף' }
    ];
    el.innerHTML = '<div class="yc-kpis-grid">' +
      kpis.map(function (k) {
        return '<div class="kpi"><div class="num">' + esc(k.num) + '</div>' +
               '<div class="label">' + esc(k.label) + '</div></div>';
      }).join('') +
      '</div>';
  }

  function _renderRoundTabs() {
    var el = document.getElementById('yc-round-tabs');
    if (!el) return;
    var closedRounds = _rounds.filter(function (r) { return r.status === 'closed'; });
    var pendingRounds = _rounds.filter(function (r) { return r.status !== 'closed' && r.participantCountStart; });
    var tabRounds = closedRounds.concat(pendingRounds.slice(0, 1));

    if (tabRounds.length < 2) { el.innerHTML = ''; return; }

    el.innerHTML = '<div class="yc-round-tabs-row">' +
      tabRounds.map(function (r) {
        var isClosed = r.status === 'closed';
        var isActive = r.round === (_viewRound || _activeRound);
        var badge = isClosed ? ' ✓' : ' 🔴';
        return '<button class="yc-round-tab secondary' + (isActive ? ' active' : '') + '" data-round="' + r.round + '">' +
          esc(r.name) + badge +
          '</button>';
      }).join('') +
    '</div>';
    _bindEvents();
  }

  function _renderRoundView() {
    _renderRoundTabs();

    var vr = _viewRound || _activeRound;
    var roundInfo = _rounds.find(function (r) { return r.round === vr; });
    var isClosed = roundInfo && roundInfo.status === 'closed';
    var isActive = vr === _activeRound;

    var el = document.getElementById('yc-bracket');
    if (!el) return;

    if (isClosed && !isActive) {
      // Show closed round results
      _renderClosedRound(el, vr, roundInfo);
    } else if (isActive) {
      // Show active round live bracket
      _renderActiveBracket(el, vr, roundInfo);
    } else {
      // Future round
      el.innerHTML =
        '<section class="card section yc-section">' +
          '<h2>סיבוב ' + vr + ' — עתידי</h2>' +
          '<div class="empty" style="padding:40px 0">הסיבוב ייפתח לאחר סגירת הסיבוב הקודם.</div>' +
        '</section>';
    }
  }

  function _searchBarHtml(withFilters) {
    var filters = withFilters
      ? '<div class="yc-filters">' +
          '<button class="yc-filter-btn secondary' + (_filter === 'all'    ? ' active' : '') + '" data-filter="all">הכל</button>' +
          '<button class="yc-filter-btn secondary' + (_filter === 'active' ? ' active' : '') + '" data-filter="active">דו-קרבים</button>' +
        '</div>'
      : '';
    return '<div class="yc-search-wrap" id="yc-search">' +
      '<div class="yc-search-bar">' +
        '<div class="inputWrap" style="flex:1;min-width:180px">' +
          '<span class="searchIcon">🔎</span>' +
          '<input id="ycSearch" autocomplete="off" placeholder="חפש שם משתתף..." ' +
            'value="' + esc(_search) + '" style="width:100%;padding-right:44px">' +
        '</div>' +
        filters +
      '</div>' +
    '</div>';
  }

  function _renderClosedRound(el, round, roundInfo) {
    var bracket   = _bracketForRound(round);
    var allActive = bracket.filter(function (m) { return !m.isBye; });
    var allByes   = bracket.filter(function (m) { return m.isBye; });

    el.innerHTML =
      '<section class="card section yc-section">' +
        '<div class="sectionHead">' +
          '<h2>' + esc(_roundLabel(round, true)) + ' — תוצאות סופיות</h2>' +
          '<span class="pill green">✓ סגור</span>' +
        '</div>' +
        '<div class="notice yc-live-note" style="margin-bottom:16px">📋 ' +
          allActive.length + ' דו-קרבים + ' + allByes.length + ' עליות אוטומטיות' +
        '</div>' +
        _searchBarHtml(false) +
        '<div id="yc-bracket-body"></div>' +
      '</section>';

    _bindEvents();
    _renderClosedBracketBody(bracket);
  }

  function _renderClosedBracketBody(bracket) {
    var el = document.getElementById('yc-bracket-body');
    if (!el) return;

    var visible = bracket.filter(function (m) {
      if (!_search) return true;
      var nA = String(m.playerAName || '').toLowerCase();
      var nB = String(m.playerBName || '').toLowerCase();
      return nA.includes(_search) || nB.includes(_search);
    });
    if (visible.length === 0) {
      el.innerHTML = '<div class="empty" style="padding:40px 0">אין תוצאות לחיפוש זה</div>';
      return;
    }
    var byes   = visible.filter(function (m) { return m.isBye; });
    var active = visible.filter(function (m) { return !m.isBye; });
    var html   = '';
    if (byes.length) {
      html += '<div class="yc-group-label">עלו אוטומטית לסיבוב הבא (' + byes.length + ')</div>' +
        '<div class="yc-bye-grid">' + byes.map(function (m) { return _matchCard(m, true); }).join('') + '</div>';
    }
    if (active.length) {
      if (byes.length) html += '<div class="yc-group-label">תוצאות דו-קרבים (' + active.length + ')</div>';
      html += '<div class="yc-duels-grid">' + active.map(function (m) { return _matchCard(m, true); }).join('') + '</div>';
    }
    el.innerHTML = html;
  }

  function _renderActiveBracket(el, round, roundInfo) {
    var started    = _roundHasStarted(round);
    var startLabel = _roundStartLabel(round);
    var liveCount  = _bracket.filter(function (m) { return m.isProvisional; }).length;
    var t = _lastUpdate ? _lastUpdate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';

    var liveStatus;
    if (!started) {
      liveStatus = '<span class="pill" style="background:#555;color:#fff">⏳ טרם התחיל</span>' +
        (startLabel ? '<span class="hint" style="margin-right:8px">מתחיל ' + esc(startLabel) + '</span>' : '');
    } else if (liveCount > 0) {
      liveStatus = '<span class="pill orange yc-live-pill"><span class="yc-live-dot"></span> ' + liveCount + ' דו-קרבים חיים</span>' +
        (t ? '<span class="hint" style="margin-right:8px">עודכן ' + esc(t) + '</span>' : '');
    } else {
      liveStatus = '<span class="pill">ממתין לתחילת המחזור</span>' +
        (t ? '<span class="hint" style="margin-right:8px">עודכן ' + esc(t) + '</span>' : '');
    }

    var roundInfo2 = _rounds.find(function (r) { return r.round === round; });
    var preStartNote = !started && startLabel
      ? '<div class="notice" style="background:rgba(247,201,72,.1);border-color:#f7c948;margin-bottom:12px">' +
          '⏳ הסיבוב יתחיל ב-<b>' + esc(startLabel) + '</b>' +
          (roundInfo2 && roundInfo2.description ? ' ויכלול את <b>' + esc(roundInfo2.description) + '</b>' : '') + '. ' +
          'ניקוד הסיבוב יתאפס ויחושב רק מנקודות שנצברו במחזור זה — ניקוד מסיבובים קודמים אינו נספר.' +
        '</div>'
      : '';

    el.innerHTML =
      '<section class="card section yc-section">' +
        '<div class="sectionHead">' +
          '<h2>' + esc(_roundLabel(round, true)) + '</h2>' +
          '<div class="yc-live-status">' + liveStatus + '</div>' +
        '</div>' +
        (started
          ? '<div class="notice yc-live-note">📡 הניקוד מתעדכן <b>חי</b> כל 30 שניות. ' +
              'הניצחון <b>הרשמי</b> נקבע לפי מייל הסיכום של יוסי בסוף המחזור — עדכון חי = <b>לא סופי</b>.</div>'
          : preStartNote) +
        _searchBarHtml(started) +
        '<div id="yc-bracket-body"></div>' +
      '</section>';

    _bindEvents();
    _renderBracketBody();
  }

  function _matchVisible(m) {
    if (_filter === 'bye' && !m.isBye) return false;
    if (_filter === 'active' && m.isBye) return false;
    if (_search) {
      var nA = String(m.playerAName || '').toLowerCase();
      var nB = String(m.playerBName || '').toLowerCase();
      if (!nA.includes(_search) && !nB.includes(_search)) return false;
    }
    return true;
  }

  function _renderBracketBody() {
    var el = document.getElementById('yc-bracket-body');
    if (!el) return;
    var visible = _bracket.filter(_matchVisible);
    if (visible.length === 0) {
      el.innerHTML = '<div class="empty" style="padding:40px 0">אין תוצאות לחיפוש זה</div>';
      return;
    }
    var byes   = visible.filter(function (m) { return m.isBye; });
    var active = visible.filter(function (m) { return !m.isBye; });
    var html   = '';
    if (byes.length && active.length) {
      html += '<div class="yc-group-label">עולים אוטומטית (' + byes.length + ')</div>' +
        '<div class="yc-bye-grid">' + byes.map(function (m) { return _matchCard(m, false); }).join('') + '</div>';
    }
    if (active.length) {
      if (byes.length) html += '<div class="yc-group-label">דו-קרבים (' + active.length + ')</div>';
      html += '<div class="yc-duels-grid">' + active.map(function (m) { return _matchCard(m, false); }).join('') + '</div>';
    }
    el.innerHTML = html;
  }

  function _renderRules() {
    var el = document.getElementById('yc-rules');
    if (!el || !_rules.tieBreakerRules) return;
    el.innerHTML =
      '<section class="card section yc-section">' +
        '<div class="sectionHead">' +
          '<h2>חוקי המפעל</h2>' +
          '<button id="ycRulesToggle" class="secondary" style="font-size:13px;padding:7px 12px">▼ הצג חוקים</button>' +
        '</div>' +
        '<div id="ycRulesBody" style="display:none">' +
          '<div class="yc-rules-grid">' +
            '<div class="yc-rule-block">' +
              '<h3>איך זה עובד</h3>' +
              '<ul>' + (_rules.general || []).map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>' +
            '</div>' +
            '<div class="yc-rule-block">' +
              '<h3>סגירת סיבוב</h3>' +
              '<ul>' + (_rules.roundClose || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
              '<div class="notice" style="margin-top:12px"><b>פיילוט:</b> ' + esc(_rules.pilot || '') + '</div>' +
            '</div>' +
            '<div class="yc-rule-block yc-rule-tiebreak">' +
              '<h3>שוברי שוויון</h3>' +
              '<div class="yc-tiebreak-list">' +
                (_rules.tieBreakerRules || []).map(function (t) {
                  return '<div class="yc-tiebreak-row">' +
                    '<span class="yc-tb-key pill gold">' + esc(t.key) + '</span>' +
                    '<div><b>' + esc(t.label) + '</b><div class="hint">' + esc(t.description) + '</div></div>' +
                    '</div>';
                }).join('') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
    _bindEvents();
  }

  // ── public render entry point ──────────────────────────────────────────
  window.YossiCup = window.YossiCup || {};
  window.YossiCup.render = function () {
    if (!_init) {
      _loadData();
      _init = true;
    } else {
      _recomputeLive();
    }

    _renderHero();
    _renderKpis();
    _renderExplanation();
    _renderRoundTabs();
    _renderRoundView();
    _renderRules();

    // hero image fallback
    var img = document.querySelector('.yc-crest-img');
    var svg = document.getElementById('yc-crest-svg');
    if (img && svg && img.complete && img.naturalWidth === 0) {
      img.style.display = 'none';
      svg.style.display = 'flex';
    }
  };

})();
