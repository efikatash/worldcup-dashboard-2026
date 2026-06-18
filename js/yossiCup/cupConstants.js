'use strict';
(function (exports) {

  var YC = exports;

  YC.TOP_14_SEEDS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14];
  YC.TOTAL_PARTICIPANTS = 242;
  YC.ACTIVE_DUELS_R1   = 114;
  YC.BYE_COUNT_R1      = 14;
  YC.ROUND2_STARTERS   = 128;

  YC.STATUS = {
    PENDING  : 'pending',
    LIVE     : 'live',
    CLOSED   : 'closed',
    BYE      : 'bye',
    UPCOMING : 'upcoming'
  };

  YC.TIE_BREAKER = {
    A : 'round_score',
    B : 'cumulative_cup_score',
    C : 'initial_score',
    D : 'previous_margin',
    F : 'seed'
  };

  YC.ROUNDS = [
    { round: 1,  name: 'סיבוב ראשון',       short: 'ס׳ 1',  desc: 'מחזור שני של שלב הבתים' },
    { round: 2,  name: 'סיבוב שני',          short: 'ס׳ 2',  desc: 'מחזור שלישי בתים 1–6' },
    { round: 3,  name: 'סיבוב שלישי',        short: 'ס׳ 3',  desc: 'מחזור שלישי בתים 7–12' },
    { round: 4,  name: 'שלב הנוק-אאוט',     short: 'נוק-אאוט', desc: 'המשך המפעל עם הנוק-אאוט' },
    { round: 99, name: 'גמר גביע יוסי',      short: 'גמר',   desc: 'שני הנותרים נלחמים על הכתר' }
  ];

  YC.COPY = {
    hero_eyebrow   : '🏆 פיילוט · מפעל נוק-אאוט',
    hero_title     : 'גביע יוסי',
    hero_subtitle  : 'מפעל נוק-אאוט על בסיס משחק טוטו מונדיאל 2026',
    badge_pilot    : 'פיילוט',
    badge_round1   : 'סיבוב ראשון',
    badge_pending  : 'ממתין לניקוד יוסי',
    bye_label      : 'עלה אוטומטית לסיבוב השני',
    pending_label  : 'ממתין לניקוד סופי',
    tiebreak_label : 'הוכרע לפי שובר שוויון',
    cup_winner     : 'מחזיק גביע יוסי הראשון',
    rules_title    : 'חוקי המפעל',
    bracket_title  : 'בראקט — סיבוב ראשון',
    search_ph      : 'חפש שם משתתף...',
    filter_all     : 'הכל',
    filter_bye     : 'עולים אוטומטית',
    filter_active  : 'דו-קרבים',
    kpi_total      : 'משתתפים',
    kpi_bye        : 'עולים אוטומטית',
    kpi_duels      : 'דו-קרבים',
    kpi_next       : 'בסיבוב הבא',
    kpi_winner     : 'מנצח אחד'
  };

})(typeof module !== 'undefined' ? (module.exports = module.exports || {}) : (window.YC = window.YC || {}));
