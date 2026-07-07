#!/usr/bin/env node
// close_r5_and_open_r6.js
// 1. Determine R5 winners via determineCupMatchWinner
// 2. Write round scores + winner fields into round5Bracket.json
// 3. Close R5 in cupRounds.json, open R6
// 4. Update participants: 8 winners get baselineScoreR6, 8 eliminated at round 5
// 5. Build round6Bracket.json (4 matches)

'use strict';
var fs   = require('fs');
var path = require('path');
var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');

var {determineCupMatchWinner} = require('../js/yossiCup/determineCupMatchWinner');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var r5Bracket   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round5Bracket.json'), 'utf8'));
var rounds      = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cupRounds.json'), 'utf8'));
var liveData    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));

var r1 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round1Bracket.json'), 'utf8'));
var r2 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round2Bracket.json'), 'utf8'));
var r3 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round3Bracket.json'), 'utf8'));
var r4 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round4Bracket.json'), 'utf8'));

var partBySeed = {};
participants.forEach(function(p) { partBySeed[p.seed] = p; });
var liveByName = {};
liveData.participants.forEach(function(p) { liveByName[p.name] = p; });

function buildMargins(brackets) {
  var m = {};
  brackets.forEach(function(rows, idx) {
    rows.forEach(function(match) {
      if (!match.winnerSeed) return;
      var rsA = match.roundScoreA || 0, rsB = match.roundScoreB || 0;
      if (!m[match.winnerSeed]) m[match.winnerSeed] = [];
      while (m[match.winnerSeed].length < idx) m[match.winnerSeed].push(0);
      m[match.winnerSeed].push(Math.abs(rsA - rsB));
    });
  });
  return m;
}
var marginHistory = buildMargins([r1, r2, r3, r4]);

console.log('=== R5 RESULTS (שמינית גמר) ===\n');
var r5Winners = [];

r5Bracket.forEach(function(m) {
  var pA = partBySeed[m.playerASeed], pB = partBySeed[m.playerBSeed];
  var lA = liveByName[m.playerAName], lB = liveByName[m.playerBName];
  if (!pA || !pB || !lA || !lB) { console.error('Missing data for match', m.matchNumber); return; }

  var rsA = lA.total - pA.baselineScoreR5;
  var rsB = lB.total - pB.baselineScoreR5;
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

  console.log('R5-' + String(m.matchNumber).padStart(2) + ': s' + m.playerASeed + ' ' + m.playerAName +
    ' ' + rsA + ' vs ' + rsB + ' s' + m.playerBSeed + ' ' + m.playerBName +
    ' → WINNER: s' + winnerSeed + ' ' + winnerName + tb);

  m.roundScoreA   = rsA;
  m.roundScoreB   = rsB;
  m.status        = 'completed';
  m.winnerSeed    = winnerSeed;
  m.winnerName    = winnerName;
  m.winnerReason  = 'official';
  m.tieBreakerUsed = res.tieBreakerUsed !== 'A' ? res.tieBreakerUsed : null;

  r5Winners.push({ matchNumber: m.matchNumber, winnerSeed: winnerSeed, winnerName: winnerName });
});

// Close R5, open R6
var todayStr = new Date().toISOString();
var r5Round = rounds.find(function(r) { return r.round === 5; });
if (r5Round) { r5Round.status = 'closed'; r5Round.closedBySummaryEmail = true; r5Round.summaryEmailDate = todayStr; }
var r6Round = rounds.find(function(r) { return r.round === 6; });
if (r6Round) { r6Round.status = 'active'; }

// Update participants
var advancingSeeds = new Set(r5Winners.map(function(w) { return w.winnerSeed; }));
console.log('\nAdvancing to R6 (' + advancingSeeds.size + '):');
var nowActive = 0, nowEliminated = 0;

participants.forEach(function(p) {
  if (p.status !== 'active' || p.baselineScoreR5 == null) return;

  if (advancingSeeds.has(p.seed)) {
    var lp = liveByName[p.name];
    p.baselineScoreR6 = lp ? lp.total : p.baselineScoreR5;
    nowActive++;
    console.log('  ADVANCING s' + p.seed + ' ' + p.name + ' baselineR6=' + p.baselineScoreR6);
  } else {
    p.status = 'eliminated';
    p.eliminatedRound = 5;
    delete p.baselineScoreR5;
    nowEliminated++;
    console.log('  ELIMINATED s' + p.seed + ' ' + p.name);
  }
});
console.log('Advancing: ' + nowActive + ' | Eliminated: ' + nowEliminated);

// Build R6 bracket — pairs consecutive R5 matches: [1,2],[3,4],[5,6],[7,8]
var R6_SEEDING = [[1,2],[3,4],[5,6],[7,8]];
var r5ByMatch = {};
r5Bracket.forEach(function(m) { r5ByMatch[m.matchNumber] = m; });

var r6Bracket = [];
R6_SEEDING.forEach(function(pair, i) {
  var matchNum = i + 1;
  var slotA = pair[0], slotB = pair[1];
  var mA = r5ByMatch[slotA], mB = r5ByMatch[slotB];
  if (!mA || !mB) { console.error('Missing R5 match for R6 slot', slotA, slotB); return; }

  r6Bracket.push({
    id:             'r6-m' + String(matchNum).padStart(3, '0'),
    round:          6,
    matchNumber:    matchNum,
    bracketSlotA:   slotA,
    bracketSlotB:   slotB,
    playerASeed:    mA.winnerSeed,
    playerAName:    mA.winnerName,
    playerBSeed:    mB.winnerSeed,
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

console.log('\n=== R6 BRACKET (רבע גמר) ===');
r6Bracket.forEach(function(m) {
  console.log('R6-' + m.matchNumber + ': s' + m.playerASeed + ' ' + m.playerAName +
    ' [R5-' + m.bracketSlotA + '] vs s' + m.playerBSeed + ' ' + m.playerBName +
    ' [R5-' + m.bracketSlotB + ']');
});

// Write all files
fs.writeFileSync(path.join(DATA_DIR, 'round5Bracket.json'), JSON.stringify(r5Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'round6Bracket.json'), JSON.stringify(r6Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'participants.json'),  JSON.stringify(participants, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'cupRounds.json'),     JSON.stringify(rounds, null, 2), 'utf8');
console.log('\n✅ Written: round5Bracket.json, round6Bracket.json, participants.json, cupRounds.json');
console.log('Next: node scripts/patch_embedded_data.js');
