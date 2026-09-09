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
      '</div><div class="form-row"><label class="f grow"><span>Notes</span><input type="text" id="pl-notes" style="width:100%" value="' + UI.esc(p.notes || '') + '"></label></div></div>');
    host.appendChild(form);
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
    const res = Scheduler.schedule({ recipe: r, partsById: pb, qty: p.qty, due, planStart, calendar: cal });
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
      '</div>';

    // alerts
    const alerts = [];
    if (res.startsInPast) alerts.push({ cls: 'err', text: 'Backward scheduling from the delivery date requires starting at ' + U.niceDateTime(res.requiredStart) + ', which is before the earliest start (' + U.niceDateTime(res.planStart) + '). Options: move the delivery date to ' + U.niceDateTime(res.projectedFinish) + ' or later, add workers to critical steps, reduce quantity, or add shifts / weekend work in the calendar.' });
    const latePurch = res.purchases.filter(x => x.orderLate);
    if (latePurch.length) alerts.push({ cls: 'warn', text: 'Material lead time exceeded for ' + latePurch.length + ' part(s): ' + latePurch.slice(0, 4).map(x => x.part.itemNr + ' (order by ' + U.niceDate(x.orderByJIT) + ')').join(', ') + (latePurch.length > 4 ? ', …' : '') + '. Check stock or expedite.' });
    res.warnings.forEach(w => alerts.push({ cls: w.level === 'error' ? 'err' : 'warn', text: w.text }));
    if (overload && overload.length) alerts.push({ cls: 'warn', text: 'Worker capacity (' + maxW + ') exceeded on ' + overload.map(d => U.niceDate(U.parseLocal(d.date)) + ' (' + d.peakWorkers + ')').join(', ') + '.' });
    html += alerts.map(a => '<div class="alert ' + a.cls + '">' + UI.esc(a.text) + '</div>').join('');

    // controls + gantt
    html += '<div class="panel"><div class="panel-head no-print"><h3>Schedule</h3>' +
      '<span class="btn-group"><button class="btn btn-sm' + (mode === 'jit' ? ' active' : '') + '" data-mode="jit" title="Backward from delivery date: latest possible start of every step (just-in-time)">Backward (JIT)</button><button class="btn btn-sm' + (mode === 'asap' ? ' active' : '') + '" data-mode="asap" title="Forward from earliest start: as soon as possible">Forward (ASAP)</button></span>' +
      '<label class="check"><input type="checkbox" id="g-crit" ' + (PlanUI.showCriticalOnly ? 'checked' : '') + '> critical path only</label>' +
      '<span class="spacer"></span><span class="muted small">zoom</span><span class="btn-group"><button class="btn btn-sm" data-zoom="out" title="Zoom out">−</button><button class="btn btn-sm" data-zoom="fit" title="Fit whole plan in view">Fit</button><button class="btn btn-sm" data-zoom="days" title="About 90 px per day">Days</button><button class="btn btn-sm" data-zoom="hours" title="Show hours">Hours</button><button class="btn btn-sm" data-zoom="in" title="Zoom in">+</button></span></div>' +
      '<div class="gantt-wrap" id="gantt"></div>' +
      '<div class="gantt-legend"><span><i style="background:#2f6fed"></i>work (colour = step type)</span><span><i style="background:repeating-linear-gradient(45deg,#c46a1c,#c46a1c 3px,#fde8d3 3px,#fde8d3 6px)"></i>cure / wait</span><span><i style="background:#fff;border:2px solid var(--critical)"></i>critical path</span><span><i style="background:var(--nonwork)"></i>non-working time</span><span><i style="background:#cbd5e1;height:3px"></i>float (could start earlier)</span><span style="color:var(--accent)">│ start</span><span style="color:var(--danger)">│ due</span></div>' +
      '</div>';

    html += '<div class="grid-2"><div class="panel"><div class="panel-head"><h3>Precedence network</h3><span class="muted small">arrows = must finish before</span></div><div class="net-wrap" id="net"></div></div>' +
      '<div class="panel"><div class="panel-head"><h3>Worker load per day</h3><span class="muted small">' + (mode === 'jit' ? 'JIT' : 'ASAP') + ' schedule · peak concurrent workers' + (maxW ? ' · limit ' + maxW : '') + '</span></div><div id="load"></div></div></div>';

    // schedule table
    const order = res.list.slice().sort((a, b) => (mode === 'jit' ? a.LS - b.LS : a.ES - b.ES) || U.num(a.step.nr) - U.num(b.step.nr));
    html += '<div class="panel"><div class="panel-head"><h3>Step schedule</h3><span class="muted small">' + (mode === 'jit' ? 'latest start / finish (backward from due date)' : 'earliest start / finish (forward from start)') + '</span></div><div class="tbl-wrap"><table class="tbl" id="sched"><thead><tr><th>Step</th><th>Type</th><th>Output</th><th class="num">Units</th><th class="num">Workers</th><th class="num">Work</th><th class="num">Cure</th><th>Start</th><th>Work end</th><th>Finish</th><th class="num">Float</th><th>After</th></tr></thead><tbody>' +
      order.map(x => {
        const s = x.step, o = pb[s.outputPartId];
        const S = mode === 'jit' ? x.LS : x.ES, WE = mode === 'jit' ? x.LworkEnd : x.EworkEnd, F = mode === 'jit' ? x.LF : x.EF;
        return '<tr class="' + (x.critical ? 'critical' : '') + (PlanUI.selectedStepId === s.id ? ' selected' : '') + '" data-id="' + s.id + '"><td><b>' + UI.esc(s.nr) + '</b> ' + UI.esc(s.name) + '</td><td>' + UI.typeBadge(s.type) + '</td><td class="mono">' + (o ? UI.esc(o.itemNr) : '') + '</td><td class="num">' + U.round(x.units, 2) + '</td><td class="num">' + x.workers + '</td><td class="num nowrap">' + U.minutesToText(x.workMinutes) + '</td><td class="num nowrap">' + (x.cureHours ? U.hoursToText(x.cureHours) : '–') + '</td><td class="nowrap">' + U.niceDateTime(S) + '</td><td class="nowrap">' + U.niceDateTime(WE) + '</td><td class="nowrap">' + U.niceDateTime(F) + '</td><td class="num nowrap">' + (x.critical ? '<span class="badge err">critical</span>' : U.hoursToText(x.floatMinutes / 60)) + '</td><td class="small muted">' + x.preds.map(id => res.rows[id].step.nr).join(', ') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    // materials
    html += '<div class="panel"><div class="panel-head"><h3>Materials to purchase</h3><span class="muted small">demand exploded through all steps · need date = start of first consuming step · order-by = need date − lead time</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item nr</th><th>Name</th><th class="num">Qty</th><th class="num">Lead time</th><th>Needed (JIT)</th><th>Order by (JIT)</th><th>Needed (ASAP)</th><th>Order by (ASAP)</th></tr></thead><tbody>' +
      (res.purchases.length ? res.purchases.map(x => '<tr><td class="mono">' + UI.esc(x.part.itemNr) + '</td><td>' + UI.esc(x.part.name) + '</td><td class="num">' + U.round(x.qty, 3) + ' ' + UI.esc(x.part.unit || 'pcs') + '</td><td class="num">' + x.leadTimeDays + ' d</td><td class="nowrap">' + (x.needJIT ? U.niceDate(x.needJIT) : '') + '</td><td class="nowrap">' + (x.orderByJIT ? (x.orderLate ? '<span class="badge err">' + U.niceDate(x.orderByJIT) + '</span>' : U.niceDate(x.orderByJIT)) : '') + '</td><td class="nowrap">' + (x.needASAP ? U.niceDate(x.needASAP) : '') + '</td><td class="nowrap">' + (x.orderByASAP ? U.niceDate(x.orderByASAP) : '') + '</td></tr>').join('') : '<tr><td colspan="8" class="muted center">No purchased parts in this recipe.</td></tr>') +
      '</tbody></table></div></div>';

    out.innerHTML = html;
    out.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { st.ui.ganttMode = b.dataset.mode; Store.save(); PlanUI.renderResult(res); }));
    out.querySelector('#g-crit').addEventListener('change', e => { PlanUI.showCriticalOnly = e.target.checked; PlanUI.drawGantt(res, mode); });
    out.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => {
      const z = b.dataset.zoom;
      if (z === 'fit') st.ui.zoom = 1;
      else if (z === 'days' || z === 'hours') { const fitPx = PlanUI.lastFitPxPerDay || 40; st.ui.zoom = U.clamp((z === 'days' ? 90 : 320) / fitPx, 0.25, 60); }
      else st.ui.zoom = U.clamp((st.ui.zoom || 1) * (z === 'in' ? 1.5 : 1 / 1.5), 0.25, 60);
      Store.save(); PlanUI.drawGantt(res, mode);
      if (z !== 'fit') { const g = document.querySelector('#gantt .gantt-scroll'); const first = g && g.querySelector('g.bar rect'); if (first) g.scrollLeft = Math.max(0, +first.getAttribute('x') - 60); }
    }));
    out.querySelectorAll('#sched tbody tr').forEach(tr => tr.addEventListener('click', () => { PlanUI.select(tr.dataset.id, res, mode); }));
    PlanUI.drawGantt(res, mode);
    PlanUI.drawNetwork(res, mode);
    PlanUI.drawLoad(load, maxW);
  };

  PlanUI.select = function (id, res, mode) {
    PlanUI.selectedStepId = PlanUI.selectedStepId === id ? null : id;
    document.querySelectorAll('#sched tbody tr').forEach(tr => tr.classList.toggle('selected', tr.dataset.id === PlanUI.selectedStepId));
    PlanUI.drawGantt(res, mode); PlanUI.drawNetwork(res, mode);
  };

  /* ---------- Gantt ---------- */
  PlanUI.tipHtml = function (x, res, mode, pb) {
    const s = x.step, o = pb[s.outputPartId];
    const S = mode === 'jit' ? x.LS : x.ES, WE = mode === 'jit' ? x.LworkEnd : x.EworkEnd, F = mode === 'jit' ? x.LF : x.EF;
    return '<b>' + UI.esc(s.nr + ' ' + s.name) + '</b>' + (x.critical ? ' <span style="color:#fca5a5">critical</span>' : '') + '<br>' + Scheduler.typeInfo(s.type).label + (o ? ' → ' + UI.esc(o.itemNr) + ' ' + UI.esc(o.name) : '') +
      '<br>' + U.round(x.units, 2) + ' units · ' + x.workers + ' worker(s) · ' + U.round(x.laborHours, 1) + ' labor h' +
      '<br>Work: ' + U.niceDateTime(S) + ' → ' + U.niceDateTime(WE) + ' (' + U.minutesToText(x.workMinutes) + ')' +
      (x.cureHours ? '<br>Cure/wait: ' + U.hoursToText(x.cureHours) + ' → ' + U.niceDateTime(F) : '') +
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
      // work: full extent faint, working windows solid
      if (WE > S) {
        bars += '<rect x="' + X(S) + '" y="' + (by + 2) + '" width="' + Math.max(1, X(WE) - X(S)) + '" height="' + (bh - 4) + '" fill="' + col + '" opacity="0.25" rx="2"/>';
        Scheduler.workSegments(cal, S, WE).forEach(seg => { bars += '<rect x="' + X(seg.a) + '" y="' + by + '" width="' + Math.max(1.5, X(seg.b) - X(seg.a)) + '" height="' + bh + '" fill="' + col + '" rx="2"/>'; });
      } else bars += '<rect x="' + (X(S) - 1) + '" y="' + by + '" width="2" height="' + bh + '" fill="' + col + '"/>';
      if (F > WE) bars += '<rect x="' + X(WE) + '" y="' + (by + 2) + '" width="' + Math.max(1, X(F) - X(WE)) + '" height="' + (bh - 4) + '" fill="url(#cureHatch)" stroke="#c46a1c" stroke-width="0.5" rx="2"/>';
      if (x.critical) bars += '<rect x="' + (X(S) - 1.5) + '" y="' + (by - 1.5) + '" width="' + Math.max(3, X(F) - X(S) + 3) + '" height="' + (bh + 3) + '" fill="none" stroke="var(--critical)" stroke-width="1.5" rx="3"/>';
      // label inside/after bar
      const lx = X(F) + 5;
      if (lx < W - 40) bars += '<text x="' + lx + '" y="' + (y + rowH / 2 + 4) + '" fill="#64748b" font-size="10">' + U.minutesToText(x.workMinutes) + (x.cureHours ? ' +' + U.hoursToText(x.cureHours) : '') + '</text>';
      svg += g + bars + '<rect x="' + X(S) + '" y="' + y + '" width="' + Math.max(6, X(F) - X(S)) + '" height="' + rowH + '" fill="transparent"/></g>';
    });
    // today / due lines
    const lineX = (t, colr, label, anchorRight) => '<line x1="' + X(t) + '" y1="20" x2="' + X(t) + '" y2="' + H + '" stroke="' + colr + '" stroke-width="1.5" stroke-dasharray="4 3"/><text x="' + (X(t) + (anchorRight ? -4 : 4)) + '" y="' + (H - 2) + '" fill="' + colr + '" font-size="10" font-weight="600" text-anchor="' + (anchorRight ? 'end' : 'start') + '">' + label + '</text>';
    svg += lineX(res.planStart, 'var(--accent)', 'start ' + U.hhmm(res.planStart));
    svg += lineX(res.due, 'var(--danger)', 'due ' + U.niceDateTime(res.due), true);
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
      lab += '<text x="16" y="' + (y + 24) + '" fill="#64748b" font-size="9.5">' + U.round(x.units, 1) + ' pcs · ' + x.workers + ' w · ' + U.niceDateTime(start(x)) + '</text></g>';
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
        '<text x="' + (P.x + 12) + '" y="' + (P.y + 31) + '" fill="#64748b" font-size="10">' + U.minutesToText(x.workMinutes) + (x.cureHours ? ' + ' + U.hoursToText(x.cureHours) + ' cure' : '') + ' · ' + x.workers + ' w</text>' +
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
