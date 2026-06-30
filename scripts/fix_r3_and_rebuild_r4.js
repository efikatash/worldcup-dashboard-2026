#!/usr/bin/env node
// fix_r3_and_rebuild_r4.js
// Corrects 10 wrong R3 winners (per Yossi's official R4 bracket image),
// updates participant statuses/baselines, and rebuilds round4Bracket.json.

var fs   = require('fs');
var path = require('path');
var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var r3Bracket   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round3Bracket.json'), 'utf8'));
var liveData    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));

var seedToParticipant = {};
participants.forEach(function(p) { seedToParticipant[p.seed] = p; });

function nameOf(seed) {
  return seedToParticipant[seed] ? seedToParticipant[seed].name : '(s' + seed + ')';
}

function liveTotal(seed) {
  var p = seedToParticipant[seed];
  if (!p) return null;
  var dp = liveData.participants.find(function(x) { return x.name === p.name; });
  return dp ? dp.total : null;
}

// Official R3 corrections: [matchNumber, correctWinnerSeed]
// Derived from Yossi's official R4 bracket image
var corrections = [
  [2,   63],   // was s127 שלומי+הראל ביגר → correct: s63 שלומי נטוביץ
  [4,   61],   // was s125 אביחי+יואב קראבץ → correct: s61 איתן גלאי
  [6,   70],   // was s6 אפי קטש            → correct: s70 חוני במנמלקר+רן בטאט
  [11,  54],   // was s11 רני רחמים          → correct: s54 תומר אמינפור
  [12,  53],   // was s140 איל לוי           → correct: s53 שלום שאער
  [14,  51],   // was s14 אוראל ויצמן        → correct: s51 עדי אדיוס
  [21,  44],   // was s108 קובי ארליך        → correct: s44 עומר עובדיה
  [22, 171],   // was s107 עומר מנור+גיל ויובל שדות → correct: s171 יוסי אדרי
  [23,  42],   // was s151 אביעד צרפתי       → correct: s42 רועי איזן
  [31,  34],   // was s31 אריק גליקמן        → correct: s34 אלעד מור+אביטן
];

var correctionMap = {};
corrections.forEach(function(c) { correctionMap[c[0]] = c[1]; });

// Apply corrections to R3 bracket
var r3ByMatch = {};
r3Bracket.forEach(function(m) { r3ByMatch[m.matchNumber] = m; });

corrections.forEach(function(c) {
  var matchNum = c[0];
  var correctWinner = c[1];
  var m = r3ByMatch[matchNum];
  if (!m) { console.error('ERROR: R3 match', matchNum, 'not found'); return; }
  console.log('R3-' + matchNum + ': CORRECT s' + m.winnerSeed + ' ' + m.winnerName +
    ' → s' + correctWinner + ' ' + nameOf(correctWinner));
  m.winnerSeed   = correctWinner;
  m.winnerName   = nameOf(correctWinner);
  m.winnerReason = 'official';
});

// Determine new advancing set
var advancingSeeds = new Set();
r3Bracket.forEach(function(m) { if (m.winnerSeed) advancingSeeds.add(m.winnerSeed); });

// Update participants
var nowActive = 0, nowEliminated = 0;
participants.forEach(function(p) {
  // Only touch participants that were in R3 (have baselineScoreR3)
  if (p.baselineScoreR3 == null) return;

  if (advancingSeeds.has(p.seed)) {
    // Should be active with baselineScoreR4
    if (p.status !== 'active' || p.baselineScoreR4 == null) {
      p.status = 'active';
      delete p.eliminatedRound;
      var tot = liveTotal(p.seed);
      p.baselineScoreR4 = tot != null ? tot : p.baselineScoreR3;
      console.log('  → ADVANCING s' + p.seed + ' ' + p.name + ' baselineR4=' + p.baselineScoreR4);
      nowActive++;
    }
  } else {
    // Should be eliminated
    if (p.status !== 'eliminated') {
      p.status = 'eliminated';
      p.eliminatedRound = 3;
      delete p.baselineScoreR4;
      console.log('  → ELIMINATED s' + p.seed + ' ' + p.name);
      nowEliminated++;
    }
  }
});

console.log('\nStatus updates — newly active: ' + nowActive + ' | newly eliminated: ' + nowEliminated);
console.log('Total R4 participants: ' + advancingSeeds.size);

// Rebuild R4 bracket
var R4_SEEDING = [
  [1,32],[16,17],[8,25],[9,24],[4,29],[13,20],[5,28],[12,21],
  [2,31],[15,18],[7,26],[10,23],[3,30],[14,19],[6,27],[11,22]
];

var r4Bracket = [];
R4_SEEDING.forEach(function(pair, i) {
  var matchNum = i + 1;
  var slotA = pair[0], slotB = pair[1];
  var mA = r3ByMatch[slotA];
  var mB = r3ByMatch[slotB];
  if (!mA || !mB) { console.error('Missing R3 match', matchNum); return; }

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

console.log('\n=== CORRECTED R4 BRACKET (Round of 16) ===');
r4Bracket.forEach(function(m) {
  console.log('R4-' + String(m.matchNumber).padStart(2,' ') + ': s' + m.playerASeed +
    ' ' + m.playerAName + ' [R3-' + m.bracketSlotA + '] vs s' + m.playerBSeed +
    ' ' + m.playerBName + ' [R3-' + m.bracketSlotB + ']');
});

// Write all files
fs.writeFileSync(path.join(DATA_DIR, 'round3Bracket.json'), JSON.stringify(r3Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'round4Bracket.json'), JSON.stringify(r4Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'participants.json'),  JSON.stringify(participants, null, 2), 'utf8');
console.log('\nWritten: round3Bracket.json, round4Bracket.json, participants.json');
console.log('Next: node scripts/patch_embedded_data.js');
