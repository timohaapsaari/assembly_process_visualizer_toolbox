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


/* ---------- Lots & resources ---------- */
const resources = {
  fix: { id: 'fix', name: 'Bonding fixtures', type: 'equipment', capacity: 6, lotSize: 1, calendar: '24_7' },
  oven: { id: 'oven', name: 'Curing oven', type: 'equipment', capacity: 1, lotSize: 20, calendar: 'shop' },
  cab: { id: 'cab', name: 'Test cabinet 1', type: 'equipment', capacity: 1, lotSize: 4, calendar: '24_7' },
  asm: { id: 'asm', name: 'Assemblers', type: 'labor', capacity: 2 }
};
const recipe2 = {
  id: 'r2', name: 'Lots', finalPartId: 'fin',
  steps: [
    { id: 'b', nr: 10, name: 'Bond', type: 'bonding', outputPartId: 'pist', components: [{ partId: 'seal', qty: 1 }], workMinutes: 25, workers: 1, fixedMinutes: 5, processHours: 12, resourceId: 'fix', transferPerLot: true },
    { id: 'a', nr: 20, name: 'Assemble', type: 'assembly', outputPartId: 'fin', components: [{ partId: 'pist', qty: 1 }, { partId: 'hous', qty: 1 }], workMinutes: 30, workers: 1, fixedMinutes: 0, processHours: 0, lotSize: 1, workerPoolId: 'asm' }
  ]
};
const mon = new Date(2026, 8, 14, 7, 0), fri = new Date(2026, 8, 25, 15, 30);

t('fixtures: 12 pcs on 6 fixtures with 12 h cure = 2 waves', () => {
  const res = S.schedule({ recipe: recipe2, partsById: parts, resourcesById: resources, qty: 12, due: fri, planStart: mon, calendar: cal });
  const b = res.rows.b;
  assert.strictEqual(b.nLots, 12); assert.strictEqual(b.waves, 2);
  assert.strictEqual(U.isoDateTime(b.lotsE[0].attStart), '2026-09-14 07:00');
  assert.strictEqual(U.isoDateTime(b.lotsE[0].procEnd), '2026-09-14 19:30');
  assert.strictEqual(U.isoDateTime(b.lotsE[5].attEnd), '2026-09-14 10:00');
  assert.strictEqual(U.isoDateTime(b.lotsE[6].attStart), '2026-09-15 07:00'); // waits for fixture 1
  assert.strictEqual(U.isoDateTime(b.EF), '2026-09-15 22:00');
});
t('transfer per lot lets assembly start on first cured piece', () => {
  const res = S.schedule({ recipe: recipe2, partsById: parts, resourcesById: resources, qty: 12, due: fri, planStart: mon, calendar: cal });
  const a = res.rows.a;
  assert.strictEqual(a.nLots, 12);
  assert.strictEqual(U.isoDateTime(a.lotsE[0].attStart), '2026-09-15 07:00'); // lot 0 cured Mon 19:30 -> Tue 07:00
  assert.strictEqual(U.isoDateTime(a.lotsE[6].attStart), '2026-09-16 07:00'); // 7th piece cured Tue 19:30
  const r2 = JSON.parse(JSON.stringify(recipe2)); r2.steps[0].transferPerLot = false;
  const res2 = S.schedule({ recipe: r2, partsById: parts, resourcesById: resources, qty: 12, due: fri, planStart: mon, calendar: cal });
  assert.strictEqual(U.isoDateTime(res2.rows.a.ES), '2026-09-16 07:00'); // waits for all cured (Tue 22:00)
});
t('backward lot schedule is feasible: forward from required start finishes by due', () => {
  const res = S.schedule({ recipe: recipe2, partsById: parts, resourcesById: resources, qty: 12, due: fri, planStart: mon, calendar: cal });
  assert.ok(res.rows.b.LF <= res.rows.a.LS || res.rows.b.transfer);
  assert.ok(res.requiredStart > mon);
  const res2 = S.schedule({ recipe: recipe2, partsById: parts, resourcesById: resources, qty: 12, due: fri, planStart: res.requiredStart, calendar: cal });
  assert.ok(res2.projectedFinish <= fri, 'finish ' + U.isoDateTime(res2.projectedFinish));
  // fixtures respected in the backward schedule too: lot j+6 starts after lot j cured
  const b = res.rows.b;
  for (let j = 0; j + 6 < b.nLots; j++) assert.ok(b.lotsL[j].procEnd <= b.lotsL[j + 6].attStart);
});
t('oven in shop calendar: 25 pcs, lot 20, 4 h -> 2 lots sequential', () => {
  const r3 = { id: 'r3', name: 'Oven', finalPartId: 'fin', steps: [{ id: 'o', nr: 10, name: 'Cure', type: 'bonding', outputPartId: 'fin', components: [{ partId: 'seal', qty: 1 }], workMinutes: 2, workers: 1, fixedMinutes: 10, processHours: 4, resourceId: 'oven' }] };
  const res = S.schedule({ recipe: r3, partsById: parts, resourcesById: resources, qty: 25, due: fri, planStart: mon, calendar: cal });
  const o = res.rows.o;
  assert.strictEqual(o.nLots, 2); assert.strictEqual(o.lotsE[1].units, 5);
  assert.strictEqual(U.isoDateTime(o.lotsE[0].attEnd), '2026-09-14 07:50'); // 10 + 40
  assert.strictEqual(U.isoDateTime(o.lotsE[0].procEnd), '2026-09-14 12:20'); // 4 h working incl. lunch
  assert.strictEqual(U.isoDateTime(o.lotsE[1].attStart), '2026-09-14 12:20'); // oven busy until then
});
t('resource conflicts detected across steps', () => {
  const r4 = { id: 'r4', name: 'Cab', finalPartId: 'fin', steps: [
    { id: 't1', nr: 10, name: 'Test A', type: 'test', outputPartId: 'pist', components: [{ partId: 'seal', qty: 1 }], workMinutes: 0, workers: 1, fixedMinutes: 10, processHours: 6, resourceId: 'cab' },
    { id: 't2', nr: 20, name: 'Test B', type: 'test', outputPartId: 'fin', components: [{ partId: 'hous', qty: 1 }], workMinutes: 0, workers: 1, fixedMinutes: 10, processHours: 6, resourceId: 'cab', extraPreds: [] },
    { id: 'f', nr: 30, name: 'Join', type: 'assembly', outputPartId: 'fin', components: [{ partId: 'pist', qty: 1 }, { partId: 'fin', qty: 1 }], workMinutes: 5, workers: 1 }
  ] };
  const res = S.schedule({ recipe: r4, partsById: parts, resourcesById: resources, qty: 4, due: fri, planStart: mon, calendar: cal });
  const load = S.resourceLoad(res, 'asap', 0);
  const cab = load.find(e => e.resource.id === 'cab');
  assert.ok(cab.conflicts.length >= 1, 'expected a double booking of the cabinet');
  assert.strictEqual(cab.peak, 2);
  const pool = S.resourceLoad(res, 'asap', 1).find(e => e.resource.general);
  assert.ok(pool.conflicts.length >= 1);
});

t('sub-assembly due date constrains its producing step and adds extra demand', () => {
  const ms = [{ partId: 'pist', due: new Date(2026, 8, 18, 15, 30), qty: 3 }];
  const res = S.schedule({ recipe, partsById: parts, qty: 10, due: new Date(2026, 8, 25, 15, 30), planStart: new Date(2026, 8, 14, 7, 0), calendar: cal, milestones: ms });
  assert.strictEqual(res.rows.s1.units, 13);
  assert.ok(res.rows.s1.LF <= ms[0].due, 'bond must finish by sub-assembly due: ' + U.isoDateTime(res.rows.s1.LF));
  assert.strictEqual(res.milestones.length, 1);
  assert.strictEqual(res.milestones[0].late, false);
  const res2 = S.schedule({ recipe, partsById: parts, qty: 10, due: new Date(2026, 8, 25, 15, 30), planStart: new Date(2026, 8, 14, 7, 0), calendar: cal, milestones: [{ partId: 'pist', due: new Date(2026, 8, 14, 9, 0) }] });
  assert.strictEqual(res2.milestones[0].late, true);
  assert.strictEqual(res2.startsInPast, true);
});

/* ---------- Yield & multi-shift calendars ---------- */
t('yield at a pass-through test raises assembly units and material demand', () => {
  const r5 = JSON.parse(JSON.stringify(recipe));
  r5.steps[2].yieldPct = 80; // pressure test on the same item, 80 % pass
  const res = S.schedule({ recipe: r5, partsById: parts, qty: 10, due: new Date(2026, 8, 25, 15, 30), planStart: new Date(2026, 8, 14, 7, 0), calendar: cal });
  assert.strictEqual(res.rows.s3.units, 13);   // ceil(10 / 0.8)
  assert.strictEqual(res.rows.s3.good, 10);
  assert.strictEqual(res.rows.s2.units, 13);   // final assembly must build 13
  assert.strictEqual(res.rows.s1.units, 13);   // and 13 piston sub-assemblies
  assert.strictEqual(res.purchases.find(p => p.partId === 'hous').qty, 13);
  assert.strictEqual(res.purchases.find(p => p.partId === 'seal').qty, 26);
  assert.strictEqual(res.totals.scrapUnits, 3);
});
t('yield on a producing step scales its own units and components', () => {
  const r6 = JSON.parse(JSON.stringify(recipe));
  r6.steps[0].yieldPct = 50; // bonding scrap
  const ex = S.explode(r6, parts, 10);
  assert.strictEqual(ex.units.s1, 20);
  assert.strictEqual(ex.purchases.find(p => p.partId === 'seal').qty, 40);
  assert.strictEqual(ex.units.s2, 10);
});
t('transfer per lot uses good units from a yielded predecessor', () => {
  const r7 = JSON.parse(JSON.stringify(recipe2));
  r7.steps[0].yieldPct = 50; // half the bonded rods fail
  const res = S.schedule({ recipe: r7, partsById: parts, resourcesById: resources, qty: 6, due: fri, planStart: mon, calendar: cal });
  assert.strictEqual(res.rows.b.units, 12);
  // assembly lot 1 (needs 1 good rod) can start once 2 rods are cured (goodCum 1.0)
  assert.strictEqual(U.isoDateTime(res.rows.a.lotsE[0].attStart), '2026-09-15 07:00');
  assert.strictEqual(res.rows.a.nLots, 6);
});
const twoShift = new Calendar({ shifts: [
  { days: [1, 2, 3, 4, 5], start: '06:00', end: '14:00', breakStart: '10:00', breakMinutes: 30 },
  { days: [1, 2, 3, 4], start: '14:00', end: '22:00', breakStart: '18:00', breakMinutes: 30 }
], holidays: [] });
t('two-shift calendar merges windows and counts minutes per day', () => {
  const w = twoShift.windows(new Date(2026, 8, 14)); // Monday
  assert.strictEqual(w.length, 3); // 06-10, 10:30-18, 18:30-22 (14:00 boundary merged)
  assert.strictEqual(U.hhmm(w[2].b), '22:00');
  assert.strictEqual(twoShift.minutesOn(new Date(2026, 8, 14)), 900);
  assert.strictEqual(twoShift.minutesOn(new Date(2026, 8, 18)), 450); // Friday, one shift
  assert.strictEqual(twoShift.addWorking(new Date(2026, 8, 14, 13, 0), 120).getHours(), 15);
});
t('worker pool on a two-shift calendar works evenings, one-shift pool does not', () => {
  const res2 = { asm: { id: 'asm', name: 'Assemblers', type: 'labor', capacity: 2 }, testers: { id: 'testers', name: 'Testers', type: 'labor', capacity: 1, calendarId: 'c2' } };
  const r8 = { id: 'r8', name: 'Shifts', finalPartId: 'fin', steps: [
    { id: 'a', nr: 10, name: 'Assemble', type: 'assembly', outputPartId: 'fin', components: [{ partId: 'hous', qty: 1 }], workMinutes: 60, workers: 1, workerPoolId: 'asm' },
    { id: 't', nr: 20, name: 'Test', type: 'test', outputPartId: 'fin', components: [{ partId: 'fin', qty: 1 }], workMinutes: 60, workers: 1, workerPoolId: 'testers' }
  ] };
  const res = S.schedule({ recipe: r8, partsById: parts, resourcesById: res2, calendarsById: { c2: twoShift }, qty: 8, due: fri, planStart: new Date(2026, 8, 14, 7, 0), calendar: cal });
  assert.strictEqual(U.isoDateTime(res.rows.a.EworkEnd), '2026-09-14 15:30'); // 8 h within the day shift
  assert.strictEqual(U.isoDateTime(res.rows.t.ES), '2026-09-14 15:30');       // testers keep going in the evening
  assert.strictEqual(U.isoDateTime(res.rows.t.EworkEnd), '2026-09-15 08:00'); // 15:30-18:00 + 18:30-22:00 = 6 h, remaining 2 h from 06:00 next day
});

t('deliverables: item delivered separately gets qty per product', () => {
  const r9 = JSON.parse(JSON.stringify(recipe));
  r9.steps.push({ id: 'k', nr: 40, name: 'Loader', type: 'assembly', outputPartId: 'seal', components: [{ partId: 'hous', qty: 1 }], workMinutes: 10, workers: 1 });
  // 'seal' is also consumed by s1 (2 per piston) -> demand from tree + 6 per product delivered separately
  r9.deliverables = [{ partId: 'seal', qtyPerProduct: 6 }];
  const ex = S.explode(r9, parts, 10);
  assert.strictEqual(ex.units.k, 20 + 60);
  assert.ok(!ex.warnings.some(w => /not used/.test(w.text)));
  delete r9.deliverables;
  const ex2 = S.explode(r9, parts, 10);
  assert.strictEqual(ex2.units.k, 20); // consumed by s1 so no orphan rule
});

t('pass-through chain: assembly -> dispensing -> curing -> testing on one item', () => {
  const r10 = { id: 'r10', name: 'Chain', finalPartId: 'fin', steps: [
    { id: 'a', nr: 10, name: 'Assembly', type: 'assembly', outputPartId: 'fin', components: [{ partId: 'hous', qty: 1 }, { partId: 'seal', qty: 2 }], workMinutes: 30, workers: 1 },
    { id: 'd', nr: 20, name: 'Dispensing', type: 'bonding', outputPartId: 'fin', components: [{ partId: 'fin', qty: 1 }], workMinutes: 5, workers: 1, transferPerLot: true, lotSize: 1 },
    { id: 'c', nr: 30, name: 'Curing', type: 'bonding', outputPartId: 'fin', components: [{ partId: 'fin', qty: 1 }], workMinutes: 1, workers: 1, processHours: 12, resourceId: 'oven', transferPerLot: true },
    { id: 't', nr: 40, name: 'Testing', type: 'test', outputPartId: 'fin', components: [{ partId: 'fin', qty: 1 }], workMinutes: 10, workers: 1, yieldPct: 90 }
  ] };
  const g = S.buildGraph(r10, parts);
  assert.deepStrictEqual(g.order, ['a', 'd', 'c', 't']);
  assert.strictEqual(g.cycle, false);
  assert.ok(g.preds.t.has('c') && g.preds.c.has('d') && g.preds.d.has('a'));
  const res = S.schedule({ recipe: r10, partsById: parts, resourcesById: resources, qty: 9, due: fri, planStart: mon, calendar: cal });
  assert.strictEqual(res.rows.t.units, 10);   // 9 good out of 90 %
  assert.strictEqual(res.rows.a.units, 10);   // assembly builds 10
  assert.strictEqual(res.purchases.find(p => p.partId === 'seal').qty, 20);
  assert.ok(res.rows.t.ES >= res.rows.c.EF - 60000);
  assert.ok(!res.warnings.length, JSON.stringify(res.warnings));
});

t('recipe chain: sub-recipes are pulled in through their final products', () => {
  const partsC = Object.assign({}, parts, { a1: { id: 'a1', itemNr: 'A-1', name: 'Assembly 1', type: 'manufactured' }, a2: { id: 'a2', itemNr: 'A-2', name: 'Assembly 2', type: 'manufactured' } });
  const rFinal = { id: 'rf', name: 'Final product', finalPartId: 'fin', steps: [{ id: 'f1', nr: 10, name: 'Final assembly', type: 'assembly', outputPartId: 'fin', components: [{ partId: 'a1', qty: 2 }, { partId: 'hous', qty: 1 }], workMinutes: 60, workers: 1 }] };
  const rA1 = { id: 'ra1', name: 'Assembly 1', finalPartId: 'a1', steps: [{ id: 'g1', nr: 10, name: 'Build A1', type: 'subassembly', outputPartId: 'a1', components: [{ partId: 'a2', qty: 3 }], workMinutes: 30, workers: 1 }] };
  const rA2 = { id: 'ra2', name: 'Assembly 2', finalPartId: 'a2', steps: [
    { id: 'h1', nr: 10, name: 'Assembly', type: 'assembly', outputPartId: 'a2', components: [{ partId: 'seal', qty: 1 }], workMinutes: 10, workers: 1 },
    { id: 'h2', nr: 20, name: 'Testing', type: 'test', outputPartId: 'a2', components: [{ partId: 'a2', qty: 1 }], workMinutes: 5, workers: 1, yieldPct: 50 }
  ] };
  const rx = S.expandRecipe(rFinal, [rFinal, rA1, rA2], partsC);
  assert.strictEqual(rx.expanded, true);
  assert.strictEqual(rx.steps.length, 4);
  assert.deepStrictEqual(rx.subRecipes.map(x => x.code), ['A1', 'A2']);
  const res = S.schedule({ recipe: rx, partsById: partsC, qty: 1, due: fri, planStart: mon, calendar: cal });
  assert.strictEqual(res.rows['ra1:g1'].units, 2);
  assert.strictEqual(res.rows['ra2:h2'].units, 12);  // 6 good needed / 50 %
  assert.strictEqual(res.rows['ra2:h1'].units, 12);
  assert.strictEqual(res.purchases.find(p => p.partId === 'seal').qty, 12);
  assert.ok(!res.purchases.some(p => p.partId === 'a1' || p.partId === 'a2'));
  assert.ok(res.rows.f1.ES >= res.rows['ra1:g1'].EF - 60000);
  assert.ok(!res.warnings.length, JSON.stringify(res.warnings));
  // unexpanded: assemblies look purchased
  const plain = S.schedule({ recipe: rFinal, partsById: partsC, qty: 1, due: fri, planStart: mon, calendar: cal });
  assert.ok(plain.purchases.some(p => p.partId === 'a1'));
});

t('continues-previous chain: only the last step names the item', () => {
  const r11 = { id: 'r11', name: 'Chain2', finalPartId: 'fin', steps: [
    { id: 'a', nr: 10, name: 'Assembly', type: 'assembly', outputPartId: null, components: [{ partId: 'hous', qty: 1 }, { partId: 'seal', qty: 2 }], workMinutes: 30, workers: 1 },
    { id: 'd', nr: 20, name: 'Dispensing', type: 'bonding', outputPartId: null, components: [{ partId: 'seal', qty: 0.1 }], workMinutes: 5, workers: 1, continuesPrevious: true },
    { id: 'c', nr: 30, name: 'Curing', type: 'bonding', outputPartId: null, components: [], workMinutes: 1, workers: 1, processHours: 12, resourceId: 'oven', continuesPrevious: true, transferPerLot: true },
    { id: 't', nr: 40, name: 'Testing', type: 'test', outputPartId: 'fin', components: [], workMinutes: 10, workers: 1, yieldPct: 90, continuesPrevious: true }
  ] };
  const rr = S.resolveRecipe(r11);
  assert.deepStrictEqual(rr.steps.map(s => s.outputPartId), ['fin', 'fin', 'fin', 'fin']);
  assert.strictEqual(rr.steps[1].components[0].partId, 'fin');           // implicit input from step 10
  assert.strictEqual(rr.steps[1].components.length, 2);                   // plus the adhesive
  assert.strictEqual(rr.steps[3].chainNamedBy, null);                     // names it itself
  assert.strictEqual(rr.steps[0].chainNamedBy, 40);
  assert.strictEqual(r11.steps[0].outputPartId, null);                    // original untouched
  const g = S.buildGraph(r11, parts);
  assert.deepStrictEqual(g.order, ['a', 'd', 'c', 't']);
  assert.ok(!g.warnings.length, JSON.stringify(g.warnings));
  const res = S.schedule({ recipe: r11, partsById: parts, resourcesById: resources, qty: 9, due: fri, planStart: mon, calendar: cal });
  assert.strictEqual(res.rows.a.units, 10);
  assert.strictEqual(res.purchases.find(p => p.partId === 'hous').qty, 10);
  assert.strictEqual(U.round(res.purchases.find(p => p.partId === 'seal').qty, 2), 21);  // 2×10 + 0.1×10
});
t('continues-previous chain without any item is reported', () => {
  const r12 = { id: 'r12', name: 'Bad', finalPartId: 'fin', steps: [
    { id: 'a', nr: 10, name: 'A', type: 'assembly', outputPartId: null, components: [{ partId: 'hous', qty: 1 }] },
    { id: 'b', nr: 20, name: 'B', type: 'test', outputPartId: null, components: [], continuesPrevious: true }
  ] };
  const g = S.buildGraph(r12, parts);
  assert.ok(g.warnings.some(w => w.level === 'error' && /no item/.test(w.text)));
});
t('chained sub-recipe with a continues chain resolves inside its own recipe', () => {
  const partsC = Object.assign({}, parts, { a2: { id: 'a2', itemNr: 'A-2', name: 'Assembly 2', type: 'manufactured' } });
  const rFinal = { id: 'rf', name: 'Final', finalPartId: 'fin', steps: [{ id: 'f1', nr: 10, name: 'Final assembly', type: 'assembly', outputPartId: 'fin', components: [{ partId: 'a2', qty: 1 }], workMinutes: 10, workers: 1 }] };
  const rA2 = { id: 'ra2', name: 'Assembly 2', finalPartId: 'a2', steps: [
    { id: 'h1', nr: 10, name: 'Assemble', type: 'assembly', outputPartId: null, components: [{ partId: 'seal', qty: 1 }], workMinutes: 10, workers: 1 },
    { id: 'h2', nr: 20, name: 'Test', type: 'test', outputPartId: 'a2', components: [], workMinutes: 5, workers: 1, continuesPrevious: true }
  ] };
  const rx = S.expandRecipe(rFinal, [rFinal, rA2], partsC);
  assert.strictEqual(rx.steps.length, 3);
  const res = S.schedule({ recipe: rx, partsById: partsC, qty: 4, due: fri, planStart: mon, calendar: cal });
  assert.ok(!res.warnings.length, JSON.stringify(res.warnings));
  assert.strictEqual(res.rows['ra2:h1'].units, 4);
  assert.strictEqual(res.rows['ra2:h1'].step.outputPartId, 'a2');
});
console.log('\n' + passed + ' tests passed' + (process.exitCode ? ', some FAILED' : ''));
