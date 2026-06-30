#!/usr/bin/env node
// fix_r4_baseline_pre_knockout.js
// The R4 baseline was captured AFTER some WC knockout-stage r16advance picks
// were already scored in data.json (June 28-29 games). This script recalculates
// the correct pre-knockout baseline for each R4 participant by subtracting
// already-resolved r16advance + bonus_r16_all points from their current total.

var fs   = require('fs');
var path = require('path');
var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var liveData    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));

var liveByName = {};
liveData.participants.forEach(function(p) { liveByName[p.name] = p; });

function knockoutPointsAlreadyScored(liveParticipant) {
  // Sum all r16advance and bonus_r16_all bonus points that are already resolved
  var bonuses = liveParticipant.bonuses || [];
  var total = 0;
  bonuses.forEach(function(b) {
    if ((b.kind === 'r16advance' || b.kind === 'bonus_r16_all') && b.status === 'resolved') {
      total += (b.points || 0);
    }
  });
  return total;
}

var updated = 0, notFound = [], unchanged = 0;

participants.forEach(function(p) {
  if (p.status !== 'active' || p.baselineScoreR4 == null) return;

  var lp = liveByName[p.name];
  if (!lp) { notFound.push(p.seed + ' ' + p.name); return; }

  var koPoints = knockoutPointsAlreadyScored(lp);
  var correctBaseline = lp.total - koPoints;

  if (correctBaseline !== p.baselineScoreR4) {
    console.log('s' + p.seed + ' ' + p.name +
      ': total=' + lp.total +
      ' koAlreadyScored=' + koPoints +
      ' oldBaseline=' + p.baselineScoreR4 +
      ' → newBaseline=' + correctBaseline +
      ' (delta will be +' + koPoints + ')');
    p.baselineScoreR4 = correctBaseline;
    updated++;
  } else {
    unchanged++;
  }
});

if (notFound.length) console.log('NOT FOUND:', notFound.join(', '));
console.log('\nUpdated: ' + updated + ' | Unchanged: ' + unchanged);

fs.writeFileSync(path.join(DATA_DIR, 'participants.json'), JSON.stringify(participants, null, 2), 'utf8');
console.log('Written participants.json');
console.log('Next: node scripts/patch_embedded_data.js');
