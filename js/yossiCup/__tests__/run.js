#!/usr/bin/env node
'use strict';
/**
 * גביע יוסי — unit tests (Node assert, no framework)
 * Run: node js/yossiCup/__tests__/run.js
 */
const assert = require('assert');
const path   = require('path');
const base   = path.join(__dirname, '..');

const { normalizeParticipantName }  = require(path.join(base, 'normalizeParticipantName.js'));
const { detectBye }                  = require(path.join(base, 'detectBye.js'));
const { determineCupMatchWinner }    = require(path.join(base, 'determineCupMatchWinner.js'));
const { validateYossiCupData }       = require(path.join(base, 'validateYossiCupData.js'));
const { buildCupBracket }            = require(path.join(base, 'buildCupBracket.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✅', name); }
  catch (e) { failed++; console.log('  ❌', name, '\n    ', e.message); }
}

// ──────────────────────────────────────────────────
// normalizeParticipantName
// ──────────────────────────────────────────────────
console.log('\n── normalizeParticipantName ──');
test('strips extra spaces', () => assert.strictEqual(normalizeParticipantName('  יובל  אברהם  '), 'יובל אברהם'));
test('lowercases latin chars', () => assert.ok(normalizeParticipantName('ABC').includes('abc')));
test('empty string', () => assert.strictEqual(normalizeParticipantName(''), ''));
test('null → empty', () => assert.strictEqual(normalizeParticipantName(null), ''));
test('ויצמן → וייצמן', () => assert.ok(normalizeParticipantName('אוראל ויצמן').includes('וייצמן')));
test('מיזלר → מייזלר', () => assert.ok(normalizeParticipantName('יוסי מיזלר').includes('מייזלר')));

// ──────────────────────────────────────────────────
// detectBye
// ──────────────────────────────────────────────────
console.log('\n── detectBye ──');
test('real BYE row (seed > 242, no name)', () =>
  assert.strictEqual(detectBye({ playerBSeed: 256, playerBName: '' }), true));
test('real BYE row (seed > 242, null name)', () =>
  assert.strictEqual(detectBye({ playerBSeed: 249, playerBName: null }), true));
test('active row (both valid)', () =>
  assert.strictEqual(detectBye({ playerBSeed: 129, playerBName: 'מיכאל זוהר' }), false));
test('null row → false', () => assert.strictEqual(detectBye(null), false));
test('seed exactly 242 with name → not a bye', () =>
  assert.strictEqual(detectBye({ playerBSeed: 242, playerBName: 'עומר פרידמן' }), false));

// ──────────────────────────────────────────────────
// determineCupMatchWinner — tie-breaker A
// ──────────────────────────────────────────────────
console.log('\n── determineCupMatchWinner — tie-breaker A (round score) ──');
const base_p = {
  playerA: 'A', playerB: 'B',
  roundScoreA: 0, roundScoreB: 0,
  cumulativeCupScoreA: 0, cumulativeCupScoreB: 0,
  initialScoreA: 0, initialScoreB: 0,
  previousRoundMarginsA: [], previousRoundMarginsB: [],
  seedA: 2, seedB: 10
};
test('A wins on round score', () => {
  const r = determineCupMatchWinner({ ...base_p, roundScoreA: 30, roundScoreB: 20 });
  assert.strictEqual(r.winnerId, 'A');
  assert.strictEqual(r.tieBreakerUsed, 'A');
  assert.strictEqual(r.margin, 10);
});
test('B wins on round score', () => {
  const r = determineCupMatchWinner({ ...base_p, roundScoreA: 10, roundScoreB: 25 });
  assert.strictEqual(r.winnerId, 'B');
  assert.strictEqual(r.tieBreakerUsed, 'A');
});

// ──────────────────────────────────────────────────
// determineCupMatchWinner — tie-breaker B
// ──────────────────────────────────────────────────
console.log('\n── tie-breaker B (cumulative cup score) ──');
test('A wins on cumulative', () => {
  const r = determineCupMatchWinner({ ...base_p, cumulativeCupScoreA: 50, cumulativeCupScoreB: 40 });
  assert.strictEqual(r.winnerId, 'A');
  assert.strictEqual(r.tieBreakerUsed, 'B');
});
test('B wins on cumulative', () => {
  const r = determineCupMatchWinner({ ...base_p, cumulativeCupScoreA: 30, cumulativeCupScoreB: 45 });
  assert.strictEqual(r.winnerId, 'B');
  assert.strictEqual(r.tieBreakerUsed, 'B');
});

// ──────────────────────────────────────────────────
// determineCupMatchWinner — tie-breaker C
// ──────────────────────────────────────────────────
console.log('\n── tie-breaker C (initial score) ──');
test('A wins on initial score', () => {
  const r = determineCupMatchWinner({ ...base_p, initialScoreA: 180, initialScoreB: 170 });
  assert.strictEqual(r.winnerId, 'A');
  assert.strictEqual(r.tieBreakerUsed, 'C');
});

// ──────────────────────────────────────────────────
// determineCupMatchWinner — tie-breaker D/E
// ──────────────────────────────────────────────────
console.log('\n── tie-breaker D/E (previous margins) ──');
test('A wins on previous margin (most recent round)', () => {
  const r = determineCupMatchWinner({
    ...base_p,
    initialScoreA: 100, initialScoreB: 100,
    previousRoundMarginsA: [5, 10],
    previousRoundMarginsB: [5, 3]
  });
  assert.strictEqual(r.winnerId, 'A');
  assert.strictEqual(r.tieBreakerUsed, 'D');
});
test('B wins on earlier round margin when latest is tied', () => {
  const r = determineCupMatchWinner({
    ...base_p,
    initialScoreA: 100, initialScoreB: 100,
    previousRoundMarginsA: [2, 10],
    previousRoundMarginsB: [8, 10]
  });
  assert.strictEqual(r.winnerId, 'B');
  assert.strictEqual(r.tieBreakerUsed, 'D');
});

// ──────────────────────────────────────────────────
// determineCupMatchWinner — tie-breaker F
// ──────────────────────────────────────────────────
console.log('\n── tie-breaker F (seed) ──');
test('lower seed wins (A has seed 1)', () => {
  const r = determineCupMatchWinner({
    ...base_p,
    initialScoreA: 100, initialScoreB: 100,
    seedA: 1, seedB: 128
  });
  assert.strictEqual(r.winnerId, 'A');
  assert.strictEqual(r.tieBreakerUsed, 'F');
});
test('lower seed wins (B has seed 10)', () => {
  const r = determineCupMatchWinner({
    ...base_p,
    initialScoreA: 100, initialScoreB: 100,
    seedA: 50, seedB: 10
  });
  assert.strictEqual(r.winnerId, 'B');
  assert.strictEqual(r.tieBreakerUsed, 'F');
});

// ──────────────────────────────────────────────────
// validateYossiCupData
// ──────────────────────────────────────────────────
console.log('\n── validateYossiCupData ──');
const mockParticipants = Array.from({ length: 242 }, (_, i) => ({
  id: `seed-${i+1}`, seed: i+1, name: `Player ${i+1}`, initialScore: 100
}));
const mockBracket = [
  ...Array.from({ length: 14 }, (_, i) => ({
    id: `r1-m${i}`, isBye: true, winnerSeed: i + 1,
    playerASeed: i+1, playerAName: `Player ${i+1}`,
    playerBSeed: 243+i, playerBName: null
  })),
  ...Array.from({ length: 114 }, (_, i) => ({
    id: `r1-m${i+14}`, isBye: false, winnerSeed: null,
    playerASeed: 15+i, playerAName: `Player ${15+i}`,
    playerBSeed: 242-i, playerBName: `Player ${242-i}`
  }))
];
test('valid data passes', () => {
  const r = validateYossiCupData(mockParticipants, mockBracket);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.errors, []);
});
test('empty participants → error', () => {
  const r = validateYossiCupData([], mockBracket);
  assert.strictEqual(r.ok, false);
});
test('empty bracket → error', () => {
  const r = validateYossiCupData(mockParticipants, []);
  assert.strictEqual(r.ok, false);
});

// ──────────────────────────────────────────────────
// buildCupBracket — round-score + provisional winner
// ──────────────────────────────────────────────────
console.log('\n── buildCupBracket ──');

const frozenParticipants = [
  { seed: 1, name: 'Player One',   initialScore: 100 },
  { seed: 2, name: 'Player Two',   initialScore: 80  },
  { seed: 3, name: 'Player Three', initialScore: 90  },
];

const rawBracket = [
  // BYE
  { id: 'r1-m1', round: 1, matchNumber: 1,
    playerASeed: 1, playerAName: 'Player One',
    playerBSeed: 256, playerBName: null,
    isBye: true, status: 'bye', winnerSeed: 1, winnerName: 'Player One', winnerReason: 'automatic', tieBreakerUsed: null },
  // Active duel: A leads on round score
  { id: 'r1-m2', round: 1, matchNumber: 2,
    playerASeed: 2, playerAName: 'Player Two',
    playerBSeed: 3, playerBName: 'Player Three',
    isBye: false, status: 'pending', winnerSeed: null, winnerName: null, winnerReason: null, tieBreakerUsed: null },
];

const liveParts = [
  { name: 'Player One',   total: 130 },  // round score = 130 - 100 = 30
  { name: 'Player Two',   total: 100 },  // round score = 100 - 80  = 20
  { name: 'Player Three', total: 95  },  // round score = 95  - 90  = 5
];

const built = buildCupBracket(rawBracket, liveParts, frozenParticipants, { activeRound: 1 });

test('BYE row: roundScoreA = liveTotal - initialScore', () => {
  const bye = built.find(m => m.isBye);
  assert.strictEqual(bye.roundScoreA, 30, 'roundScoreA should be 30');
  assert.strictEqual(bye.initialScoreA, 100, 'initialScoreA should be 100');
  assert.strictEqual(bye.liveScoreA, 130, 'liveScoreA should be 130');
});

test('BYE row: hasLiveData false (bye rows excluded from provisional logic)', () => {
  const bye = built.find(m => m.isBye);
  assert.strictEqual(bye.isProvisional, false);
});

test('Active duel: roundScoreA/B computed from initialScore baseline', () => {
  const duel = built.find(m => !m.isBye);
  assert.strictEqual(duel.roundScoreA, 20, 'seed-2 round score = 100-80');
  assert.strictEqual(duel.roundScoreB, 5,  'seed-3 round score = 95-90');
});

test('Active duel: provisional winner set when round points exist', () => {
  const duel = built.find(m => !m.isBye);
  assert.strictEqual(duel.isProvisional, true);
  assert.strictEqual(duel.provisionalWinnerSeed, 2, 'seed-2 leads with 20 vs 5');
  assert.strictEqual(duel.provisionalWinnerName, 'Player Two');
});

test('Active duel: provisional tie-breaker A (round score dominates)', () => {
  const duel = built.find(m => !m.isBye);
  assert.strictEqual(duel.provisionalTieBreaker, 'A');
  assert.strictEqual(duel.provisionalMargin, 15);
});

// Duel with zero round points on both sides: no provisional winner yet
const zeroBracket = [
  { id: 'r1-m3', round: 1, matchNumber: 3,
    playerASeed: 2, playerAName: 'Player Two',
    playerBSeed: 3, playerBName: 'Player Three',
    isBye: false, status: 'pending', winnerSeed: null, winnerName: null, winnerReason: null, tieBreakerUsed: null },
];
const zeroParts = [
  { name: 'Player Two',   total: 80 },  // round score = 0
  { name: 'Player Three', total: 90 },  // round score = 0
];
const zeroBuilt = buildCupBracket(zeroBracket, zeroParts, frozenParticipants, { activeRound: 1 });
test('Active duel: no provisional winner when both round scores are 0', () => {
  const duel = zeroBuilt[0];
  assert.strictEqual(duel.isProvisional, false);
  assert.strictEqual(duel.provisionalWinnerSeed, null);
});

test('Active duel with official winner: provisional not set', () => {
  const officialBracket = [
    { id: 'r1-m4', round: 1, matchNumber: 4,
      playerASeed: 2, playerAName: 'Player Two',
      playerBSeed: 3, playerBName: 'Player Three',
      isBye: false, status: 'closed', winnerSeed: 3, winnerName: 'Player Three', winnerReason: 'round_score', tieBreakerUsed: 'A' },
  ];
  const result = buildCupBracket(officialBracket, liveParts, frozenParticipants, { activeRound: 1 });
  assert.strictEqual(result[0].isProvisional, false, 'official winner → no provisional override');
  assert.strictEqual(result[0].winnerSeed, 3, 'official winner preserved');
});

// ──────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`  Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log('═'.repeat(50));
process.exit(failed > 0 ? 1 : 0);
