'use strict';
/**
 * reclose_round1_official.js
 *
 * Re-closes Round 1 using the OFFICIAL snapshot from git commit f4806f3
 * (2026-06-24 14:48 UTC = 22:48 Philippines time, right when matchday-2
 * final games kicked off — the snapshot Yossi used for his summary email).
 *
 * This corrects 6 wrong winners that were computed using the 03:44 UTC
 * June-25 snapshot (which included extra open-question points).
 *
 * Usage: node scripts/reclose_round1_official.js
 * Then:  node scripts/patch_embedded_data.js
 * Then:  git add -A && git commit && git push
 */

var path    = require('path');
var fs      = require('fs');
var cp      = require('child_process');
var root    = path.join(__dirname, '..');

var { normalizeParticipantName: norm } = require('../js/yossiCup/normalizeParticipantName');
var { determineCupMatchWinner }        = require('../js/yossiCup/determineCupMatchWinner');

// Load official snapshot from git
var officialJson;
try {
  var out = cp.execSync('git show f4806f3:data.json', { cwd: root, maxBuffer: 50 * 1024 * 1024 });
  officialJson = JSON.parse(out.toString('utf8'));
} catch (e) {
  console.error('Failed to read f4806f3:data.json:', e.message);
  process.exit(1);
}

var participants = require('../data/yossiCup/participants.json');
var r1Bracket    = require('../data/yossiCup/round1Bracket.json');

// Build lookup by normalized name from official snapshot
var officialByName = {};
officialJson.participants.forEach(function (p) {
  officialByName[norm(p.name)] = p;
});

// Build initialScore lookup
var initBySeed = {};
participants.forEach(function (p) { initBySeed[p.seed] = p.initialScore; });

console.log('\n=== Re-closing Round 1 using OFFICIAL snapshot f4806f3 ===');
console.log('Snapshot generatedAt:', officialJson.meta && officialJson.meta.generatedAt);
console.log('');

var winnerBySeed    = {};
var eliminatedSeeds = new Set();
var errors          = [];
var corrections     = 0;
var missing         = 0;

var updatedR1 = r1Bracket.map(function (row) {
  if (row.isBye) {
    var byeP = officialByName[norm(row.playerAName)];
    winnerBySeed[row.playerASeed] = {
      seed:       row.playerASeed,
      name:       row.playerAName,
      roundScore: 0,
      totalScore: byeP ? Number(byeP.total) : (initBySeed[row.playerASeed] || 0)
    };
    return Object.assign({}, row, { status: 'bye', roundScoreA: 0 });
  }

  var pA = officialByName[norm(row.playerAName)];
  var pB = officialByName[norm(row.playerBName)];

  if (!pA) { errors.push('NOT FOUND: ' + row.playerAName); missing++; }
  if (!pB) { errors.push('NOT FOUND: ' + row.playerBName); missing++; }
  if (!pA || !pB) return row;

  var initA = initBySeed[row.playerASeed];
  var initB = initBySeed[row.playerBSeed];
  var totA  = Number(pA.total);
  var totB  = Number(pB.total);

  var rsA = totA - initA;
  var rsB = totB - initB;

  if (rsA < 0) {
    errors.push('WARNING: negative delta for ' + row.playerAName + ' (init=' + initA + ' official=' + totA + ')');
    rsA = 0;
  }
  if (rsB < 0) {
    errors.push('WARNING: negative delta for ' + row.playerBName + ' (init=' + initB + ' official=' + totB + ')');
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
  var changed    = (newWinSeed !== oldWinSeed);
  if (changed) {
    corrections++;
    console.log('CORRECTED #' + row.matchNumber + ': '
      + row.playerAName + '(+' + rsA + ') vs ' + row.playerBName + '(+' + rsB + ')'
      + ' | OLD winner: ' + (row.winnerName || '?') + ' → NEW: ' + newWinName
      + (res.tieBreakerUsed ? ' [TB:' + res.tieBreakerUsed + ']' : ''));
  }

  winnerBySeed[newWinSeed] = {
    seed:       newWinSeed,
    name:       newWinName,
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

console.log('\n✅ ' + corrections + ' corrections from current bracket.');
console.log('   ' + Object.keys(winnerBySeed).length + ' advancing, ' + eliminatedSeeds.size + ' eliminated.');

// ── Regenerate Round 2 Bracket ─────────────────────────────────────────────
console.log('\n=== Regenerating Round 2 Bracket ===\n');

// Map each R1 slot → winner of that slot's match
var slotToWinner = {};
r1Bracket.forEach(function (row) {
  var slot    = row.playerASeed;  // slot number = playerA's original seed
  var updated = updatedR1.find(function (r) { return r.matchNumber === row.matchNumber; });
  slotToWinner[slot] = winnerBySeed[updated.winnerSeed];
});

var r2Errors  = [];
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
// Use current baselineScoreR2 values from existing participants.json (already set)
// Only update status for the 6 corrected matches
var existingParts = require('../data/yossiCup/participants.json');
var baselineByName = {};
existingParts.forEach(function (p) { baselineByName[norm(p.name)] = p.baselineScoreR2; });

var updatedParticipants = participants.map(function (p) {
  if (eliminatedSeeds.has(p.seed)) {
    return Object.assign({}, p, { status: 'eliminated', eliminatedRound: 1,
      baselineScoreR2: undefined, autoQualifiedRound2: undefined });
  }
  var w = winnerBySeed[p.seed];
  if (w) {
    var existing = existingParts.find(function (ep) { return ep.seed === p.seed; });
    var baseline = existing ? existing.baselineScoreR2 : w.totalScore;
    return Object.assign({}, p, {
      status:              'active',
      autoQualifiedRound2: p.seed <= 14,
      baselineScoreR2:     baseline
    });
  }
  return p;
});

// ── Write Files ────────────────────────────────────────────────────────────
function write(rel, data) {
  var clean = JSON.parse(JSON.stringify(data, function (k, v) {
    return v === undefined ? undefined : v;
  }));
  fs.writeFileSync(path.join(root, rel), JSON.stringify(clean, null, 2) + '\n', 'utf8');
  console.log('\nWritten: ' + rel);
}

write('data/yossiCup/round1Bracket.json', updatedR1);
write('data/yossiCup/round2Bracket.json', r2Bracket);
write('data/yossiCup/participants.json',  updatedParticipants);

console.log('\n✅ Done. Run next:');
console.log('  node scripts/patch_embedded_data.js');
console.log('  git add -A && git commit -m "fix: reclose R1 by official f4806f3 snapshot, fix 6 wrong winners" && git push');
