#!/usr/bin/env node
// close_r4_and_open_r5.js
// 1. Determine R4 winners via determineCupMatchWinner (with full tie-break chain)
// 2. Write round scores + winner fields into round4Bracket.json, mark all completed
// 3. Close R4 in cupRounds.json (status='closed', closedBySummaryEmail=true)
// 4. Update participants: 16 winners get baselineScoreR5, 16 eliminated get eliminatedRound=4
// 5. Build round5Bracket.json (8 matches, standard paired bracket)
// 6. Open R5 in cupRounds.json (status='active')

'use strict';
var fs   = require('fs');
var path = require('path');
var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');

var {determineCupMatchWinner} = require('../js/yossiCup/determineCupMatchWinner');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var r4Bracket   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round4Bracket.json'), 'utf8'));
var rounds      = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cupRounds.json'), 'utf8'));
var liveData    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));

// R1 bracket for margin lookups
var r1Bracket = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round1Bracket.json'), 'utf8'));
var r2Bracket = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round2Bracket.json'), 'utf8'));
var r3Bracket = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round3Bracket.json'), 'utf8'));

var partBySeed = {};
participants.forEach(function(p) { partBySeed[p.seed] = p; });

var liveByName = {};
liveData.participants.forEach(function(p) { liveByName[p.name] = p; });

// Build margin lookup: for each seed, collect [marginR1, marginR2, marginR3]
// margin = |roundScoreA - roundScoreB| from the match where this seed won
function buildMarginHistory(brackets) {
  var margins = {}; // seed -> [marginR1, marginR2, marginR3]
  brackets.forEach(function(bracketRows, idx) {
    bracketRows.forEach(function(m) {
      if (!m.winnerSeed) return;
      var rsA = m.roundScoreA != null ? m.roundScoreA : 0;
      var rsB = m.roundScoreB != null ? m.roundScoreB : 0;
      var margin = Math.abs(rsA - rsB);
      if (!margins[m.winnerSeed]) margins[m.winnerSeed] = [];
      while (margins[m.winnerSeed].length < idx) margins[m.winnerSeed].push(0);
      margins[m.winnerSeed].push(margin);
    });
  });
  return margins;
}

var marginHistory = buildMarginHistory([r1Bracket, r2Bracket, r3Bracket]);

// Determine R4 winners
console.log('=== R4 RESULTS (round of 16 / 1/16 גמר) ===\n');
var r4Winners = []; // { matchNumber, winnerSeed, winnerName, tieBreakerUsed, margin, rsA, rsB }

r4Bracket.forEach(function(m) {
  var pA = partBySeed[m.playerASeed];
  var pB = partBySeed[m.playerBSeed];
  if (!pA || !pB) { console.error('Missing participant for match', m.matchNumber); return; }

  var lA = liveByName[pA.name];
  var lB = liveByName[pB.name];
  if (!lA || !lB) { console.error('Missing live data for', pA.name, 'or', pB.name); return; }

  var rsA = lA.total - pA.baselineScoreR4;
  var rsB = lB.total - pB.baselineScoreR4;
  var cumA = lA.total - pA.initialScore;
  var cumB = lB.total - pB.initialScore;

  var res = determineCupMatchWinner({
    playerA: m.playerASeed, playerB: m.playerBSeed,
    roundScoreA: rsA, roundScoreB: rsB,
    cumulativeCupScoreA: cumA, cumulativeCupScoreB: cumB,
    initialScoreA: pA.initialScore, initialScoreB: pB.initialScore,
    previousRoundMarginsA: marginHistory[m.playerASeed] || [],
    previousRoundMarginsB: marginHistory[m.playerBSeed] || [],
    seedA: m.playerASeed, seedB: m.playerBSeed
  });

  var winnerSeed = res.winnerId;
  var winnerName = winnerSeed === m.playerASeed ? m.playerAName : m.playerBName;
  var tb = res.tieBreakerUsed !== 'A' ? ' [TB-' + res.tieBreakerUsed + ']' : '';

  console.log('R4-' + String(m.matchNumber).padStart(2, ' ') + ': ' +
    's' + m.playerASeed + ' ' + m.playerAName.substring(0, 18) + ' ' +
    String(rsA).padStart(4) + ' vs ' + String(rsB).padStart(4) +
    ' s' + m.playerBSeed + ' ' + m.playerBName +
    '  → WINNER: s' + winnerSeed + ' ' + winnerName + tb);

  // Update R4 bracket row
  m.roundScoreA   = rsA;
  m.roundScoreB   = rsB;
  m.status        = 'completed';
  m.winnerSeed    = winnerSeed;
  m.winnerName    = winnerName;
  m.winnerReason  = 'official';
  m.tieBreakerUsed = res.tieBreakerUsed !== 'A' ? res.tieBreakerUsed : null;

  r4Winners.push({ matchNumber: m.matchNumber, winnerSeed: winnerSeed, winnerName: winnerName,
    tieBreakerUsed: res.tieBreakerUsed, margin: res.margin, rsA: rsA, rsB: rsB });
});

// Close R4 in cupRounds
var todayStr = new Date().toISOString();
var r4Round = rounds.find(function(r) { return r.round === 4; });
if (r4Round) {
  r4Round.status = 'closed';
  r4Round.closedBySummaryEmail = true;
  r4Round.summaryEmailDate = todayStr;
}

// Determine advancing seeds
var advancingSeeds = new Set(r4Winners.map(function(w) { return w.winnerSeed; }));
console.log('\nAdvancing to R5 (' + advancingSeeds.size + ' participants):');

// Update participants: winners get baselineScoreR5, losers get eliminated
var nowActive = 0, nowEliminated = 0;
participants.forEach(function(p) {
  if (p.status !== 'active' || p.baselineScoreR4 == null) return;

  if (advancingSeeds.has(p.seed)) {
    var lp = liveByName[p.name];
    p.baselineScoreR5 = lp ? lp.total : p.baselineScoreR4;
    nowActive++;
    console.log('  ADVANCING s' + p.seed + ' ' + p.name + ' baselineR5=' + p.baselineScoreR5);
  } else {
    p.status = 'eliminated';
    p.eliminatedRound = 4;
    delete p.baselineScoreR4;
    nowEliminated++;
    console.log('  ELIMINATED s' + p.seed + ' ' + p.name);
  }
});

console.log('\nAdvancing: ' + nowActive + ' | Eliminated: ' + nowEliminated);

// Build R5 bracket — pairs consecutive R4 matches: [1,2],[3,4],...,[15,16]
var R5_SEEDING = [[1,2],[3,4],[5,6],[7,8],[9,10],[11,12],[13,14],[15,16]];

var r4ByMatch = {};
r4Bracket.forEach(function(m) { r4ByMatch[m.matchNumber] = m; });

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

console.log('\n=== R5 BRACKET (שמינית גמר / round of 16) ===');
r5Bracket.forEach(function(m) {
  console.log('R5-' + String(m.matchNumber).padStart(2, ' ') + ': s' + m.playerASeed +
    ' ' + m.playerAName + ' [R4-' + m.bracketSlotA + '] vs s' + m.playerBSeed +
    ' ' + m.playerBName + ' [R4-' + m.bracketSlotB + ']');
});

// Open R5 in cupRounds
var r5Round = rounds.find(function(r) { return r.round === 5; });
if (r5Round) {
  r5Round.status = 'active';
}

// Write all files
fs.writeFileSync(path.join(DATA_DIR, 'round4Bracket.json'), JSON.stringify(r4Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'round5Bracket.json'), JSON.stringify(r5Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'participants.json'),  JSON.stringify(participants, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'cupRounds.json'),     JSON.stringify(rounds, null, 2), 'utf8');

console.log('\n✅ Written: round4Bracket.json, round5Bracket.json, participants.json, cupRounds.json');
console.log('Next: node scripts/patch_embedded_data.js  (then also add #ycBracketR5 support)');
