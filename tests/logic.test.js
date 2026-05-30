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

/* ===================== opStats ===================== */
test('opStats aggregates per op, in OP_ORDER, skipping ops with no data', () => {
  const problems = [
    { operation: PLUS, msToAnswer: 1000, wasCorrect: true },
    { operation: PLUS, msToAnswer: 3000, wasCorrect: false },
    { operation: TIMES, msToAnswer: 2000, wasCorrect: true },
  ];
  const rows = Z.opStats(problems);
  assert.deepEqual(rows.map(r => r.op), [PLUS, TIMES]); // MINUS/DIV absent, order preserved
  const add = rows[0];
  assert.equal(add.count, 2);
  assert.equal(add.errors, 1);
  assert.equal(add.avgMs, 2000); // (1000+3000)/2
});

test('opStats flags the single slowest operation (first wins on a tie)', () => {
  const problems = [
    { operation: PLUS, msToAnswer: 1000, wasCorrect: true },
    { operation: TIMES, msToAnswer: 5000, wasCorrect: true },
    { operation: DIV, msToAnswer: 5000, wasCorrect: true },
  ];
  const rows = Z.opStats(problems);
  const slowest = rows.filter(r => r.slowest);
  assert.equal(slowest.length, 1);
  assert.equal(slowest[0].op, TIMES); // ties broken by OP_ORDER (× before ÷)
});

test('opStats on no problems is an empty list', () => {
  assert.deepEqual(Z.opStats([]), []);
});

/* ===================== computeWeakFacts ===================== */
test('computeWeakFacts ranks misses and slow facts above fast/accurate ones', () => {
  const fact = (op, o1, o2, ok, ms) =>
    ({ operation: op, operand1: o1, operand2: o2, wasCorrect: ok, msToAnswer: ms });
  const key = f => f.operation + ':' + f.operand1 + ':' + f.operand2;
  const problems = [
    // 7×8: fast and always right -> should rank LAST
    fact(TIMES, 7, 8, true, 800), fact(TIMES, 7, 8, true, 900),
    // 6×9: solved but slow -> a weak fact
    fact(TIMES, 6, 9, true, 4000), fact(TIMES, 6, 9, true, 4200),
    // 8×8: high miss rate -> a weak fact
    fact(TIMES, 8, 8, false, 0), fact(TIMES, 8, 8, true, 1500), fact(TIMES, 8, 8, false, 0),
  ];
  const weak = Z.computeWeakFacts(problems, 10);
  // both the slow fact and the missed fact outrank the fast/accurate one
  assert.equal(key(weak[weak.length - 1]), '×:7:8');
  assert.deepEqual(new Set([key(weak[0]), key(weak[1])]), new Set(['×:6:9', '×:8:8']));
  // correctAnswer is filled in for the challenge pool to reuse
  const m78 = weak.find(f => f.operand1 === 7 && f.operand2 === 8);
  assert.equal(m78.correctAnswer, 56);
});

test('computeWeakFacts folds commutative facts and skips singletons', () => {
  const fact = (op, o1, o2, ok, ms) =>
    ({ operation: op, operand1: o1, operand2: o2, wasCorrect: ok, msToAnswer: ms });
  const problems = [
    fact(TIMES, 7, 8, true, 1000),  // folds with 8×7 -> count 2, kept
    fact(TIMES, 8, 7, true, 1200),
    fact(TIMES, 3, 4, true, 1000),  // seen once -> skipped
  ];
  const weak = Z.computeWeakFacts(problems, 10);
  assert.equal(weak.length, 1);
  assert.equal(weak[0].operand1, 7);
  assert.equal(weak[0].operand2, 8);
  assert.equal(weak[0]._count, 2);
});

test('computeWeakFacts returns [] when nothing has been solved correctly', () => {
  const problems = [
    { operation: PLUS, operand1: 2, operand2: 3, wasCorrect: false, msToAnswer: 0 },
    { operation: PLUS, operand1: 2, operand2: 3, wasCorrect: false, msToAnswer: 0 },
  ];
  assert.deepEqual(Z.computeWeakFacts(problems, 10), []);
});

test('computeWeakFacts honors the topN cap', () => {
  const problems = [];
  for (let n = 2; n <= 9; n++)              // 8 distinct facts, each seen twice
    for (let i = 0; i < 2; i++)
      problems.push({ operation: TIMES, operand1: 2, operand2: n, wasCorrect: true, msToAnswer: 1000 * n });
  const weak = Z.computeWeakFacts(problems, 3);
  assert.equal(weak.length, 3);
});

/* ===================== genProblem (invariants) ===================== */
test('genProblem always yields a well-formed, in-range, exactly-solvable problem', () => {
  // a wide config that exercises every op and a range that admits 1
  const cfg = {
    ops: { add: true, sub: true, mul: true, div: true },
    add: { min1: 2, max1: 100, min2: 2, max2: 100 },
    mul: { min1: 2, max1: 12, min2: 2, max2: 100 },
  };
  // deterministic PRNG so a failure is reproducible (mulberry32)
  let s = 0x9e3779b9;
  const rng = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 5000; i++) {
    const p = Z.genProblem(cfg, rng);
    // answer matches the stated operation
    assert.equal(Z.answerFor(p.operation, p.operand1, p.operand2), p.correctAnswer);
    // never a negative subtraction
    if (p.operation === MINUS) assert.ok(p.operand1 >= p.operand2, `negative sub: ${p.display}`);
    // division is always exact and integer
    if (p.operation === DIV) {
      assert.ok(Number.isInteger(p.correctAnswer), `non-integer div: ${p.display}`);
      assert.equal(p.operand1 % p.operand2, 0, `inexact div: ${p.display}`);
    }
    // display reads "o1 op o2"
    assert.equal(p.display, p.operand1 + ' ' + p.operation + ' ' + p.operand2);
  }
});

test('genProblem only emits enabled operations', () => {
  const cfg = {
    ops: { add: false, sub: false, mul: true, div: false },
    add: { min1: 1, max1: 9, min2: 1, max2: 9 },
    mul: { min1: 2, max1: 9, min2: 2, max2: 9 },
  };
  let i = 0;
  const rng = () => ((i++ * 0.137) % 1); // cheap spread across [0,1)
  for (let n = 0; n < 200; n++) assert.equal(Z.genProblem(cfg, rng).operation, TIMES);
});

test('genProblem never divides by zero even when the mul range admits 0', () => {
  // the input layer accepts min >= 0, so a 0-inclusive mul range must not
  // produce a 0 / 0 (or anything / 0) problem with a bogus stored answer
  const cfg = {
    ops: { add: false, sub: false, mul: false, div: true },
    add: { min1: 1, max1: 9, min2: 1, max2: 9 },
    mul: { min1: 0, max1: 0, min2: 2, max2: 4 },
  };
  let i = 0;
  const rng = () => ((i++ * 0.137) % 1);
  for (let n = 0; n < 500; n++) {
    const p = Z.genProblem(cfg, rng);
    assert.equal(p.operation, DIV);
    assert.ok(p.operand2 >= 1, `divisor < 1: ${p.display}`);
    // the stored answer must be the true quotient, not an unrelated factor
    assert.equal(Z.answerFor(p.operation, p.operand1, p.operand2), p.correctAnswer, `bad div: ${p.display}`);
    assert.ok(Number.isInteger(p.correctAnswer), `non-integer div: ${p.display}`);
  }
});
