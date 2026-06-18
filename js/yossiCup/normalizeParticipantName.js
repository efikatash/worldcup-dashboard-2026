'use strict';
(function (exports) {

  function normalizeParticipantName(name) {
    if (!name) return '';
    return String(name)
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[״׳"']/g, '')
      .replace(/ויצמן/g, 'וייצמן')
      .replace(/מיזלר/g, 'מייזלר')
      .replace(/לוקל/g, 'לוקאל')
      .toLowerCase();
  }

  exports.normalizeParticipantName = normalizeParticipantName;

})(typeof module !== 'undefined' ? (module.exports = module.exports || {}) : (window.YC = window.YC || {}));
