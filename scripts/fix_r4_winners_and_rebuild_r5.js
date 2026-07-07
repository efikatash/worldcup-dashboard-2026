#!/usr/bin/env node
// fix_r4_winners_and_rebuild_r5.js
// Corrects 5 wrong R4 winners per Yossi's official R5 bracket image,
// updates participant statuses/baselines, rebuilds round5Bracket.json.

'use strict';
var fs   = require('fs');
var path = require('path');
var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var r4Bracket   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round4Bracket.json'), 'utf8'));
var liveData    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));

var partBySeed = {};
participants.forEach(function(p) { partBySeed[p.seed] = p; });
var liveByName = {};
liveData.participants.forEach(function(p) { liveByName[p.name] = p; });

function nameOf(seed) {
  return partBySeed[seed] ? partBySeed[seed].name : '(s' + seed + ')';
}

// Official corrections: [R4 matchNumber, correctWinnerSeed]
// Derived from Yossi's official R5 bracket image
var corrections = [
  [1,  65],   // was s32 יריב וישנו  → s65 מור גרשגורן
  [6,  84],   // was s205 שני בארד   → s84 אורי קיין
  [10, 79],   // was s175 רועי הדר   → s79 יואב יוקלסון
  [11,  7],   // was s26 דרור רסקין  → s7 שמוליק תמיר
  [15, 70],   // was s38 גיא טלסניק  → s70 חוני במנלקר+רן בטאט
];

var r4ByMatch = {};
r4Bracket.forEach(function(m) { r4ByMatch[m.matchNumber] = m; });

console.log('=== R4 WINNER CORRECTIONS ===\n');
corrections.forEach(function(c) {
  var matchNum = c[0], correctSeed = c[1];
  var m = r4ByMatch[matchNum];
  if (!m) { console.error('ERROR: R4 match', matchNum, 'not found'); return; }
  console.log('R4-' + matchNum + ': WRONG s' + m.winnerSeed + ' ' + m.winnerName +
    ' → CORRECT s' + correctSeed + ' ' + nameOf(correctSeed));
  m.winnerSeed   = correctSeed;
  m.winnerName   = nameOf(correctSeed);
  m.winnerReason = 'official';
  m.tieBreakerUsed = null;
});

// Determine newly advancing seeds
var advancingSeeds = new Set();
r4Bracket.forEach(function(m) { if (m.winnerSeed) advancingSeeds.add(m.winnerSeed); });

console.log('\n=== PARTICIPANT STATUS UPDATES ===\n');

// Update participants
var nowActive = 0, nowEliminated = 0;
participants.forEach(function(p) {
  // Only touch R4 participants (have baselineScoreR4)
  if (p.baselineScoreR4 == null && p.baselineScoreR5 == null && p.eliminatedRound !== 4) return;
  // Covers: currently active (baselineScoreR5) or just eliminated at R4

  var shouldBeActive = advancingSeeds.has(p.seed);
  var isActive = p.status === 'active' && p.baselineScoreR5 != null;
  var isElimR4 = p.status === 'eliminated' && p.eliminatedRound === 4;

  if (shouldBeActive && !isActive) {
    // Was wrongly eliminated — restore as active with fresh R5 baseline
    var lp = liveByName[p.name];
    p.status = 'active';
    delete p.eliminatedRound;
    p.baselineScoreR5 = lp ? lp.total : null;
    // restore baselineScoreR4 — was deleted when eliminated
    // (it's already in r4Bracket roundScoreA/B so we can reconstruct if needed)
    console.log('  → RESTORED TO ACTIVE s' + p.seed + ' ' + p.name + ' baselineR5=' + p.baselineScoreR5);
    nowActive++;
  } else if (!shouldBeActive && isActive) {
    // Was wrongly advanced — eliminate
    p.status = 'eliminated';
    p.eliminatedRound = 4;
    delete p.baselineScoreR5;
    console.log('  → NOW ELIMINATED s' + p.seed + ' ' + p.name);
    nowEliminated++;
  }
});

console.log('\nRestored to active: ' + nowActive + ' | Newly eliminated: ' + nowEliminated);

// Rebuild R5 bracket from corrected R4 winners
// R5_SEEDING: consecutive R4 match pairs [1,2],[3,4],...,[15,16]
var R5_SEEDING = [[1,2],[3,4],[5,6],[7,8],[9,10],[11,12],[13,14],[15,16]];

var r5Bracket = [];
R5_SEEDING.forEach(function(pair, i) {
  var matchNum = i + 1;
  var slotA = pair[0], slotB = pair[1];
  var mA = r4ByMatch[slotA], mB = r4ByMatch[slotB];
  if (!mA || !mB) { console.error('Missing R4 match for R5 slot', slotA, slotB); return; }

  var seedA = mA.winnerSeed, seedB = mB.winnerSeed;
  r5Bracket.push({
    id:             'r5-m' + String(matchNum).padStart(3, '0'),
    round:          5,
    matchNumber:    matchNum,
    bracketSlotA:   slotA,
    bracketSlotB:   slotB,
    playerASeed:    seedA,
    playerAName:    mA.winnerName,
    playerBSeed:    seedB,
    playerBName:    mB.winnerName,
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

console.log('\n=== CORRECTED R5 BRACKET (שמינית גמר) ===');
r5Bracket.forEach(function(m) {
  console.log('R5-' + String(m.matchNumber).padStart(2,' ') + ': s' + m.playerASeed +
    ' ' + m.playerAName + ' vs s' + m.playerBSeed + ' ' + m.playerBName);
});

// Write files
fs.writeFileSync(path.join(DATA_DIR, 'round4Bracket.json'), JSON.stringify(r4Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'round5Bracket.json'), JSON.stringify(r5Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'participants.json'),  JSON.stringify(participants, null, 2), 'utf8');
console.log('\n✅ Written: round4Bracket.json, round5Bracket.json, participants.json');
console.log('Next: node scripts/patch_embedded_data.js');
