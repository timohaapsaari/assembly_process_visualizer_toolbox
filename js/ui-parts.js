/* Parts admin tab: searchable, inline-editable parts table. */
(function (root) {
  'use strict';
  const U = root.U, UI = root.UI, Store = root.Store;
  const PartsUI = { filter: '', sort: 'itemNr', typeFilter: '' };

  PartsUI.render = function () {
    const host = document.getElementById('tab-parts');
    host.innerHTML = '';
    const parts = Store.state.parts;
    const panel = UI.el('<div class="panel">' +
      '<div class="panel-head"><h2>Parts</h2><span class="badge">' + parts.length + '</span>' +
      '<input type="text" id="pf" class="w-l" placeholder="Filter by item nr or name…" value="' + UI.esc(PartsUI.filter) + '">' +
      '<select id="ptf"><option value="">All types</option><option value="purchased"' + (PartsUI.typeFilter === 'purchased' ? ' selected' : '') + '>Purchased</option><option value="manufactured"' + (PartsUI.typeFilter === 'manufactured' ? ' selected' : '') + '>Manufactured</option></select>' +
      '<span class="spacer"></span>' +
      '<button class="btn" id="p-import">Import CSV…</button>' +
      '<button class="btn btn-primary" id="p-add">+ New part</button></div>' +
      '<p class="muted small">Edit directly in the table. <b>Work time</b> is the default labor time per unit used when this part is chosen as a step output. <b>Lead time</b> (purchased parts) gives the order-by date in plans.</p>' +
      '<div class="tbl-wrap"><table class="tbl" id="ptbl"><thead><tr>' +
      '<th data-s="itemNr">Item nr</th><th data-s="name">Name</th><th data-s="type">Type</th><th>Unit</th><th class="num" data-s="workMinutes">Work time / unit (min)</th><th class="num" data-s="leadTimeDays">Lead time (days)</th><th>Notes</th><th>Used in</th><th></th>' +
      '</tr></thead><tbody></tbody></table></div></div>');
    host.appendChild(panel);
    const tbody = panel.querySelector('tbody');

    const usageCount = {};
    Store.state.recipes.forEach(r => r.steps.forEach(s => {
      if (s.outputPartId) usageCount[s.outputPartId] = (usageCount[s.outputPartId] || 0) + 1;
      (s.components || []).forEach(c => { usageCount[c.partId] = (usageCount[c.partId] || 0) + 1; });
    }));

    const q = PartsUI.filter.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = parts.filter(p => (!PartsUI.typeFilter || p.type === PartsUI.typeFilter) && q.every(t => (p.itemNr + ' ' + p.name).toLowerCase().indexOf(t) >= 0))
      .sort((a, b) => { const k = PartsUI.sort; const va = a[k], vb = b[k]; if (typeof va === 'number') return va - vb; return String(va).localeCompare(String(vb), undefined, { numeric: true }); });

    rows.forEach(p => {
      const tr = UI.el('<tr>' +
        '<td><input type="text" class="w-m mono" value="' + UI.esc(p.itemNr) + '"></td>' +
        '<td><input type="text" style="width:100%;min-width:220px" value="' + UI.esc(p.name) + '"></td>' +
        '<td><select><option value="purchased"' + (p.type === 'purchased' ? ' selected' : '') + '>Purchased</option><option value="manufactured"' + (p.type === 'manufactured' ? ' selected' : '') + '>Manufactured</option></select></td>' +
        '<td><input type="text" class="w-s" value="' + UI.esc(p.unit || 'pcs') + '"></td>' +
        '<td class="num"><input type="number" min="0" step="0.5" value="' + U.num(p.workMinutes) + '"></td>' +
        '<td class="num"><input type="number" min="0" value="' + U.num(p.leadTimeDays) + '"></td>' +
        '<td><input type="text" style="width:100%;min-width:160px" value="' + UI.esc(p.notes || '') + '"></td>' +
        '<td class="center"><span class="badge">' + (usageCount[p.id] || 0) + '</span></td>' +
        '<td class="nowrap"><button class="btn btn-icon btn-danger" title="Delete part">✕</button></td></tr>');
      const inputs = tr.querySelectorAll('input, select');
      const nrInput = inputs[0];
      nrInput.addEventListener('change', () => {
        const v = nrInput.value.trim();
        const dup = Store.state.parts.find(x => x.id !== p.id && String(x.itemNr).toLowerCase() === v.toLowerCase());
        if (!v || dup) { UI.toast(dup ? 'Item nr ' + v + ' already exists' : 'Item nr is required', 'err'); nrInput.value = p.itemNr; return; }
        p.itemNr = v; Store.save();
      });
      UI.bind(inputs[1], p, 'name');
      UI.bind(inputs[2], p, 'type');
      UI.bind(inputs[3], p, 'unit');
      UI.bind(inputs[4], p, 'workMinutes', 'num');
      UI.bind(inputs[5], p, 'leadTimeDays', 'num');
      UI.bind(inputs[6], p, 'notes');
      tr.querySelector('button').addEventListener('click', async () => {
        const uses = Store.partUsage(p.id);
        const msg = uses.length ? 'Part ' + p.itemNr + ' is used in ' + uses.length + ' place(s) (' + uses.slice(0, 3).map(u => u.recipe.name + (u.step ? ' / step ' + u.step.nr : '')).join(', ') + (uses.length > 3 ? ', …' : '') + '). Deleting removes it from those steps. Continue?' : 'Delete part ' + p.itemNr + '?';
        if (await UI.confirm(msg, 'Delete')) { Store.deletePart(p.id); Store.save(); PartsUI.render(); }
      });
      tbody.appendChild(tr);
    });
    if (!rows.length) tbody.appendChild(UI.el('<tr><td colspan="9" class="muted center">No parts' + (parts.length ? ' match the filter' : ' yet — add one or import a CSV') + '.</td></tr>'));

    panel.querySelector('#pf').addEventListener('input', UI.debounce(e => { PartsUI.filter = e.target.value; const v = e.target.value; PartsUI.render(); const f = document.getElementById('pf'); f.focus(); f.setSelectionRange(v.length, v.length); }, 250));
    panel.querySelector('#ptf').addEventListener('change', e => { PartsUI.typeFilter = e.target.value; PartsUI.render(); });
    panel.querySelectorAll('th[data-s]').forEach(th => { th.style.cursor = 'pointer'; th.addEventListener('click', () => { PartsUI.sort = th.dataset.s; PartsUI.render(); }); });
    panel.querySelector('#p-add').addEventListener('click', () => UI.quickCreatePart('', () => PartsUI.render()));
    panel.querySelector('#p-import').addEventListener('click', () => { root.App.showTab('data'); root.DataUI.preselect('parts'); });
  };

  root.PartsUI = PartsUI;
})(window);
