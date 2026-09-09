/* Resources admin tab: equipment (fixtures, ovens, test chambers) and worker pools. */
(function (root) {
  'use strict';
  const U = root.U, UI = root.UI, Store = root.Store;
  const ResourcesUI = {};

  ResourcesUI.render = function () {
    const host = document.getElementById('tab-resources');
    host.innerHTML = '';
    const list = Store.state.resources || [];
    const panel = UI.el('<div class="panel">' +
      '<div class="panel-head"><h2>Resources</h2><span class="badge">' + list.length + '</span><span class="spacer"></span>' +
      '<button class="btn" id="res-import">Import CSV…</button>' +
      '<button class="btn" id="res-std" title="Create Assembly workers, Test workers, Test chambers and Curing chambers (if missing) and fill the step-type defaults">✨ Add standard groups</button>' +
      '<button class="btn" id="res-add-labor">+ Worker pool</button><button class="btn btn-primary" id="res-add">+ Equipment</button></div>' +
      '<p class="muted small"><b>Equipment</b> limits how many pieces can be in a process at once: capacity × lot size. Fixtures: capacity 6, lot 1. Oven or test chamber: capacity 1, lot 20. ' +
      'A step assigned to the equipment is scheduled lot by lot, each lot occupying one unit for the attended work plus the process time. Equipment on the <b>24/7</b> calendar keeps running over nights and weekends (curing, burn-in); shop equipment only runs during the shifts of its calendar. ' +
      '<b>Worker pools</b> limit how many people can work at the same time and follow their own shift calendar (define calendars under Calendar &amp; settings); steps draw their workers from a pool.</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Type</th><th class="num">Capacity</th><th class="num">Lot size</th><th class="num">Default process time (h)</th><th>Calendar / shifts</th><th>Notes</th><th>Used in</th><th></th></tr></thead><tbody id="res-body"></tbody></table></div></div>');
    host.appendChild(panel);
    const tbody = panel.querySelector('#res-body');
    const usage = {};
    Store.state.recipes.forEach(r => r.steps.forEach(s => { if (s.resourceId) usage[s.resourceId] = (usage[s.resourceId] || 0) + 1; if (s.workerPoolId) usage[s.workerPoolId] = (usage[s.workerPoolId] || 0) + 1; }));

    list.slice().sort((a, b) => (a.type === b.type ? 0 : a.type === 'labor' ? 1 : -1) || String(a.name).localeCompare(String(b.name))).forEach(r => {
      const labor = r.type === 'labor';
      const tr = UI.el('<tr>' +
        '<td><input type="text" style="width:100%;min-width:200px" value="' + UI.esc(r.name) + '"></td>' +
        '<td><select><option value="equipment"' + (!labor ? ' selected' : '') + '>Equipment</option><option value="labor"' + (labor ? ' selected' : '') + '>Worker pool</option></select></td>' +
        '<td class="num"><input type="number" min="1" step="1" value="' + Math.max(1, U.num(r.capacity, 1)) + '" title="' + (labor ? 'Persons available' : 'Number of units (fixtures, chambers…)') + '"></td>' +
        '<td class="num"><input type="number" min="0" step="1" value="' + U.num(r.lotSize, 1) + '" ' + (labor ? 'disabled' : '') + ' title="Pieces per unit per run (0 = whole batch)"></td>' +
        '<td class="num"><input type="number" min="0" step="0.25" value="' + U.num(r.processHours, 0) + '" ' + (labor ? 'disabled' : '') + ' title="Suggested process time when the resource is chosen on a step"></td>' +
        '<td><select>' + (labor ? '' : '<option value="24_7"' + (r.calendar !== 'shop' ? ' selected' : '') + '>24/7</option>') + '<option value="shop"' + ((labor || r.calendar === 'shop') && !r.calendarId ? ' selected' : '') + '>Shop calendar</option>' + (Store.state.calendars || []).map(c => '<option value="cal:' + c.id + '"' + ((labor || r.calendar === 'shop') && r.calendarId === c.id ? ' selected' : '') + '>' + UI.esc(c.name) + '</option>').join('') + '</select></td>' +
        '<td><input type="text" style="width:100%;min-width:160px" value="' + UI.esc(r.notes || '') + '"></td>' +
        '<td class="center"><span class="badge">' + (usage[r.id] || 0) + '</span></td>' +
        '<td class="nowrap"><button class="btn btn-icon btn-danger" title="Delete resource">✕</button></td></tr>');
      const f = tr.querySelectorAll('input, select');
      UI.bind(f[0], r, 'name');
      UI.bind(f[1], r, 'type', 'text', () => ResourcesUI.render());
      UI.bind(f[2], r, 'capacity', 'int', v => { if (v < 1) { r.capacity = 1; f[2].value = 1; Store.save(); } });
      UI.bind(f[3], r, 'lotSize', 'num');
      UI.bind(f[4], r, 'processHours', 'num');
      f[5].addEventListener('change', () => {
        const v = f[5].value;
        if (v === '24_7') { r.calendar = '24_7'; r.calendarId = null; }
        else { r.calendar = 'shop'; r.calendarId = v.startsWith('cal:') ? v.slice(4) : null; }
        Store.save();
      });
      UI.bind(f[6], r, 'notes');
      tr.querySelector('button').addEventListener('click', async () => {
        const uses = Store.resourceUsage(r.id);
        if (await UI.confirm((uses.length ? 'Resource "' + r.name + '" is used by ' + uses.length + ' step(s); they will be scheduled without a capacity limit. ' : '') + 'Delete resource "' + r.name + '"?', 'Delete')) { Store.deleteResource(r.id); Store.save(); ResourcesUI.render(); }
      });
      tbody.appendChild(tr);
    });
    if (!list.length) tbody.appendChild(UI.el('<tr><td colspan="9" class="muted center">No resources yet. Click <b>Add standard groups</b> for assembly workers, test workers, test chambers and curing chambers, or add your own equipment and worker pools.</td></tr>'));

    // defaults by step type
    const d = Store.state.settings.defaultsByType || (Store.state.settings.defaultsByType = {});
    const pools = Store.laborPools(), equip = Store.equipment();
    const def = UI.el('<div class="panel"><div class="panel-head"><h3>Defaults by step type</h3><span class="muted small">new and imported steps get these automatically; existing steps via the buttons</span><span class="spacer"></span>' +
      (!pools.length && !equip.length ? '<span class="badge warn">no resources to choose from yet — use "Add standard groups" above</span>' : '') +
      '<button class="btn btn-sm" id="def-fill">Fill empty assignments in all recipes</button><button class="btn btn-sm btn-danger" id="def-all">Overwrite all steps</button></div>' +
      '<table class="tbl"><thead><tr><th>Step type</th><th>Worker pool</th><th>Process equipment</th></tr></thead><tbody>' +
      root.Scheduler.STEP_TYPES.map(t => '<tr data-type="' + t.id + '"><td>' + UI.typeBadge(t.id) + '</td>' +
        '<td><select class="dp"><option value="">— none —</option>' + pools.map(x => '<option value="' + x.id + '"' + ((d[t.id] || {}).poolId === x.id ? ' selected' : '') + '>' + UI.esc(x.name) + '</option>').join('') + '</select></td>' +
        '<td><select class="dr"><option value="">— none —</option>' + equip.map(x => '<option value="' + x.id + '"' + ((d[t.id] || {}).resourceId === x.id ? ' selected' : '') + '>' + UI.esc(x.name) + '</option>').join('') + '</select></td></tr>').join('') +
      '</tbody></table></div>');
    def.querySelectorAll('tr[data-type]').forEach(tr => {
      const t = tr.dataset.type;
      tr.querySelector('.dp').addEventListener('change', e => { d[t] = d[t] || {}; d[t].poolId = e.target.value || null; Store.save(); });
      tr.querySelector('.dr').addEventListener('change', e => { d[t] = d[t] || {}; d[t].resourceId = e.target.value || null; Store.save(); });
    });
    def.querySelector('#def-fill').addEventListener('click', () => { const n = Store.applyDefaultsToAll(false); Store.save(); UI.toast(n + ' step(s) assigned', 'ok'); ResourcesUI.render(); });
    def.querySelector('#def-all').addEventListener('click', async () => { if (await UI.confirm('Overwrite the worker pool and equipment of every step in every recipe with these defaults?', 'Overwrite')) { const n = Store.applyDefaultsToAll(true); Store.save(); UI.toast(n + ' step(s) changed', 'ok'); ResourcesUI.render(); } });
    host.appendChild(def);

    const add = (type) => {
      Store.addResource(type === 'labor' ? { name: 'New worker pool', type: 'labor', capacity: 2, lotSize: 0 } : { name: 'New equipment', type: 'equipment', capacity: 1, lotSize: 1, processHours: 1 });
      Store.save(); ResourcesUI.render();
      const rows = tbody.querySelectorAll('tr'); const target = Array.from(rows).find(tr => tr.querySelector('input') && /^New /.test(tr.querySelector('input').value));
      if (target) { const i = target.querySelector('input'); i.focus(); i.select(); }
    };
    panel.querySelector('#res-add').addEventListener('click', () => add('equipment'));
    panel.querySelector('#res-add-labor').addEventListener('click', () => add('labor'));
    panel.querySelector('#res-import').addEventListener('click', () => { root.App.showTab('data'); root.DataUI.preselect('resources'); });
    panel.querySelector('#res-std').addEventListener('click', async () => {
      const rep = Store.addStandardResources();
      const n = Store.applyDefaultsToAll(false);
      Store.save();
      UI.toast((rep.created.length ? 'Created ' + rep.created.join(', ') + '. ' : 'Standard groups already exist. ') + (n ? n + ' step(s) assigned from the defaults.' : ''), 'ok', 6000);
      ResourcesUI.render();
    });
  };

  root.ResourcesUI = ResourcesUI;
})(window);
