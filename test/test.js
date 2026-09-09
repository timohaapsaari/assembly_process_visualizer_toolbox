/* Run: node test/test.js */
const assert = require('assert');
const U = require('../js/util.js');
const Calendar = require('../js/calendar.js');
const S = require('../js/scheduler.js');

let passed = 0;
function t(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } }

const cal = new Calendar({ workdays: [1, 2, 3, 4, 5], shiftStart: '07:00', shiftEnd: '15:30', breakStart: '11:00', breakMinutes: 30, holidays: ['2026-09-18'] });

t('minutes per day', () => assert.strictEqual(cal.minutesPerDay(), 480));

t('snapForward on weekend goes to Monday 07:00', () => {
  const d = cal.snapForward(new Date(2026, 8, 12, 10, 0)); // Sat 12.9.2026
  assert.strictEqual(U.isoDateTime(d), '2026-09-14 07:00');
});
t('snapBackward from Monday 06:00 goes to Friday 15:30', () => {
  const d = cal.snapBackward(new Date(2026, 8, 14, 6, 0));
  assert.strictEqual(U.isoDateTime(d), '2026-09-11 15:30');
});
t('snapBackward skips holiday', () => {
  const d = cal.snapBackward(new Date(2026, 8, 18, 12, 0)); // Fri 18.9 holiday
  assert.strictEqual(U.isoDateTime(d), '2026-09-17 15:30');
});
t('addWorking crosses lunch', () => {
  const d = cal.addWorking(new Date(2026, 8, 14, 10, 30), 60); // 10:30 + 60 -> 30 to 11:00, break, 30 -> 12:00
  assert.strictEqual(U.isoDateTime(d), '2026-09-14 12:00');
});
t('addWorking crosses day and weekend', () => {
  const d = cal.addWorking(new Date(2026, 8, 11, 15, 0), 60); // Fri 15:00 + 60: 30 today, 30 Monday
  assert.strictEqual(U.isoDateTime(d), '2026-09-14 07:30');
});
t('subtractWorking crosses lunch', () => {
  const d = cal.subtractWorking(new Date(2026, 8, 14, 12, 0), 60);
  assert.strictEqual(U.isoDateTime(d), '2026-09-14 10:30');
});
t('subtractWorking crosses weekend', () => {
  const d = cal.subtractWorking(new Date(2026, 8, 14, 7, 30), 60);
  assert.strictEqual(U.isoDateTime(d), '2026-09-11 15:00');
});
t('subtract then add roundtrip 3 days', () => {
  const end = new Date(2026, 8, 17, 15, 30);
  const start = cal.subtractWorking(end, 3 * 480);
  assert.strictEqual(U.isoDateTime(start), '2026-09-15 07:00');
  assert.strictEqual(U.isoDateTime(cal.addWorking(start, 3 * 480)), '2026-09-17 15:30');
});
t('workingMinutesBetween', () => {
  assert.strictEqual(cal.workingMinutesBetween(new Date(2026, 8, 14, 7, 0), new Date(2026, 8, 15, 15, 30)), 960);
  assert.strictEqual(cal.workingMinutesBetween(new Date(2026, 8, 11, 0, 0), new Date(2026, 8, 14, 23, 0)), 960);
});
t('cure uses calendar time', () => {
  const d = cal.subtractCure(new Date(2026, 8, 14, 7, 0), 12);
  assert.strictEqual(U.isoDateTime(d), '2026-09-13 19:00');
});

/* ---------- CSV ---------- */
t('csv parse with semicolons, quotes and decimal comma', () => {
  const r = U.parseCSV('item_nr;name;work_minutes\r\nA-1;"Housing, machined";12,5\r\nA-2;Rod;3');
  assert.strictEqual(r.delimiter, ';');
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.rows[0].name, 'Housing, machined');
  assert.strictEqual(U.num(r.rows[0].work_minutes), 12.5);
});
t('csv roundtrip', () => {
  const csv = U.toCSV([{ a: 'x,y', b: 'he said "hi"' }], [{ key: 'a' }, { key: 'b' }]);
  const back = U.parseCSV(csv);
  assert.strictEqual(back.rows[0].a, 'x,y');
  assert.strictEqual(back.rows[0].b, 'he said "hi"');
});

/* ---------- Scheduler ---------- */
const parts = {
  hous: { id: 'hous', itemNr: 'P-100', name: 'Housing', type: 'purchased', leadTimeDays: 14 },
  seal: { id: 'seal', itemNr: 'P-200', name: 'Seal', type: 'purchased', leadTimeDays: 3 },
  pist: { id: 'pist', itemNr: 'S-300', name: 'Piston sub-assy', type: 'manufactured' },
  fin:  { id: 'fin', itemNr: 'F-001', name: 'Actuator', type: 'manufactured' }
};
const recipe = {
  id: 'r1', name: 'Actuator', finalPartId: 'fin',
  steps: [
    { id: 's1', nr: 10, name: 'Bond seal', type: 'bonding', outputPartId: 'pist', components: [{ partId: 'seal', qty: 2 }], workMinutes: 30, workers: 1, fixedMinutes: 0, cureHours: 12 },
    { id: 's2', nr: 20, name: 'Final assembly', type: 'assembly', outputPartId: 'fin', components: [{ partId: 'hous', qty: 1 }, { partId: 'pist', qty: 1 }], workMinutes: 60, workers: 2, fixedMinutes: 30, cureHours: 0 },
    { id: 's3', nr: 30, name: 'Pressure test', type: 'test', outputPartId: 'fin', components: [{ partId: 'fin', qty: 1 }], workMinutes: 15, workers: 1, fixedMinutes: 45, cureHours: 0 }
  ]
};

t('graph derives dependencies incl. pass-through test', () => {
  const g = S.buildGraph(recipe, parts);
  assert.deepStrictEqual(g.order, ['s1', 's2', 's3']);
  assert.ok(g.preds.s3.has('s2'));
  assert.ok(!g.preds.s2.has('s3'));
  assert.strictEqual(g.cycle, false);
});
t('explosion computes units and purchase demand', () => {
  const ex = S.explode(recipe, parts, 10);
  assert.strictEqual(ex.units.s1, 10);
  assert.strictEqual(ex.units.s2, 10);
  assert.strictEqual(ex.units.s3, 10);
  const seal = ex.purchases.find(p => p.partId === 'seal');
  assert.strictEqual(seal.qty, 20);
});
t('backward schedule ends at due and respects cure + calendar', () => {
  const due = new Date(2026, 8, 25, 15, 30); // Fri
  const res = S.schedule({ recipe, partsById: parts, qty: 10, due, planStart: new Date(2026, 8, 7, 7, 0), calendar: cal });
  const s3 = res.rows.s3, s2 = res.rows.s2, s1 = res.rows.s1;
  // test: 45 + 15*10/1 = 195 min -> from 15:30 back: 12:15
  assert.strictEqual(U.isoDateTime(s3.LF), '2026-09-25 15:30');
  assert.strictEqual(U.isoDateTime(s3.LS), '2026-09-25 12:15');
  // assembly: 30 + 60*10/2 = 330 min; ends 12:15 -> back over lunch 11:00-11:30 -> 06:15 previous... => Thu 24.9 14:15? compute: 12:15 -> 11:30 is 45; remaining 285; 11:00 back 240 -> 07:00; remaining 45 -> Thu 15:30-45 = 14:45
  assert.strictEqual(U.isoDateTime(s2.LworkEnd), '2026-09-25 12:15');
  assert.strictEqual(U.isoDateTime(s2.LS), '2026-09-24 14:45');
  // bonding: must cure 12h before Thu 14:45 -> Thu 02:45 -> snap back Wed 15:30; work 300 min -> Wed 09:30 (15:30-11:30=240, 11:00-10:00 = 60)
  assert.strictEqual(U.isoDateTime(s1.LworkEnd), '2026-09-23 15:30');
  assert.strictEqual(U.isoDateTime(s1.LS), '2026-09-23 10:00');
  assert.strictEqual(U.isoDateTime(s1.LF), '2026-09-24 03:30');
  assert.strictEqual(res.startsInPast, false);
  assert.strictEqual(res.late, false);
  assert.ok(res.rows.s1.critical && res.rows.s2.critical && res.rows.s3.critical);
  const hous = res.purchases.find(p => p.partId === 'hous');
  assert.strictEqual(U.isoDate(hous.orderByJIT), '2026-09-10');
});
t('forward schedule from plan start', () => {
  const start = new Date(2026, 8, 14, 7, 0);
  const res = S.schedule({ recipe, partsById: parts, qty: 10, due: new Date(2026, 8, 25, 15, 30), planStart: start, calendar: cal });
  assert.strictEqual(U.isoDateTime(res.rows.s1.ES), '2026-09-14 07:00');
  assert.strictEqual(U.isoDateTime(res.rows.s1.EworkEnd), '2026-09-14 12:30'); // 300 min incl lunch
  assert.strictEqual(U.isoDateTime(res.rows.s1.EF), '2026-09-15 00:30');
  assert.strictEqual(U.isoDateTime(res.rows.s2.ES), '2026-09-15 07:00');
  assert.ok(res.projectedFinish < res.due);
});
t('infeasible plan is flagged', () => {
  const res = S.schedule({ recipe, partsById: parts, qty: 200, due: new Date(2026, 8, 15, 15, 30), planStart: new Date(2026, 8, 14, 7, 0), calendar: cal });
  assert.strictEqual(res.startsInPast, true);
  assert.strictEqual(res.late, true);
  assert.ok(res.shortMinutes > 0);
});
t('cycle detection', () => {
  const r2 = U.deepClone(recipe);
  r2.steps[0].extraPreds = ['s3'];
  const g = S.buildGraph(r2, parts);
  assert.strictEqual(g.cycle, true);
});
t('load profile', () => {
  const res = S.schedule({ recipe, partsById: parts, qty: 10, due: new Date(2026, 8, 25, 15, 30), planStart: new Date(2026, 8, 14, 7, 0), calendar: cal });
  const lp = S.loadProfile(res, 'jit');
  const fri = lp.find(d => d.date === '2026-09-25');
  assert.ok(fri.peakWorkers >= 2);
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ', some FAILED' : ''));
