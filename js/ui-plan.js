/* Plan tab: order inputs, backward/forward schedule, Gantt, network, tables, load profile. */
(function (root) {
  'use strict';
  const U = root.U, UI = root.UI, Store = root.Store, Scheduler = root.Scheduler;
  const PlanUI = { result: null, selectedStepId: null, showCriticalOnly: false };

  function currentPlan() {
    const st = Store.state;
    let p = st.plans.find(x => x.id === st.ui.planId);
    if (!p && st.plans.length) { p = st.plans[0]; st.ui.planId = p.id; }
    return p;
  }

  PlanUI.planWithRecipe = function (recipeId) {
    const st = Store.state;
    const r = Store.recipe(recipeId);
    const p = Store.newPlan({ name: 'Plan for ' + (r ? r.name : ''), recipeId, startNow: true });
    st.plans.push(p); st.ui.planId = p.id; Store.save();
    root.App.showTab('plan');
  };

  PlanUI.render = function () {
    const host = document.getElementById('tab-plan');
    host.innerHTML = '';
    const st = Store.state;
    const p = currentPlan();

    const top = UI.el('<div class="panel no-print"><div class="panel-head">' +
      '<h2>Production plan</h2>' +
      '<select id="pl-sel" style="min-width:260px">' + (st.plans.length ? st.plans.map(x => '<option value="' + x.id + '"' + (p && x.id === p.id ? ' selected' : '') + '>' + UI.esc(x.name || '(unnamed plan)') + '</option>').join('') : '<option value="">No plans yet</option>') + '</select>' +
      '<button class="btn btn-primary" id="pl-new">+ New plan</button>' +
      (p ? '<button class="btn" id="pl-dup">Duplicate</button><button class="btn btn-danger" id="pl-del">Delete</button>' : '') +
      '<span class="spacer"></span>' +
      (p ? '<button class="btn" id="pl-csv">Export schedule CSV</button><button class="btn" id="pl-mat">Export materials CSV</button><button class="btn" id="pl-print">Print / PDF</button>' : '') +
      '</div></div>');
    host.appendChild(top);
    top.querySelector('#pl-sel').addEventListener('change', e => { st.ui.planId = e.target.value; Store.save(); PlanUI.render(); });
    top.querySelector('#pl-new').addEventListener('click', () => {
      if (!st.recipes.length) { UI.toast('Create a recipe first (Recipes tab).', 'err'); return; }
      const np = Store.newPlan({ name: 'New plan ' + (st.plans.length + 1), recipeId: st.ui.recipeId || st.recipes[0].id, startNow: true });
      st.plans.push(np); st.ui.planId = np.id; Store.save(); PlanUI.render();
      setTimeout(() => { const i = document.getElementById('pl-name'); if (i) { i.focus(); i.select(); } }, 50);
    });
    if (!p) {
      host.appendChild(UI.el('<div class="panel"><p class="muted">' + (st.recipes.length ? 'Create a plan: choose a recipe, the quantity and the delivery date. The tool schedules every step backwards from the delivery date.' : 'No recipes yet. Go to <b>Recipes</b> to build an assembly process, or load the demo data from <b>Calendar &amp; settings</b>.') + '</p></div>'));
      return;
    }
    top.querySelector('#pl-dup').addEventListener('click', () => { const c = U.deepClone(p); c.id = U.uid('pl'); c.name = p.name + ' (copy)'; st.plans.push(c); st.ui.planId = c.id; Store.save(); PlanUI.render(); });
    top.querySelector('#pl-del').addEventListener('click', async () => { if (await UI.confirm('Delete plan "' + p.name + '"?', 'Delete plan')) { st.plans = st.plans.filter(x => x.id !== p.id); st.ui.planId = st.plans.length ? st.plans[0].id : null; Store.save(); PlanUI.render(); } });
    top.querySelector('#pl-csv').addEventListener('click', () => { if (!PlanUI.result) return; const rows = Scheduler.exportRows(PlanUI.result, Store.partsById()); UI.download(PlanUI.fileBase(p) + '_schedule.csv', U.toCSV(rows, Object.keys(rows[0] || { step_nr: 1 }).map(k => ({ key: k })), ';')); });
    top.querySelector('#pl-mat').addEventListener('click', () => { if (!PlanUI.result) return; const rows = PlanUI.result.purchases.map(x => ({ item_nr: x.part.itemNr, name: x.part.name, qty: U.round(x.qty, 3), unit: x.part.unit || 'pcs', lead_time_days: x.leadTimeDays, need_date_jit: x.needJIT ? U.isoDateTime(x.needJIT) : '', order_by_jit: x.orderByJIT ? U.isoDate(x.orderByJIT) : '', need_date_asap: x.needASAP ? U.isoDateTime(x.needASAP) : '', order_by_asap: x.orderByASAP ? U.isoDate(x.orderByASAP) : '' })); UI.download(PlanUI.fileBase(p) + '_materials.csv', U.toCSV(rows, ['item_nr', 'name', 'qty', 'unit', 'lead_time_days', 'need_date_jit', 'order_by_jit', 'need_date_asap', 'order_by_asap'].map(k => ({ key: k })), ';')); });
    top.querySelector('#pl-print').addEventListener('click', () => window.print());

    if (p.startNow === undefined) p.startNow = true;
    const cal = Store.calendar();
    const form = UI.el('<div class="panel"><div class="form-row">' +
      '<label class="f"><span>Plan / order name</span><input type="text" id="pl-name" class="w-l" value="' + UI.esc(p.name) + '"></label>' +
      '<label class="f"><span>Recipe (product)</span><select id="pl-recipe">' + st.recipes.map(r => '<option value="' + r.id + '"' + (r.id === p.recipeId ? ' selected' : '') + '>' + UI.esc(r.name) + '</option>').join('') + '</select></label>' +
      '<label class="f"><span>Quantity needed (pcs)</span><input type="number" id="pl-qty" min="1" step="1" value="' + Math.max(1, U.num(p.qty, 1)) + '"></label>' +
      '<label class="f"><span>Delivery date</span><input type="date" id="pl-due" value="' + UI.esc(p.dueDate) + '"></label>' +
      '<label class="f"><span>Time</span><input type="time" id="pl-duet" value="' + UI.esc(p.dueTime || cal.s.shiftEnd) + '"></label>' +
      '<label class="f"><span>Earliest start</span><div class="flex"><label class="check"><input type="checkbox" id="pl-now" ' + (p.startNow ? 'checked' : '') + '> now</label><input type="date" id="pl-start" value="' + UI.esc(p.planStartDate) + '" ' + (p.startNow ? 'disabled' : '') + '><input type="time" id="pl-startt" value="' + UI.esc(p.planStartTime || cal.s.shiftStart) + '" ' + (p.startNow ? 'disabled' : '') + '></div></label>' +
      '</div><div class="form-row"><label class="f grow"><span>Notes</span><input type="text" id="pl-notes" style="width:100%" value="' + UI.esc(p.notes || '') + '"></label></div>' +
      '<div class="mt"><div class="flex"><b class="small">Sub-assembly due dates</b><span class="muted small">separate delivery dates for sub-assemblies (e.g. shipped ahead or to another site); optional extra pcs are added to the demand</span><span class="spacer"></span><button class="btn btn-sm" id="ms-add">+ Add sub-assembly due date</button></div><div id="ms-list" class="mt"></div></div></div>');
    host.appendChild(form);
    p.milestones = p.milestones || [];
    PlanUI.renderMilestones(p, form.querySelector('#ms-list'));
    form.querySelector('#ms-add').addEventListener('click', () => {
      const r = Store.recipe(p.recipeId); if (!r) { UI.toast('Select a recipe first', 'err'); return; }
      const produced = r.steps.map(x => x.outputPartId).filter(x => x && x !== r.finalPartId);
      p.milestones.push({ partId: produced[0] || null, dueDate: p.dueDate, dueTime: p.dueTime || cal.s.shiftEnd, qty: 0 });
      Store.save(); PlanUI.renderMilestones(p, form.querySelector('#ms-list')); PlanUI.compute();
    });
    const recalc = UI.debounce(() => PlanUI.compute(), 150);
    UI.bind(form.querySelector('#pl-name'), p, 'name', 'text', () => { const o = top.querySelector('#pl-sel option:checked'); if (o) o.textContent = p.name; });
    UI.bind(form.querySelector('#pl-recipe'), p, 'recipeId', 'text', recalc);
    UI.bind(form.querySelector('#pl-qty'), p, 'qty', 'int', recalc);
    UI.bind(form.querySelector('#pl-due'), p, 'dueDate', 'text', recalc);
    UI.bind(form.querySelector('#pl-duet'), p, 'dueTime', 'text', recalc);
    UI.bind(form.querySelector('#pl-start'), p, 'planStartDate', 'text', recalc);
    UI.bind(form.querySelector('#pl-startt'), p, 'planStartTime', 'text', recalc);
    UI.bind(form.querySelector('#pl-notes'), p, 'notes');
    form.querySelector('#pl-now').addEventListener('change', e => { p.startNow = e.target.checked; form.querySelector('#pl-start').disabled = p.startNow; form.querySelector('#pl-startt').disabled = p.startNow; if (!p.startNow) { p.planStartDate = U.isoDate(new Date()); p.planStartTime = U.hhmm(new Date()); form.querySelector('#pl-start').value = p.planStartDate; form.querySelector('#pl-startt').value = p.planStartTime; } Store.save(); recalc(); });

    host.appendChild(UI.el('<div id="pl-out"></div>'));
    PlanUI.compute();
  };

  PlanUI.fileBase = p => (p.name || 'plan').replace(/[^\w.-]+/g, '_');

  PlanUI.renderMilestones = function (p, host) {
    host.innerHTML = '';
    const r = Store.recipe(p.recipeId); const pb = Store.partsById(); const cal = Store.calendar();
    const produced = r ? Array.from(new Set(r.steps.map(x => x.outputPartId).filter(Boolean))) : [];
    (p.milestones || []).forEach((m, i) => {
      const row = UI.el('<div class="form-row" style="margin-bottom:6px">' +
        '<label class="f"><span>Sub-assembly</span><select class="ms-part" style="min-width:280px">' + produced.map(pid => '<option value="' + pid + '"' + (pid === m.partId ? ' selected' : '') + '>' + UI.esc((pb[pid] || {}).itemNr + ' – ' + (pb[pid] || {}).name) + (pid === r.finalPartId ? ' (final product)' : '') + '</option>').join('') + '</select></label>' +
        '<label class="f"><span>Due date</span><input type="date" class="ms-date" value="' + UI.esc(m.dueDate || '') + '"></label>' +
        '<label class="f"><span>Time</span><input type="time" class="ms-time" value="' + UI.esc(m.dueTime || cal.s.shiftEnd) + '"></label>' +
        '<label class="f"><span>Extra pcs delivered separately</span><input type="number" class="ms-qty" min="0" step="1" value="' + U.num(m.qty) + '"></label>' +
        '<button class="btn btn-icon btn-danger" title="Remove" style="align-self:flex-end;margin-bottom:2px">✕</button></div>');
      const recalc = () => { Store.save(); PlanUI.compute(); };
      row.querySelector('.ms-part').addEventListener('change', e => { m.partId = e.target.value; recalc(); });
      row.querySelector('.ms-date').addEventListener('change', e => { m.dueDate = e.target.value; recalc(); });
      row.querySelector('.ms-time').addEventListener('change', e => { m.dueTime = e.target.value; recalc(); });
      row.querySelector('.ms-qty').addEventListener('input', UI.debounce(e => { m.qty = Math.max(0, Math.round(U.num(e.target.value))); recalc(); }, 250));
      row.querySelector('button').addEventListener('click', () => { p.milestones.splice(i, 1); Store.save(); PlanUI.renderMilestones(p, host); PlanUI.compute(); });
      host.appendChild(row);
    });
  };

  PlanUI.compute = function () {
    const p = currentPlan(); const out = document.getElementById('pl-out'); if (!p || !out) return;
    const r = Store.recipe(p.recipeId);
    if (!r) { out.innerHTML = '<div class="alert warn">Select a recipe.</div>'; return; }
    const cal = Store.calendar();
    const due = U.parseLocal(p.dueDate + ' ' + (p.dueTime || cal.s.shiftEnd));
    if (!due) { out.innerHTML = '<div class="alert warn">Enter a delivery date.</div>'; return; }
    let planStart = p.startNow ? new Date() : U.parseLocal(p.planStartDate + ' ' + (p.planStartTime || cal.s.shiftStart));
    if (!planStart) planStart = new Date();
    planStart = cal.snapForward(planStart);
    const pb = Store.partsById();
    const milestones = (p.milestones || []).map(m => ({ partId: m.partId, due: U.parseLocal((m.dueDate || '') + ' ' + (m.dueTime || cal.s.shiftEnd)), qty: m.qty })).filter(m => m.partId && m.due);
    const res = Scheduler.schedule({ recipe: r, partsById: pb, resourcesById: Store.resourcesById(), qty: p.qty, due, planStart, calendar: cal, milestones });
    PlanUI.result = res;
    PlanUI.renderResult(res);
  };

  PlanUI.renderResult = function (res) {
    const out = document.getElementById('pl-out');
    const st = Store.state;
    const mode = st.ui.ganttMode || 'jit';
    const cal = res.calendar;
    const pb = Store.partsById();
    const load = Scheduler.loadProfile(res, mode);
    const peak = load.reduce((m, d) => Math.max(m, d.peakWorkers), 0);
    const maxW = U.num(st.settings.maxWorkers, 0);
    const overload = maxW > 0 && load.filter(d => d.peakWorkers > maxW);
    const rload = Scheduler.resourceLoad(res, mode, maxW);
    PlanUI.rload = rload;
    const conflicts = rload.filter(e => e.conflicts.length);
    const bottleneck = rload.filter(e => e.resource.type !== 'labor' && e.utilization > 0).sort((a, b) => b.utilization - a.utilization)[0];

    let html = '';
    // KPI tiles
    const status = res.graph.cycle ? { cls: 'bad', v: 'Invalid', s: 'circular dependency' } :
      res.startsInPast ? { cls: 'bad', v: 'Not achievable', s: 'needs ' + U.hoursToText(res.shortMinutes / 60) + ' more working time' } :
      { cls: 'good', v: 'Achievable', s: 'slack ' + U.hoursToText(res.rows[res.list.find(x => x.critical) ? res.list.find(x => x.critical).step.id : res.list[0].step.id].floatMinutes / 60) + ' on critical path' };
    html += '<div class="kpis">' +
      '<div class="kpi ' + status.cls + '"><div class="k">Delivery</div><div class="v">' + status.v + '</div><div class="s">' + UI.esc(status.s) + '</div></div>' +
      '<div class="kpi"><div class="k">Due</div><div class="v">' + U.niceDateTime(res.due) + '</div><div class="s">' + res.qty + ' pcs ' + UI.esc((pb[res.recipe.finalPartId] || {}).itemNr || '') + '</div></div>' +
      '<div class="kpi ' + (res.startsInPast ? 'bad' : '') + '"><div class="k">Latest start (JIT)</div><div class="v">' + U.niceDateTime(res.requiredStart) + '</div><div class="s">' + U.hoursToText(res.totals.leadCalendarHoursJIT) + ' lead time · ' + U.round(res.totals.leadWorkingHoursJIT, 1) + ' working h</div></div>' +
      '<div class="kpi ' + (res.late ? 'bad' : '') + '"><div class="k">Earliest finish (ASAP)</div><div class="v">' + U.niceDateTime(res.projectedFinish) + '</div><div class="s">' + (res.late ? 'late by ' + U.hoursToText(res.lateMinutes / 60) + ' working time' : 'starting ' + U.niceDateTime(res.planStart)) + '</div></div>' +
      '<div class="kpi"><div class="k">Labor</div><div class="v">' + U.round(res.totals.laborHours, 1) + ' h</div><div class="s">' + U.round(res.totals.laborHours / res.qty, 2) + ' h per pc · ' + U.round(res.totals.cureHours, 1) + ' h cure/wait</div></div>' +
      '<div class="kpi ' + (overload && overload.length ? 'bad' : '') + '"><div class="k">Peak workers</div><div class="v">' + peak + '</div><div class="s">' + (maxW ? (overload.length ? overload.length + ' day(s) over ' + maxW : 'within ' + maxW + ' available') : 'concurrently, ' + mode.toUpperCase() + ' schedule') + '</div></div>' +
      '<div class="kpi ' + (conflicts.length ? 'bad' : '') + '"><div class="k">Bottleneck resource</div><div class="v" style="font-size:16px">' + (bottleneck ? UI.esc(bottleneck.resource.name) : '–') + '</div><div class="s">' + (bottleneck ? Math.round(bottleneck.utilization * 100) + '% busy over its active days' : 'no equipment assigned') + (conflicts.length ? ' · ' + conflicts.length + ' double-booked' : '') + '</div></div>' +
      '</div>';
    // sub-assembly due dates
    if (res.milestones.length) {
      html += '<div class="kpis">' + res.milestones.map(m => '<div class="kpi ' + (m.late ? 'bad' : (m.LF && m.LF > m.due ? 'bad' : 'good')) + '"><div class="k">Sub-assembly due · ' + UI.esc((m.part || {}).itemNr || '') + '</div><div class="v" style="font-size:16px">' + (m.late ? 'Late by ' + U.hoursToText(m.lateMinutes / 60) : 'Achievable') + '</div><div class="s">due ' + U.niceDateTime(m.due) + (m.qty ? ' · +' + m.qty + ' pcs' : '') + (m.EF ? ' · earliest ' + U.niceDateTime(m.EF) : '') + '</div></div>').join('') + '</div>';
    }

    // alerts
    const alerts = [];
    if (res.startsInPast) alerts.push({ cls: 'err', text: 'Backward scheduling from the delivery date requires starting at ' + U.niceDateTime(res.requiredStart) + ', which is before the earliest start (' + U.niceDateTime(res.planStart) + '). Options: move the delivery date to ' + U.niceDateTime(res.projectedFinish) + ' or later, add workers to critical steps, reduce quantity, or add shifts / weekend work in the calendar.' });
    const latePurch = res.purchases.filter(x => x.orderLate);
    if (latePurch.length) alerts.push({ cls: 'warn', text: 'Material lead time exceeded for ' + latePurch.length + ' part(s): ' + latePurch.slice(0, 4).map(x => x.part.itemNr + ' (order by ' + U.niceDate(x.orderByJIT) + ')').join(', ') + (latePurch.length > 4 ? ', …' : '') + '. Check stock or expedite.' });
    res.warnings.forEach(w => alerts.push({ cls: w.level === 'error' ? 'err' : 'warn', text: w.text }));
    conflicts.forEach(e => alerts.push({ cls: 'err', text: (e.resource.type === 'labor' ? 'Worker pool "' : 'Equipment "') + e.resource.name + '" (capacity ' + e.resource.capacity + ') is over capacity in the ' + mode.toUpperCase() + ' schedule: ' + e.conflicts.slice(0, 3).map(c => U.niceDateTime(c.a) + ' – ' + U.niceDateTime(c.b) + ' (' + c.load + ' needed)').join(', ') + (e.conflicts.length > 3 ? ' and ' + (e.conflicts.length - 3) + ' more' : '') + '. Competing lots are shown red in the resource occupancy chart; add capacity, change lot sizes or sequence the steps.' }));
    if (overload && overload.length) alerts.push({ cls: 'warn', text: 'Worker capacity (' + maxW + ') exceeded on ' + overload.map(d => U.niceDate(U.parseLocal(d.date)) + ' (' + d.peakWorkers + ')').join(', ') + '.' });
    html += alerts.map(a => '<div class="alert ' + a.cls + '">' + UI.esc(a.text) + '</div>').join('');

    // controls + gantt
    html += '<div class="panel"><div class="panel-head no-print"><h3>Schedule</h3>' +
      '<span class="btn-group"><button class="btn btn-sm' + (mode === 'jit' ? ' active' : '') + '" data-mode="jit" title="Backward from delivery date: latest possible start of every step (just-in-time)">Backward (JIT)</button><button class="btn btn-sm' + (mode === 'asap' ? ' active' : '') + '" data-mode="asap" title="Forward from earliest start: as soon as possible">Forward (ASAP)</button></span>' +
      '<label class="check"><input type="checkbox" id="g-crit" ' + (PlanUI.showCriticalOnly ? 'checked' : '') + '> critical path only</label>' +
      '<span class="spacer"></span><span class="muted small">zoom</span><span class="btn-group"><button class="btn btn-sm" data-zoom="out" title="Zoom out">−</button><button class="btn btn-sm" data-zoom="fit" title="Fit whole plan in view">Fit</button><button class="btn btn-sm" data-zoom="days" title="About 90 px per day">Days</button><button class="btn btn-sm" data-zoom="hours" title="Show hours">Hours</button><button class="btn btn-sm" data-zoom="in" title="Zoom in">+</button></span></div>' +
      '<div class="gantt-wrap" id="gantt"></div>' +
      '<div class="gantt-legend"><span><i style="background:#2f6fed"></i>work (colour = step type)</span><span><i style="background:repeating-linear-gradient(45deg,#c46a1c,#c46a1c 3px,#fde8d3 3px,#fde8d3 6px)"></i>process / cure per lot</span><span><i style="background:#fff;border:2px solid var(--critical)"></i>critical path</span><span><i style="background:var(--nonwork)"></i>non-working time</span><span><i style="background:#cbd5e1;height:3px"></i>float (could start earlier)</span><span style="color:var(--accent)">│ start</span><span style="color:var(--danger)">│ due</span></div>' +
      '</div>';

    html += '<div class="panel"><div class="panel-head"><h3>Resource occupancy</h3><span class="muted small">' + (mode === 'jit' ? 'JIT' : 'ASAP') + ' schedule · each lane is one unit of capacity (one fixture, one chamber, one person) · red = over capacity</span></div><div class="gantt-wrap" id="rgantt"></div></div>';
    html += '<div class="grid-2"><div class="panel"><div class="panel-head"><h3>Precedence network</h3><span class="muted small">arrows = must finish before</span></div><div class="net-wrap" id="net"></div></div>' +
      '<div class="panel"><div class="panel-head"><h3>Worker load per day</h3><span class="muted small">' + (mode === 'jit' ? 'JIT' : 'ASAP') + ' schedule · peak concurrent workers' + (maxW ? ' · limit ' + maxW : '') + '</span></div><div id="load"></div></div></div>';

    // schedule table
    const order = res.list.slice().sort((a, b) => (mode === 'jit' ? a.LS - b.LS : a.ES - b.ES) || U.num(a.step.nr) - U.num(b.step.nr));
    html += '<div class="panel"><div class="panel-head"><h3>Step schedule</h3><span class="muted small">' + (mode === 'jit' ? 'latest start / finish (backward from due date)' : 'earliest start / finish (forward from start)') + '</span></div><div class="tbl-wrap"><table class="tbl" id="sched"><thead><tr><th>Step</th><th>Type</th><th>Output</th><th class="num">Units</th><th>Resource / lots</th><th class="num">Workers</th><th class="num">Work</th><th class="num">Process</th><th>Start</th><th>Work end</th><th>Finish</th><th class="num">Float</th><th>After</th></tr></thead><tbody>' +
      order.map(x => {
        const s = x.step, o = pb[s.outputPartId];
        const S = mode === 'jit' ? x.LS : x.ES, WE = mode === 'jit' ? x.LworkEnd : x.EworkEnd, F = mode === 'jit' ? x.LF : x.EF;
        return '<tr class="' + (x.critical ? 'critical' : '') + (PlanUI.selectedStepId === s.id ? ' selected' : '') + '" data-id="' + s.id + '"><td><b>' + UI.esc(s.nr) + '</b> ' + UI.esc(s.name) + '</td><td>' + UI.typeBadge(s.type) + '</td><td class="mono">' + (o ? UI.esc(o.itemNr) : '') + '</td><td class="num">' + U.round(x.units, 2) + '</td><td class="small">' + (x.resource ? UI.esc(x.resource.name) + '<br>' : '') + (x.nLots > 1 ? x.nLots + ' lots' + (x.waves > 1 ? ' / ' + x.waves + ' waves' : '') + (x.transfer ? ' ⇢' : '') : (x.resource ? '1 lot' : '')) + '</td><td class="num">' + x.workers + (x.pool ? '<br><span class="small muted">' + UI.esc(x.pool.name) + '</span>' : '') + '</td><td class="num nowrap">' + U.minutesToText(x.workMinutes) + '</td><td class="num nowrap">' + (x.processHours ? U.hoursToText(x.processHours) + (x.nLots > 1 ? ' / lot' : '') : '–') + '</td><td class="nowrap">' + U.niceDateTime(S) + '</td><td class="nowrap">' + U.niceDateTime(WE) + '</td><td class="nowrap">' + U.niceDateTime(F) + '</td><td class="num nowrap">' + (x.critical ? '<span class="badge err">critical</span>' : U.hoursToText(x.floatMinutes / 60)) + '</td><td class="small muted">' + x.preds.map(id => res.rows[id].step.nr).join(', ') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    // materials
    html += '<div class="panel"><div class="panel-head"><h3>Materials to purchase</h3><span class="muted small">demand exploded through all steps · need date = start of first consuming step · order-by = need date − lead time</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item nr</th><th>Name</th><th class="num">Qty</th><th class="num">Lead time</th><th>Needed (JIT)</th><th>Order by (JIT)</th><th>Needed (ASAP)</th><th>Order by (ASAP)</th></tr></thead><tbody>' +
      (res.purchases.length ? res.purchases.map(x => '<tr><td class="mono">' + UI.esc(x.part.itemNr) + '</td><td>' + UI.esc(x.part.name) + '</td><td class="num">' + U.round(x.qty, 3) + ' ' + UI.esc(x.part.unit || 'pcs') + '</td><td class="num">' + x.leadTimeDays + ' d</td><td class="nowrap">' + (x.needJIT ? U.niceDate(x.needJIT) : '') + '</td><td class="nowrap">' + (x.orderByJIT ? (x.orderLate ? '<span class="badge err">' + U.niceDate(x.orderByJIT) + '</span>' : U.niceDate(x.orderByJIT)) : '') + '</td><td class="nowrap">' + (x.needASAP ? U.niceDate(x.needASAP) : '') + '</td><td class="nowrap">' + (x.orderByASAP ? U.niceDate(x.orderByASAP) : '') + '</td></tr>').join('') : '<tr><td colspan="8" class="muted center">No purchased parts in this recipe.</td></tr>') +
      '</tbody></table></div></div>';

    out.innerHTML = html;
    out.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { st.ui.ganttMode = b.dataset.mode; Store.save(); PlanUI.renderResult(res); }));
    out.querySelector('#g-crit').addEventListener('change', e => { PlanUI.showCriticalOnly = e.target.checked; PlanUI.drawGantt(res, mode); });
    const legend = out.querySelector('.gantt-legend'); if (legend) legend.insertAdjacentHTML('beforeend', '<span style="color:#7c3aed">┆ sub-assembly due</span>');
    out.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => {
      const z = b.dataset.zoom;
      if (z === 'fit') st.ui.zoom = 1;
      else if (z === 'days' || z === 'hours') { const fitPx = PlanUI.lastFitPxPerDay || 40; st.ui.zoom = U.clamp((z === 'days' ? 90 : 320) / fitPx, 0.25, 60); }
      else st.ui.zoom = U.clamp((st.ui.zoom || 1) * (z === 'in' ? 1.5 : 1 / 1.5), 0.25, 60);
      Store.save(); PlanUI.drawGantt(res, mode); PlanUI.drawResourceGantt(res, mode, PlanUI.rload);
      if (z !== 'fit') { const g = document.querySelector('#gantt .gantt-scroll'); const first = g && g.querySelector('g.bar rect'); if (first) g.scrollLeft = Math.max(0, +first.getAttribute('x') - 60); }
    }));
    out.querySelectorAll('#sched tbody tr').forEach(tr => tr.addEventListener('click', () => { PlanUI.select(tr.dataset.id, res, mode); }));
    PlanUI.drawGantt(res, mode);
    PlanUI.drawResourceGantt(res, mode, rload);
    PlanUI.drawNetwork(res, mode);
    PlanUI.drawLoad(load, maxW);
  };

  PlanUI.select = function (id, res, mode) {
    PlanUI.selectedStepId = PlanUI.selectedStepId === id ? null : id;
    document.querySelectorAll('#sched tbody tr').forEach(tr => tr.classList.toggle('selected', tr.dataset.id === PlanUI.selectedStepId));
    PlanUI.drawGantt(res, mode); PlanUI.drawNetwork(res, mode); PlanUI.drawResourceGantt(res, mode, PlanUI.rload);
  };

  /* ---------- Gantt ---------- */
  PlanUI.tipHtml = function (x, res, mode, pb) {
    const s = x.step, o = pb[s.outputPartId];
    const S = mode === 'jit' ? x.LS : x.ES, WE = mode === 'jit' ? x.LworkEnd : x.EworkEnd, F = mode === 'jit' ? x.LF : x.EF;
    return '<b>' + UI.esc(s.nr + ' ' + s.name) + '</b>' + (x.critical ? ' <span style="color:#fca5a5">critical</span>' : '') + '<br>' + Scheduler.typeInfo(s.type).label + (o ? ' → ' + UI.esc(o.itemNr) + ' ' + UI.esc(o.name) : '') +
      '<br>' + U.round(x.units, 2) + ' units · ' + x.workers + ' worker(s)' + (x.pool ? ' from ' + UI.esc(x.pool.name) : '') + ' · ' + U.round(x.laborHours, 1) + ' labor h' +
      (x.resource ? '<br>On ' + UI.esc(x.resource.name) + ': ' + x.nLots + ' lot(s) of ≤' + (x.lotSize || x.units) + ' pcs, ' + x.resource.capacity + ' at a time → ' + x.waves + ' wave(s)' + (x.transfer ? ', next step per lot' : '') : (x.nLots > 1 ? '<br>' + x.nLots + ' lots of ' + x.lotSize + (x.transfer ? ', next step per lot' : '') : '')) +
      '<br>Work: ' + U.niceDateTime(S) + ' → ' + U.niceDateTime(WE) + ' (' + U.minutesToText(x.workMinutes) + ' attended)' +
      (x.processHours ? '<br>Process: ' + U.hoursToText(x.processHours) + ' per lot (' + (x.procCal === 'shop' ? 'shop hours' : '24/7') + ') → last lot done ' + U.niceDateTime(F) : '') +
      '<br>Float: ' + U.hoursToText(x.floatMinutes / 60) + (mode === 'jit' ? ' · earliest start ' + U.niceDateTime(x.ES) : ' · latest start ' + U.niceDateTime(x.LS)) +
      ((s.components || []).length ? '<br>Uses: ' + s.components.map(c => (pb[c.partId] ? pb[c.partId].itemNr : '?') + '×' + U.round(c.qty * x.units, 2)).join(', ') : '') +
      (s.notes ? '<br><i>' + UI.esc(s.notes) + '</i>' : '');
  };

  PlanUI.drawGantt = function (res, mode) {
    const wrap = document.getElementById('gantt'); if (!wrap) return;
    const st = Store.state, cal = res.calendar, pb = Store.partsById();
    let rows = res.list.slice().sort((a, b) => (mode === 'jit' ? a.LS - b.LS : a.ES - b.ES) || U.num(a.step.nr) - U.num(b.step.nr));
    if (PlanUI.showCriticalOnly) rows = rows.filter(x => x.critical);
    const start = x => mode === 'jit' ? x.LS : x.ES, wend = x => mode === 'jit' ? x.LworkEnd : x.EworkEnd, fin = x => mode === 'jit' ? x.LF : x.EF;

    let t0 = new Date(Math.min(res.planStart, res.requiredStart, res.due)), t1 = new Date(Math.max(res.due, res.projectedFinish, res.planStart));
    rows.forEach(x => { if (x.ES < t0) t0 = x.ES; if (x.LF > t1) t1 = x.LF; });
    t0 = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate()); t1 = new Date(t1.getFullYear(), t1.getMonth(), t1.getDate() + 1);
    const totalH = (t1 - t0) / 3600000;
    const labelW = 250, rowH = 28, headH = 40, padR = 20;
    const avail = Math.max(400, wrap.clientWidth - labelW - padR - 2);
    PlanUI.lastFitPxPerDay = (avail / totalH) * 24;
    const pxh = Math.max(0.5, (avail / totalH) * (st.ui.zoom || 1));
    const W = totalH * pxh + padR, H = headH + rows.length * rowH + 10;
    const X = t => ((t - t0) / 3600000) * pxh;

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(W) + '" height="' + H + '" font-family="system-ui, sans-serif" font-size="11">';
    svg += '<defs><pattern id="cureHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fde8d3"/><rect width="2.5" height="6" fill="#c46a1c"/></pattern></defs>';
    svg += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>';
    // non-working shading + day columns
    const days = Math.round(totalH / 24);
    const dayPx = 24 * pxh;
    const showHours = dayPx > 160, showDayNames = dayPx > 34;
    for (let i = 0; i < days; i++) {
      const d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + i);
      const x = X(d), xe = X(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
      const wins = cal.windows(d);
      if (!wins.length) svg += '<rect x="' + x + '" y="' + headH + '" width="' + (xe - x) + '" height="' + (H - headH) + '" fill="var(--nonwork)"/>';
      else {
        let cur = d;
        wins.forEach(w => { if (w.a > cur) svg += '<rect x="' + X(cur) + '" y="' + headH + '" width="' + (X(w.a) - X(cur)) + '" height="' + (H - headH) + '" fill="var(--nonwork)"/>'; cur = w.b; });
        const de = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        if (de > cur) svg += '<rect x="' + X(cur) + '" y="' + headH + '" width="' + (X(de) - X(cur)) + '" height="' + (H - headH) + '" fill="var(--nonwork)"/>';
      }
      svg += '<line x1="' + x + '" y1="20" x2="' + x + '" y2="' + H + '" stroke="#e5e9f0"/>';
      if (showDayNames) svg += '<text x="' + (x + 3) + '" y="33" fill="#334155">' + (dayPx > 60 ? U.dayName(d) + ' ' : '') + d.getDate() + '.' + (d.getMonth() + 1) + '.</text>';
      else if (d.getDay() === 1) svg += '<text x="' + (x + 2) + '" y="33" fill="#334155">' + d.getDate() + '.' + (d.getMonth() + 1) + '.</text>';
      if (i === 0 || d.getDate() === 1) svg += '<text x="' + (x + 3) + '" y="14" fill="#64748b" font-weight="600">' + d.toLocaleString('en', { month: 'long' }) + ' ' + d.getFullYear() + '</text>';
      if (showHours) for (let h = 6; h < 24; h += 6) { const xh = X(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h)); svg += '<line x1="' + xh + '" y1="' + headH + '" x2="' + xh + '" y2="' + H + '" stroke="#f1f5f9"/><text x="' + (xh + 2) + '" y="' + (headH - 3) + '" fill="#94a3b8" font-size="9">' + h + ':00</text>'; }
    }
    // rows
    const yOf = {}; rows.forEach((x, i) => { yOf[x.step.id] = headH + i * rowH; });
    rows.forEach((x, i) => {
      const y = yOf[x.step.id];
      const sel = PlanUI.selectedStepId === x.step.id;
      svg += '<rect x="0" y="' + y + '" width="' + W + '" height="' + rowH + '" fill="' + (sel ? '#e8effd' : (i % 2 ? '#fafbfd' : 'none')) + '" opacity="' + (sel ? 1 : 0.6) + '"/>';
      svg += '<line x1="0" y1="' + (y + rowH) + '" x2="' + W + '" y2="' + (y + rowH) + '" stroke="#eef2f7"/>';
    });
    // dependency arrows
    rows.forEach(x => x.preds.forEach(pid => {
      const p = res.rows[pid]; if (yOf[pid] == null) return;
      const crit = x.critical && p.critical && (x.driverPreds || []).indexOf(pid) >= 0;
      const x1 = X(fin(p)), y1 = yOf[pid] + rowH / 2, x2 = X(start(x)), y2 = yOf[x.step.id] + rowH / 2;
      const mid = Math.max(x1 + 6, x2 - 8);
      svg += '<path d="M' + x1 + ',' + y1 + ' H' + mid + ' V' + y2 + ' H' + (x2 - 1) + '" fill="none" stroke="' + (crit ? 'var(--critical)' : '#94a3b8') + '" stroke-width="' + (crit ? 1.5 : 1) + '" opacity="' + (crit ? 0.9 : 0.6) + '"/>';
      svg += '<path d="M' + (x2 - 5) + ',' + (y2 - 3.5) + ' L' + (x2 - 1) + ',' + y2 + ' L' + (x2 - 5) + ',' + (y2 + 3.5) + ' Z" fill="' + (crit ? 'var(--critical)' : '#94a3b8') + '"/>';
    }));
    // bars
    rows.forEach(x => {
      const y = yOf[x.step.id], s = x.step, col = Scheduler.typeInfo(s.type).color;
      const S = start(x), WE = wend(x), F = fin(x);
      const by = y + 6, bh = rowH - 12;
      // float indicator
      if (mode === 'jit' && x.ES < x.LS) svg += '<line x1="' + X(x.ES) + '" y1="' + (y + rowH / 2) + '" x2="' + X(x.LS) + '" y2="' + (y + rowH / 2) + '" stroke="#cbd5e1" stroke-width="3" stroke-linecap="round"/>';
      if (mode === 'asap' && x.LS > x.ES) svg += '<line x1="' + X(x.EF) + '" y1="' + (y + rowH / 2) + '" x2="' + X(x.LF) + '" y2="' + (y + rowH / 2) + '" stroke="#cbd5e1" stroke-width="3" stroke-linecap="round"/>';
      const g = '<g class="bar" data-id="' + s.id + '" style="cursor:pointer">';
      let bars = '';
      const lots = Scheduler.lotsOf(x, mode);
      // faint span of the whole step, then per lot: attended work solid (in working windows), process hatched
      bars += '<rect x="' + X(S) + '" y="' + (by + 3) + '" width="' + Math.max(1, X(F) - X(S)) + '" height="' + (bh - 6) + '" fill="' + col + '" opacity="0.15" rx="2"/>';
      const many = lots.length > 1;
      lots.forEach(l => {
        if (l.attEnd > l.attStart) Scheduler.workSegments(cal, l.attStart, l.attEnd).forEach(seg => { bars += '<rect x="' + X(seg.a) + '" y="' + by + '" width="' + Math.max(1.5, X(seg.b) - X(seg.a)) + '" height="' + bh + '" fill="' + col + '" rx="2"/>'; });
        else bars += '<rect x="' + (X(l.attStart) - 1) + '" y="' + by + '" width="2" height="' + bh + '" fill="' + col + '"/>';
        if (l.procEnd > l.attEnd) bars += '<rect x="' + X(l.attEnd) + '" y="' + (by + 2) + '" width="' + Math.max(1, X(l.procEnd) - X(l.attEnd)) + '" height="' + (bh - 4) + '" fill="url(#cureHatch)" stroke="#c46a1c" stroke-width="0.5" opacity="' + (many ? 0.55 : 1) + '" rx="2"/>';
      });
      if (x.critical) bars += '<rect x="' + (X(S) - 1.5) + '" y="' + (by - 1.5) + '" width="' + Math.max(3, X(F) - X(S) + 3) + '" height="' + (bh + 3) + '" fill="none" stroke="var(--critical)" stroke-width="1.5" rx="3"/>';
      // label inside/after bar
      const lx = X(F) + 5;
      if (lx < W - 40) bars += '<text x="' + lx + '" y="' + (y + rowH / 2 + 4) + '" fill="#64748b" font-size="10">' + U.minutesToText(x.workMinutes) + (x.processHours ? ' +' + U.hoursToText(x.processHours) + (x.nLots > 1 ? '/lot' : '') : '') + (x.nLots > 1 ? ' · ' + x.nLots + ' lots' : '') + '</text>';
      svg += g + bars + '<rect x="' + X(S) + '" y="' + y + '" width="' + Math.max(6, X(F) - X(S)) + '" height="' + rowH + '" fill="transparent"/></g>';
    });
    // today / due lines
    const lineX = (t, colr, label, anchorRight) => '<line x1="' + X(t) + '" y1="20" x2="' + X(t) + '" y2="' + H + '" stroke="' + colr + '" stroke-width="1.5" stroke-dasharray="4 3"/><text x="' + (X(t) + (anchorRight ? -4 : 4)) + '" y="' + (H - 2) + '" fill="' + colr + '" font-size="10" font-weight="600" text-anchor="' + (anchorRight ? 'end' : 'start') + '">' + label + '</text>';
    svg += lineX(res.planStart, 'var(--accent)', 'start ' + U.hhmm(res.planStart));
    svg += lineX(res.due, 'var(--danger)', 'due ' + U.niceDateTime(res.due), true);
    (res.milestones || []).forEach(m => { svg += '<line x1="' + X(m.due) + '" y1="20" x2="' + X(m.due) + '" y2="' + H + '" stroke="' + (m.late ? 'var(--danger)' : '#7c3aed') + '" stroke-width="1.2" stroke-dasharray="2 3"/><text x="' + (X(m.due) - 4) + '" y="30" fill="' + (m.late ? 'var(--danger)' : '#7c3aed') + '" font-size="9.5" font-weight="600" text-anchor="end">' + UI.esc((m.part || {}).itemNr || '') + ' due</text>'; });
    svg += '</svg>';
    // labels column in its own (non-scrolling) SVG
    let lab = '<svg xmlns="http://www.w3.org/2000/svg" width="' + labelW + '" height="' + H + '" font-family="system-ui, sans-serif" font-size="11"><rect x="0" y="0" width="' + labelW + '" height="' + H + '" fill="#fff"/><line x1="' + (labelW - 1) + '" y1="0" x2="' + (labelW - 1) + '" y2="' + H + '" stroke="#dbe1ea"/>';
    rows.forEach((x, i) => {
      const y = yOf[x.step.id];
      if (PlanUI.selectedStepId === x.step.id) lab += '<rect x="0" y="' + y + '" width="' + labelW + '" height="' + rowH + '" fill="#e8effd"/>';
      lab += '<line x1="0" y1="' + (y + rowH) + '" x2="' + labelW + '" y2="' + (y + rowH) + '" stroke="#eef2f7"/>';
    });
    rows.forEach(x => {
      const y = yOf[x.step.id], s = x.step, col = Scheduler.typeInfo(s.type).color;
      lab += '<g class="lab" data-id="' + s.id + '" style="cursor:pointer"><rect x="0" y="' + y + '" width="' + labelW + '" height="' + rowH + '" fill="transparent"/><rect x="6" y="' + (y + 8) + '" width="4" height="' + (rowH - 16) + '" fill="' + col + '" rx="1"/>';
      const name = (s.nr + ' ' + s.name);
      lab += '<text x="16" y="' + (y + 13) + '" fill="#1b2430" font-weight="' + (x.critical ? '600' : '400') + '">' + UI.esc(name.length > 38 ? name.slice(0, 37) + '…' : name) + '</text>';
      lab += '<text x="16" y="' + (y + 24) + '" fill="#64748b" font-size="9.5">' + U.round(x.units, 1) + ' pcs · ' + x.workers + ' w' + (x.resource ? ' · ' + UI.esc(x.resource.name.length > 14 ? x.resource.name.slice(0, 13) + '…' : x.resource.name) : '') + ' · ' + U.niceDateTime(start(x)) + '</text></g>';
    });
    lab += '<text x="8" y="14" fill="#64748b" font-weight="600">' + (mode === 'jit' ? 'Backward (JIT) schedule' : 'Forward (ASAP) schedule') + '</text>';
    lab += '<text x="8" y="33" fill="#94a3b8" font-size="10">' + rows.length + ' steps · hover bars for details</text>';
    lab += '</svg>';
    const prevScroll = wrap.querySelector('.gantt-scroll') ? wrap.querySelector('.gantt-scroll').scrollLeft : 0;
    wrap.innerHTML = '<div class="gantt-labels">' + lab + '</div><div class="gantt-scroll">' + svg + '</div>';
    wrap.querySelector('.gantt-scroll').scrollLeft = prevScroll;
    wrap.querySelectorAll('g.lab').forEach(g => {
      const x = res.rows[g.dataset.id];
      g.addEventListener('mouseenter', e => UI.showTip(PlanUI.tipHtml(x, res, mode, pb), e.clientX, e.clientY));
      g.addEventListener('mousemove', e => UI.moveTip(e.clientX, e.clientY));
      g.addEventListener('mouseleave', UI.hideTip);
      g.addEventListener('click', () => PlanUI.select(g.dataset.id, res, mode));
    });
    wrap.querySelectorAll('g.bar').forEach(g => {
      const x = res.rows[g.dataset.id];
      g.addEventListener('mouseenter', e => UI.showTip(PlanUI.tipHtml(x, res, mode, pb), e.clientX, e.clientY));
      g.addEventListener('mousemove', e => UI.moveTip(e.clientX, e.clientY));
      g.addEventListener('mouseleave', UI.hideTip);
      g.addEventListener('click', () => PlanUI.select(g.dataset.id, res, mode));
    });
  };

  /* ---------- Resource Gantt ---------- */
  PlanUI.drawResourceGantt = function (res, mode, rload) {
    const wrap = document.getElementById('rgantt'); if (!wrap) return;
    if (!rload || !rload.length) { wrap.innerHTML = '<p class="muted small" style="padding:10px">No resources assigned to steps. Add equipment and worker pools on the Resources tab and select them on the recipe steps.</p>'; return; }
    const st = Store.state, cal = res.calendar;
    let t0 = new Date(Math.min(res.planStart, res.requiredStart, res.due)), t1 = new Date(Math.max(res.due, res.projectedFinish, res.planStart));
    res.list.forEach(x => { if (x.ES < t0) t0 = x.ES; if (x.LF > t1) t1 = x.LF; });
    t0 = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate()); t1 = new Date(t1.getFullYear(), t1.getMonth(), t1.getDate() + 1);
    const totalH = (t1 - t0) / 3600000;
    const labelW = 250, headH = 40, padR = 20, laneH = 9;
    const avail = Math.max(400, wrap.clientWidth - labelW - padR - 2);
    const pxh = Math.max(0.5, (avail / totalH) * (st.ui.zoom || 1));
    const X = t => ((t - t0) / 3600000) * pxh;
    // lane assignment per resource (greedy interval colouring, an interval takes w lanes)
    const rowsR = rload.map(e => {
      const cap = Math.max(1, Math.round(U.num(e.resource.capacity, 1)));
      const ivs = e.intervals.slice().sort((a, b) => a.a - b.a || a.b - b.b);
      const laneFree = [];
      ivs.forEach(iv => {
        let lane = -1;
        for (let k = 0; k + iv.w <= laneFree.length; k++) { let ok = true; for (let m = 0; m < iv.w; m++) { if (laneFree[k + m] > iv.a) { ok = false; break; } } if (ok) { lane = k; break; } }
        if (lane < 0) { lane = laneFree.length; for (let m = 0; m < iv.w; m++) laneFree.push(null); }
        for (let m = 0; m < iv.w; m++) laneFree[lane + m] = iv.b;
        iv.lane = lane;
      });
      const lanes = Math.max(cap, laneFree.length, 1);
      return { e, cap, ivs, lanes, h: Math.max(26, lanes * laneH + 8) };
    });
    const H = headH + rowsR.reduce((a, r) => a + r.h, 0) + 10, W = totalH * pxh + padR;
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(W) + '" height="' + H + '" font-family="system-ui, sans-serif" font-size="11"><rect width="' + W + '" height="' + H + '" fill="#fff"/>';
    const days = Math.round(totalH / 24), dayPx = 24 * pxh;
    for (let i = 0; i < days; i++) {
      const d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + i);
      const x = X(d), xe = X(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
      if (!cal.isWorkingDay(d)) svg += '<rect x="' + x + '" y="' + headH + '" width="' + (xe - x) + '" height="' + (H - headH) + '" fill="var(--nonwork)"/>';
      svg += '<line x1="' + x + '" y1="20" x2="' + x + '" y2="' + H + '" stroke="#e5e9f0"/>';
      if (dayPx > 34) svg += '<text x="' + (x + 3) + '" y="33" fill="#334155">' + (dayPx > 60 ? U.dayName(d) + ' ' : '') + d.getDate() + '.' + (d.getMonth() + 1) + '.</text>';
      else if (d.getDay() === 1) svg += '<text x="' + (x + 2) + '" y="33" fill="#334155">' + d.getDate() + '.' + (d.getMonth() + 1) + '.</text>';
    }
    let y = headH;
    let lab = '<svg xmlns="http://www.w3.org/2000/svg" width="' + labelW + '" height="' + H + '" font-family="system-ui, sans-serif" font-size="11"><rect width="' + labelW + '" height="' + H + '" fill="#fff"/><line x1="' + (labelW - 1) + '" y1="0" x2="' + (labelW - 1) + '" y2="' + H + '" stroke="#dbe1ea"/>';
    lab += '<text x="8" y="14" fill="#64748b" font-weight="600">Resources</text>';
    rowsR.forEach(r => {
      const e = r.e, over = e.conflicts.length;
      svg += '<line x1="0" y1="' + (y + r.h) + '" x2="' + W + '" y2="' + (y + r.h) + '" stroke="#dbe1ea"/>';
      const capY = y + 4 + r.cap * laneH;
      if (r.lanes > r.cap) svg += '<line x1="0" y1="' + capY + '" x2="' + W + '" y2="' + capY + '" stroke="var(--danger)" stroke-dasharray="3 3"/>';
      r.ivs.forEach(iv => {
        const col = Scheduler.typeInfo(iv.row.step.type).color;
        const ly = y + 4 + iv.lane * laneH, lh = iv.w * laneH - 2;
        const bad = iv.lane + iv.w > r.cap;
        const sel = PlanUI.selectedStepId === iv.row.step.id;
        svg += '<g class="riv" data-id="' + iv.row.step.id + '" data-j="' + iv.j + '" style="cursor:pointer"><rect x="' + X(iv.a) + '" y="' + ly + '" width="' + Math.max(1.5, X(iv.b) - X(iv.a)) + '" height="' + lh + '" fill="' + (bad ? 'var(--danger)' : col) + '" opacity="' + (sel ? 1 : 0.85) + '" rx="1.5"' + (sel ? ' stroke="#111827" stroke-width="1.5"' : '') + '/></g>';
      });
      lab += '<text x="8" y="' + (y + 15) + '" fill="#1b2430" font-weight="600">' + UI.esc(e.resource.name.length > 30 ? e.resource.name.slice(0, 29) + '…' : e.resource.name) + '</text>';
      lab += '<text x="8" y="' + (y + 26) + '" fill="' + (over ? 'var(--danger)' : '#64748b') + '" font-size="9.5">' + (e.resource.type === 'labor' ? 'pool of ' + r.cap : 'capacity ' + r.cap + (U.num(e.resource.lotSize) ? ' × lot ' + e.resource.lotSize : '')) + ' · ' + Math.round(e.utilization * 100) + '% busy' + (over ? ' · ' + over + ' overbooking' : '') + '</text>';
      y += r.h;
    });
    const lineX = (t, colr) => '<line x1="' + X(t) + '" y1="20" x2="' + X(t) + '" y2="' + H + '" stroke="' + colr + '" stroke-width="1.5" stroke-dasharray="4 3"/>';
    svg += lineX(res.planStart, 'var(--accent)') + lineX(res.due, 'var(--danger)') + '</svg>';
    lab += '</svg>';
    const main = document.querySelector('#gantt .gantt-scroll');
    const prev = wrap.querySelector('.gantt-scroll') ? wrap.querySelector('.gantt-scroll').scrollLeft : (main ? main.scrollLeft : 0);
    wrap.innerHTML = '<div class="gantt-labels">' + lab + '</div><div class="gantt-scroll">' + svg + '</div>';
    wrap.querySelector('.gantt-scroll').scrollLeft = prev;
    wrap.querySelectorAll('g.riv').forEach(g => {
      const x = res.rows[g.dataset.id]; const l = Scheduler.lotsOf(x, mode)[+g.dataset.j];
      g.addEventListener('mouseenter', e => UI.showTip('<b>' + UI.esc(x.step.nr + ' ' + x.step.name) + '</b> · lot ' + (+g.dataset.j + 1) + '/' + x.nLots + ' (' + U.round(l.units, 2) + ' pcs)<br>' + U.niceDateTime(l.attStart) + ' → ' + U.niceDateTime(l.procEnd) + '<br>attended until ' + U.niceDateTime(l.attEnd) + (x.processHours ? ', then ' + U.hoursToText(x.processHours) + ' process' : ''), e.clientX, e.clientY));
      g.addEventListener('mousemove', e => UI.moveTip(e.clientX, e.clientY));
      g.addEventListener('mouseleave', UI.hideTip);
      g.addEventListener('click', () => PlanUI.select(g.dataset.id, res, mode));
    });
    // keep both charts scrolled together
    const b = wrap.querySelector('.gantt-scroll');
    if (main && b) { main.onscroll = () => { if (b.scrollLeft !== main.scrollLeft) b.scrollLeft = main.scrollLeft; }; b.onscroll = () => { if (main.scrollLeft !== b.scrollLeft) main.scrollLeft = b.scrollLeft; }; }
  };

  /* ---------- Precedence network ---------- */
  PlanUI.drawNetwork = function (res, mode) {
    const wrap = document.getElementById('net'); if (!wrap) return;
    const pb = Store.partsById();
    const ids = res.graph.order.slice();
    if (!ids.length) { wrap.innerHTML = '<p class="muted small" style="padding:10px">No steps.</p>'; return; }
    // layering by longest path
    const layer = {};
    ids.forEach(id => { layer[id] = 0; res.rows[id].preds.forEach(p => { layer[id] = Math.max(layer[id], (layer[p] || 0) + 1); }); });
    // transitive reduction for display
    const reach = {};
    ids.slice().reverse().forEach(id => { const r = new Set(); res.rows[id].succs.forEach(s => { r.add(s); (reach[s] || []).forEach(x => r.add(x)); }); reach[id] = Array.from(r); });
    const edges = [];
    ids.forEach(id => res.rows[id].preds.forEach(p => {
      const redundant = res.rows[id].preds.some(q => q !== p && (reach[p] || []).indexOf(q) >= 0);
      if (!redundant) edges.push([p, id]);
    }));
    const cols = {}; ids.forEach(id => { (cols[layer[id]] = cols[layer[id]] || []).push(id); });
    const nW = 180, nH = 46, gapX = 70, gapY = 16;
    const nCols = Object.keys(cols).length, maxRows = Math.max.apply(null, Object.values(cols).map(c => c.length));
    const W = 20 + nCols * (nW + gapX), H = 20 + maxRows * (nH + gapY);
    const pos = {};
    Object.keys(cols).forEach(l => { cols[l].sort((a, b) => U.num(res.rows[a].step.nr) - U.num(res.rows[b].step.nr)); const total = cols[l].length * (nH + gapY); cols[l].forEach((id, i) => { pos[id] = { x: 10 + l * (nW + gapX), y: (H - total) / 2 + 10 + i * (nH + gapY) }; }); });
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" font-family="system-ui, sans-serif" font-size="11"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker><marker id="arrc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#d33c3c"/></marker></defs>';
    edges.forEach(([a, b]) => {
      const A = pos[a], B = pos[b];
      const crit = res.rows[a].critical && res.rows[b].critical && (res.rows[b].driverPreds || []).indexOf(a) >= 0;
      const x1 = A.x + nW, y1 = A.y + nH / 2, x2 = B.x, y2 = B.y + nH / 2, c = (x2 - x1) / 2;
      svg += '<path d="M' + x1 + ',' + y1 + ' C' + (x1 + c) + ',' + y1 + ' ' + (x2 - c) + ',' + y2 + ' ' + x2 + ',' + y2 + '" fill="none" stroke="' + (crit ? '#d33c3c' : '#94a3b8') + '" stroke-width="' + (crit ? 2 : 1.2) + '" marker-end="url(#' + (crit ? 'arrc' : 'arr') + ')"/>';
    });
    ids.forEach(id => {
      const x = res.rows[id], P = pos[id], col = Scheduler.typeInfo(x.step.type).color, sel = PlanUI.selectedStepId === id;
      const name = x.step.nr + ' ' + x.step.name;
      svg += '<g class="node" data-id="' + id + '" style="cursor:pointer"><rect x="' + P.x + '" y="' + P.y + '" width="' + nW + '" height="' + nH + '" rx="6" fill="' + (sel ? '#e8effd' : '#fff') + '" stroke="' + (x.critical ? '#d33c3c' : '#cbd5e1') + '" stroke-width="' + (x.critical ? 2 : 1) + '"/>' +
        '<rect x="' + P.x + '" y="' + P.y + '" width="5" height="' + nH + '" rx="2" fill="' + col + '"/>' +
        '<text x="' + (P.x + 12) + '" y="' + (P.y + 17) + '" font-weight="600" fill="#1b2430">' + UI.esc(name.length > 26 ? name.slice(0, 25) + '…' : name) + '</text>' +
        '<text x="' + (P.x + 12) + '" y="' + (P.y + 31) + '" fill="#64748b" font-size="10">' + U.minutesToText(x.workMinutes) + (x.processHours ? ' + ' + U.hoursToText(x.processHours) + (x.nLots > 1 ? '/lot' : '') : '') + (x.nLots > 1 ? ' · ' + x.nLots + ' lots' : '') + ' · ' + x.workers + ' w</text>' +
        '<text x="' + (P.x + 12) + '" y="' + (P.y + 42) + '" fill="#64748b" font-size="9.5">' + U.niceDateTime(mode === 'jit' ? x.LS : x.ES) + ' → ' + U.niceDateTime(mode === 'jit' ? x.LF : x.EF) + '</text></g>';
    });
    svg += '</svg>';
    wrap.innerHTML = svg;
    wrap.querySelectorAll('g.node').forEach(g => {
      const x = res.rows[g.dataset.id];
      g.addEventListener('mouseenter', e => UI.showTip(PlanUI.tipHtml(x, res, mode, pb), e.clientX, e.clientY));
      g.addEventListener('mousemove', e => UI.moveTip(e.clientX, e.clientY));
      g.addEventListener('mouseleave', UI.hideTip);
      g.addEventListener('click', () => PlanUI.select(g.dataset.id, res, mode));
    });
  };

  /* ---------- Load profile ---------- */
  PlanUI.drawLoad = function (load, maxW) {
    const wrap = document.getElementById('load'); if (!wrap) return;
    if (!load.length) { wrap.innerHTML = '<p class="muted small">No work scheduled.</p>'; return; }
    const W = Math.max(400, wrap.clientWidth - 4), H = 200, padL = 30, padB = 34, padT = 10;
    const n = load.length, bw = Math.max(4, Math.min(40, (W - padL - 10) / n - 3));
    const maxY = Math.max(maxW || 0, load.reduce((m, d) => Math.max(m, d.peakWorkers), 0), 1);
    const y = v => padT + (H - padT - padB) * (1 - v / maxY);
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" font-family="system-ui, sans-serif" font-size="10">';
    for (let v = 0; v <= maxY; v += Math.max(1, Math.ceil(maxY / 5))) svg += '<line x1="' + padL + '" y1="' + y(v) + '" x2="' + W + '" y2="' + y(v) + '" stroke="#eef2f7"/><text x="' + (padL - 4) + '" y="' + (y(v) + 3) + '" text-anchor="end" fill="#64748b">' + v + '</text>';
    load.forEach((d, i) => {
      const x = padL + 5 + i * ((W - padL - 10) / n);
      const over = maxW && d.peakWorkers > maxW;
      svg += '<rect x="' + x + '" y="' + y(d.peakWorkers) + '" width="' + bw + '" height="' + (y(0) - y(d.peakWorkers)) + '" fill="' + (over ? '#d33c3c' : '#93c5fd') + '" rx="2"><title>' + d.date + ': peak ' + d.peakWorkers + ' workers, ' + U.round(d.laborHours, 1) + ' labor h (avg ' + U.round(d.avgWorkers, 1) + ')</title></rect>';
      svg += '<rect x="' + x + '" y="' + y(d.avgWorkers) + '" width="' + bw + '" height="' + Math.max(0, y(0) - y(d.avgWorkers)) + '" fill="' + (over ? '#991b1b' : '#2f6fed') + '" rx="2" opacity="0.9"><title>' + d.date + ': avg ' + U.round(d.avgWorkers, 1) + ' workers</title></rect>';
      if (n <= 40 || i % Math.ceil(n / 40) === 0) { const dt = U.parseLocal(d.date); svg += '<text x="' + (x + bw / 2) + '" y="' + (H - padB + 12) + '" text-anchor="middle" fill="#64748b">' + dt.getDate() + '.' + (dt.getMonth() + 1) + '.</text><text x="' + (x + bw / 2) + '" y="' + (H - padB + 22) + '" text-anchor="middle" fill="#94a3b8" font-size="9">' + U.dayName(dt) + '</text>'; }
    });
    if (maxW) svg += '<line x1="' + padL + '" y1="' + y(maxW) + '" x2="' + W + '" y2="' + y(maxW) + '" stroke="#d33c3c" stroke-dasharray="4 3"/><text x="' + (W - 4) + '" y="' + (y(maxW) - 3) + '" text-anchor="end" fill="#d33c3c">max ' + maxW + '</text>';
    svg += '<text x="' + padL + '" y="' + (H - 2) + '" fill="#64748b">dark = average workers over the shift, light = peak concurrent</text></svg>';
    wrap.innerHTML = svg;
  };

  root.PlanUI = PlanUI;
})(window);
