'use strict';
/**
 * reclose_round1_by_total.js
 *
 * Re-closes Round 1 using TOTAL score (initialScore + roundDelta) as the
 * decisive metric. The original close used only the delta from initialScore,
 * which was wrong: initialScore was captured mid-tournament so participants
 * who joined late or had low early scores looked artificially "stronger."
 *
 * Rule: Round 1 winner = higher total score at round close.
 *       Total = participants.json initialScore + round1Bracket.json roundScore
 *
 * This does NOT touch data.json — it re-uses only frozen data.
 */

var path = require('path');
var fs   = require('fs');
var root = path.join(__dirname, '..');

var { determineCupMatchWinner } = require('../js/yossiCup/determineCupMatchWinner');

var r1Bracket    = require('../data/yossiCup/round1Bracket.json');
var participants = require('../data/yossiCup/participants.json');
var rounds       = require('../data/yossiCup/cupRounds.json');

// Build initialScore lookup by seed
var initBySeed = {};
participants.forEach(function (p) { initBySeed[p.seed] = p.initialScore; });

// ── Re-close Round 1 ─────────────────────────────────────────────────────────
console.log('\n=== Re-closing Round 1 by TOTAL score (initialScore + roundDelta) ===\n');

var winnerBySeed    = {};
var eliminatedSeeds = new Set();
var errors          = [];
var corrections     = 0;

var updatedR1 = r1Bracket.map(function (row) {
  if (row.isBye) {
    winnerBySeed[row.playerASeed] = {
      seed: row.playerASeed, name: row.playerAName,
      totalScore: initBySeed[row.playerASeed] || 0
    };
    return Object.assign({}, row, { status: 'bye' });
  }

  var initA = initBySeed[row.playerASeed];
  var initB = initBySeed[row.playerBSeed];

  if (initA == null) { errors.push('No initialScore for seed ' + row.playerASeed + ' (' + row.playerAName + ')'); }
  if (initB == null) { errors.push('No initialScore for seed ' + row.playerBSeed + ' (' + row.playerBName + ')'); }

  // Total at R1 close = initialScore + stored roundScore (delta at close time)
  var totA = initA + row.roundScoreA;
  var totB = initB + row.roundScoreB;

  // Use total as "roundScore" so tie-breaker A = higher total wins
  var res = determineCupMatchWinner({
    playerA: row.playerASeed, playerB: row.playerBSeed,
    roundScoreA: totA, roundScoreB: totB,
    cumulativeCupScoreA: totA, cumulativeCupScoreB: totB,
    initialScoreA: initA, initialScoreB: initB,
    previousRoundMarginsA: [], previousRoundMarginsB: [],
    seedA: row.playerASeed, seedB: row.playerBSeed
  });

  var newWinSeed  = res.winnerId;
  var newWinName  = newWinSeed === row.playerASeed ? row.playerAName : row.playerBName;
  var newLoseSeed = newWinSeed === row.playerASeed ? row.playerBSeed : row.playerASeed;

  var changed = (newWinSeed !== row.winnerSeed);
  if (changed) {
    corrections++;
    console.log('CORRECTED #' + row.matchNumber + ': '
      + row.playerAName + '(' + totA + ') vs ' + row.playerBName + '(' + totB + ')'
      + ' | OLD winner: ' + row.winnerName + ' → NEW winner: ' + newWinName);
  }

  winnerBySeed[newWinSeed] = {
    seed: newWinSeed, name: newWinName,
    totalScore: newWinSeed === row.playerASeed ? totA : totB
  };
  eliminatedSeeds.add(newLoseSeed);

  return Object.assign({}, row, {
    winnerSeed:     newWinSeed,
    winnerName:     newWinName,
    winnerReason:   res.reason,
    tieBreakerUsed: res.tieBreakerUsed || null,
    status:         'completed'
  });
});

if (errors.length) {
  console.error('\n⚠️  ERRORS:'); errors.forEach(function (e) { console.error('  ' + e); });
  process.exit(1);
}

console.log('\n✅ ' + corrections + ' corrections made. ' + Object.keys(winnerBySeed).length + ' advancing, ' + eliminatedSeeds.size + ' eliminated.');

// ── Re-generate Round 2 Bracket ───────────────────────────────────────────────
console.log('\n=== Re-generating Round 2 Bracket ===\n');

var slotToWinner = {};
r1Bracket.forEach(function (row) {
  var slot = row.playerASeed; // always the lower seed = slot number
  var updated = updatedR1.find(function (r) { return r.matchNumber === row.matchNumber; });
  slotToWinner[slot] = winnerBySeed[updated.winnerSeed];
});

var r2Bracket = [];
for (var matchNum = 1; matchNum <= 64; matchNum++) {
  var slotA = matchNum;
  var slotB = 129 - matchNum;
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

  console.log('R2 #' + matchNum + ': ' + wA.name + '(s' + wA.seed + ') vs ' + wB.name + '(s' + wB.seed + ')');
}

if (errors.length) { console.error('ERRORS:', errors); process.exit(1); }

// ── Update Participants ────────────────────────────────────────────────────────
var updatedParticipants = participants.map(function (p) {
  if (eliminatedSeeds.has(p.seed)) {
    return Object.assign({}, p, { status: 'eliminated', eliminatedRound: 1 });
  }
  var w = winnerBySeed[p.seed];
  if (w) {
    return Object.assign({}, p, {
      status: 'active',
      autoQualifiedRound2: p.seed <= 14,
      baselineScoreR2: w.totalScore
    });
  }
  // BYE participants (seeds 1-14)
  return p;
});

// ── Write Files ────────────────────────────────────────────────────────────────
function write(rel, data) {
  fs.writeFileSync(path.join(root, rel), JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('\nWritten: ' + rel);
}

write('data/yossiCup/round1Bracket.json', updatedR1);
write('data/yossiCup/round2Bracket.json', r2Bracket);
write('data/yossiCup/participants.json',  updatedParticipants);

// Check upsets (winner has higher seed number = weaker seeding)
var upsets = updatedR1.filter(function (r) {
  return !r.isBye && r.winnerSeed > r.playerASeed; // winner was player B (higher seed)
});
console.log('\n⚡ Upsets (higher seed number won): ' + upsets.length);

console.log('\n✅ Done. Run next:\n  node scripts/patch_embedded_data.js\n  git add -A && git commit -m "fix: reclose R1 by total score" && git push');
