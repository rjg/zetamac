'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../app-logic.js');

const { PLUS, MINUS, TIMES, DIV } = Z;

/* ---- helpers ---- */
// build a sessions array: N games on each given dayKey
function sessionsForDays(spec) {            // spec: { '2026-05-20': 5, ... }
  const out = [];
  for (const k of Object.keys(spec)) {
    const [y, m, d] = k.split('-').map(Number);
    for (let i = 0; i < spec[k]; i++)
      out.push({ endedAt: new Date(y, m - 1, d, 12, i).toISOString() });
  }
  return out;
}
const D = (y, m, d) => new Date(y, m - 1, d, 18, 0); // a fixed "today" at 6pm local

/* ===================== date helpers ===================== */
test('dayKey / addDays / parseKey roundtrip', () => {
  assert.equal(Z.dayKey(new Date(2026, 4, 9)), '2026-05-09');           // zero-pad month/day
  assert.equal(Z.dayKey(Z.addDays(new Date(2026, 0, 31), 1)), '2026-02-01'); // month rollover
  assert.equal(Z.dayKey(Z.parseKey('2026-12-25')), '2026-12-25');
});

/* ===================== fact folding ===================== */
test('canonFact folds +,× but preserves order for −,÷', () => {
  assert.equal(Z.factKey({ operation: TIMES, operand1: 7, operand2: 5 }),
               Z.factKey({ operation: TIMES, operand1: 5, operand2: 7 }));
  assert.notEqual(Z.factKey({ operation: DIV, operand1: 56, operand2: 7 }),
                  Z.factKey({ operation: DIV, operand1: 56, operand2: 8 }));
});

/* ===================== streak ===================== */
test('currentStreak counts consecutive met days, today-in-progress is forgiving', () => {
  const counts = Z.dayCounts(sessionsForDays({
    '2026-05-27': 5, '2026-05-28': 6, '2026-05-29': 2, // today only partial
  }));
  // today (29th) not met yet, but streak through 27-28 still stands
  assert.equal(Z.currentStreak(counts, {}, 5, D(2026, 5, 29)), 2);
  // once today is met it extends
  const counts2 = Z.dayCounts(sessionsForDays({
    '2026-05-27': 5, '2026-05-28': 6, '2026-05-29': 5,
  }));
  assert.equal(Z.currentStreak(counts2, {}, 5, D(2026, 5, 29)), 3);
});

test('currentStreak breaks on a fully missed day', () => {
  const counts = Z.dayCounts(sessionsForDays({
    '2026-05-26': 5, '2026-05-28': 5, '2026-05-29': 5, // 27th missed
  }));
  assert.equal(Z.currentStreak(counts, {}, 5, D(2026, 5, 29)), 2); // only 28,29
});

test('bestStreak finds the longest historical run', () => {
  const counts = Z.dayCounts(sessionsForDays({
    '2026-05-01': 5, '2026-05-02': 5, '2026-05-03': 5, // run of 3
    '2026-05-10': 5, '2026-05-11': 5,                   // run of 2
  }));
  assert.equal(Z.bestStreak(counts, {}, 5), 3);
});

test('frozen days count toward both current and best streak', () => {
  const counts = Z.dayCounts(sessionsForDays({
    '2026-05-27': 5, '2026-05-29': 5, // 28th missed but frozen
  }));
  const freezeDays = { '2026-05-28': true };
  assert.equal(Z.currentStreak(counts, freezeDays, 5, D(2026, 5, 29)), 3);
  assert.equal(Z.bestStreak(counts, freezeDays, 5), 3);
});

/* ===================== freeze reconciliation ===================== */
test('reconcile spends a freeze to bridge a single missed day', () => {
  const counts = Z.dayCounts(sessionsForDays({
    '2026-05-27': 5,                 // prior streak
    '2026-05-29': 5,                 // today met; 28th missed
  }));
  const progress = { freezes: 1, freezeDays: {} };
  const spent = Z.reconcileFreezes(counts, progress, D(2026, 5, 29), 5);
  assert.equal(spent, 1);
  assert.equal(progress.freezes, 0);
  assert.ok(progress.freezeDays['2026-05-28']);
  assert.equal(Z.currentStreak(counts, progress.freezeDays, 5, D(2026, 5, 29)), 3);
});

test('reconcile does NOT waste a freeze on an unbridgeable 2-day gap', () => {
  const counts = Z.dayCounts(sessionsForDays({
    '2026-05-26': 5,                 // prior streak
    '2026-05-29': 5,                 // 27 & 28 both missed
  }));
  const progress = { freezes: 1, freezeDays: {} };          // only one freeze
  const spent = Z.reconcileFreezes(counts, progress, D(2026, 5, 29), 5);
  assert.equal(spent, 0);                                   // can't bridge two with one
  assert.equal(progress.freezes, 1);                        // freeze preserved
  assert.deepEqual(progress.freezeDays, {});
});

test('reconcile bridges a 2-day gap when two freezes are held', () => {
  const counts = Z.dayCounts(sessionsForDays({
    '2026-05-26': 5, '2026-05-29': 5,
  }));
  const progress = { freezes: 2, freezeDays: {} };
  const spent = Z.reconcileFreezes(counts, progress, D(2026, 5, 29), 5);
  assert.equal(spent, 2);
  assert.equal(progress.freezes, 0);
  assert.equal(Z.currentStreak(counts, progress.freezeDays, 5, D(2026, 5, 29)), 4);
});

test('reconcile never touches today and never invents a streak from nothing', () => {
  const counts = Z.dayCounts(sessionsForDays({ '2026-05-29': 2 })); // only a partial today
  const progress = { freezes: 2, freezeDays: {} };
  const spent = Z.reconcileFreezes(counts, progress, D(2026, 5, 29), 5);
  assert.equal(spent, 0);
  assert.equal(progress.freezes, 2);
});

test('reconcile is idempotent across repeated renders the same day', () => {
  const counts = Z.dayCounts(sessionsForDays({ '2026-05-27': 5, '2026-05-29': 5 }));
  const progress = { freezes: 1, freezeDays: {} };
  Z.reconcileFreezes(counts, progress, D(2026, 5, 29), 5);
  const after = { freezes: progress.freezes, freezeDays: { ...progress.freezeDays } };
  Z.reconcileFreezes(counts, progress, D(2026, 5, 29), 5);   // run again
  assert.equal(progress.freezes, after.freezes);
  assert.deepEqual(progress.freezeDays, after.freezeDays);
});

/* ===================== XP / freezes ===================== */
test('xpForSession is the score; awardXp tracks balance + lifetime', () => {
  const p = Z.defaultProgress();
  assert.equal(Z.xpForSession({ score: 42 }), 42);
  Z.awardXp(p, 42); Z.awardXp(p, 8);
  assert.equal(p.xp, 50);
  assert.equal(p.xpLifetime, 50);
});

test('buyFreeze enforces cost (500) and the max-held cap (2)', () => {
  const p = Z.defaultProgress();
  p.xp = 400;
  assert.equal(Z.canBuyFreeze(p), false);
  assert.equal(Z.buyFreeze(p), false);                 // too poor
  p.xp = 1200;
  assert.equal(Z.buyFreeze(p), true);
  assert.equal(p.xp, 700); assert.equal(p.freezes, 1);
  assert.equal(Z.buyFreeze(p), true);
  assert.equal(p.xp, 200); assert.equal(p.freezes, 2);
  assert.equal(Z.canBuyFreeze(p), false);              // at cap, even if affordable
  p.xp = 5000;
  assert.equal(Z.buyFreeze(p), false);
  assert.equal(p.freezes, 2);
});

test('normalizeProgress repairs partial/garbage records', () => {
  assert.deepEqual(Z.normalizeProgress(null), Z.defaultProgress());
  const fixed = Z.normalizeProgress({ xp: -5, freezes: 9, freezeDays: null });
  assert.equal(fixed.xp, 0);
  assert.equal(fixed.freezes, Z.MAX_FREEZES);           // clamped to cap
  assert.deepEqual(fixed.freezeDays, {});
});

/* ===================== ghost ===================== */
test('pickGhost returns the best-rate session for the matching preset only', () => {
  const sessions = [
    { presetName: 'Normal', rate: 0.5, score: 60, sessionId: 'a' },
    { presetName: 'Normal', rate: 0.7, score: 84, sessionId: 'b' },
    { presetName: 'Fast', rate: 0.9, score: 54, sessionId: 'c' },
  ];
  assert.equal(Z.pickGhost(sessions, 'Normal').sessionId, 'b');
  assert.equal(Z.pickGhost(sessions, 'Hard'), null);
});

test('ghostScoreAt advances at a steady rate', () => {
  assert.equal(Z.ghostScoreAt(0.5, 10000), 5);   // 0.5/s for 10s
  assert.equal(Z.ghostScoreAt(0.5, 9000), 4);     // floors
  assert.equal(Z.ghostScoreAt(0, 10000), 0);
});

/* ===================== mastery grid ===================== */
test('masteryGrid folds ×, places by factor, and skips out-of-range facts', () => {
  const baseline = 1000;
  const problems = [
    { operation: TIMES, operand1: 7, operand2: 8, correctAnswer: 56, wasCorrect: true, msToAnswer: 900 },
    { operation: TIMES, operand1: 8, operand2: 7, correctAnswer: 56, wasCorrect: true, msToAnswer: 1100 }, // folds with above
    { operation: TIMES, operand1: 7, operand2: 50, correctAnswer: 350, wasCorrect: true, msToAnswer: 900 }, // 50 > maxN -> skipped
  ];
  const g = Z.masteryGrid(problems, TIMES, 12, baseline);
  const cell = g.cells[6][7]; // 7×8 -> indices 6,7
  assert.equal(cell.count, 2);
  assert.equal(cell.correct, 2);
  assert.equal(g.cells[6][6], null); // nothing at 7×7
});

test('masteryGrid maps ÷ onto divisor/quotient and grades levels', () => {
  // 56 ÷ 7 = 8  -> factors (7,8); fast & accurate -> strong
  const problems = [];
  for (let i = 0; i < 5; i++)
    problems.push({ operation: DIV, operand1: 56, operand2: 7, correctAnswer: 8, wasCorrect: true, msToAnswer: 800 });
  const g = Z.masteryGrid(problems, DIV, 12, 1000);
  const cell = g.cells[6][7]; // (7,8)
  assert.equal(cell.count, 5);
  assert.equal(cell.level, 3); // accuracy 1.0, avg 800 <= 1.3*1000
});

test('cellLevel grades weak (inaccurate or slow), ok, strong', () => {
  assert.equal(Z.cellLevel({ count: 0 }, 1000), 0);
  assert.equal(Z.cellLevel({ count: 5, correct: 2, totalMs: 1600 }, 1000), 1); // 40% accuracy
  assert.equal(Z.cellLevel({ count: 5, correct: 5, totalMs: 15000 }, 1000), 1); // avg 3000 > 2x baseline
  assert.equal(Z.cellLevel({ count: 5, correct: 5, totalMs: 4000 }, 1000), 3);  // avg 800, perfect
  assert.equal(Z.cellLevel({ count: 5, correct: 4, totalMs: 4800 }, 1000), 2);  // 80% acc, avg 1200 -> ok
});
