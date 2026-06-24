'use strict';
/**
 * set_round2_baseline.js
 *
 * Run this script at the START of Round 2 (when the first Round-2 World Cup
 * match kicks off). It takes a fresh snapshot of current live scores as the
 * baseline for Round 2, so that roundScoreR2 = liveTotal - newBaseline.
 *
 * Usage: node scripts/set_round2_baseline.js
 * Then:  node scripts/patch_embedded_data.js
 * Then:  git add -A && git commit -m "chore: set R2 baseline" && git push
 */

var path = require('path');
var fs   = require('fs');
var root = path.join(__dirname, '..');

var { normalizeParticipantName: norm } = require('../js/yossiCup/normalizeParticipantName');

var live         = require('../data.json');
var participants = require('../data/yossiCup/participants.json');
var rounds       = require('../data/yossiCup/cupRounds.json');

var liveByName = {};
live.participants.forEach(function (p) { liveByName[norm(p.name)] = p; });

var updated = 0, missing = 0;

var updatedParticipants = participants.map(function (p) {
  if (p.status !== 'active') return p;
  var lp = liveByName[norm(p.name)];
  if (!lp) {
    console.warn('⚠️  Not found in live data: ' + p.name);
    missing++;
    return p;
  }
  updated++;
  console.log('  ' + p.seed + '. ' + p.name + ': ' + (p.baselineScoreR2 || p.initialScore) + ' → ' + lp.total);
  return Object.assign({}, p, { baselineScoreR2: lp.total });
});

if (missing > 0) {
  console.error('\n❌ ' + missing + ' participants not found — aborting write.');
  process.exit(1);
}

// Remove roundStart from Round 2 (the gate has been passed)
var updatedRounds = rounds.map(function (r) {
  if (r.round === 2) {
    var copy = Object.assign({}, r);
    delete copy.roundStart;
    return copy;
  }
  return r;
});

var partsPath   = path.join(root, 'data/yossiCup/participants.json');
var roundsPath  = path.join(root, 'data/yossiCup/cupRounds.json');

fs.writeFileSync(partsPath,  JSON.stringify(updatedParticipants, null, 2) + '\n', 'utf8');
fs.writeFileSync(roundsPath, JSON.stringify(updatedRounds, null, 2) + '\n', 'utf8');

console.log('\n✅ R2 baseline set for ' + updated + ' participants.');
console.log('   Run next: node scripts/patch_embedded_data.js');
console.log('   Then commit & push.');
