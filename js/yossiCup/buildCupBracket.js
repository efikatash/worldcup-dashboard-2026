'use strict';
(function (exports) {

  /**
   * buildCupBracket — attach live scores AND a provisional (live, non-final) winner
   * to each frozen bracket row.
   *
   * A cup duel is decided by the ROUND SCORE — the points a participant earns during
   * the current cup round window — NOT their lifetime total. For Round 1 the round
   * window starts at the frozen "initialScore" snapshot, so:
   *
   *     roundScore = liveTotal − initialScore        (Round 1: baseline = initialScore)
   *
   * The provisional winner is computed with the same determineCupMatchWinner tie-break
   * chain used for the official result, but it is ALWAYS marked provisional/not-final
   * (isProvisional) and never written back as the official winnerSeed. The official
   * result is only set when Yossi's summary email closes the round.
   *
   * @param {object[]} bracketRows        — frozen rows from round1Bracket.json
   * @param {object[]} participants       — DATA.participants (live leaderboard, has .total)
   * @param {object[]} [frozenParticipants] — participants.json (has .seed, .initialScore)
   * @param {object}   [opts]             — { activeRound, baselineBySeed }
   * @returns {object[]} enriched rows
   */
  function buildCupBracket(bracketRows, participants, frozenParticipants, opts) {
    opts = opts || {};
    var hasWin = (typeof window !== 'undefined');
    var norm = (hasWin && window.YC && window.YC.normalizeParticipantName) ||
               (typeof require !== 'undefined' && require('./normalizeParticipantName').normalizeParticipantName) ||
               function (s) { return String(s || '').toLowerCase().trim(); };
    var determine = (hasWin && window.YC && window.YC.determineCupMatchWinner) ||
               (typeof require !== 'undefined' && require('./determineCupMatchWinner').determineCupMatchWinner) ||
               null;

    // live participant by normalized name → has .total / .displayRank
    var byName = {};
    if (Array.isArray(participants)) {
      participants.forEach(function (p) { var k = norm(p.name); if (k) byName[k] = p; });
    }

    // frozen initialScore lookups (by seed and by name) — the Round 1 baseline.
    var initBySeed = {}, initByName = {};
    if (Array.isArray(frozenParticipants)) {
      frozenParticipants.forEach(function (fp) {
        if (fp.seed != null) initBySeed[fp.seed] = Number(fp.initialScore);
        var k = norm(fp.name); if (k) initByName[k] = Number(fp.initialScore);
      });
    }

    // Optional per-round baseline override (for rounds > 1, supplied after a round closes).
    var baselineBySeed = opts.baselineBySeed || null;

    function liveOf(name) { return name ? (byName[norm(name)] || null) : null; }
    function baselineOf(seed, name) {
      if (baselineBySeed && baselineBySeed[seed] != null && !isNaN(baselineBySeed[seed])) return baselineBySeed[seed];
      if (initBySeed[seed] != null && !isNaN(initBySeed[seed])) return initBySeed[seed];
      var k = norm(name);
      if (k && initByName[k] != null && !isNaN(initByName[k])) return initByName[k];
      return null;
    }
    function initOf(seed, name) {
      if (initBySeed[seed] != null && !isNaN(initBySeed[seed])) return initBySeed[seed];
      var k = norm(name);
      if (k && initByName[k] != null && !isNaN(initByName[k])) return initByName[k];
      return null;
    }

    return bracketRows.map(function (row) {
      var pA = liveOf(row.playerAName), pB = liveOf(row.playerBName);
      var totA = pA ? (Number(pA.total) || 0) : null;
      var totB = pB ? (Number(pB.total) || 0) : null;
      var baseA = baselineOf(row.playerASeed, row.playerAName);
      var baseB = baselineOf(row.playerBSeed, row.playerBName);
      var initA = initOf(row.playerASeed, row.playerAName);
      var initB = initOf(row.playerBSeed, row.playerBName);
      var rsA = (totA != null && baseA != null) ? (totA - baseA) : null; // round score
      var rsB = (totB != null && baseB != null) ? (totB - baseB) : null;

      var out = Object.assign({}, row, {
        liveScoreA: totA, liveScoreB: totB,
        liveRankA: pA ? (pA.displayRank || pA.rank || null) : null,
        liveRankB: pB ? (pB.displayRank || pB.rank || null) : null,
        initialScoreA: initA, initialScoreB: initB,
        roundScoreA: rsA, roundScoreB: rsB,
        hasLiveData: false,
        provisionalWinnerSeed: null, provisionalWinnerName: null,
        provisionalTieBreaker: null, provisionalMargin: null, isProvisional: false
      });

      // Provisional winner — only when the round has officially started AND there is no
      // official result yet. opts.roundHasStarted=false means the round start time has not
      // been reached; in that case we show no live scores at all (baseline is stale).
      var noOfficialWinner = (row.winnerSeed == null);
      var roundHasStarted = (opts.roundHasStarted !== false); // default true if not supplied
      if (!row.isBye && noOfficialWinner && totA != null && totB != null && determine && roundHasStarted) {
        out.hasLiveData = true;
        // Effective round scores: use computed delta when non-negative; fall back to the
        // live total itself when the snapshot pre-dates the current data (rsX < 0).
        var effA = (rsA != null && rsA >= 0) ? rsA : totA;
        var effB = (rsB != null && rsB >= 0) ? rsB : totB;
        // Only suppress provisional display when the round hasn't moved at all AND
        // we have a valid baseline (i.e. data is fresh but no cup-round games yet).
        var roundStarted = (rsA !== null && rsB !== null) ? (rsA > 0 || rsB > 0) : true;
        var res = determine({
          playerA: row.playerASeed, playerB: row.playerBSeed,
          roundScoreA: effA, roundScoreB: effB,
          cumulativeCupScoreA: effA, cumulativeCupScoreB: effB,
          initialScoreA: initA, initialScoreB: initB,
          previousRoundMarginsA: [], previousRoundMarginsB: [],
          seedA: row.playerASeed, seedB: row.playerBSeed
        });
        out.provisionalWinnerSeed = res.winnerId;
        out.provisionalWinnerName = (res.winnerId === row.playerASeed) ? row.playerAName : row.playerBName;
        out.provisionalTieBreaker = res.tieBreakerUsed;
        out.provisionalMargin = res.margin;
        out.isProvisional = true;
        out.roundStarted = roundStarted;
      }
      return out;
    });
  }

  exports.buildCupBracket = buildCupBracket;

})(typeof module !== 'undefined' ? (module.exports = module.exports || {}) : (window.YC = window.YC || {}));
