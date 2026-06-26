#!/usr/bin/env node
// close_round2_official.js
// Closes R2 with official winners from Yossi's spreadsheet images.
// Looks up each official winner by seed pair (order-independent), not by match index.

var fs = require('fs');
var path = require('path');

var DATA_DIR = path.join(__dirname, '..', 'data', 'yossiCup');

var participants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'participants.json'), 'utf8'));
var r2Bracket   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'round2Bracket.json'), 'utf8'));
var cupRounds   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cupRounds.json'), 'utf8'));
var liveData    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));

var snapshotDate = liveData.generatedAt || new Date().toISOString();
console.log('R2 close snapshot: data.json generatedAt =', snapshotDate);

// Build lookup: participant seed -> current total from data.json
var seedToTotal = {};
participants.forEach(function(p) {
  var dp = liveData.participants.find(function(x) { return x.name === p.name; });
  if (dp) {
    seedToTotal[p.seed] = dp.total;
  } else {
    console.warn('WARN: no data.json match for', p.seed, p.name);
    seedToTotal[p.seed] = p.baselineScoreR2 != null ? p.baselineScoreR2 : p.initialScore;
  }
});

// Official R2 winners from images: [seedA, seedB, winnerSeed]
// Indexed by seed pair (order-independent) via pairKey()
var officialWinnersList = [
  // first image (matches listed in bracket visual order)
  [1,   128, 128],
  [193,  65,  65],
  [ 32,  97,  32],
  [ 33, 161, 161],
  [241, 113, 241],
  [ 49,  80,  49],
  [ 17, 112,  17],
  [ 48,  81,  81],
  [  8, 121,   8],
  [ 57,  72,  57],
  [ 25, 104, 104],
  [217, 168, 168],
  [  9, 137,   9],
  [ 56,  73,  73],
  [ 24, 152,  24],
  [ 41, 169, 169],
  [  4, 125, 125],
  [ 61, 189,  61],
  [228, 100, 100],
  [ 36,  93,  93],
  [ 13, 116,  13],
  [205, 180, 205],
  [ 20, 109, 109],
  [ 84, 212,  84],
  [  5, 124,   5],
  [ 60,  69,  60],
  [ 28, 101,  28],
  [ 37, 165,  37],
  [ 12, 140, 140],
  [ 53,  76,  53],
  [ 21, 108, 108],
  [ 85,  44,  44],
  // second image
  [  2, 127, 127],
  [ 63,  66,  63],
  [ 31, 159,  31],
  [ 34,  95,  34],
  [ 15, 114, 114],
  [ 50,  79,  79],
  [ 18, 111, 111],
  [210, 175, 175],
  [  7, 122,   7],
  [ 58, 186, 186],
  [ 26, 154,  26],
  [218,  90,  90],
  [ 10, 138,  10],
  [ 55, 183,  55],
  [ 23, 151, 151],
  [ 42,  87,  42],
  [  3, 126,   3],
  [ 62, 190, 190],
  [227,  99, 227],
  [ 35, 163,  35],
  [ 14, 115,  14],
  [ 51,  78,  51],
  [ 19, 110, 110],
  [211, 174, 211],
  [123,   6,   6],
  [198,  70,  70],
  [ 27, 102, 102],
  [ 91,  38,  38],
  [118,  11,  11],
  [182,  54,  54],
  [235, 107, 107],
  [214, 171, 171]
];

if (officialWinnersList.length !== 64) {
  throw new Error('Expected 64 official winners, got ' + officialWinnersList.length);
}

// Build lookup: "minSeed,maxSeed" -> winnerSeed
function pairKey(a, b) { return Math.min(a, b) + ',' + Math.max(a, b); }

var winnerBySeedPair = {};
officialWinnersList.forEach(function(ow) {
  var key = pairKey(ow[0], ow[1]);
  winnerBySeedPair[key] = ow[2];
});

// Seed -> participant lookup
var seedToParticipant = {};
participants.forEach(function(p) { seedToParticipant[p.seed] = p; });

function nameOf(seed) {
  return seedToParticipant[seed] ? seedToParticipant[seed].name : '(seed ' + seed + ')';
}

// Apply official results to r2Bracket (look up by seed pair)
var corrections = 0;
var notFound = 0;
r2Bracket.forEach(function(match) {
  var key = pairKey(match.playerASeed, match.playerBSeed);
  var offWinner = winnerBySeedPair[key];

  if (offWinner === undefined) {
    console.error('ERROR: no official winner found for match', match.matchNumber,
      match.playerASeed, 'vs', match.playerBSeed);
    notFound++;
    return;
  }

  var baseA = seedToParticipant[match.playerASeed] ? seedToParticipant[match.playerASeed].baselineScoreR2 : 0;
  var baseB = seedToParticipant[match.playerBSeed] ? seedToParticipant[match.playerBSeed].baselineScoreR2 : 0;
  var totA  = seedToTotal[match.playerASeed] || 0;
  var totB  = seedToTotal[match.playerBSeed] || 0;
  var rsA   = totA - (baseA || 0);
  var rsB   = totB - (baseB || 0);

  var provisionalWinner = rsA > rsB ? match.playerASeed :
                          rsB > rsA ? match.playerBSeed : null;
  if (provisionalWinner !== null && provisionalWinner !== offWinner) {
    corrections++;
    var provScore = provisionalWinner === match.playerASeed ? rsA : rsB;
    var offScore  = offWinner === match.playerASeed ? rsA : rsB;
    console.log('OVERRIDE m' + match.matchNumber + ': provisional ' + nameOf(provisionalWinner) +
      ' (+' + provScore + ') → official ' + nameOf(offWinner) + ' (+' + offScore + ')');
  }

  match.roundScoreA    = rsA;
  match.roundScoreB    = rsB;
  match.winnerSeed     = offWinner;
  match.winnerName     = nameOf(offWinner);
  match.winnerReason   = 'official';
  match.tieBreakerUsed = null;
  match.status         = 'completed';
});

console.log('\nR2 closed. Score-based overrides: ' + corrections + ' | not found: ' + notFound);

// Update participants
var advancingSeeds = new Set();
r2Bracket.forEach(function(m) { if (m.winnerSeed) advancingSeeds.add(m.winnerSeed); });

var eliminatedCount = 0;
var advancedCount   = 0;
participants.forEach(function(p) {
  if (p.baselineScoreR2 == null) return;

  if (advancingSeeds.has(p.seed)) {
    p.baselineScoreR3 = seedToTotal[p.seed] || p.baselineScoreR2;
    p.status = 'active';
    advancedCount++;
  } else {
    p.status = 'eliminated';
    p.eliminatedRound = 2;
    eliminatedCount++;
  }
});

console.log('Advancing to R3: ' + advancedCount + ' | Eliminated in R2: ' + eliminatedCount);

// Build round3Bracket.json
// R3 match N: R2 match N winner vs R2 match (65-N) winner, for N=1..32
var r2ByMatch = {};
r2Bracket.forEach(function(m) { r2ByMatch[m.matchNumber] = m; });

var r3Bracket = [];
for (var n = 1; n <= 32; n++) {
  var mA = r2ByMatch[n];
  var mB = r2ByMatch[65 - n];
  if (!mA || !mB) { console.error('Missing R2 match for R3 slot', n); continue; }

  var seedA = mA.winnerSeed;
  var seedB = mB.winnerSeed;

  r3Bracket.push({
    id:             'r3-m' + String(n).padStart(3, '0'),
    round:          3,
    matchNumber:    n,
    bracketSlotA:   n,
    bracketSlotB:   65 - n,
    playerASeed:    seedA,
    playerAName:    nameOf(seedA),
    playerBSeed:    seedB,
    playerBName:    nameOf(seedB),
    isBye:          false,
    status:         'pending',
    winnerSeed:     null,
    winnerName:     null,
    winnerReason:   null,
    tieBreakerUsed: null,
    roundScoreA:    null,
    roundScoreB:    null
  });
}

console.log('Generated R3 bracket with ' + r3Bracket.length + ' matches');

// Update cupRounds.json
cupRounds.forEach(function(r) {
  if (r.round === 2) {
    r.status = 'closed';
    r.closedBySummaryEmail = true;
    r.summaryEmailDate = snapshotDate;
    r.participantCountEnd = 64;
  }
  if (r.round === 3) {
    r.status = 'pending';
    r.participantCountStart = 64;
    r.activeMatchCount = 32;
    r.byeCount = 0;
    r.participantCountEnd = 32;
    r.closedBySummaryEmail = false;
    r.summaryEmailDate = null;
  }
});

// Write files
fs.writeFileSync(path.join(DATA_DIR, 'round2Bracket.json'), JSON.stringify(r2Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'round3Bracket.json'), JSON.stringify(r3Bracket, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'participants.json'),  JSON.stringify(participants, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'cupRounds.json'),     JSON.stringify(cupRounds, null, 2), 'utf8');
console.log('\nWritten: round2Bracket.json, round3Bracket.json, participants.json, cupRounds.json');
console.log('Next: node scripts/patch_embedded_data.js');

// Print R3 bracket summary
console.log('\n=== R3 BRACKET ===');
r3Bracket.forEach(function(m) {
  console.log('R3-' + String(m.matchNumber).padStart(2,' ') + ': ' + m.playerAName + ' (s' + m.playerASeed + ') vs ' + m.playerBName + ' (s' + m.playerBSeed + ')');
});
