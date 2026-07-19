#!/usr/bin/env node
// close_r8_final.js — close the Yossi Cup final and declare the champion
'use strict';
var fs   = require('fs');
var path = require('path');
var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');
var {determineCupMatchWinner} = require('../js/yossiCup/determineCupMatchWinner');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var r8Bracket   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round8Bracket.json'), 'utf8'));
var rounds      = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cupRounds.json'), 'utf8'));
var liveData    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));

var r1 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round1Bracket.json'), 'utf8'));
var r2 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round2Bracket.json'), 'utf8'));
var r3 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round3Bracket.json'), 'utf8'));
var r4 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round4Bracket.json'), 'utf8'));
var r5 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round5Bracket.json'), 'utf8'));
var r6 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round6Bracket.json'), 'utf8'));
var r7 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round7Bracket.json'), 'utf8'));

var partBySeed = {};
participants.forEach(function(p) { partBySeed[p.seed] = p; });
var liveByName = {};
liveData.participants.forEach(function(p) { liveByName[p.name] = p; });

function buildMargins(bks) {
  var m = {};
  bks.forEach(function(rows, idx) {
    rows.forEach(function(match) {
      if (!match.winnerSeed) return;
      var rsA = match.roundScoreA||0, rsB = match.roundScoreB||0;
      if (!m[match.winnerSeed]) m[match.winnerSeed] = [];
      while (m[match.winnerSeed].length < idx) m[match.winnerSeed].push(0);
      m[match.winnerSeed].push(Math.abs(rsA - rsB));
    });
  });
  return m;
}
var marginHistory = buildMargins([r1, r2, r3, r4, r5, r6, r7]);

console.log('=== R8 FINAL RESULT (גמר גביע יוסי) ===\n');

var m = r8Bracket[0];
var pA = partBySeed[m.playerASeed], pB = partBySeed[m.playerBSeed];
var lA = liveByName[m.playerAName], lB = liveByName[m.playerBName];
if (!pA||!pB||!lA||!lB) { console.error('Missing data for final'); process.exit(1); }

var rsA = lA.total - pA.baselineScoreR8;
var rsB = lB.total - pB.baselineScoreR8;
var cumA = lA.total - pA.initialScore;
var cumB = lB.total - pB.initialScore;

var res = determineCupMatchWinner({
  playerA: m.playerASeed, playerB: m.playerBSeed,
  roundScoreA: rsA, roundScoreB: rsB,
  cumulativeCupScoreA: cumA, cumulativeCupScoreB: cumB,
  initialScoreA: pA.initialScore, initialScoreB: pB.initialScore,
  previousRoundMarginsA: marginHistory[m.playerASeed]||[],
  previousRoundMarginsB: marginHistory[m.playerBSeed]||[],
  seedA: m.playerASeed, seedB: m.playerBSeed
});

var winnerSeed = res.winnerId;
var loserSeed  = winnerSeed===m.playerASeed ? m.playerBSeed : m.playerASeed;
var winnerName = winnerSeed===m.playerASeed ? m.playerAName : m.playerBName;
var loserName  = winnerSeed===m.playerASeed ? m.playerBName : m.playerAName;
var tb = res.tieBreakerUsed!=='A' ? ' [TB-'+res.tieBreakerUsed+']' : '';

console.log('R8 FINAL: s'+m.playerASeed+' '+m.playerAName+
  ' ('+rsA+') vs ('+rsB+') s'+m.playerBSeed+' '+m.playerBName+
  ' → CHAMPION: s'+winnerSeed+' '+winnerName+tb);

m.roundScoreA   = rsA;
m.roundScoreB   = rsB;
m.status        = 'completed';
m.winnerSeed    = winnerSeed;
m.winnerName    = winnerName;
m.winnerReason  = 'official';
m.tieBreakerUsed = res.tieBreakerUsed!=='A' ? res.tieBreakerUsed : null;

// Close R8
var todayStr = new Date().toISOString();
var r8Round = rounds.find(function(r){return r.round===8;});
if (r8Round) {
  r8Round.status = 'closed';
  r8Round.closedBySummaryEmail = true;
  r8Round.summaryEmailDate = todayStr;
}

// Update participants
participants.forEach(function(p) {
  if (p.seed === winnerSeed && p.status === 'active') {
    p.status = 'champion';
    p.championRound = 8;
    console.log('\n🏆 CHAMPION: s'+p.seed+' '+p.name);
  } else if (p.seed === loserSeed && p.status === 'active') {
    p.status = 'eliminated';
    p.eliminatedRound = 8;
    delete p.baselineScoreR8;
    console.log('🥈 RUNNER-UP: s'+p.seed+' '+p.name);
  }
});

// Write files
fs.writeFileSync(path.join(DATA_DIR,'round8Bracket.json'), JSON.stringify(r8Bracket,null,2),'utf8');
fs.writeFileSync(path.join(DATA_DIR,'participants.json'),  JSON.stringify(participants,null,2),'utf8');
fs.writeFileSync(path.join(DATA_DIR,'cupRounds.json'),     JSON.stringify(rounds,null,2),'utf8');
console.log('\n✅ Written: round8Bracket.json, participants.json, cupRounds.json');
console.log('Next: node scripts/patch_embedded_data.js');
