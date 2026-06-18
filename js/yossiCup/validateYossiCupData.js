'use strict';
(function (exports) {

  /**
   * validateYossiCupData — runtime sanity checks before rendering.
   * Returns { ok: boolean, errors: string[], warnings: string[] }.
   */
  function validateYossiCupData(participants, bracket) {
    var errors = [], warnings = [];
    var e = errors.push.bind(errors);
    var w = warnings.push.bind(warnings);

    if (!Array.isArray(participants) || participants.length === 0) {
      e('participants array is missing or empty'); return { ok: false, errors: errors, warnings: warnings };
    }
    if (!Array.isArray(bracket) || bracket.length === 0) {
      e('bracket array is missing or empty'); return { ok: false, errors: errors, warnings: warnings };
    }

    if (participants.length !== 242) w('Expected 242 participants, got ' + participants.length);

    var seedSet = {};
    participants.forEach(function (p) {
      if (!p.seed || !p.name) e('Participant missing seed or name: ' + JSON.stringify(p));
      if (seedSet[p.seed]) e('Duplicate seed ' + p.seed);
      seedSet[p.seed] = true;
    });

    var byeRows    = bracket.filter(function (m) { return m.isBye; });
    var activeRows = bracket.filter(function (m) { return !m.isBye; });

    if (byeRows.length !== 14) w('Expected 14 BYE rows, got ' + byeRows.length);
    if (activeRows.length !== 114) w('Expected 114 active rows, got ' + activeRows.length);

    byeRows.forEach(function (m) {
      if (!m.winnerSeed) e('BYE row ' + m.id + ' has no winnerSeed');
    });

    activeRows.forEach(function (m) {
      if (m.winnerSeed !== null && m.winnerSeed !== undefined) {
        w('Active match ' + m.id + ' already has a winner — ensure it was set by determineCupMatchWinner');
      }
    });

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  exports.validateYossiCupData = validateYossiCupData;

})(typeof module !== 'undefined' ? (module.exports = module.exports || {}) : (window.YC = window.YC || {}));
