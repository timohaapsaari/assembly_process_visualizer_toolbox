/* Assembly scheduler: dependency graph, quantity explosion, backward (JIT) and forward (ASAP) passes.
   Pure functions; browser + Node. */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const U = isNode ? require('./util.js') : root.U;
  const Calendar = isNode ? require('./calendar.js') : root.Calendar;

  const S = {};

  S.STEP_TYPES = [
    { id: 'assembly',    label: 'Assembly',        color: '#2f6fed' },
    { id: 'subassembly', label: 'Sub-assembly',    color: '#4f9bff' },
    { id: 'bonding',     label: 'Bonding / curing', color: '#c46a1c' },
    { id: 'test',        label: 'Test',            color: '#7c3aed' },
    { id: 'inspection',  label: 'Inspection',      color: '#0e9f6e' },
    { id: 'packaging',   label: 'Packaging',       color: '#64748b' },
    { id: 'other',       label: 'Other',           color: '#94a3b8' }
  ];
  S.typeInfo = id => S.STEP_TYPES.find(t => t.id === id) || S.STEP_TYPES[S.STEP_TYPES.length - 1];

  /** Duration of the work portion of a step in working minutes for the given number of units. */
  S.stepWorkMinutes = function (step, units) {
    const workers = Math.max(1, U.num(step.workers, 1));
    const fixed = Math.max(0, U.num(step.fixedMinutes, 0));
    const perUnit = Math.max(0, U.num(step.workMinutes, 0));
    return fixed + (perUnit * units) / workers;
  };
  /** Labor hours (man-hours) for a step. */
  S.stepLaborHours = function (step, units) {
    const workers = Math.max(1, U.num(step.workers, 1));
    const fixed = Math.max(0, U.num(step.fixedMinutes, 0));
    const perUnit = Math.max(0, U.num(step.workMinutes, 0));
    return (fixed * workers + perUnit * units) / 60;
  };

  /**
   * Build the precedence graph. Edges: producer -> consumer (component part produced by another step),
   * plus explicit extra predecessors. Returns {order, preds, succs, cycle, warnings}.
   */
  S.buildGraph = function (recipe, partsById) {
    const steps = recipe.steps || [];
    const byId = {};
    steps.forEach(s => { byId[s.id] = s; });
    const producers = {};   // partId -> [stepId]
    steps.forEach(s => { if (s.outputPartId) (producers[s.outputPartId] = producers[s.outputPartId] || []).push(s.id); });

    const preds = {}, succs = {}, warnings = [];
    steps.forEach(s => { preds[s.id] = new Set(); succs[s.id] = new Set(); });

    steps.forEach(s => {
      (s.components || []).forEach(c => {
        (producers[c.partId] || []).forEach(pid => {
          if (pid === s.id) return;
          const p = byId[pid];
          // A pass-through step (output == one of its inputs) must not become the predecessor of the
          // step that originally produced that part.
          const sIsPassThrough = s.outputPartId && s.outputPartId === c.partId;
          const pIsPassThrough = p.outputPartId && (p.components || []).some(pc => pc.partId === p.outputPartId);
          if (sIsPassThrough && pIsPassThrough) {
            // both pass-through on same part: order by step sequence (list order)
            const ia = steps.indexOf(p), ib = steps.indexOf(s);
            if (ia > ib) return;
          } else if (sIsPassThrough && !pIsPassThrough) {
            // p produces the part, s processes it: p -> s (ok)
          } else if (!sIsPassThrough && pIsPassThrough) {
            // s consumes a part that p only processes: p -> s (ok)
          }
          preds[s.id].add(pid); succs[pid].add(s.id);
        });
      });
      (s.extraPreds || []).forEach(pid => {
        if (byId[pid] && pid !== s.id) { preds[s.id].add(pid); succs[pid].add(s.id); }
      });
    });

    // Kahn topological sort
    const indeg = {}; steps.forEach(s => { indeg[s.id] = preds[s.id].size; });
    const queue = steps.filter(s => indeg[s.id] === 0).map(s => s.id);
    const order = [];
    while (queue.length) {
      const id = queue.shift(); order.push(id);
      succs[id].forEach(n => { if (--indeg[n] === 0) queue.push(n); });
    }
    const cycle = order.length !== steps.length;
    if (cycle) {
      const inCycle = steps.filter(s => order.indexOf(s.id) < 0).map(s => s.nr + ' ' + s.name);
      warnings.push({ level: 'error', text: 'Circular dependency between steps: ' + inCycle.join(', ') });
    }

    // Diagnostics
    steps.forEach(s => {
      if (!s.outputPartId) warnings.push({ level: 'warn', text: 'Step ' + s.nr + ' "' + s.name + '" has no output part.' });
      (s.components || []).forEach(c => {
        if (!partsById[c.partId]) warnings.push({ level: 'warn', text: 'Step ' + s.nr + ' uses an unknown part.' });
      });
    });
    Object.keys(producers).forEach(pid => {
      const nonPass = producers[pid].filter(sid => !(byId[sid].components || []).some(c => c.partId === pid));
      if (nonPass.length > 1) {
        const p = partsById[pid];
        warnings.push({ level: 'warn', text: 'Part ' + (p ? p.itemNr : pid) + ' is produced by ' + nonPass.length + ' steps; each is scheduled for the full demand.' });
      }
    });

    return { order, preds, succs, cycle, warnings, producers, byId };
  };

  /**
   * Quantity explosion: how many units each step must produce for `qty` of the recipe's final part,
   * and the demand for purchased (non-produced) parts.
   */
  S.explode = function (recipe, partsById, qty, graph) {
    graph = graph || S.buildGraph(recipe, partsById);
    const demand = {};  // partId -> units
    const units = {};   // stepId -> units
    const warnings = [];
    const finalId = recipe.finalPartId;
    if (finalId) demand[finalId] = qty;
    else warnings.push({ level: 'error', text: 'Recipe has no final product part selected.' });

    const producedParts = new Set(Object.keys(graph.producers));
    const rev = graph.order.slice().reverse(); // consumers first
    rev.forEach(sid => {
      const s = graph.byId[sid];
      let u;
      if (s.outputPartId && demand[s.outputPartId] != null) u = demand[s.outputPartId];
      else if (s.outputPartId && s.outputPartId !== finalId && graph.succs[sid].size === 0) {
        u = qty; // orphan output: assume one per product
        warnings.push({ level: 'warn', text: 'Step ' + s.nr + ' "' + s.name + '": output is not used by any other step and is not the final product. Assuming ' + qty + ' pcs.' });
      } else u = demand[s.outputPartId] != null ? demand[s.outputPartId] : qty;
      units[sid] = u;
      (s.components || []).forEach(c => {
        if (c.partId === s.outputPartId) return; // pass-through
        demand[c.partId] = (demand[c.partId] || 0) + u * Math.max(0, U.num(c.qty, 1));
      });
    });
    // steps not in order (cycle) get qty
    (recipe.steps || []).forEach(s => { if (units[s.id] == null) units[s.id] = qty; });

    const purchases = Object.keys(demand)
      .filter(pid => !producedParts.has(pid))
      .map(pid => ({ partId: pid, qty: demand[pid] }));
    return { units, demand, purchases, warnings };
  };

  /** Split [a,b] into working windows (for drawing bars that skip nights/weekends). */
  S.workSegments = function (cal, a, b) {
    if (!(b > a)) return [];
    if (!cal.hasWorkdays()) return [{ a, b }];
    const segs = [];
    let cur = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 0, 0, 0, 0);
    for (let guard = 0; guard < 4000 && cur < b; guard++) {
      cal.windows(cur).forEach(w => {
        const s = w.a > a ? w.a : a, e = w.b < b ? w.b : b;
        if (e > s) segs.push({ a: s, b: e });
      });
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }
    return segs;
  };

  /**
   * Main entry. opts: { recipe, partsById, qty, due (Date), planStart (Date), calendar (Calendar) }
   */
  S.schedule = function (opts) {
    const recipe = opts.recipe, partsById = opts.partsById || {};
    const qty = Math.max(1, U.num(opts.qty, 1));
    const cal = opts.calendar instanceof Calendar ? opts.calendar : new Calendar(opts.calendar);
    const due = opts.due instanceof Date ? new Date(opts.due) : U.parseLocal(opts.due);
    const planStart = opts.planStart instanceof Date ? new Date(opts.planStart) : (U.parseLocal(opts.planStart) || new Date());

    const graph = S.buildGraph(recipe, partsById);
    const ex = S.explode(recipe, partsById, qty, graph);
    const warnings = graph.warnings.concat(ex.warnings);

    const rows = {};
    (recipe.steps || []).forEach(s => {
      const units = ex.units[s.id];
      rows[s.id] = {
        step: s, units,
        workMinutes: S.stepWorkMinutes(s, units),
        laborHours: S.stepLaborHours(s, units),
        cureHours: Math.max(0, U.num(s.cureHours, 0)),
        workers: Math.max(1, U.num(s.workers, 1)),
        preds: Array.from(graph.preds[s.id]),
        succs: Array.from(graph.succs[s.id])
      };
    });

    // ---- Backward pass (JIT / latest) ----
    const rev = graph.order.slice().reverse();
    rev.forEach(sid => {
      const r = rows[sid];
      let lf = due;
      if (r.succs.length) {
        r.succs.forEach(nid => { const n = rows[nid]; if (n.LS && n.LS < lf) lf = n.LS; });
      }
      r.LF = new Date(lf);                                  // end of cure
      r.LcureStart = cal.subtractCure(r.LF, r.cureHours);   // work must finish by here
      r.LworkEnd = cal.snapBackward(r.LcureStart);
      r.LS = cal.subtractWorking(r.LworkEnd, r.workMinutes);
      if (r.cureHours) r.LF = cal.addCure(r.LworkEnd, r.cureHours); // actual cure end (<= lf)
      else r.LF = r.LworkEnd;
    });

    // ---- Forward pass (ASAP / earliest) ----
    graph.order.forEach(sid => {
      const r = rows[sid];
      let es = planStart;
      r.preds.forEach(pid => { const p = rows[pid]; if (p.EF && p.EF > es) es = p.EF; });
      r.ES = cal.snapForward(es);
      r.EworkEnd = cal.addWorking(r.ES, r.workMinutes);
      r.EF = cal.addCure(r.EworkEnd, r.cureHours);
    });
    // steps in a cycle: fallback
    (recipe.steps || []).forEach(s => {
      const r = rows[s.id];
      if (!r.LS) { r.LS = r.LworkEnd = r.LF = new Date(due); }
      if (!r.ES) { r.ES = r.EworkEnd = r.EF = new Date(planStart); }
    });

    // ---- Float & critical path ----
    let projectedFinish = planStart, requiredStart = due;
    Object.values(rows).forEach(r => {
      r.floatMinutes = r.LS >= r.ES ? cal.workingMinutesBetween(r.ES, r.LS) : -cal.workingMinutesBetween(r.LS, r.ES);
      if (r.EF > projectedFinish) projectedFinish = r.EF;
      if (r.LS < requiredStart) requiredStart = r.LS;
    });
    // Critical path = the chain of driving predecessors (those that determine each start) traced back
    // from the step(s) that finish last. This stays correct with calendar-time cures, where float is
    // not uniform along a chain.
    Object.values(rows).forEach(r => { r.critical = false; r.driverPreds = []; });
    Object.values(rows).forEach(r => {
      let maxEF = null;
      r.preds.forEach(pid => { const p = rows[pid]; if (!maxEF || p.EF > maxEF) maxEF = p.EF; });
      if (maxEF) r.driverPreds = r.preds.filter(pid => Math.abs(rows[pid].EF - maxEF) <= 60000);
    });
    const stack = Object.values(rows).filter(r => Math.abs(r.EF - projectedFinish) <= 60000).map(r => r.step.id);
    while (stack.length) {
      const id = stack.pop(); const r = rows[id];
      if (r.critical) continue;
      r.critical = true;
      r.driverPreds.forEach(pid => stack.push(pid));
    }

    const late = projectedFinish > due;
    const lateMinutes = late ? cal.workingMinutesBetween(due, projectedFinish) : 0;
    const startsInPast = requiredStart < planStart;
    const shortMinutes = startsInPast ? cal.workingMinutesBetween(requiredStart, planStart) : 0;

    // ---- Purchases (material need dates) ----
    const purchases = ex.purchases.map(pu => {
      const part = partsById[pu.partId] || { itemNr: '?', name: 'Unknown part', leadTimeDays: 0 };
      let needJIT = null, needASAP = null;
      (recipe.steps || []).forEach(s => {
        if ((s.components || []).some(c => c.partId === pu.partId)) {
          const r = rows[s.id];
          if (!needJIT || r.LS < needJIT) needJIT = r.LS;
          if (!needASAP || r.ES < needASAP) needASAP = r.ES;
        }
      });
      const lead = Math.max(0, U.num(part.leadTimeDays, 0));
      const orderByJIT = needJIT ? new Date(needJIT.getTime() - lead * 86400000) : null;
      const orderByASAP = needASAP ? new Date(needASAP.getTime() - lead * 86400000) : null;
      return { part, partId: pu.partId, qty: pu.qty, needJIT, needASAP, leadTimeDays: lead, orderByJIT, orderByASAP,
               orderLate: orderByJIT ? orderByJIT < planStart : false };
    }).sort((a, b) => (a.needJIT && b.needJIT) ? a.needJIT - b.needJIT : 0);

    const list = graph.order.map(id => rows[id]).concat((recipe.steps || []).filter(s => graph.order.indexOf(s.id) < 0).map(s => rows[s.id]));
    const totals = {
      laborHours: list.reduce((a, r) => a + r.laborHours, 0),
      workMinutes: list.reduce((a, r) => a + r.workMinutes, 0),
      cureHours: list.reduce((a, r) => a + r.cureHours, 0),
      leadWorkingHoursJIT: cal.workingMinutesBetween(requiredStart, due) / 60,
      leadCalendarHoursJIT: (due - requiredStart) / 3600000,
      leadCalendarHoursASAP: (projectedFinish - planStart) / 3600000
    };

    return {
      recipe, qty, due, planStart, calendar: cal, graph, rows, list, purchases, warnings, totals,
      projectedFinish, requiredStart, late, lateMinutes, startsInPast, shortMinutes, units: ex.units
    };
  };

  /** Per-day labor load for the chosen mode ('jit' | 'asap'): [{date, laborHours, avgWorkers, peakWorkers}]. */
  S.loadProfile = function (result, mode) {
    const cal = result.calendar;
    const mpd = cal.minutesPerDay() || 480;
    const days = {};
    const events = [];
    result.list.forEach(r => {
      const a = mode === 'asap' ? r.ES : r.LS;
      const b = mode === 'asap' ? r.EworkEnd : r.LworkEnd;
      S.workSegments(cal, a, b).forEach(seg => {
        const key = U.isoDate(seg.a);
        const d = days[key] || (days[key] = { date: key, laborHours: 0, avgWorkers: 0, peakWorkers: 0 });
        d.laborHours += ((seg.b - seg.a) / 60000) * r.workers / 60;
        events.push({ t: seg.a.getTime(), w: r.workers, key }, { t: seg.b.getTime(), w: -r.workers, key });
      });
    });
    events.sort((x, y) => x.t - y.t || x.w - y.w);
    let cur = 0;
    events.forEach(e => { cur += e.w; const d = days[e.key]; if (d && cur > d.peakWorkers) d.peakWorkers = cur; });
    Object.values(days).forEach(d => { d.avgWorkers = d.laborHours * 60 / mpd; });
    return Object.values(days).sort(U.by('date'));
  };

  /** Rows of the schedule flattened for CSV export. */
  S.exportRows = function (result, partsById) {
    return result.list.map(r => {
      const s = r.step;
      const out = partsById[s.outputPartId];
      return {
        step_nr: s.nr, step_name: s.name, step_type: s.type,
        output_item_nr: out ? out.itemNr : '', output_name: out ? out.name : '',
        units: r.units, workers: r.workers,
        work_minutes_total: U.round(r.workMinutes, 1), labor_hours: U.round(r.laborHours, 2), cure_hours: r.cureHours,
        jit_start: U.isoDateTime(r.LS), jit_work_end: U.isoDateTime(r.LworkEnd), jit_finish: U.isoDateTime(r.LF),
        asap_start: U.isoDateTime(r.ES), asap_work_end: U.isoDateTime(r.EworkEnd), asap_finish: U.isoDateTime(r.EF),
        float_hours: U.round(r.floatMinutes / 60, 1), critical: r.critical ? 'yes' : 'no',
        predecessors: r.preds.map(id => result.rows[id].step.nr).join(';'),
        components: (s.components || []).map(c => { const p = partsById[c.partId]; return (p ? p.itemNr : '?') + ':' + c.qty; }).join('|')
      };
    });
  };

  if (isNode) module.exports = S; else root.Scheduler = S;
})(typeof window !== 'undefined' ? window : globalThis);
