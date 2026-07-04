#!/usr/bin/env node
// reset_r5_baseline.js
// Sets baselineScoreR5 = current data.json total for all 16 R5 active participants,
// so that only points earned during WC Round of 16 (שמינית הגמר) count toward R5.

'use strict';
var fs   = require('fs');
var path = require('path');
var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var liveData    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));

var liveByName = {};
liveData.participants.forEach(function(p) { liveByName[p.name] = p; });

var updated = 0, notFound = [], unchanged = 0;

participants.forEach(function(p) {
  if (p.status !== 'active' || p.baselineScoreR5 == null) return;

  var lp = liveByName[p.name];
  if (!lp) { notFound.push('s' + p.seed + ' ' + p.name); return; }

  var oldBaseline = p.baselineScoreR5;
  var newBaseline = lp.total;

  if (newBaseline !== oldBaseline) {
    console.log('s' + String(p.seed).padStart(3) + ' ' + p.name +
      ': ' + oldBaseline + ' → ' + newBaseline + ' (delta was +' + (newBaseline - oldBaseline) + ')');
    p.baselineScoreR5 = newBaseline;
    updated++;
  } else {
    unchanged++;
  }
});

if (notFound.length) console.log('\nNOT FOUND:', notFound.join(', '));
console.log('\nעודכנו: ' + updated + ' | ללא שינוי: ' + unchanged);

fs.writeFileSync(path.join(DATA_DIR, 'participants.json'), JSON.stringify(participants, null, 2), 'utf8');
console.log('נכתב: participants.json');
console.log('הבא: node scripts/patch_embedded_data.js');
