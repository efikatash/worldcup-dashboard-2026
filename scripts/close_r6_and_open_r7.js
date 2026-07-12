#!/usr/bin/env node
// close_r6_and_open_r7.js
'use strict';
var fs   = require('fs');
var path = require('path');
var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');
var {determineCupMatchWinner} = require('../js/yossiCup/determineCupMatchWinner');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var r6Bracket   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round6Bracket.json'), 'utf8'));
var rounds      = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cupRounds.json'), 'utf8'));
var liveData    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));

var r1 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round1Bracket.json'), 'utf8'));
var r2 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round2Bracket.json'), 'utf8'));
var r3 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round3Bracket.json'), 'utf8'));
var r4 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round4Bracket.json'), 'utf8'));
var r5 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round5Bracket.json'), 'utf8'));

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
var marginHistory = buildMargins([r1, r2, r3, r4, r5]);

console.log('=== R6 RESULTS (רבע גמר) ===\n');
var r6Winners = [];

r6Bracket.forEach(function(m) {
  var pA = partBySeed[m.playerASeed], pB = partBySeed[m.playerBSeed];
  var lA = liveByName[m.playerAName], lB = liveByName[m.playerBName];
  if (!pA||!pB||!lA||!lB) { console.error('Missing data for match', m.matchNumber); return; }

  var rsA = lA.total - pA.baselineScoreR6;
  var rsB = lB.total - pB.baselineScoreR6;
  var cumA = lA.total - pA.initialScore;
  var cumB = lB.total - pB.initialScore;

  var res = determineCupMatchWinner({
    playerA:m.playerASeed, playerB:m.playerBSeed,
    roundScoreA:rsA, roundScoreB:rsB,
    cumulativeCupScoreA:cumA, cumulativeCupScoreB:cumB,
    initialScoreA:pA.initialScore, initialScoreB:pB.initialScore,
    previousRoundMarginsA:marginHistory[m.playerASeed]||[],
    previousRoundMarginsB:marginHistory[m.playerBSeed]||[],
    seedA:m.playerASeed, seedB:m.playerBSeed
  });

  var winnerSeed = res.winnerId;
  var winnerName = winnerSeed===m.playerASeed ? m.playerAName : m.playerBName;
  var tb = res.tieBreakerUsed!=='A' ? ' [TB-'+res.tieBreakerUsed+']' : '';

  console.log('R6-'+m.matchNumber+': s'+m.playerASeed+' '+m.playerAName+
    ' ('+rsA+') vs ('+rsB+') s'+m.playerBSeed+' '+m.playerBName+
    ' → WINNER: s'+winnerSeed+' '+winnerName+tb);

  m.roundScoreA   = rsA;
  m.roundScoreB   = rsB;
  m.status        = 'completed';
  m.winnerSeed    = winnerSeed;
  m.winnerName    = winnerName;
  m.winnerReason  = 'official';
  m.tieBreakerUsed = res.tieBreakerUsed!=='A' ? res.tieBreakerUsed : null;

  r6Winners.push({ matchNumber:m.matchNumber, winnerSeed:winnerSeed, winnerName:winnerName });
});

// Close R6, open R7
var todayStr = new Date().toISOString();
var r6Round = rounds.find(function(r){return r.round===6;});
if (r6Round) { r6Round.status='closed'; r6Round.closedBySummaryEmail=true; r6Round.summaryEmailDate=todayStr; }
var r7Round = rounds.find(function(r){return r.round===7;});
if (r7Round) { r7Round.status='active'; }

// Update participants
var advancingSeeds = new Set(r6Winners.map(function(w){return w.winnerSeed;}));
console.log('\nAdvancing to R7 ('+advancingSeeds.size+'):');
var nowActive=0, nowEliminated=0;

participants.forEach(function(p) {
  if (p.status!=='active'||p.baselineScoreR6==null) return;
  if (advancingSeeds.has(p.seed)) {
    var lp = liveByName[p.name];
    p.baselineScoreR7 = lp ? lp.total : p.baselineScoreR6;
    nowActive++;
    console.log('  ADVANCING s'+p.seed+' '+p.name+' baselineR7='+p.baselineScoreR7);
  } else {
    p.status='eliminated'; p.eliminatedRound=6; delete p.baselineScoreR6;
    nowEliminated++;
    console.log('  ELIMINATED s'+p.seed+' '+p.name);
  }
});
console.log('Advancing: '+nowActive+' | Eliminated: '+nowEliminated);

// Build R7 bracket — pairs consecutive R6 matches: [1,2],[3,4]
var R7_SEEDING = [[1,2],[3,4]];
var r6ByMatch = {};
r6Bracket.forEach(function(m){r6ByMatch[m.matchNumber]=m;});

var r7Bracket = [];
R7_SEEDING.forEach(function(pair,i) {
  var matchNum=i+1, slotA=pair[0], slotB=pair[1];
  var mA=r6ByMatch[slotA], mB=r6ByMatch[slotB];
  if (!mA||!mB) { console.error('Missing R6 match',slotA,slotB); return; }
  r7Bracket.push({
    id:'r7-m'+String(matchNum).padStart(3,'0'),
    round:7, matchNumber:matchNum,
    bracketSlotA:slotA, bracketSlotB:slotB,
    playerASeed:mA.winnerSeed, playerAName:mA.winnerName,
    playerBSeed:mB.winnerSeed, playerBName:mB.winnerName,
    isBye:false, status:'pending',
    winnerSeed:null, winnerName:null, winnerReason:null,
    tieBreakerUsed:null, roundScoreA:null, roundScoreB:null
  });
});

console.log('\n=== R7 BRACKET (חצי גמר) ===');
r7Bracket.forEach(function(m){
  console.log('R7-'+m.matchNumber+': s'+m.playerASeed+' '+m.playerAName+
    ' [R6-'+m.bracketSlotA+'] vs s'+m.playerBSeed+' '+m.playerBName+' [R6-'+m.bracketSlotB+']');
});

// Verify delta=0
console.log('\n=== בדיקת איפוס ===');
var valid=true;
participants.filter(function(p){return p.status==='active'&&p.baselineScoreR7!=null;}).forEach(function(p){
  var lp=liveByName[p.name];
  var delta=lp ? lp.total-p.baselineScoreR7 : '?';
  console.log('s'+p.seed+' '+p.name+': delta='+delta+(delta!==0?' ⚠':''));
  if(delta!==0) valid=false;
});
console.log(valid?'✅ כל הדלתות = 0':'⚠ יש דלתות שאינן אפס');

fs.writeFileSync(path.join(DATA_DIR,'round6Bracket.json'), JSON.stringify(r6Bracket,null,2),'utf8');
fs.writeFileSync(path.join(DATA_DIR,'round7Bracket.json'), JSON.stringify(r7Bracket,null,2),'utf8');
fs.writeFileSync(path.join(DATA_DIR,'participants.json'),  JSON.stringify(participants,null,2),'utf8');
fs.writeFileSync(path.join(DATA_DIR,'cupRounds.json'),     JSON.stringify(rounds,null,2),'utf8');
console.log('\n✅ Written: round6Bracket.json, round7Bracket.json, participants.json, cupRounds.json');
