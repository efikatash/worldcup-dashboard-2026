#!/usr/bin/env node
// close_r7_and_open_r8.js
'use strict';
var fs   = require('fs');
var path = require('path');
var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');
var {determineCupMatchWinner} = require('../js/yossiCup/determineCupMatchWinner');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var r7Bracket   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round7Bracket.json'), 'utf8'));
var rounds      = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cupRounds.json'), 'utf8'));
var liveData    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));

var r1 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round1Bracket.json'), 'utf8'));
var r2 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round2Bracket.json'), 'utf8'));
var r3 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round3Bracket.json'), 'utf8'));
var r4 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round4Bracket.json'), 'utf8'));
var r5 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round5Bracket.json'), 'utf8'));
var r6 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round6Bracket.json'), 'utf8'));

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
var marginHistory = buildMargins([r1, r2, r3, r4, r5, r6]);

console.log('=== R7 RESULTS (חצי גמר) ===\n');
var r7Winners = [];

r7Bracket.forEach(function(m) {
  var pA = partBySeed[m.playerASeed], pB = partBySeed[m.playerBSeed];
  var lA = liveByName[m.playerAName], lB = liveByName[m.playerBName];
  if (!pA||!pB||!lA||!lB) { console.error('Missing data for match', m.matchNumber); return; }

  var rsA = lA.total - pA.baselineScoreR7;
  var rsB = lB.total - pB.baselineScoreR7;
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
  var winnerName = winnerSeed===m.playerASeed ? m.playerAName : m.playerBName;
  var tb = res.tieBreakerUsed!=='A' ? ' [TB-'+res.tieBreakerUsed+']' : '';

  console.log('R7-'+m.matchNumber+': s'+m.playerASeed+' '+m.playerAName+
    ' ('+rsA+') vs ('+rsB+') s'+m.playerBSeed+' '+m.playerBName+
    ' → WINNER: s'+winnerSeed+' '+winnerName+tb);

  m.roundScoreA   = rsA;
  m.roundScoreB   = rsB;
  m.status        = 'completed';
  m.winnerSeed    = winnerSeed;
  m.winnerName    = winnerName;
  m.winnerReason  = 'official';
  m.tieBreakerUsed = res.tieBreakerUsed!=='A' ? res.tieBreakerUsed : null;

  r7Winners.push({ matchNumber:m.matchNumber, winnerSeed:winnerSeed, winnerName:winnerName });
});

// Close R7, open R8
var todayStr = new Date().toISOString();
var r7Round = rounds.find(function(r){return r.round===7;});
if (r7Round) { r7Round.status='closed'; r7Round.closedBySummaryEmail=true; r7Round.summaryEmailDate=todayStr; }
var r8Round = rounds.find(function(r){return r.round===8;});
if (r8Round) {
  r8Round.status='active';
  r8Round.wcStage='third_place_and_final';
}

// Update participants
var advancingSeeds = new Set(r7Winners.map(function(w){return w.winnerSeed;}));
console.log('\nAdvancing to R8 ('+advancingSeeds.size+'):');
var nowActive=0, nowEliminated=0;

participants.forEach(function(p) {
  if (p.status!=='active'||p.baselineScoreR7==null) return;
  if (advancingSeeds.has(p.seed)) {
    var lp = liveByName[p.name];
    p.baselineScoreR8 = lp ? lp.total : p.baselineScoreR7;
    nowActive++;
    console.log('  ADVANCING s'+p.seed+' '+p.name+' baselineR8='+p.baselineScoreR8);
  } else {
    p.status='eliminated'; p.eliminatedRound=7; delete p.baselineScoreR7;
    nowEliminated++;
    console.log('  ELIMINATED s'+p.seed+' '+p.name);
  }
});
console.log('Advancing: '+nowActive+' | Eliminated: '+nowEliminated);

// Build R8 bracket — winner of R7-1 vs winner of R7-2
var r7ByMatch = {};
r7Bracket.forEach(function(m){r7ByMatch[m.matchNumber]=m;});

var mA = r7ByMatch[1], mB = r7ByMatch[2];
if (!mA||!mB) { console.error('Missing R7 matches'); process.exit(1); }

var r8Bracket = [{
  id: 'r8-m001',
  round: 8,
  matchNumber: 1,
  bracketSlotA: 1,
  bracketSlotB: 2,
  playerASeed: mA.winnerSeed,
  playerAName: mA.winnerName,
  playerBSeed: mB.winnerSeed,
  playerBName: mB.winnerName,
  isBye: false,
  status: 'pending',
  winnerSeed: null,
  winnerName: null,
  winnerReason: null,
  tieBreakerUsed: null,
  roundScoreA: null,
  roundScoreB: null
}];

console.log('\n=== R8 BRACKET (גמר) ===');
r8Bracket.forEach(function(m){
  console.log('R8-'+m.matchNumber+': s'+m.playerASeed+' '+m.playerAName+
    ' [R7-'+m.bracketSlotA+'] vs s'+m.playerBSeed+' '+m.playerBName+' [R7-'+m.bracketSlotB+']');
});
console.log('(מתקיים במקביל למשחק על המקום השלישי וגמר גביע העולם)');

// Verify delta=0
console.log('\n=== בדיקת איפוס ===');
var valid=true;
participants.filter(function(p){return p.status==='active'&&p.baselineScoreR8!=null;}).forEach(function(p){
  var lp=liveByName[p.name];
  var delta=lp ? lp.total-p.baselineScoreR8 : '?';
  console.log('s'+p.seed+' '+p.name+': delta='+delta+(delta!==0?' ⚠':''));
  if(delta!==0) valid=false;
});
console.log(valid?'✅ כל הדלתות = 0':'⚠ יש דלתות שאינן אפס');

fs.writeFileSync(path.join(DATA_DIR,'round7Bracket.json'), JSON.stringify(r7Bracket,null,2),'utf8');
fs.writeFileSync(path.join(DATA_DIR,'round8Bracket.json'), JSON.stringify(r8Bracket,null,2),'utf8');
fs.writeFileSync(path.join(DATA_DIR,'participants.json'),  JSON.stringify(participants,null,2),'utf8');
fs.writeFileSync(path.join(DATA_DIR,'cupRounds.json'),     JSON.stringify(rounds,null,2),'utf8');
console.log('\n✅ Written: round7Bracket.json, round8Bracket.json, participants.json, cupRounds.json');
