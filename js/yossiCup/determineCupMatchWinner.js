'use strict';
(function (exports) {

  /**
   * determineCupMatchWinner — pure tie-breaker function.
   *
   * Tie-break order (spec):
   *   A. Higher round score.
   *   B. Higher cumulative cup score (total since cup round 1, excluding initialScore).
   *   C. Higher initial score.
   *   D/E. Bigger margin in previous rounds, stepping back to round 1.
   *   F. Lower seed number (better original ranking).
   *
   * @param {object} p
   *   playerA, playerB              — any identifier
   *   roundScoreA, roundScoreB      — number (points in current round)
   *   cumulativeCupScoreA, …B       — number (total cup points excluding initialScore)
   *   initialScoreA, initialScoreB  — number
   *   previousRoundMarginsA, …B     — number[] (margins in rounds [R1, R2, …] most recent last)
   *   seedA, seedB                  — number (lower = higher rank)
   * @returns {{ winnerId, reason, tieBreakerUsed, margin, details }}
   */
  function determineCupMatchWinner(p) {
    var a = p.playerA, b = p.playerB;
    var rA = Number(p.roundScoreA) || 0;
    var rB = Number(p.roundScoreB) || 0;
    var cA = Number(p.cumulativeCupScoreA) || 0;
    var cB = Number(p.cumulativeCupScoreB) || 0;
    var iA = Number(p.initialScoreA) || 0;
    var iB = Number(p.initialScoreB) || 0;
    var mA = Array.isArray(p.previousRoundMarginsA) ? p.previousRoundMarginsA : [];
    var mB = Array.isArray(p.previousRoundMarginsB) ? p.previousRoundMarginsB : [];
    var sA = Number(p.seedA);
    var sB = Number(p.seedB);

    function result(winnerId, tieBreaker, margin, details) {
      return { winnerId: winnerId, reason: tieBreaker, tieBreakerUsed: tieBreaker, margin: margin, details: details };
    }

    // A — current round score
    if (rA !== rB) {
      return result(rA > rB ? a : b, 'A', Math.abs(rA - rB),
        'ניקוד סיבוב נוכחי: ' + Math.max(rA, rB) + ' מול ' + Math.min(rA, rB));
    }

    // B — cumulative cup score
    if (cA !== cB) {
      return result(cA > cB ? a : b, 'B', Math.abs(cA - cB),
        'ניקוד מצטבר בגביע: ' + Math.max(cA, cB) + ' מול ' + Math.min(cA, cB));
    }

    // C — initial score
    if (iA !== iB) {
      return result(iA > iB ? a : b, 'C', Math.abs(iA - iB),
        'ניקוד התחלתי: ' + Math.max(iA, iB) + ' מול ' + Math.min(iA, iB));
    }

    // D/E — step backwards through previous round margins (most recent first)
    var len = Math.max(mA.length, mB.length);
    for (var i = len - 1; i >= 0; i--) {
      var mAi = Number(mA[i]) || 0;
      var mBi = Number(mB[i]) || 0;
      if (mAi !== mBi) {
        return result(mAi > mBi ? a : b, 'D', Math.abs(mAi - mBi),
          'פער ניצחון בסיבוב ' + (i + 1) + ': ' + Math.max(mAi, mBi) + ' מול ' + Math.min(mAi, mBi));
      }
    }

    // F — seed (lower number = better rank = wins)
    if (sA !== sB) {
      return result(sA < sB ? a : b, 'F', Math.abs(sA - sB),
        'זרע מקורי: ' + Math.min(sA, sB) + ' מנצח על ' + Math.max(sA, sB));
    }

    // Should never reach here if seeds are unique
    return result(a, 'F', 0, 'זהה לחלוטין — שחקן א׳ מנצח כברירת מחדל');
  }

  exports.determineCupMatchWinner = determineCupMatchWinner;

})(typeof module !== 'undefined' ? (module.exports = module.exports || {}) : (window.YC = window.YC || {}));
