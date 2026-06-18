'use strict';
(function (exports) {

  function detectBye(row) {
    if (!row) return false;
    var sB = row.playerBSeed;
    var nB = row.playerBName;
    return (!nB || String(nB).trim() === '') || (typeof sB === 'number' && sB > 242);
  }

  exports.detectBye = detectBye;

})(typeof module !== 'undefined' ? (module.exports = module.exports || {}) : (window.YC = window.YC || {}));
