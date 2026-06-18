'use strict';
(function (exports) {

  /**
   * buildCupBracket — attach live scores from DATA.participants to frozen bracket rows.
   *
   * @param {object[]} bracketRows  — from round1Bracket.json
   * @param {object[]} participants — DATA.participants (live leaderboard)
   * @returns {object[]} enriched bracket rows with liveScoreA, liveScoreB, liveRankA, liveRankB
   */
  function buildCupBracket(bracketRows, participants) {
    var norm = (window.YC && window.YC.normalizeParticipantName) ||
               (typeof require !== 'undefined' && require('./normalizeParticipantName').normalizeParticipantName) ||
               function (s) { return String(s || '').toLowerCase().trim(); };

    // Build lookup: normalizedName → participant
    var byName = {};
    if (Array.isArray(participants)) {
      participants.forEach(function (p) {
        var k = norm(p.name);
        if (k) byName[k] = p;
      });
    }

    function lookup(name) {
      if (!name) return null;
      return byName[norm(name)] || null;
    }

    return bracketRows.map(function (row) {
      var pA = lookup(row.playerAName);
      var pB = lookup(row.playerBName);
      return Object.assign({}, row, {
        liveScoreA  : pA ? (pA.total || 0) : null,
        liveRankA   : pA ? (pA.displayRank || pA.rank || null) : null,
        liveScoreB  : pB ? (pB.total || 0) : null,
        liveRankB   : pB ? (pB.displayRank || pB.rank || null) : null
      });
    });
  }

  exports.buildCupBracket = buildCupBracket;

})(typeof module !== 'undefined' ? (module.exports = module.exports || {}) : (window.YC = window.YC || {}));
