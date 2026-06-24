'use strict';
/**
 * close_round_and_advance.js
 *
 * Run: node scripts/close_round_and_advance.js
 *
 * 1. Reads current data.json scores → computes round 1 winners (determineCupMatchWinner)
 * 2. Writes updated data/yossiCup/round1Bracket.json  (winnerSeed, roundScoreA/B, status)
 * 3. Writes new     data/yossiCup/round2Bracket.json  (64 matches, paired by bracket slot)
 * 4. Updates        data/yossiCup/cupRounds.json       (round 1 closed, round 2 pending)
 * 5. Updates        data/yossiCup/participants.json    (eliminated flag, baselineScore for R2)
 * 6. Prints a full results report
 */

var path  = require('path');
var fs    = require('fs');
var root  = path.join(__dirname, '..');

// ── load utilities ──────────────────────────────────────────────────────────
var { normalizeParticipantName: norm }
  = require('../js/yossiCup/normalizeParticipantName');
var { determineCupMatchWinner }
  = require('../js/yossiCup/determineCupMatchWinner');

// ── load data ───────────────────────────────────────────────────────────────
var live         = require('../data.json');
var participants = require('../data/yossiCup/participants.json');
var r1Bracket    = require('../data/yossiCup/round1Bracket.json');
var rounds       = require('../data/yossiCup/cupRounds.json');

// ── build lookups ────────────────────────────────────────────────────────────
var liveByName = {};
live.participants.forEach(function(p){ liveByName[norm(p.name)] = p; });

var initBySeed = {}, nameByInitSeed = {};
participants.forEach(function(p){
  initBySeed[p.seed] = p.initialScore;
  nameByInitSeed[p.seed] = p.name;
});

// ── STEP 1: Close Round 1 ────────────────────────────────────────────────────
console.log('\n=== Closing Round 1 ===\n');

var winnerBySeed   = {};  // winnerSeed → { seed, name, roundScore, totalScore }
var eliminatedSeeds = new Set();
var errors = [];

var updatedR1 = r1Bracket.map(function(row) {
  if (row.isBye) {
    // BYE: auto-advance already marked in original data
    var p = liveByName[norm(row.playerAName)];
    winnerBySeed[row.playerASeed] = {
      seed: row.playerASeed,
      name: row.playerAName,
      roundScore: 0,
      totalScore: p ? p.total : initBySeed[row.playerASeed]
    };
    return Object.assign({}, row, { status: 'bye' });
  }

  var pA = liveByName[norm(row.playerAName)];
  var pB = liveByName[norm(row.playerBName)];

  if (!pA) { errors.push('NOT FOUND in live data: ' + row.playerAName); }
  if (!pB) { errors.push('NOT FOUND in live data: ' + row.playerBName); }

  var totA  = pA ? pA.total : initBySeed[row.playerASeed];
  var totB  = pB ? pB.total : initBySeed[row.playerBSeed];
  var initA = initBySeed[row.playerASeed];
  var initB = initBySeed[row.playerBSeed];
  var rsA   = totA - initA;
  var rsB   = totB - initB;

  var res = determineCupMatchWinner({
    playerA: row.playerASeed,
    playerB: row.playerBSeed,
    roundScoreA: rsA,
    roundScoreB: rsB,
    cumulativeCupScoreA: rsA,
    cumulativeCupScoreB: rsB,
    initialScoreA: initA,
    initialScoreB: initB,
    previousRoundMarginsA: [],
    previousRoundMarginsB: [],
    seedA: row.playerASeed,
    seedB: row.playerBSeed
  });

  var winSeed = res.winnerId;
  var winName = winSeed === row.playerASeed ? row.playerAName : row.playerBName;
  var loseSeed = winSeed === row.playerASeed ? row.playerBSeed : row.playerASeed;

  winnerBySeed[winSeed] = {
    seed: winSeed,
    name: winName,
    roundScore: winSeed === row.playerASeed ? rsA : rsB,
    totalScore: winSeed === row.playerASeed ? totA : totB
  };
  eliminatedSeeds.add(loseSeed);

  console.log('Match #' + row.matchNumber + ': '
    + row.playerAName + ' (+' + rsA + ') vs ' + row.playerBName + ' (+' + rsB + ')'
    + ' → WIN: ' + winName
    + (res.tieBreakerUsed && res.tieBreakerUsed !== 'A'
        ? '  [שובר שוויון ' + res.tieBreakerUsed + ']' : ''));

  return Object.assign({}, row, {
    winnerSeed:     winSeed,
    winnerName:     winName,
    winnerReason:   res.reason,
    roundScoreA:    rsA,
    roundScoreB:    rsB,
    tieBreakerUsed: res.tieBreakerUsed || null,
    status:         'completed'
  });
});

if (errors.length) {
  console.error('\n⚠️  ERRORS:');
  errors.forEach(function(e){ console.error('  ' + e); });
  process.exit(1);
}

var advancingSeeds = Object.keys(winnerBySeed).map(Number);
console.log('\n✅ Round 1 closed: ' + advancingSeeds.length + ' participants advance, '
  + eliminatedSeeds.size + ' eliminated.');

// ── STEP 2: Generate Round 2 Bracket ────────────────────────────────────────
console.log('\n=== Generating Round 2 Bracket ===\n');

// slot(row) = min(playerASeed, playerBSeed) — i.e., the original "lower seed" position
// That's always playerASeed since we put the lower seed as player A.
// The slot ranges 1..128, and round 2 pairs slot X vs slot (129-X).

var slotToWinner = {};   // slot → { seed, name, roundScore, totalScore }
r1Bracket.forEach(function(row) {
  var slot = row.playerASeed;  // always the lower of the two seeds
  slotToWinner[slot] = winnerBySeed[
    updatedR1.find(function(r){ return r.matchNumber === row.matchNumber; }).winnerSeed
  ];
});

var r2Bracket = [];
for (var matchNum = 1; matchNum <= 64; matchNum++) {
  var slotA = matchNum;          // slot 1..64
  var slotB = 129 - matchNum;    // slot 128..65

  var wA = slotToWinner[slotA];
  var wB = slotToWinner[slotB];

  if (!wA) { errors.push('No winner for slot ' + slotA); continue; }
  if (!wB) { errors.push('No winner for slot ' + slotB); continue; }

  r2Bracket.push({
    id:           'r2-m' + String(matchNum).padStart(3, '0'),
    round:        2,
    matchNumber:  matchNum,
    bracketSlotA: slotA,
    bracketSlotB: slotB,
    playerASeed:  wA.seed,
    playerAName:  wA.name,
    playerBSeed:  wB.seed,
    playerBName:  wB.name,
    isBye:        false,
    status:       'pending',
    winnerSeed:   null,
    winnerName:   null,
    winnerReason: null,
    roundScoreA:  null,
    roundScoreB:  null,
    tieBreakerUsed: null
  });

  console.log('R2 Match #' + matchNum + ': ' + wA.name + ' (seed ' + wA.seed + ', slot ' + slotA + ')'
    + ' vs ' + wB.name + ' (seed ' + wB.seed + ', slot ' + slotB + ')');
}

if (errors.length) {
  console.error('\n⚠️  ERRORS generating R2:');
  errors.forEach(function(e){ console.error('  ' + e); });
  process.exit(1);
}

console.log('\n✅ Round 2 bracket: ' + r2Bracket.length + ' matches generated.');

// ── STEP 3: Update Rounds ────────────────────────────────────────────────────
var today = new Date().toISOString().slice(0, 10);
var updatedRounds = rounds.map(function(r) {
  if (r.round === 1) {
    return Object.assign({}, r, {
      status:              'closed',
      closedBySummaryEmail: false,  // closed via script, not Yossi email
      summaryEmailDate:    today
    });
  }
  if (r.round === 2) {
    return Object.assign({}, r, { status: 'pending' });
  }
  return r;
});

// ── STEP 4: Update Participants ───────────────────────────────────────────────
var updatedParticipants = participants.map(function(p) {
  var w = winnerBySeed[p.seed];
  if (eliminatedSeeds.has(p.seed)) {
    return Object.assign({}, p, {
      status: 'eliminated',
      eliminatedRound: 1
    });
  }
  if (w) {
    // Advancing: set R2 baseline score
    return Object.assign({}, p, {
      status: 'active',
      autoQualifiedRound2: p.seed <= 14,
      baselineScoreR2: w.totalScore  // score at close of R1 = new baseline for R2
    });
  }
  return p;
});

// ── WRITE FILES ──────────────────────────────────────────────────────────────
function write(relPath, data) {
  var fullPath = path.join(root, relPath);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('Written: ' + relPath);
}

console.log('\n=== Writing files ===\n');
write('data/yossiCup/round1Bracket.json',  updatedR1);
write('data/yossiCup/round2Bracket.json',  r2Bracket);
write('data/yossiCup/cupRounds.json',       updatedRounds);
write('data/yossiCup/participants.json',    updatedParticipants);

// ── SUMMARY ──────────────────────────────────────────────────────────────────
console.log('\n=== Summary ===');
console.log('Round 1:');
console.log('  Winners:    ' + advancingSeeds.length);
console.log('  Eliminated: ' + eliminatedSeeds.size);
console.log('Round 2:');
console.log('  Matches:    ' + r2Bracket.length);
console.log('  Date:       ' + today);

// Print upsets (higher seed beat lower seed)
var upsets = updatedR1.filter(function(r) {
  return !r.isBye && r.winnerSeed && r.playerBSeed < r.playerASeed
    ? false  // would mean we mixed up A/B labeling
    : !r.isBye && r.winnerSeed > 128; // winner was the "weaker" seed (>128)
});
if (upsets.length) {
  console.log('\n⚡ Upsets (' + upsets.length + ' higher seeds won):');
  upsets.forEach(function(r){
    console.log('  ' + r.winnerName + ' (seed ' + r.winnerSeed + ') beat seed ' + (r.winnerSeed === r.playerBSeed ? r.playerASeed : r.playerBSeed));
  });
}
