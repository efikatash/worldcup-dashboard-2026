#!/usr/bin/env node
// reset_r4_baseline.js
// Re-snapshots baselineScoreR4 for all 32 R4 participants from current data.json.
// Run AFTER data.json has been updated with R3 game results.

var fs = require('fs');
var path = require('path');
var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var live = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));

var updated = 0, notFound = [];
participants.forEach(function(p) {
  if (p.status !== 'active' || p.baselineScoreR4 == null) return;
  var dp = live.participants.find(function(x) { return x.name === p.name; });
  if (!dp) { notFound.push(p.seed + ' ' + p.name); return; }
  p.baselineScoreR4 = dp.total;
  updated++;
});

if (notFound.length) console.log('NOT FOUND:', notFound.join(', '));
console.log('Updated baselineScoreR4 for', updated, 'R4 participants');

fs.writeFileSync(path.join(DATA_DIR, 'participants.json'), JSON.stringify(participants, null, 2), 'utf8');
console.log('Written participants.json');
console.log('Next: node scripts/patch_embedded_data.js');
