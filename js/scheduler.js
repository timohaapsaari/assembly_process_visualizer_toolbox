/* Assembly scheduler: dependency graph, quantity explosion, backward (JIT) and forward (ASAP) passes.
   Pure functions; browser + Node. */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const U = isNode ? require('./util.js') : root.U;
  const Calendar = isNode ? require('./calendar.js') : root.Calendar;

  const S = {};

  S.DEFAULT_STEP_TYPES = [
    { id: 'assembly',    label: 'Assembly',        color: '#2f6fed' },
    { id: 'subassembly', label: 'Sub-assembly',    color: '#4f9bff' },
    { id: 'bonding',     label: 'Bonding / curing', color: '#c46a1c' },
    { id: 'test',        label: 'Test',            color: '#7c3aed' },
    { id: 'inspection',  label: 'Inspection',      color: '#0e9f6e' },
    { id: 'packaging',   label: 'Packaging',       color: '#64748b' },
    { id: 'other',       label: 'Other',           color: '#94a3b8' }
  ];
  /** Active step types (editable by the user; defaults until Store sets them). */
  S.STEP_TYPES = S.DEFAULT_STEP_TYPES.map(t => Object.assign({}, t));
  S.setTypes = function (list) {
    const clean = (list || []).filter(t => t && t.id).map(t => ({ id: String(t.id), label: t.label || t.id, color: t.color || '#94a3b8' }));
    S.STEP_TYPES.length = 0; clean.forEach(t => S.STEP_TYPES.push(t));
    if (!S.STEP_TYPES.length) S.DEFAULT_STEP_TYPES.forEach(t => S.STEP_TYPES.push(Object.assign({}, t)));
  };
  S.typeInfo = id => S.STEP_TYPES.find(t => t.id === id) || S.STEP_TYPES.find(t => t.id === 'other') || { id: id || 'other', label: id || 'Other', color: '#94a3b8' };

  /** Duration of the work portion of a step in working minutes for the given number of units. */
  S.stepWorkMinutes = function (step, units, resource) {
    const workers = Math.max(1, U.num(step.workers, 1));
    const fixed = Math.max(0, U.num(step.fixedMinutes, 0));
    const perUnit = Math.max(0, U.num(step.workMinutes, 0));
    const n = S.lots(units, S.lotting(step, resource).lotSize).length;
    return fixed * n + (perUnit * units) / workers;
  };
  /** Labor hours (man-hours) for a step. */
  S.stepLaborHours = function (step, units, resource) {
    const workers = Math.max(1, U.num(step.workers, 1));
    const fixed = Math.max(0, U.num(step.fixedMinutes, 0));
    const perUnit = Math.max(0, U.num(step.workMinutes, 0));
    const n = S.lots(units, S.lotting(step, resource).lotSize).length;
    return (fixed * workers * n + perUnit * units) / 60;
  };

  /**
   * Resolve step chains. A step with `continuesPrevious` works on the item of the previous step (same recipe):
   * that item becomes its implicit input, and its output is its own named item, else the item named by the
   * nearest downstream step of the unbroken chain, else the upstream chain item. So only the step that creates
   * an item has to name it ("Produces"); intermediate steps (dispensing, curing, testing…) just continue.
   * Returns a copy of the recipe with outputPartId / components filled in (original objects untouched).
   */
  S.resolveRecipe = function (recipe) {
    if (!recipe || recipe._resolved) return recipe;
    const out = (recipe.steps || []).map(s => Object.assign({}, s, { components: (s.components || []).map(c => Object.assign({}, c)), extraPreds: (s.extraPreds || []).slice() }));
    const group = s => s.chainGroup || recipe.id;
    const prevOf = i => { for (let j = i - 1; j >= 0; j--) if (group(out[j]) === group(out[i])) return j; return -1; };
    const nextOf = i => { for (let j = i + 1; j < out.length; j++) if (group(out[j]) === group(out[i])) return j; return -1; };
    const eff = new Array(out.length).fill(null), src = new Array(out.length).fill(null);
    const warnings = [];
    for (let i = 0; i < out.length; i++) {
      const s = out[i];
      if (s.outputPartId) { eff[i] = s.outputPartId; continue; }
      let j = nextOf(i), found = null, from = null;
      while (j >= 0 && out[j].continuesPrevious) { if (out[j].outputPartId) { found = out[j].outputPartId; from = out[j]; break; } j = nextOf(j); }
      if (!found && s.continuesPrevious) { let k = prevOf(i); while (k >= 0) { if (eff[k]) { found = eff[k]; from = out[k]; break; } if (!out[k].continuesPrevious) break; k = prevOf(k); } }
      eff[i] = found; src[i] = from;
    }
    out.forEach((s, i) => {
      s.rawOutputPartId = s.outputPartId || null;
      s.outputPartId = eff[i];
      s.chainNamedBy = src[i] ? src[i].nr : null;
      if (s.continuesPrevious) {
        const k = prevOf(i);
        if (k < 0) { s.continuesPrevious = false; s.isChainStart = true; } // first step: nothing to continue from
        else {
          s.chainPrevStepId = out[k].id;
          if (eff[k]) {
            s.chainInputPartId = eff[k];
            if (!s.components.some(c => c.partId === eff[k])) s.components.unshift({ partId: eff[k], qty: 1, implicit: true });
          }
        }
      }
      if (!eff[i]) {
        // find the end of this chain; the item has to be set there (or on this step if it starts something new)
        let e = i, j = nextOf(i);
        while (j >= 0 && out[j].continuesPrevious) { e = j; j = nextOf(j); }
        s.chainEndNr = out[e].nr; s.chainEndId = out[e].id;
        const nxt = nextOf(e);
        s.chainNextNamed = nxt >= 0 && !out[nxt].continuesPrevious && out[nxt].outputPartId ? out[nxt].nr : null;
        if (e === i) warnings.push({ level: 'error', text: 'Step ' + s.nr + ' "' + s.name + '"' + (s.continuesPrevious ? ' ends a chain that has no item yet: set "Produces" here' : ': set "Produces" (the item this step creates)') + (s.chainNextNamed != null ? ', or tick "continues from previous step" on step ' + s.chainNextNamed + ' if that step works on this chain\'s item.' : '.') });
      }
    });
    return Object.assign({}, recipe, { steps: out, _resolved: true, resolveWarnings: warnings });
  };

  /**
   * Build the precedence graph. Edges: producer -> consumer (component part produced by another step),
   * plus explicit extra predecessors. Returns {order, preds, succs, cycle, warnings}.
   */
  S.buildGraph = function (recipe, partsById) {
    recipe = S.resolveRecipe(recipe);
    const steps = recipe.steps || [];
    const byId = {};
    steps.forEach(s => { byId[s.id] = s; });
    const producers = {};   // partId -> [stepId]
    steps.forEach(s => { if (s.outputPartId) (producers[s.outputPartId] = producers[s.outputPartId] || []).push(s.id); });

    const preds = {}, succs = {}, warnings = (recipe.resolveWarnings || []).slice();
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
      if (!s.outputPartId && !(recipe.resolveWarnings || []).length) warnings.push({ level: 'warn', text: 'Step ' + s.nr + ' "' + s.name + '" has no output part.' });
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

    return { order, preds, succs, cycle, warnings, producers, byId, recipe };
  };

  /**
   * Quantity explosion: how many units each step must produce for `qty` of the recipe's final part,
   * and the demand for purchased (non-produced) parts.
   */
  S.explode = function (recipe, partsById, qty, graph, extraDemand) {
    recipe = S.resolveRecipe(recipe);
    graph = graph || S.buildGraph(recipe, partsById);
    const demand = {};  // partId -> units
    const units = {};   // stepId -> units
    const warnings = [];
    const finalId = recipe.finalPartId;
    if (finalId) demand[finalId] = qty;
    else warnings.push({ level: 'error', text: 'Recipe has no final product part selected.' });
    // items delivered separately: quantity per product
    const deliverables = (recipe.deliverables || []).filter(d => d.partId && U.num(d.qtyPerProduct) > 0);
    deliverables.forEach(d => { demand[d.partId] = (demand[d.partId] || 0) + qty * U.num(d.qtyPerProduct); });
    const isDeliverable = pid => pid === finalId || deliverables.some(d => d.partId === pid);
    (extraDemand || []).forEach(e => { if (e.partId && U.num(e.qty) > 0) demand[e.partId] = (demand[e.partId] || 0) + U.num(e.qty); });

    const producedParts = new Set(Object.keys(graph.producers));
    const good = {};    // stepId -> good units out
    const rev = graph.order.slice().reverse(); // consumers first
    rev.forEach(sid => {
      const s = graph.byId[sid];
      let g;
      if (s.outputPartId && demand[s.outputPartId] != null) g = demand[s.outputPartId];
      else if (s.outputPartId && !isDeliverable(s.outputPartId) && graph.succs[sid].size === 0) {
        g = qty; // orphan output: assume one per product
        warnings.push({ level: 'warn', text: 'Step ' + s.nr + ' "' + s.name + '": output is not used by any other step and is not listed as a deliverable. Assuming 1 per product; add it under "Delivered separately" to set the quantity.' });
      } else g = demand[s.outputPartId] != null ? demand[s.outputPartId] : qty;
      // yield: start enough units so that `g` good ones come out (scrap model: failed units are lost)
      const y = S.yieldOf(s);
      const u = Math.ceil(g / y - 1e-9);
      units[sid] = u; good[sid] = g;
      (s.components || []).forEach(c => {
        if (c.partId === s.outputPartId) {
          // pass-through (test on the same item): the producer must deliver the tested quantity
          if (u > (demand[c.partId] || 0)) demand[c.partId] = u;
          return;
        }
        demand[c.partId] = (demand[c.partId] || 0) + u * Math.max(0, U.num(c.qty, 1));
      });
    });
    // steps not in order (cycle) get qty
    (recipe.steps || []).forEach(s => { if (units[s.id] == null) { units[s.id] = qty; good[s.id] = qty; } });

    const purchases = Object.keys(demand)
      .filter(pid => !producedParts.has(pid))
      .map(pid => ({ partId: pid, qty: demand[pid] }));
    return { units, good, demand, purchases, warnings };
  };

  /** Yield of a step as a fraction 0 < y <= 1 (100 % when not set). */
  S.yieldOf = function (step) {
    const y = U.num(step.yieldPct, 100);
    return Math.min(1, Math.max(0.01, (y > 0 ? y : 100) / 100));
  };

  /**
   * Chain recipes: components that no step of `recipe` produces but that are the final product of another recipe
   * pull that recipe's steps in (recursively). Returns a virtual recipe with all steps; sub-recipe steps get a
   * prefixed nr ("A2.10"), a name prefix, and sourceRecipeId / sourceStepId for editing.
   */
  S.expandRecipe = function (recipe, allRecipes, partsById) {
    if (!recipe) return recipe;
    const visited = new Set([recipe.id]);
    const codes = {};
    const makeCode = name => {
      let code = String(name || 'SUB').split(/\s+/).map(w => w.replace(/[^A-Za-z0-9]/g, '').slice(0, 1)).join('').toUpperCase().slice(0, 4) || 'SUB';
      let c = code, n = 2; while (codes[c]) c = code + (n++); codes[c] = true; return c;
    };
    const clone = (r, code) => (r.steps || []).map(s => Object.assign({}, s, {
      id: code ? r.id + ':' + s.id : s.id,
      nr: code ? code + '.' + s.nr : s.nr,
      name: code ? r.name + ' › ' + s.name : s.name,
      extraPreds: (s.extraPreds || []).map(id => code ? r.id + ':' + id : id),
      components: (s.components || []).map(c => Object.assign({}, c)),
      sourceRecipeId: r.id, sourceStepId: s.id, subCode: code || '', chainGroup: r.id
    }));
    const steps = clone(recipe, '');
    const subRecipes = [];
    let changed = true;
    while (changed) {
      changed = false;
      const produced = new Set(S.resolveRecipe({ id: recipe.id, steps }).steps.map(s => s.outputPartId).filter(Boolean));
      for (const s of steps) {
        for (const c of (s.components || [])) {
          if (produced.has(c.partId)) continue;
          const sub = (allRecipes || []).find(r => !visited.has(r.id) && r.finalPartId === c.partId && r.id !== recipe.id);
          if (!sub) continue;
          visited.add(sub.id);
          const code = makeCode(sub.name);
          subRecipes.push({ recipe: sub, code, partId: c.partId });
          clone(sub, code).forEach(x => steps.push(x));
          produced.add(c.partId);
          changed = true;
        }
        if (changed) break;
      }
    }
    return Object.assign({}, recipe, { steps, subRecipes, expanded: subRecipes.length > 0 });
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

  /** Effective lot size and capacity of a step: {lotSize (0 = whole batch), capacity (Infinity = unlimited)}. */
  S.lotting = function (step, resource) {
    let lotSize = Math.max(0, U.num(step.lotSize, 0));
    if (!lotSize && resource) lotSize = Math.max(0, U.num(resource.lotSize, 0));
    const capacity = resource ? Math.max(1, Math.round(U.num(resource.capacity, 1))) : Infinity;
    return { lotSize, capacity };
  };

  /** Split units into lots: [{units, cum}]. */
  S.lots = function (units, lotSize) {
    if (!lotSize || lotSize >= units) return [{ units, cum: units }];
    const out = []; let cum = 0;
    while (cum < units - 1e-9) { const u = Math.min(lotSize, units - cum); cum += u; out.push({ units: u, cum }); }
    return out;
  };

  /**
   * Main entry. opts: { recipe, partsById, resourcesById, qty, due (Date), planStart (Date), calendar (Calendar) }
   * Every step is scheduled lot by lot: attended work (fixed per lot + per-unit / workers, shop hours) followed by an
   * unattended process (curing, testing) on a process resource with capacity × lot size, in the resource calendar.
   */
  S.schedule = function (opts) {
    const recipe = S.resolveRecipe(opts.recipe), partsById = opts.partsById || {}, resById = opts.resourcesById || {};
    const calById = opts.calendarsById || {};
    const qty = Math.max(1, U.num(opts.qty, 1));
    const cal = opts.calendar instanceof Calendar ? opts.calendar : new Calendar(opts.calendar);
    const due = opts.due instanceof Date ? new Date(opts.due) : U.parseLocal(opts.due);
    const planStart = opts.planStart instanceof Date ? new Date(opts.planStart) : (U.parseLocal(opts.planStart) || new Date());

    // milestones: separate due dates (and optional extra quantity) for sub-assemblies
    const milestones = (opts.milestones || []).map(m => ({ partId: m.partId, due: m.due instanceof Date ? m.due : U.parseLocal(m.due), qty: Math.max(0, U.num(m.qty, 0)), label: m.label || '' })).filter(m => m.partId && m.due);
    const graph = S.buildGraph(recipe, partsById);
    const ex = S.explode(recipe, partsById, qty, graph, milestones.filter(m => m.qty > 0).map(m => ({ partId: m.partId, qty: m.qty })));
    const warnings = graph.warnings.concat(ex.warnings);
    milestones.forEach(m => { if (!(graph.producers[m.partId] || []).length) warnings.push({ level: 'warn', text: 'Sub-assembly due date: no step produces ' + ((partsById[m.partId] || {}).itemNr || m.partId) + '.' }); });
    const milestoneDue = pid => milestones.filter(m => m.partId === pid).reduce((d, m) => (!d || m.due < d ? m.due : d), null);

    const rows = {};
    (recipe.steps || []).forEach(s => {
      const units = ex.units[s.id];
      const resource = s.resourceId ? (resById[s.resourceId] || null) : null;
      if (s.resourceId && !resource) warnings.push({ level: 'warn', text: 'Step ' + s.nr + ' refers to an unknown resource; scheduled without capacity limit.' });
      const pool = s.workerPoolId ? (resById[s.workerPoolId] || null) : null;
      const lt = S.lotting(s, resource);
      const lots = S.lots(units, lt.lotSize);
      const yld = S.yieldOf(s);
      const workers = Math.max(1, U.num(s.workers, 1));
      const fixed = Math.max(0, U.num(s.fixedMinutes, 0)), perUnit = Math.max(0, U.num(s.workMinutes, 0));
      const processHours = Math.max(0, U.num(s.processHours != null ? s.processHours : s.cureHours, 0));
      // calendars: attended work follows the worker pool's calendar; the process follows the equipment's calendar
      const workCal = (pool && pool.calendarId && calById[pool.calendarId]) || cal;
      let procCal, procCalObj = null;
      if (resource) { procCal = resource.calendar === 'shop' ? 'shop' : '24_7'; if (procCal === 'shop') procCalObj = (resource.calendarId && calById[resource.calendarId]) || cal; }
      else { procCal = cal.s.cureUsesCalendar ? '24_7' : 'shop'; if (procCal === 'shop') procCalObj = cal; }
      const r = rows[s.id] = {
        step: s, units, good: ex.good[s.id], yield: yld, workers, pool, resource, lotSize: lt.lotSize, capacity: lt.capacity, processHours, procCal, workCal, procCalObj,
        transfer: !!s.transferPerLot,
        lotsE: lots.map(l => ({ units: l.units, cum: l.cum, goodCum: l.cum * yld })),
        lotsL: lots.map(l => ({ units: l.units, cum: l.cum, goodCum: l.cum * yld })),
        preds: Array.from(graph.preds[s.id]), succs: Array.from(graph.succs[s.id])
      };
      r.attMinutes = lot => fixed + (perUnit * lot.units) / workers;
      r.workMinutes = lots.reduce((a, l) => a + r.attMinutes(l), 0);
      r.laborHours = (fixed * workers * lots.length + perUnit * units) / 60;
      r.nLots = lots.length;
      r.waves = isFinite(lt.capacity) ? Math.ceil(lots.length / lt.capacity) : 1;
      r.addProc = (t, h) => !h ? new Date(t) : (procCalObj ? procCalObj.addWorking(t, h * 60) : new Date(t.getTime() + h * 3600000));
      r.subProc = (t, h) => !h ? new Date(t) : (procCalObj ? procCalObj.subtractWorking(t, h * 60) : new Date(t.getTime() - h * 3600000));
    });

    // quantity of predecessor output needed per unit of successor output (undefined = no part relation)
    const qtyPerUnit = (pred, succ) => {
      if (!pred.step.outputPartId) return undefined;
      const c = (succ.step.components || []).find(c => c.partId === pred.step.outputPartId);
      return c ? Math.max(0, U.num(c.qty, 1)) : undefined;
    };

    // ---- Backward pass (JIT / latest): reverse topological order, lot by lot ----
    graph.order.slice().reverse().forEach(sid => {
      const r = rows[sid];
      const n = r.nLots;
      // latest finish of each lot from successors (and from a sub-assembly due date on the output part)
      const own = r.step.outputPartId ? milestoneDue(r.step.outputPartId) : null;
      const lotDue = own && own < due ? own : due;
      const lotLF = r.lotsL.map(() => new Date(lotDue));
      r.succs.forEach(tid => {
        const t = rows[tid];
        if (!t.lotsL[0].attStart) return;
        const q = qtyPerUnit(r, t);
        if (!r.transfer || q === undefined || q <= 0) {
          r.lotsL.forEach((l, j) => { if (t.lotsL[0].attStart < lotLF[j]) lotLF[j] = t.lotsL[0].attStart; });
          return;
        }
        r.lotsL.forEach((l, j) => {
          const prevGood = j ? r.lotsL[j - 1].goodCum : 0;
          const k = t.lotsL.findIndex(tl => tl.cum * q > prevGood + 1e-9);
          if (k >= 0 && t.lotsL[k].attStart < lotLF[j]) lotLF[j] = t.lotsL[k].attStart;
        });
      });
      for (let j = n - 1; j >= 0; j--) {
        const L = r.lotsL[j];
        let procEnd = lotLF[j];
        if (isFinite(r.capacity) && j + r.capacity < n && r.lotsL[j + r.capacity].attStart < procEnd) procEnd = r.lotsL[j + r.capacity].attStart;
        let attEnd = r.workCal.snapBackward(r.subProc(procEnd, r.processHours));
        if (j + 1 < n && r.lotsL[j + 1].attStart < attEnd) attEnd = r.workCal.snapBackward(r.lotsL[j + 1].attStart);
        L.attEnd = attEnd;
        L.attStart = r.workCal.subtractWorking(attEnd, r.attMinutes(L));
        L.procEnd = r.addProc(attEnd, r.processHours);
      }
      r.LS = r.lotsL[0].attStart; r.LworkEnd = r.lotsL[n - 1].attEnd;
      r.LF = r.lotsL.reduce((m, l) => l.procEnd > m ? l.procEnd : m, r.lotsL[0].procEnd);
    });

    // ---- Forward pass (ASAP / earliest): topological order, lot by lot ----
    graph.order.forEach(sid => {
      const r = rows[sid];
      const n = r.nLots;
      const readyFromPred = (p, j) => {
        const q = qtyPerUnit(p, r);
        if (!p.transfer || q === undefined || q <= 0) return p.EF;
        const need = r.lotsE[j].cum * q;
        const i = p.lotsE.findIndex(pl => pl.goodCum >= need - 1e-9);
        return i >= 0 ? p.lotsE[i].procEnd : p.EF;
      };
      let crewFree = planStart; const slotFree = [];
      r.driverPreds = [];
      for (let j = 0; j < n; j++) {
        const L = r.lotsE[j];
        let ready = planStart, driver = null, contribs = [];
        r.preds.forEach(pid => { const t = readyFromPred(rows[pid], j); contribs.push({ pid, t }); if (t > ready) { ready = t; driver = pid; } });
        if (j === 0) r.driverPreds = contribs.filter(c => Math.abs(c.t - ready) <= 60000 && c.t > planStart).map(c => c.pid);
        let start = ready > crewFree ? ready : crewFree;
        if (isFinite(r.capacity)) { const sf = slotFree[j % r.capacity]; if (sf && sf > start) start = sf; }
        L.attStart = r.workCal.snapForward(start);
        L.attEnd = r.workCal.addWorking(L.attStart, r.attMinutes(L));
        L.procEnd = r.addProc(L.attEnd, r.processHours);
        L.waitedFor = driver && ready > crewFree ? driver : null;
        crewFree = L.attEnd;
        if (isFinite(r.capacity)) slotFree[j % r.capacity] = L.procEnd;
      }
      r.ES = r.lotsE[0].attStart; r.EworkEnd = r.lotsE[n - 1].attEnd;
      r.EF = r.lotsE.reduce((m, l) => l.procEnd > m ? l.procEnd : m, r.lotsE[0].procEnd);
    });
    // steps in a cycle: fallback
    (recipe.steps || []).forEach(s => {
      const r = rows[s.id];
      if (!r.LS) { r.LS = r.LworkEnd = r.LF = new Date(due); r.lotsL.forEach(l => { l.attStart = l.attEnd = l.procEnd = new Date(due); }); }
      if (!r.ES) { r.ES = r.EworkEnd = r.EF = new Date(planStart); r.lotsE.forEach(l => { l.attStart = l.attEnd = l.procEnd = new Date(planStart); }); r.driverPreds = []; }
    });

    // ---- Float & critical path ----
    let projectedFinish = planStart, requiredStart = due;
    Object.values(rows).forEach(r => {
      r.floatMinutes = r.LS >= r.ES ? cal.workingMinutesBetween(r.ES, r.LS) : -cal.workingMinutesBetween(r.LS, r.ES);
      if (r.EF > projectedFinish) projectedFinish = r.EF;
      if (r.LS < requiredStart) requiredStart = r.LS;
    });
    // Critical path = chain of driving predecessors (those that actually gate each start) traced back from the
    // step(s) that finish last. Correct with calendar-time processes, where float is not uniform along a chain.
    Object.values(rows).forEach(r => { r.critical = false; });
    const stack = Object.values(rows).filter(r => Math.abs(r.EF - projectedFinish) <= 60000).map(r => r.step.id);
    while (stack.length) {
      const id = stack.pop(); const r = rows[id];
      if (r.critical) continue;
      r.critical = true;
      (r.driverPreds || []).forEach(pid => stack.push(pid));
    }

    const milestoneStatus = milestones.map(m => {
      const prods = (graph.producers[m.partId] || []).map(id => rows[id]);
      const EF = prods.reduce((x, r) => (!x || r.EF > x ? r.EF : x), null);
      const LF = prods.reduce((x, r) => (!x || r.LF > x ? r.LF : x), null);
      const LS = prods.reduce((x, r) => (!x || r.LS < x ? r.LS : x), null);
      const lm = EF && EF > m.due ? (cal.workingMinutesBetween(m.due, EF) || (EF - m.due) / 60000) : 0;
      return { partId: m.partId, part: partsById[m.partId], due: m.due, qty: m.qty, label: m.label, EF, LF, LS, late: EF ? EF > m.due : false, lateMinutes: lm };
    });

    const late = projectedFinish > due;
    const lateMinutes = late ? (cal.workingMinutesBetween(due, projectedFinish) || (projectedFinish - due) / 60000) : 0;
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
      scrapUnits: list.reduce((a, r) => a + Math.max(0, r.units - r.good), 0),
      laborHours: list.reduce((a, r) => a + r.laborHours, 0),
      workMinutes: list.reduce((a, r) => a + r.workMinutes, 0),
      cureHours: list.reduce((a, r) => a + r.processHours * r.nLots, 0),
      leadWorkingHoursJIT: cal.workingMinutesBetween(requiredStart, due) / 60,
      leadCalendarHoursJIT: (due - requiredStart) / 3600000,
      leadCalendarHoursASAP: (projectedFinish - planStart) / 3600000
    };

    return {
      recipe, qty, due, planStart, calendar: cal, calendarsById: calById, graph, rows, list, purchases, warnings, totals, milestones: milestoneStatus,
      projectedFinish, requiredStart, late, lateMinutes, startsInPast, shortMinutes, units: ex.units
    };
  };

  /** Lots of a row for the given mode. */
  S.lotsOf = (r, mode) => mode === 'asap' ? r.lotsE : r.lotsL;

  /**
   * Resource occupancy for the chosen mode. Returns [{resource, intervals:[{row, lot, j, a, b, w}], conflicts:[{a,b,load}],
   * days:[{date, hours, util}]}] for every resource used (equipment: lot occupies 1 unit from attended start to process
   * end; labor pools: attended interval with weight = workers). generalPool = {capacity} for steps without a pool.
   */
  S.resourceLoad = function (result, mode, generalCapacity) {
    const map = {};
    const add = (res, row, lot, j, a, b, w) => {
      const key = res.id;
      const e = map[key] || (map[key] = { resource: res, intervals: [], conflicts: [], days: [] });
      if (b > a) e.intervals.push({ row, lot, j, a, b, w });
    };
    const general = { id: '__general', name: 'General workers', type: 'labor', capacity: generalCapacity || 0, general: true };
    result.list.forEach(r => {
      S.lotsOf(r, mode).forEach((l, j) => {
        if (r.resource) add(r.resource, r, l, j, l.attStart, l.procEnd, 1);
        add(r.pool || general, r, l, j, l.attStart, l.attEnd, r.workers);
      });
    });
    const cal = result.calendar;
    Object.values(map).forEach(e => {
      const cap = Math.max(0, U.num(e.resource.capacity, 0));
      // sweep for overload
      const ev = [];
      e.intervals.forEach(iv => { ev.push({ t: iv.a.getTime(), w: iv.w }, { t: iv.b.getTime(), w: -iv.w }); });
      ev.sort((x, y) => x.t - y.t || x.w - y.w);
      let load = 0, over = null;
      ev.forEach(x => {
        load += x.w;
        if (cap > 0 && load > cap && !over) over = { a: new Date(x.t), load };
        else if (over && load > cap && load > over.load) over.load = load;
        else if (over && load <= cap) { over.b = new Date(x.t); e.conflicts.push(over); over = null; }
      });
      if (over) { over.b = new Date(ev[ev.length - 1].t); e.conflicts.push(over); }
      e.peak = ev.reduce((acc, x) => { acc.cur += x.w; return { cur: acc.cur, max: Math.max(acc.max, acc.cur) }; }, { cur: 0, max: 0 }).max;
      // per-day occupied hours (unit-hours)
      const days = {};
      e.intervals.forEach(iv => {
        let cur = new Date(iv.a.getFullYear(), iv.a.getMonth(), iv.a.getDate());
        for (let g = 0; g < 400 && cur < iv.b; g++) {
          const next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
          const a = iv.a > cur ? iv.a : cur, b = iv.b < next ? iv.b : next;
          if (b > a) { const k = U.isoDate(cur); days[k] = (days[k] || 0) + ((b - a) / 3600000) * iv.w; }
          cur = next;
        }
      });
      const rc = e.resource.calendarId && result.calendarsById && result.calendarsById[e.resource.calendarId];
      const availPerDay = e.resource.type === 'labor' || e.resource.calendar === 'shop' ? ((rc || cal).minutesPerDay() / 60) : 24;
      e.days = Object.keys(days).sort().map(k => ({ date: k, hours: days[k], util: cap > 0 ? days[k] / (cap * availPerDay) : 0 }));
      e.utilization = e.days.length && cap > 0 ? e.days.reduce((a, d) => a + d.hours, 0) / (cap * availPerDay * e.days.length) : 0;
    });
    return Object.values(map).sort((a, b) => (a.resource.type === b.resource.type ? 0 : a.resource.type === 'equipment' ? -1 : 1) || String(a.resource.name).localeCompare(String(b.resource.name)));
  };

  /** Per-day labor load for the chosen mode ('jit' | 'asap'): [{date, laborHours, avgWorkers, peakWorkers}]. */
  S.loadProfile = function (result, mode) {
    const cal = result.calendar;
    const mpd = cal.minutesPerDay() || 480;
    const days = {};
    const events = [];
    result.list.forEach(r => {
      S.lotsOf(r, mode).forEach(l => S.workSegments(r.workCal || cal, l.attStart, l.attEnd).forEach(seg => {
        const key = U.isoDate(seg.a);
        const d = days[key] || (days[key] = { date: key, laborHours: 0, avgWorkers: 0, peakWorkers: 0 });
        d.laborHours += ((seg.b - seg.a) / 60000) * r.workers / 60;
        events.push({ t: seg.a.getTime(), w: r.workers, key }, { t: seg.b.getTime(), w: -r.workers, key });
      }));
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
        units: r.units, good_units: r.good, yield_pct: Math.round(r.yield * 100), workers: r.workers,
        work_minutes_total: U.round(r.workMinutes, 1), labor_hours: U.round(r.laborHours, 2), process_hours_per_lot: r.processHours,
        resource: r.resource ? r.resource.name : '', lot_size: r.lotSize || '', lots: r.nLots, worker_pool: r.pool ? r.pool.name : '',
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
