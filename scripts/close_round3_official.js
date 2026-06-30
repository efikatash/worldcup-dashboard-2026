#!/usr/bin/env node
// close_round3_official.js
// Closes R3 with official winners from Yossi's image, generates R4 (Round of 16).
// Lookup by seed pair (order-independent) — image may use different A/B assignment.

var fs   = require('fs');
var path = require('path');
var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var r3Bracket   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round3Bracket.json'), 'utf8'));
var cupRounds   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cupRounds.json'),     'utf8'));
var liveData    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'),   'utf8'));

var snapshotDate = liveData.generatedAt || new Date().toISOString();
console.log('R3 close snapshot: data.json total timestamp unknown, using:', snapshotDate);

// Build lookups
var seedToParticipant = {};
participants.forEach(function(p) { seedToParticipant[p.seed] = p; });

var seedToTotal = {};
participants.forEach(function(p) {
  var dp = liveData.participants.find(function(x) { return x.name === p.name; });
  if (dp) seedToTotal[p.seed] = dp.total;
});

function nameOf(seed) {
  return seedToParticipant[seed] ? seedToParticipant[seed].name : '(s' + seed + ')';
}

function pairKey(a, b) { return Math.min(a, b) + ',' + Math.max(a, b); }

// Official R3 winners from Yossi's spreadsheet images (unordered, matched by seed pair)
var officialWinnersList = [
  // [seedA, seedB, winnerSeed] — image may list pair in any A/B order
  [128,  65,  65],  // R3-1:  מור גרשגורן
  [127,  63, 127],  // R3-2:  שלומי+הראל ביגר
  [  3, 190,   3],  // R3-3:  ניר כהן
  [125,  61, 125],  // R3-4:  אביחי+יואב קראבץ
  [  5,  60,   5],  // R3-5:  רועי שטרק
  [  6,  70,   6],  // R3-6:  אפי קטש
  [  7, 186,   7],  // R3-7:  שמוליק תמיר
  [  8,  57,   8],  // R3-8:  פאפאספורט
  [  9,  73,   9],  // R3-9:  אייל חסון
  [ 10,  55,  10],  // R3-10: גל+סייבה גורליק
  [ 11,  54,  11],  // R3-11: רני רחמים
  [140,  53, 140],  // R3-12: איל לוי
  [ 13, 205, 205],  // R3-13: שני בארד (upset!)
  [ 14,  51,  14],  // R3-14: אוראל ויצמן
  [114,  79,  79],  // R3-15: יואב יוקלסון (upset!)
  [241,  49, 241],  // R3-16: ליאור רוזן (upset by R3 score)
  [ 17,  81,  17],  // R3-17: מיכל עובדיה
  [111, 175, 175],  // R3-18: רועי הדר (upset!)
  [110, 211, 110],  // R3-19: אסף קדם
  [109,  84,  84],  // R3-20: אורי קיין (upset!)
  [108,  44, 108],  // R3-21: קובי ארליך
  [107, 171, 107],  // R3-22: עומר מנור+גיל ויובל שדות
  [151,  42, 151],  // R3-23: אביעד צרפתי
  [ 24, 169,  24],  // R3-24: כפיר כהן
  [104, 168, 104],  // R3-25: לידן דלויה
  [ 26,  90,  26],  // R3-26: דרור רסקין+ניר לוגסי
  [102,  38,  38],  // R3-27: גיא טלסניק (upset!)
  [ 28,  37,  37],  // R3-28: רותם בן חמו+ מורלי (upset!)
  [100,  93,  93],  // R3-29: עדי בן סימון (upset!)
  [ 99, 163,  99],  // R3-30: תומר פרי
  [ 31,  34,  31],  // R3-31: אריק גליקמן
  [ 32, 161,  32],  // R3-32: יריב וישנו
];

if (officialWinnersList.length !== 32) throw new Error('Expected 32 R3 winners, got ' + officialWinnersList.length);

var winnerBySeedPair = {};
officialWinnersList.forEach(function(ow) {
  winnerBySeedPair[pairKey(ow[0], ow[1])] = ow[2];
});

// Apply official results to R3 bracket
var corrections = 0, notFound = 0;
r3Bracket.forEach(function(match) {
  var key = pairKey(match.playerASeed, match.playerBSeed);
  var offWinner = winnerBySeedPair[key];
  if (offWinner === undefined) {
    console.error('ERROR: no official winner for R3 match', match.matchNumber, match.playerASeed, 'vs', match.playerBSeed);
    notFound++;
    return;
  }

  var baseA = seedToParticipant[match.playerASeed] ? seedToParticipant[match.playerASeed].baselineScoreR3 : null;
  var baseB = seedToParticipant[match.playerBSeed] ? seedToParticipant[match.playerBSeed].baselineScoreR3 : null;
  var totA  = seedToTotal[match.playerASeed] || 0;
  var totB  = seedToTotal[match.playerBSeed] || 0;
  var rsA   = baseA != null ? totA - baseA : null;
  var rsB   = baseB != null ? totB - baseB : null;

  var provisionalWinner = (rsA != null && rsB != null)
    ? (rsA > rsB ? match.playerASeed : rsB > rsA ? match.playerBSeed : null)
    : null;
  if (provisionalWinner !== null && provisionalWinner !== offWinner) {
    corrections++;
    console.log('OVERRIDE R3-' + match.matchNumber + ': score says s' + provisionalWinner +
      ' (' + nameOf(provisionalWinner) + ') → official s' + offWinner + ' (' + nameOf(offWinner) + ')' +
      ' | rsA=+' + rsA + ' rsB=+' + rsB);
  }

  match.roundScoreA    = rsA;
  match.roundScoreB    = rsB;
  match.winnerSeed     = offWinner;
  match.winnerName     = nameOf(offWinner);
  match.winnerReason   = 'official';
  match.tieBreakerUsed = null;
  match.status         = 'completed';
});

console.log('R3 closed. Overrides: ' + corrections + ' | not found: ' + notFound);

// Update participants: R3 winners get baselineScoreR4; losers are eliminated
var advancingSeeds = new Set();
r3Bracket.forEach(function(m) { if (m.winnerSeed) advancingSeeds.add(m.winnerSeed); });

var advancedCount = 0, eliminatedCount = 0;
participants.forEach(function(p) {
  if (p.baselineScoreR3 == null) return;
  if (advancingSeeds.has(p.seed)) {
    p.baselineScoreR4 = seedToTotal[p.seed] || p.baselineScoreR3;
    p.status = 'active';
    advancedCount++;
  } else {
    p.status = 'eliminated';
    p.eliminatedRound = 3;
    delete p.baselineScoreR4;
    eliminatedCount++;
  }
});
console.log('Advancing to R4: ' + advancedCount + ' | Eliminated in R3: ' + eliminatedCount);

// Build R4 bracket (Round of 16)
// Standard 32-player single-elimination bracket seeding:
// R4 match N pairs R3 slots A and B from:
// (1,32),(16,17),(8,25),(9,24),(4,29),(13,20),(5,28),(12,21),
// (2,31),(15,18),(7,26),(10,23),(3,30),(14,19),(6,27),(11,22)
var R4_SEEDING = [
  [1,32],[16,17],[8,25],[9,24],[4,29],[13,20],[5,28],[12,21],
  [2,31],[15,18],[7,26],[10,23],[3,30],[14,19],[6,27],[11,22]
];

var r3ByMatch = {};
r3Bracket.forEach(function(m) { r3ByMatch[m.matchNumber] = m; });

var r4Bracket = [];
R4_SEEDING.forEach(function(pair, i) {
  var matchNum = i + 1;
  var slotA = pair[0], slotB = pair[1];
  var mA = r3ByMatch[slotA];
  var mB = r3ByMatch[slotB];
  if (!mA || !mB) { console.error('Missing R3 match for R4 slot', matchNum); return; }

  var seedA = mA.winnerSeed;
  var seedB = mB.winnerSeed;

  r4Bracket.push({
    id:             'r4-m' + String(matchNum).padStart(3, '0'),
    round:          4,
    matchNumber:    matchNum,
    bracketSlotA:   slotA,
    bracketSlotB:   slotB,
    playerASeed:    seedA,
    playerAName:    nameOf(seedA),
    playerBSeed:    seedB,
    playerBName:    nameOf(seedB),
    isBye:          false,
    status:         'pending',
    winnerSeed:     null,
    winnerName:     null,
    winnerReason:   null,
    tieBreakerUsed: null,
    roundScoreA:    null,
    roundScoreB:    null
  });
});

console.log('Generated R4 bracket with ' + r4Bracket.length + ' matches');

// Update cupRounds.json: R3 → closed, R4 → pending
cupRounds.forEach(function(r) {
  if (r.round === 3) {
    r.status = 'closed';
    r.closedBySummaryEmail = true;
    r.summaryEmailDate = snapshotDate;
    r.participantCountEnd = 32;
  }
  if (r.round === 4) {
    r.status = 'pending';
    r.participantCountStart = 32;
    r.activeMatchCount = 16;
    r.byeCount = 0;
    r.participantCountEnd = 16;
    r.closedBySummaryEmail = false;
    r.summaryEmailDate = null;
  }
});

// Write all files
fs.writeFileSync(path.join(DATA_DIR, 'round3Bracket.json'), JSON.stringify(r3Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'round4Bracket.json'), JSON.stringify(r4Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'participants.json'),  JSON.stringify(participants, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'cupRounds.json'),     JSON.stringify(cupRounds, null, 2), 'utf8');
console.log('Written: round3Bracket.json, round4Bracket.json, participants.json, cupRounds.json');
console.log('\nNOTE: baselineScoreR4 = current totals (pre-R3-game data.json).');
console.log('Once data.json updates with R3 game results, re-run: node scripts/reset_r4_baseline.js');
console.log('Next: node scripts/patch_embedded_data.js\n');

// Print R4 bracket
console.log('=== R4 BRACKET (Round of 16) ===');
r4Bracket.forEach(function(m) {
  console.log('R4-' + String(m.matchNumber).padStart(2,' ') + ': ' +
    m.playerAName + ' (s' + m.playerASeed + ') [R3-' + m.bracketSlotA + '] vs ' +
    m.playerBName + ' (s' + m.playerBSeed + ') [R3-' + m.bracketSlotB + ']');
});
