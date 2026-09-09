/* Recipe (assembly process) builder. */
(function (root) {
  'use strict';
  const U = root.U, UI = root.UI, Store = root.Store, Scheduler = root.Scheduler;
  const RecipesUI = { selectedStepId: null };

  function currentRecipe() {
    const st = Store.state;
    let r = st.recipes.find(x => x.id === st.ui.recipeId);
    if (!r && st.recipes.length) { r = st.recipes[0]; st.ui.recipeId = r.id; }
    return r;
  }

  RecipesUI.render = function () {
    const host = document.getElementById('tab-recipes');
    host.innerHTML = '';
    const st = Store.state;
    const r = currentRecipe();

    const top = UI.el('<div class="panel"><div class="panel-head">' +
      '<h2>Assembly recipes</h2>' +
      '<select id="r-sel" style="min-width:260px">' + (st.recipes.length ? st.recipes.map(x => '<option value="' + x.id + '"' + (r && x.id === r.id ? ' selected' : '') + '>' + UI.esc(x.name || '(unnamed)') + ' · ' + x.steps.length + ' steps</option>').join('') : '<option value="">No recipes yet</option>') + '</select>' +
      '<button class="btn btn-primary" id="r-new">+ New recipe</button>' +
      (r ? '<button class="btn" id="r-dup">Duplicate</button><button class="btn btn-danger" id="r-del">Delete</button>' : '') +
      '<span class="spacer"></span>' +
      '<button class="btn" id="r-import">Import steps CSV…</button>' +
      (r ? '<button class="btn" id="r-plan">Plan with this recipe →</button>' : '') +
      '</div></div>');
    host.appendChild(top);
    top.querySelector('#r-sel').addEventListener('change', e => { st.ui.recipeId = e.target.value; Store.save(); RecipesUI.render(); });
    top.querySelector('#r-new').addEventListener('click', () => {
      const nr = Store.addRecipe({ name: 'New recipe ' + (st.recipes.length + 1) });
      nr.steps.push(Store.newStep({ nr: 10, name: 'Step 10' }));
      st.ui.recipeId = nr.id; Store.save(); RecipesUI.render();
      setTimeout(() => { const i = document.getElementById('r-name'); if (i) { i.focus(); i.select(); } }, 50);
    });
    top.querySelector('#r-import').addEventListener('click', () => { root.App.showTab('data'); root.DataUI.preselect('steps'); });
    if (!r) {
      host.appendChild(UI.el('<div class="panel"><p class="muted">Create a recipe to start building the assembly process, or import steps from CSV.</p></div>'));
      return;
    }
    top.querySelector('#r-dup').addEventListener('click', () => {
      const copy = U.deepClone(r); copy.id = U.uid('r'); copy.name = r.name + ' (copy)';
      const idMap = {}; copy.steps.forEach(s => { const n = U.uid('s'); idMap[s.id] = n; s.id = n; });
      copy.steps.forEach(s => { s.extraPreds = (s.extraPreds || []).map(id => idMap[id]).filter(Boolean); });
      st.recipes.push(copy); st.ui.recipeId = copy.id; Store.save(); RecipesUI.render();
    });
    top.querySelector('#r-del').addEventListener('click', async () => {
      if (await UI.confirm('Delete recipe "' + r.name + '" with ' + r.steps.length + ' steps?', 'Delete recipe')) {
        st.recipes = st.recipes.filter(x => x.id !== r.id);
        st.plans.forEach(p => { if (p.recipeId === r.id) p.recipeId = null; });
        st.ui.recipeId = st.recipes.length ? st.recipes[0].id : null; Store.save(); RecipesUI.render();
      }
    });
    top.querySelector('#r-plan').addEventListener('click', () => { root.PlanUI.planWithRecipe(r.id); });

    // header
    const head = UI.el('<div class="panel"><div class="form-row">' +
      '<label class="f"><span>Recipe name</span><input type="text" id="r-name" class="w-l" value="' + UI.esc(r.name) + '"></label>' +
      '<label class="f"><span>Final product (output of the last step)</span><span id="r-final"></span></label>' +
      '<label class="f grow"><span>Notes</span><input type="text" id="r-notes" style="width:100%" value="' + UI.esc(r.notes || '')+ '"></label>' +
      '</div><div id="r-validation"></div></div>');
    host.appendChild(head);
    UI.bind(head.querySelector('#r-name'), r, 'name', 'text', () => { const o = top.querySelector('#r-sel option:checked'); if (o) o.textContent = r.name + ' · ' + r.steps.length + ' steps'; });
    UI.bind(head.querySelector('#r-notes'), r, 'notes');
    const fp = UI.partPicker({ value: r.finalPartId, filter: p => p.type === 'manufactured' || !r.finalPartId, onPick: p => { r.finalPartId = p.id; if (p.type !== 'manufactured') { p.type = 'manufactured'; } Store.save(); RecipesUI.refresh(); } });
    head.querySelector('#r-final').appendChild(fp);

    // steps
    const body = UI.el('<div class="grid-2" style="grid-template-columns: 1.6fr 1fr"><div><div class="panel"><div class="panel-head"><h3>Steps</h3><span class="muted small">Drag ⋮⋮ to reorder. Dependencies are derived automatically from parts: a step that uses the output of another step comes after it.</span><span class="spacer"></span><button class="btn btn-sm" id="s-defaults" title="Fill empty worker pool / equipment fields from the step-type defaults (Resources tab)">Apply resource defaults</button><button class="btn btn-sm" id="s-renum">Renumber</button><button class="btn btn-primary btn-sm" id="s-add">+ Add step</button></div><div class="step-list" id="steps"></div><div class="flex mt"><button class="btn" id="s-add2">+ Add step</button></div></div></div>' +
      '<div><div class="panel" id="r-side"></div></div></div>');
    host.appendChild(body);
    const list = body.querySelector('#steps');
    r.steps.forEach(s => list.appendChild(RecipesUI.stepCard(r, s)));
    const addStep = () => {
      const s = Store.newStep({ nr: Store.nextStepNr(r), name: '' });
      // sensible default: consume previous step's output
      const prev = r.steps[r.steps.length - 1];
      if (prev && prev.outputPartId) s.components.push({ partId: prev.outputPartId, qty: 1 });
      Store.applyDefaults(s, false);
      r.steps.push(s); Store.save();
      const card = RecipesUI.stepCard(r, s); list.appendChild(card);
      RecipesUI.refresh();
      const n = card.querySelector('input.name'); n.focus();
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    body.querySelector('#s-add').addEventListener('click', addStep);
    body.querySelector('#s-add2').addEventListener('click', addStep);
    body.querySelector('#s-renum').addEventListener('click', () => { Store.renumberSteps(r); Store.save(); RecipesUI.render(); });
    body.querySelector('#s-defaults').addEventListener('click', () => { const n = Store.applyDefaultsToAll(false, r.id); Store.save(); UI.toast(n ? n + ' step(s) assigned from defaults' : 'All steps already have assignments (or no defaults set on the Resources tab)', n ? 'ok' : ''); RecipesUI.render(); });
    RecipesUI.enableDrag(list, r);
    RecipesUI.refresh();
  };

  /* Build one step card. */
  RecipesUI.stepCard = function (r, s) {
    const pb = Store.partsById();
    const t = Scheduler.typeInfo(s.type);
    const card = UI.el('<div class="step-card" draggable="true" data-id="' + s.id + '" style="border-left-color:' + t.color + '">' +
      '<div class="head">' +
      '<span class="drag-handle" title="Drag to reorder">⋮⋮</span>' +
      '<input type="number" class="w-s nr" value="' + UI.esc(s.nr) + '" title="Step nr">' +
      '<input type="text" class="name" placeholder="Step name, e.g. Bond piston to rod" value="' + UI.esc(s.name) + '">' +
      UI.typeSelect(s.type, 'type') +
      '<span class="btn-group"><button class="btn btn-icon" data-act="up" title="Move up">↑</button><button class="btn btn-icon" data-act="down" title="Move down">↓</button><button class="btn btn-icon" data-act="dup" title="Duplicate step">⧉</button><button class="btn btn-icon btn-danger" data-act="del" title="Delete step">✕</button></span>' +
      '</div>' +
      '<div class="body">' +
      '<div>' +
      '<label class="f"><span>Produces (output part)</span><span class="out"></span></label>' +
      '<label class="f mt"><span>Uses (components, qty per output unit)</span><div class="comps"></div><span class="addcomp"></span></label>' +
      '</div>' +
      '<div>' +
      '<div class="times">' +
      '<label class="f"><span>Work time / unit (min)</span><input type="number" class="work" min="0" step="0.5" value="' + U.num(s.workMinutes) + '"></label>' +
      '<label class="f"><span>Workers</span><input type="number" class="workers w-s" min="1" step="1" value="' + Math.max(1, U.num(s.workers, 1)) + '"></label>' +
      '<label class="f"><span>from pool</span><select class="pool"><option value="">general</option>' + Store.laborPools().map(x => '<option value="' + x.id + '"' + (x.id === s.workerPoolId ? ' selected' : '') + '>' + UI.esc(x.name) + ' (' + x.capacity + ')</option>').join('') + '</select></label>' +
      '<label class="f"><span>Fixed time / lot (min)</span><input type="number" class="fixed" min="0" step="5" value="' + U.num(s.fixedMinutes) + '" title="Setup, loading or test-rig time per lot that does not scale with quantity"></label>' +
      '</div>' +
      '<div class="times mt">' +
      '<label class="f"><span>Process resource (fixtures, oven, chamber…)</span><select class="res"><option value="">none</option>' + Store.equipment().map(x => '<option value="' + x.id + '"' + (x.id === s.resourceId ? ' selected' : '') + '>' + UI.esc(x.name) + ' (' + x.capacity + ' × ' + (U.num(x.lotSize) || '∞') + ')</option>').join('') + '</select></label>' +
      '<label class="f"><span>Lot size (pcs)</span><input type="number" class="lot w-s" min="0" step="1" value="' + U.num(s.lotSize) + '" placeholder="auto" title="Pieces per lot. 0 = from resource, or whole batch if no resource."></label>' +
      '<label class="f"><span>Process / cure time per lot (h)</span><input type="number" class="cure" min="0" step="0.25" value="' + U.num(s.processHours) + '" title="Unattended time after the attended work: curing, potting, test cycle, burn-in. No workers needed."></label>' +
      '<label class="check" style="align-self:flex-end;padding-bottom:6px" title="Next step may start on the first finished lot instead of waiting for the whole batch"><input type="checkbox" class="transfer" ' + (s.transferPerLot ? 'checked' : '') + '> next step per lot</label>' +
      '<label class="f"><span>Yield %</span><input type="number" class="yield w-s" min="1" max="100" step="1" value="' + (s.yieldPct == null ? 100 : U.num(s.yieldPct, 100)) + '" title="Share of units that pass. Failed units are scrapped; the plan starts more units upstream to still deliver the required quantity."></label>' +
      '</div>' +
      '<label class="f mt"><span>Also after (extra predecessors)</span><div class="preds"></div></label>' +
      '<label class="f mt"><span>Notes / instructions</span><input type="text" class="notes" style="width:100%" value="' + UI.esc(s.notes || '') + '"></label>' +
      '</div></div>' +
      '<div class="summary"></div><div class="deps"></div></div>');

    const refresh = () => RecipesUI.refresh();
    const nrI = card.querySelector('.nr');
    nrI.addEventListener('change', () => { s.nr = U.num(nrI.value, s.nr); Store.save(); refresh(); });
    UI.bind(card.querySelector('.name'), s, 'name', 'text', refresh);
    const typeSel = card.querySelector('select.type');
    UI.bind(typeSel, s, 'type', 'text', v => {
      card.style.borderLeftColor = Scheduler.typeInfo(v).color;
      if (Store.applyDefaults(s, false)) {
        card.querySelector('.pool').value = s.workerPoolId || ''; card.querySelector('.res').value = s.resourceId || '';
        card.querySelector('.cure').value = U.num(s.processHours); card.querySelector('.transfer').checked = !!s.transferPerLot;
        Store.save();
      }
      refresh();
    });
    UI.bind(card.querySelector('.work'), s, 'workMinutes', 'num', refresh);
    UI.bind(card.querySelector('.workers'), s, 'workers', 'int', v => { if (v < 1) { s.workers = 1; card.querySelector('.workers').value = 1; Store.save(); } refresh(); });
    UI.bind(card.querySelector('.fixed'), s, 'fixedMinutes', 'num', refresh);
    UI.bind(card.querySelector('.cure'), s, 'processHours', 'num', refresh);
    UI.bind(card.querySelector('.lot'), s, 'lotSize', 'num', refresh);
    UI.bind(card.querySelector('.yield'), s, 'yieldPct', 'num', v => { if (v <= 0 || v > 100) { s.yieldPct = 100; card.querySelector('.yield').value = 100; Store.save(); } refresh(); });
    UI.bind(card.querySelector('.transfer'), s, 'transferPerLot', 'bool', refresh);
    const poolSel = card.querySelector('.pool');
    poolSel.addEventListener('change', () => { s.workerPoolId = poolSel.value || null; Store.save(); refresh(); });
    const resSel = card.querySelector('.res');
    resSel.addEventListener('change', () => {
      s.resourceId = resSel.value || null;
      const res = Store.resourcesById()[s.resourceId];
      if (res && !U.num(s.processHours) && U.num(res.processHours)) { s.processHours = res.processHours; card.querySelector('.cure').value = res.processHours; }
      if (res && !s.transferPerLot && U.num(res.lotSize) > 0) { s.transferPerLot = true; card.querySelector('.transfer').checked = true; }
      Store.save(); refresh();
    });
    UI.bind(card.querySelector('.notes'), s, 'notes');

    // output picker
    const out = UI.partPicker({ value: s.outputPartId, placeholder: 'Output part (item nr or name)…', onPick: p => {
      s.outputPartId = p.id;
      if (p.type !== 'manufactured') { p.type = 'manufactured'; }
      if (!U.num(s.workMinutes) && U.num(p.workMinutes)) { s.workMinutes = p.workMinutes; card.querySelector('.work').value = p.workMinutes; }
      if (!s.name && p.name) { s.name = p.name; card.querySelector('.name').value = p.name; }
      Store.save(); refresh();
    } });
    card.querySelector('.out').appendChild(out);
    const outClear = UI.el('<button class="btn btn-icon" title="Clear output" style="margin-left:4px">✕</button>');
    outClear.addEventListener('click', () => { s.outputPartId = null; out.setValue(null); Store.save(); refresh(); });
    card.querySelector('.out').appendChild(outClear);

    // components
    const comps = card.querySelector('.comps');
    const renderComps = () => {
      comps.innerHTML = '';
      (s.components || []).forEach((c, i) => {
        const p = pb[c.partId] || Store.partsById()[c.partId];
        const chip = UI.el('<span class="chip" title="' + UI.esc(p ? p.name : '') + '"><span class="mono">' + (p ? UI.esc(p.itemNr) : '<span class="badge err">?</span>') + '</span> <span class="muted">' + UI.esc(p ? p.name.slice(0, 28) : '') + '</span> ×<input type="number" min="0" step="any" value="' + c.qty + '"><span class="x" title="Remove">✕</span></span>');
        chip.querySelector('input').addEventListener('input', e => { c.qty = U.num(e.target.value, 1); Store.save(); refresh(); });
        chip.querySelector('.x').addEventListener('click', () => { s.components.splice(i, 1); Store.save(); renderComps(); refresh(); });
        comps.appendChild(chip);
      });
      if (!s.components.length) comps.appendChild(UI.el('<span class="muted small">No components yet.</span>'));
    };
    renderComps();
    const addPick = UI.partPicker({ placeholder: '+ add component (type item nr or name)…', clearAfterPick: true, onPick: p => {
      const ex = s.components.find(c => c.partId === p.id);
      if (ex) ex.qty += 1; else s.components.push({ partId: p.id, qty: 1 });
      Store.save(); renderComps(); refresh();
    } });
    card.querySelector('.addcomp').appendChild(addPick);

    // extra predecessors
    const preds = card.querySelector('.preds');
    const renderPreds = () => {
      preds.innerHTML = '';
      (s.extraPreds || []).forEach((pid, i) => {
        const ps = r.steps.find(x => x.id === pid);
        if (!ps) return;
        const chip = UI.el('<span class="chip">' + UI.esc(ps.nr + ' ' + ps.name) + '<span class="x">✕</span></span>');
        chip.querySelector('.x').addEventListener('click', () => { s.extraPreds.splice(i, 1); Store.save(); renderPreds(); refresh(); });
        preds.appendChild(chip);
      });
      const sel = UI.el('<select><option value="">+ add step that must finish first…</option>' + r.steps.filter(x => x.id !== s.id && (s.extraPreds || []).indexOf(x.id) < 0).map(x => '<option value="' + x.id + '">' + UI.esc(x.nr + ' ' + (x.name || '(unnamed)')) + '</option>').join('') + '</select>');
      sel.addEventListener('change', () => { if (sel.value) { s.extraPreds = s.extraPreds || []; s.extraPreds.push(sel.value); Store.save(); renderPreds(); refresh(); } });
      preds.appendChild(sel);
    };
    renderPreds();

    // actions
    card.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
      const idx = r.steps.indexOf(s);
      const act = b.dataset.act;
      if (act === 'del') {
        if (!(await UI.confirm('Delete step ' + s.nr + ' "' + s.name + '"?', 'Delete step'))) return;
        r.steps.splice(idx, 1);
        r.steps.forEach(x => { x.extraPreds = (x.extraPreds || []).filter(id => id !== s.id); });
        Store.save(); RecipesUI.render(); return;
      }
      if (act === 'dup') {
        const copy = U.deepClone(s); copy.id = U.uid('s'); copy.nr = Store.nextStepNr(r); copy.name = s.name + ' (copy)';
        r.steps.splice(idx + 1, 0, copy); Store.save(); RecipesUI.render(); return;
      }
      if (act === 'up' && idx > 0) { r.steps.splice(idx, 1); r.steps.splice(idx - 1, 0, s); }
      if (act === 'down' && idx < r.steps.length - 1) { r.steps.splice(idx, 1); r.steps.splice(idx + 1, 0, s); }
      Store.save(); RecipesUI.render();
    }));
    card.addEventListener('focusin', () => { document.querySelectorAll('.step-card.selected').forEach(c => c.classList.remove('selected')); card.classList.add('selected'); RecipesUI.selectedStepId = s.id; });
    return card;
  };

  /* Drag & drop reordering. */
  RecipesUI.enableDrag = function (list, r) {
    let dragId = null;
    list.addEventListener('dragstart', e => {
      const card = e.target.closest('.step-card'); if (!card) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { e.preventDefault(); return; }
      dragId = card.dataset.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* ignore */ }
    });
    list.addEventListener('dragend', () => { list.querySelectorAll('.dragging, .drop-before, .drop-after').forEach(c => c.classList.remove('dragging', 'drop-before', 'drop-after')); dragId = null; });
    list.addEventListener('dragover', e => {
      const card = e.target.closest('.step-card'); if (!card || !dragId || card.dataset.id === dragId) return;
      e.preventDefault();
      const rect = card.getBoundingClientRect(); const before = e.clientY < rect.top + rect.height / 2;
      list.querySelectorAll('.drop-before, .drop-after').forEach(c => c.classList.remove('drop-before', 'drop-after'));
      card.classList.add(before ? 'drop-before' : 'drop-after');
    });
    list.addEventListener('drop', e => {
      const card = e.target.closest('.step-card'); if (!card || !dragId) return;
      e.preventDefault();
      const rect = card.getBoundingClientRect(); const before = e.clientY < rect.top + rect.height / 2;
      const from = r.steps.findIndex(s => s.id === dragId); const moving = r.steps[from];
      r.steps.splice(from, 1);
      let to = r.steps.findIndex(s => s.id === card.dataset.id); if (!before) to++;
      r.steps.splice(to, 0, moving);
      Store.save(); RecipesUI.render();
    });
    // make inputs not start drags
    list.querySelectorAll('input, select').forEach(i => i.setAttribute('draggable', 'false'));
  };

  /* Recompute derived info (dependencies, durations, validation, side panel) without rebuilding inputs. */
  RecipesUI.refresh = function () {
    const r = currentRecipe(); if (!r) return;
    const pb = Store.partsById(), rb = Store.resourcesById();
    const g = Scheduler.buildGraph(r, pb);
    const ex = Scheduler.explode(r, pb, 1, g);
    const opt = document.querySelector('#r-sel option:checked'); if (opt) opt.textContent = (r.name || '(unnamed)') + ' · ' + r.steps.length + ' steps';

    r.steps.forEach(s => {
      const card = document.querySelector('.step-card[data-id="' + s.id + '"]'); if (!card) return;
      const units = ex.units[s.id] || 1;
      const res = rb[s.resourceId];
      const wm = Scheduler.stepWorkMinutes(s, units, res);
      const lt = Scheduler.lotting(s, res);
      const preds = Array.from(g.preds[s.id] || []).map(id => g.byId[id]).sort((a, b) => U.num(a.nr) - U.num(b.nr));
      const succs = Array.from(g.succs[s.id] || []).map(id => g.byId[id]).sort((a, b) => U.num(a.nr) - U.num(b.nr));
      let lotTxt = '';
      if (res) lotTxt = ' · on <b>' + UI.esc(res.name) + '</b>: ' + res.capacity + ' × ' + (lt.lotSize || 'whole batch') + ' pcs at a time (' + (res.calendar === 'shop' ? 'shop hours' : '24/7') + ')';
      else if (lt.lotSize) lotTxt = ' · lots of ' + lt.lotSize + ' pcs';
      const per10 = (() => { if (!res || !lt.lotSize) return ''; const lots = Math.ceil(10 / lt.lotSize), waves = Math.ceil(lots / res.capacity); return ' · 10 pcs = ' + lots + ' lot' + (lots > 1 ? 's' : '') + ' in ' + waves + ' wave' + (waves > 1 ? 's' : ''); })();
      const yTxt = Scheduler.yieldOf(s) < 1 ? ' · <b style="color:var(--danger)">yield ' + Math.round(Scheduler.yieldOf(s) * 100) + '%</b> → start ' + units + ' to get ' + (ex.good[s.id] || 1) : '';
      card.querySelector('.summary').innerHTML = 'Per product: <b>' + U.minutesToText(wm) + '</b> attended work' + (U.num(s.workers, 1) > 1 ? ' with ' + s.workers + ' workers' : '') + ' (' + U.round(Scheduler.stepLaborHours(s, units, res), 2) + ' labor h)' + (U.num(s.processHours) ? ' + <b style="color:var(--cure)">' + U.hoursToText(U.num(s.processHours)) + ' process per lot</b>' : '') + (units !== 1 && Scheduler.yieldOf(s) >= 1 ? ' · ' + units + ' units per product' : '') + yTxt + lotTxt + per10;
      card.querySelector('.deps').innerHTML = (preds.length ? 'After: <b>' + preds.map(p => UI.esc(p.nr + ' ' + p.name)).join(', ') + '</b>' : '<span class="badge">start step</span>') + (succs.length ? ' &nbsp;→ Before: <b>' + succs.map(p => UI.esc(p.nr + ' ' + p.name)).join(', ') + '</b>' : (s.outputPartId === r.finalPartId ? ' &nbsp;<span class="badge ok">final step</span>' : ''));
    });

    // validation
    const warnings = g.warnings.concat(ex.warnings);
    if (!r.finalPartId) warnings.unshift({ level: 'error', text: 'Select the final product part.' });
    else if (!r.steps.some(s => s.outputPartId === r.finalPartId)) warnings.unshift({ level: 'error', text: 'No step produces the final product.' });
    r.steps.forEach(s => { if (!s.name) warnings.push({ level: 'warn', text: 'Step ' + s.nr + ' has no name.' }); });
    const v = document.getElementById('r-validation');
    if (v) v.innerHTML = warnings.length ? '<div class="alert ' + (warnings.some(w => w.level === 'error') ? 'err' : 'warn') + '"><ul>' + warnings.map(w => '<li>' + UI.esc(w.text) + '</li>').join('') + '</ul></div>' : '<div class="alert ok">Recipe is consistent: ' + r.steps.length + ' steps, ' + Object.keys(g.producers).length + ' produced parts, ' + ex.purchases.length + ' purchased parts.</div>';

    // side panel: lead time for one unit + structure
    const side = document.getElementById('r-side');
    if (!side) return;
    let html = '<div class="panel-head"><h3>Recipe summary</h3></div>';
    if (r.finalPartId && !g.cycle) {
      const cal = Store.calendar();
      const due = cal.shiftEndOn(new Date(2030, 0, 4)); // any Friday far away
      const res = Scheduler.schedule({ recipe: r, partsById: pb, resourcesById: rb, calendarsById: Store.calendarsById(), qty: 1, due, planStart: new Date(2020, 0, 6, 7, 0), calendar: cal });
      html += '<div class="kpis" style="grid-template-columns:1fr 1fr">' +
        '<div class="kpi"><div class="k">Lead time, 1 pc</div><div class="v">' + U.hoursToText(res.totals.leadCalendarHoursJIT) + '</div><div class="s">calendar, JIT from due date</div></div>' +
        '<div class="kpi"><div class="k">Labor, 1 pc</div><div class="v">' + U.round(res.totals.laborHours, 1) + ' h</div><div class="s">' + U.round(res.totals.cureHours, 1) + ' h cure/wait total</div></div></div>';
      html += '<h3 class="mt">Critical path (1 pc)</h3><ol style="margin:4px 0 0 18px;padding:0;font-size:13px">' + res.list.filter(x => x.critical).map(x => '<li>' + UI.esc(x.step.nr + ' ' + x.step.name) + ' <span class="muted">' + U.minutesToText(x.workMinutes) + (x.processHours ? ' + ' + U.hoursToText(x.processHours) + ' process' : '') + '</span></li>').join('') + '</ol>';
    }
    html += '<h3 class="mt">Product structure</h3>' + RecipesUI.structureHtml(r, g, pb);
    side.innerHTML = html;
  };

  RecipesUI.structureHtml = function (r, g, pb) {
    if (!r.finalPartId) return '<p class="muted small">Select a final product first.</p>';
    const producersOf = pid => (g.producers[pid] || []).map(id => g.byId[id]);
    const seen = new Set();
    const node = (pid, qty, depth) => {
      const p = pb[pid];
      const prods = producersOf(pid).filter(s => !(s.components || []).some(c => c.partId === pid)); // real producers
      const passes = producersOf(pid).filter(s => (s.components || []).some(c => c.partId === pid));
      let html = '<li><span class="mono">' + (p ? UI.esc(p.itemNr) : '?') + '</span> ' + UI.esc(p ? p.name : 'missing') + (qty !== 1 ? ' <span class="badge">×' + qty + '</span>' : '') +
        (prods.length ? ' <span class="muted small">← step ' + prods.map(s => s.nr).join(', ') + (passes.length ? ' then ' + passes.map(s => s.nr).join(', ') : '') + '</span>' : ' <span class="badge purchased">buy</span>' + (p && U.num(p.leadTimeDays) ? ' <span class="muted small">' + p.leadTimeDays + ' d</span>' : '')) + '</li>';
      if (prods.length && depth < 12 && !seen.has(pid)) {
        seen.add(pid);
        const comps = [];
        prods.concat(passes).forEach(s => (s.components || []).forEach(c => { if (c.partId !== pid && !comps.some(x => x.partId === c.partId)) comps.push(c); }));
        if (comps.length) html += '<ul>' + comps.map(c => node(c.partId, c.qty, depth + 1)).join('') + '</ul>';
        seen.delete(pid);
      }
      return html;
    };
    return '<ul class="small" style="margin:4px 0 0 16px;padding:0;line-height:1.6">' + node(r.finalPartId, 1, 0) + '</ul>';
  };

  root.RecipesUI = RecipesUI;
})(window);
