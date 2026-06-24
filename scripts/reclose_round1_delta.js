'use strict';
/**
 * reclose_round1_delta.js
 *
 * Closes Round 1 using the DELTA from matchday 2 only:
 *   roundScoreA = data.json[participant].total - initialScore
 *
 * initialScore was captured from the ranking Excel on 2026-06-18 (before
 * matchday 2 started), so the delta = points earned in matchday 2 ONLY
 * (game predictions + open questions that resolved during matchday 2).
 *
 * Requires up-to-date data.json with full matchday 2 results.
 *
 * Usage: node scripts/reclose_round1_delta.js
 * Then:  node scripts/patch_embedded_data.js
 * Then:  git add -A && git commit && git push
 */

var path = require('path');
var fs   = require('fs');
var root = path.join(__dirname, '..');

var { normalizeParticipantName: norm } = require('../js/yossiCup/normalizeParticipantName');
var { determineCupMatchWinner }        = require('../js/yossiCup/determineCupMatchWinner');

var live         = require('../data.json');
var participants = require('../data/yossiCup/participants.json');
var r1Bracket    = require('../data/yossiCup/round1Bracket.json');

// Build lookups
var liveByName = {};
live.participants.forEach(function (p) { liveByName[norm(p.name)] = p; });

var initBySeed = {};
participants.forEach(function (p) { initBySeed[p.seed] = p.initialScore; });

console.log('\n=== Closing Round 1 by MATCHDAY-2 DELTA (liveTotal - initialScore) ===\n');
console.log('data.json generatedAt:', live.meta && live.meta.generatedAt);
console.log('matchday2 verified matches in data.json: checking...\n');

var winnerBySeed    = {};
var eliminatedSeeds = new Set();
var errors          = [];
var corrections     = 0;
var missing         = 0;

var updatedR1 = r1Bracket.map(function (row) {
  if (row.isBye) {
    var byeP = liveByName[norm(row.playerAName)];
    winnerBySeed[row.playerASeed] = {
      seed: row.playerASeed, name: row.playerAName,
      roundScore: 0,
      totalScore: byeP ? Number(byeP.total) : (initBySeed[row.playerASeed] || 0)
    };
    return Object.assign({}, row, { status: 'bye', roundScoreA: 0 });
  }

  var pA = liveByName[norm(row.playerAName)];
  var pB = liveByName[norm(row.playerBName)];

  if (!pA) { errors.push('NOT FOUND: ' + row.playerAName); missing++; }
  if (!pB) { errors.push('NOT FOUND: ' + row.playerBName); missing++; }
  if (!pA || !pB) return row;

  var initA = initBySeed[row.playerASeed];
  var initB = initBySeed[row.playerBSeed];
  var totA  = Number(pA.total);
  var totB  = Number(pB.total);

  // Round 1 score = matchday 2 delta ONLY
  var rsA = totA - initA;
  var rsB = totB - initB;

  if (rsA < 0) {
    errors.push('WARNING: negative delta for ' + row.playerAName + ' (init=' + initA + ' live=' + totA + ')');
    rsA = 0;
  }
  if (rsB < 0) {
    errors.push('WARNING: negative delta for ' + row.playerBName + ' (init=' + initB + ' live=' + totB + ')');
    rsB = 0;
  }

  var res = determineCupMatchWinner({
    playerA: row.playerASeed, playerB: row.playerBSeed,
    roundScoreA: rsA, roundScoreB: rsB,
    cumulativeCupScoreA: rsA, cumulativeCupScoreB: rsB,
    initialScoreA: initA, initialScoreB: initB,
    previousRoundMarginsA: [], previousRoundMarginsB: [],
    seedA: row.playerASeed, seedB: row.playerBSeed
  });

  var newWinSeed  = res.winnerId;
  var newWinName  = newWinSeed === row.playerASeed ? row.playerAName : row.playerBName;
  var newLoseSeed = newWinSeed === row.playerASeed ? row.playerBSeed : row.playerASeed;

  var oldWinSeed = row.winnerSeed;
  var changed = (newWinSeed !== oldWinSeed);
  if (changed) {
    corrections++;
    var loseRs = newWinSeed === row.playerASeed ? rsB : rsA;
    console.log('CORRECTED #' + row.matchNumber + ': '
      + row.playerAName + '(+' + rsA + ') vs ' + row.playerBName + '(+' + rsB + ')'
      + ' | OLD winner: ' + (row.winnerName || '?') + ' → NEW: ' + newWinName);
  }

  winnerBySeed[newWinSeed] = {
    seed: newWinSeed, name: newWinName,
    roundScore: newWinSeed === row.playerASeed ? rsA : rsB,
    totalScore: newWinSeed === row.playerASeed ? totA : totB
  };
  eliminatedSeeds.add(newLoseSeed);

  return Object.assign({}, row, {
    roundScoreA:    rsA,
    roundScoreB:    rsB,
    winnerSeed:     newWinSeed,
    winnerName:     newWinName,
    winnerReason:   res.reason,
    tieBreakerUsed: res.tieBreakerUsed || null,
    status:         'completed'
  });
});

if (errors.length) {
  console.error('\n⚠️  ERRORS / WARNINGS:');
  errors.forEach(function (e) { console.error('  ' + e); });
  if (missing > 0) { console.error('\nAborting due to missing participants.'); process.exit(1); }
}

console.log('\n✅ ' + corrections + ' corrections. '
  + Object.keys(winnerBySeed).length + ' advancing, '
  + eliminatedSeeds.size + ' eliminated.');

// Check upsets
var upsets = updatedR1.filter(function (r) {
  return !r.isBye && r.winnerSeed && r.winnerSeed > r.playerASeed;
});
console.log('⚡ Upsets (higher seed won): ' + upsets.length);

// ── Regenerate Round 2 Bracket ─────────────────────────────────────────────
console.log('\n=== Regenerating Round 2 Bracket ===\n');

var slotToWinner = {};
r1Bracket.forEach(function (row) {
  var slot    = row.playerASeed;
  var updated = updatedR1.find(function (r) { return r.matchNumber === row.matchNumber; });
  slotToWinner[slot] = winnerBySeed[updated.winnerSeed];
});

var r2Errors = [];
var r2Bracket = [];
for (var matchNum = 1; matchNum <= 64; matchNum++) {
  var slotA = matchNum;
  var slotB = 129 - matchNum;
  var wA = slotToWinner[slotA];
  var wB = slotToWinner[slotB];
  if (!wA) { r2Errors.push('No winner for slot ' + slotA); continue; }
  if (!wB) { r2Errors.push('No winner for slot ' + slotB); continue; }

  r2Bracket.push({
    id:             'r2-m' + String(matchNum).padStart(3, '0'),
    round:          2,
    matchNumber:    matchNum,
    bracketSlotA:   slotA,
    bracketSlotB:   slotB,
    playerASeed:    wA.seed,
    playerAName:    wA.name,
    playerBSeed:    wB.seed,
    playerBName:    wB.name,
    isBye:          false,
    status:         'pending',
    winnerSeed:     null,
    winnerName:     null,
    winnerReason:   null,
    roundScoreA:    null,
    roundScoreB:    null,
    tieBreakerUsed: null
  });

  console.log('R2 #' + matchNum + ': ' + wA.name + '(s' + wA.seed + ') vs '
    + wB.name + '(s' + wB.seed + ')');
}

if (r2Errors.length) { console.error('R2 ERRORS:', r2Errors); process.exit(1); }

// ── Update Participants ────────────────────────────────────────────────────
var updatedParticipants = participants.map(function (p) {
  if (eliminatedSeeds.has(p.seed)) {
    return Object.assign({}, p, { status: 'eliminated', eliminatedRound: 1 });
  }
  var w = winnerBySeed[p.seed];
  if (w) {
    // baselineScoreR2 = total score at R1 close = start of R2 window
    return Object.assign({}, p, {
      status:             'active',
      autoQualifiedRound2: p.seed <= 14,
      baselineScoreR2:    w.totalScore
    });
  }
  return p; // BYE seeds 1-14 — handled by winnerBySeed if they have a live total
});

// ── Write Files ────────────────────────────────────────────────────────────
function write(rel, data) {
  fs.writeFileSync(path.join(root, rel), JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('\nWritten: ' + rel);
}

write('data/yossiCup/round1Bracket.json', updatedR1);
write('data/yossiCup/round2Bracket.json', r2Bracket);
write('data/yossiCup/participants.json',  updatedParticipants);

console.log('\n✅ Done. Run next:\n  node scripts/patch_embedded_data.js\n  git add -A && git commit -m "fix: reclose R1 by matchday-2 delta" && git push');
