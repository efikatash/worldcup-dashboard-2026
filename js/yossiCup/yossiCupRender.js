'use strict';
/* ───────────────────────────────────────────────────────────────────────
   גביע יוסי — Render Module
   window.YossiCup.render() is called every time the 'yossicup' tab is shown.
   All DOM mutation is inside this file; all logic lives in YC.* utilities.
   ─────────────────────────────────────────────────────────────────────── */
(function () {

  var yc  = window.YC  || {};
  var esc = window.esc || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g,
      function (s) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]; });
  };

  // ── state ──────────────────────────────────────────────────────────────
  var _init      = false;
  var _bracket   = [];   // enriched with live scores
  var _participants = [];
  var _rounds    = [];
  var _rules     = {};
  var _search    = '';
  var _filter    = 'all'; // 'all' | 'bye' | 'active'

  // ── boot ───────────────────────────────────────────────────────────────
  function _loadData() {
    try {
      var pEl = document.getElementById('ycParticipants');
      var bEl = document.getElementById('ycBracket');
      var rEl = document.getElementById('ycRounds');
      var ruEl= document.getElementById('ycRules');
      _participants = pEl ? JSON.parse(pEl.textContent) : [];
      var raw       = bEl ? JSON.parse(bEl.textContent) : [];
      _rounds       = rEl ? JSON.parse(rEl.textContent) : [];
      _rules        = ruEl? JSON.parse(ruEl.textContent): {};
      // enrich bracket with live scores from DATA
      var live = (window.DATA && window.DATA.participants) || [];
      _bracket = (yc.buildCupBracket || function (b) { return b; })(raw, live);
    } catch (e) {
      console.error('[YossiCup] data load error', e);
    }
  }

  function _bindEvents() {
    var searchEl = document.getElementById('ycSearch');
    if (searchEl) {
      searchEl.oninput = function () {
        _search = (this.value || '').trim().toLowerCase();
        _renderBracket();
      };
    }
    document.querySelectorAll('.yc-filter-btn').forEach(function (btn) {
      btn.onclick = function () {
        document.querySelectorAll('.yc-filter-btn').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        _filter = this.dataset.filter || 'all';
        _renderBracket();
      };
    });
    var rulesToggle = document.getElementById('ycRulesToggle');
    if (rulesToggle) {
      rulesToggle.onclick = function () {
        var body = document.getElementById('ycRulesBody');
        if (body) {
          var open = body.style.display !== 'none';
          body.style.display = open ? 'none' : 'block';
          this.textContent = open ? '▼ הצג חוקים' : '▲ הסתר';
        }
      };
    }
  }

  // ── sections ──────────────────────────────────────────────────────────

  function _renderHero() {
    var el = document.getElementById('yc-hero');
    if (!el) return;
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
          '<div class="yc-eyebrow">🏆 פיילוט · מפעל נוק-אאוט</div>' +
          '<h1 class="yc-title">גביע יוסי</h1>' +
          '<div class="yc-subtitle">מפעל נוק-אאוט על בסיס משחק טוטו מונדיאל 2026</div>' +
          '<div class="yc-badges">' +
            '<span class="pill gold">פיילוט</span>' +
            '<span class="pill blue">סיבוב ראשון</span>' +
            '<span class="pill">ממתין לניקוד יוסי</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function _renderKpis() {
    var el = document.getElementById('yc-kpis');
    if (!el) return;
    var kpis = [
      { num: '242',   label: 'משתתפים' },
      { num: '14',    label: 'עולים אוטומטית' },
      { num: '114',   label: 'דו-קרבים' },
      { num: '128',   label: 'בסיבוב הבא' },
      { num: '1',     label: 'מנצח אחד בסוף' }
    ];
    el.innerHTML = '<div class="yc-kpis-grid">' +
      kpis.map(function (k) {
        return '<div class="kpi"><div class="num">' + esc(k.num) + '</div>' +
               '<div class="label">' + esc(k.label) + '</div></div>';
      }).join('') +
      '</div>';
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
              '<ul>' + (_rules.bye || []).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' +
            '</div>' +
            '<div class="yc-rule-block">' +
              '<h3>סגירת סיבוב</h3>' +
              '<ul>' + (_rules.roundClose || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
              '<div class="notice" style="margin-top:12px"><b>פיילוט:</b> ' + esc(_rules.pilot || '') + '</div>' +
            '</div>' +
            '<div class="yc-rule-block yc-rule-tiebreak">' +
              '<h3>שוברי שוויון — לפי סדר קדימויות</h3>' +
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
    _bindEvents(); // re-bind after DOM insert
  }

  function _renderTimeline() {
    var el = document.getElementById('yc-timeline');
    if (!el || !_rounds.length) return;
    el.innerHTML =
      '<section class="card section yc-section">' +
        '<div class="sectionHead"><h2>מפת הסיבובים</h2></div>' +
        '<div class="yc-timeline-row">' +
          _rounds.map(function (r) {
            var statusClass = r.status === 'closed' ? 'green' : r.status === 'live' ? 'orange' : r.status === 'upcoming' ? 'gray' : '';
            var statusLabel = r.status === 'closed' ? 'סגור' : r.status === 'live' ? 'פעיל' : r.status === 'upcoming' ? 'עתידי' : 'ממתין';
            return '<div class="yc-timeline-card">' +
              '<div class="yc-tl-round">סיבוב ' + (r.round === 99 ? 'גמר' : r.round) + '</div>' +
              '<div class="yc-tl-name">' + esc(r.name) + '</div>' +
              '<div class="yc-tl-desc hint">' + esc(r.description) + '</div>' +
              (r.participantCountStart ? '<div class="yc-tl-stat">' + r.participantCountStart + ' משתתפים</div>' : '') +
              '<div class="yc-tl-status"><span class="pill ' + statusClass + '">' + statusLabel + '</span></div>' +
              '</div>';
          }).join('<div class="yc-tl-arrow">→</div>') +
        '</div>' +
      '</section>';
  }

  function _renderSearch() {
    var el = document.getElementById('yc-search');
    if (!el) return;
    el.innerHTML =
      '<div class="yc-search-bar">' +
        '<div class="inputWrap" style="flex:1;min-width:220px">' +
          '<span class="searchIcon">🔎</span>' +
          '<input id="ycSearch" autocomplete="off" placeholder="חפש שם משתתף..." style="width:100%;padding-right:44px">' +
        '</div>' +
        '<div class="yc-filters">' +
          '<button class="yc-filter-btn secondary active" data-filter="all">הכל (128)</button>' +
          '<button class="yc-filter-btn secondary" data-filter="bye">עולים אוטומטית (14)</button>' +
          '<button class="yc-filter-btn secondary" data-filter="active">דו-קרבים (114)</button>' +
        '</div>' +
      '</div>';
    _bindEvents();
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

  function _scoreBadge(live) {
    if (live === null || live === undefined) return '<span class="hint">—</span>';
    return '<span class="yc-live-score">' + live + '</span>';
  }

  function _matchCard(m) {
    if (m.isBye) {
      return '<div class="yc-card yc-bye-card">' +
        '<div class="yc-card-seed">#' + esc(m.playerASeed) + '</div>' +
        '<div class="yc-card-name">' + esc(m.playerAName) + '</div>' +
        (m.liveScoreA !== null ? '<div class="yc-card-score">' + _scoreBadge(m.liveScoreA) + '<span class="hint" style="font-size:11px;margin-right:4px">נק׳ כרגע</span></div>' : '') +
        '<div class="yc-bye-label">' +
          '<span class="pill green">✓ עלה אוטומטית לסיבוב השני</span>' +
        '</div>' +
        '</div>';
    }
    var scoreA = m.liveScoreA !== null ? m.liveScoreA : null;
    var scoreB = m.liveScoreB !== null ? m.liveScoreB : null;
    var leadClass = '';
    if (scoreA !== null && scoreB !== null) {
      if (scoreA > scoreB) leadClass = 'yc-lead-a';
      else if (scoreB > scoreA) leadClass = 'yc-lead-b';
    }
    return '<div class="yc-card yc-match-card ' + leadClass + '">' +
      '<div class="yc-match-num">#' + esc(m.matchNumber) + '</div>' +
      '<div class="yc-match-row yc-row-a">' +
        '<span class="yc-seed">' + esc(m.playerASeed) + '</span>' +
        '<span class="yc-name">' + esc(m.playerAName) + '</span>' +
        '<span class="yc-mscore">' + _scoreBadge(scoreA) + '</span>' +
      '</div>' +
      '<div class="yc-vs">vs</div>' +
      '<div class="yc-match-row yc-row-b">' +
        '<span class="yc-seed">' + esc(m.playerBSeed) + '</span>' +
        '<span class="yc-name">' + esc(m.playerBName) + '</span>' +
        '<span class="yc-mscore">' + _scoreBadge(scoreB) + '</span>' +
      '</div>' +
      '<div class="yc-match-status">' +
        (m.winnerSeed ? '<span class="pill green">הוכרז מנצח</span>' : '<span class="pill">ממתין לניקוד סופי</span>') +
        (m.tieBreakerUsed ? '<span class="pill gold" title="הוכרע לפי שובר שוויון ' + esc(m.tieBreakerUsed) + '">שוב״ש ' + esc(m.tieBreakerUsed) + '</span>' : '') +
      '</div>' +
      '</div>';
  }

  function _renderBracket() {
    var el = document.getElementById('yc-bracket-body');
    if (!el) return;
    var visible = _bracket.filter(_matchVisible);
    if (visible.length === 0) {
      el.innerHTML = '<div class="empty" style="padding:40px 0">אין תוצאות לחיפוש זה</div>';
      return;
    }
    // Group: BYEs first, then active duels — each group with a sub-header if mixed
    var byes   = visible.filter(function (m) { return m.isBye; });
    var active = visible.filter(function (m) { return !m.isBye; });
    var html   = '';
    if (byes.length && active.length) {
      html += '<div class="yc-group-label">עולים אוטומטית לסיבוב השני (' + byes.length + ')</div>';
    }
    if (byes.length) {
      html += '<div class="yc-bye-grid">' + byes.map(_matchCard).join('') + '</div>';
    }
    if (active.length) {
      if (byes.length) html += '<div class="yc-group-label">דו-קרבים פעילים (' + active.length + ')</div>';
      html += '<div class="yc-duels-grid">' + active.map(_matchCard).join('') + '</div>';
    }
    el.innerHTML = html;
  }

  function _renderBracketShell() {
    var el = document.getElementById('yc-bracket');
    if (!el) return;
    el.innerHTML =
      '<section class="card section yc-section">' +
        '<div class="sectionHead">' +
          '<h2>בראקט — סיבוב ראשון</h2>' +
          '<div class="hint">הניקוד המוצג הוא הדירוג החי הנוכחי. הניקוד הקובע לדו-קרב הוא ניקוד מייל הסיכום של יוסי.</div>' +
        '</div>' +
        '<div id="yc-bracket-body"></div>' +
      '</section>';
    _renderBracket();
  }

  // ── public render entry point ──────────────────────────────────────────
  window.YossiCup = window.YossiCup || {};
  window.YossiCup.render = function () {
    if (!_init) {
      _loadData();
      _init = true;
    } else {
      // Refresh live scores on each tab visit (DATA may have updated)
      var live = (window.DATA && window.DATA.participants) || [];
      var raw = _bracket.map(function (m) {
        return { playerASeed: m.playerASeed, playerAName: m.playerAName,
                 playerBSeed: m.playerBSeed, playerBName: m.playerBName,
                 isBye: m.isBye, matchNumber: m.matchNumber, id: m.id,
                 status: m.status, winnerSeed: m.winnerSeed, winnerName: m.winnerName,
                 winnerReason: m.winnerReason, round: m.round, tieBreakerUsed: m.tieBreakerUsed,
                 roundScoreA: m.roundScoreA, roundScoreB: m.roundScoreB };
      });
      _bracket = (yc.buildCupBracket || function (b) { return b; })(raw, live);
    }

    var result = (yc.validateYossiCupData || function () { return { ok: true, errors: [], warnings: [] }; })(_participants, _bracket);
    if (!result.ok) {
      console.warn('[YossiCup] validation errors:', result.errors);
    }

    _renderHero();
    _renderKpis();
    _renderTimeline();
    _renderRules();
    _renderSearch();
    _renderBracketShell();

    // bind hero image fallback
    var img = document.querySelector('.yc-crest-img');
    var svg = document.getElementById('yc-crest-svg');
    if (img && svg) {
      if (img.complete && img.naturalWidth === 0) {
        img.style.display = 'none';
        svg.style.display = 'flex';
      }
    }
  };

})();
