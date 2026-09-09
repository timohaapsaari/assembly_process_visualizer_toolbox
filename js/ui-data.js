/* Import / Export tab: CSV (parts, steps, BOM) with header mapping and preview, JSON backup. */
(function (root) {
  'use strict';
  const U = root.U, UI = root.UI, Store = root.Store, CSV = root.CSV;
  const DataUI = { parsed: null, dataset: null, mapping: {}, preselected: null, fileName: '' };

  DataUI.preselect = function (ds) { DataUI.preselected = ds; DataUI.render(); };

  DataUI.render = function () {
    const host = document.getElementById('tab-data');
    host.innerHTML = '';
    const st = Store.state;
    const panel = UI.el('<div class="grid-2">' +
      '<div class="panel"><div class="panel-head"><h2>Import CSV</h2></div>' +
      '<p class="muted small">Drop an ERP export here. Delimiter (, ; tab) and decimal comma are detected automatically. Columns are matched by name; you can adjust the mapping before importing. Parts referenced by steps but missing from the parts list are created automatically.</p>' +
      '<div class="dropzone" id="dz">Drop a .csv / .txt file here, or <label style="color:var(--accent);cursor:pointer"><u>choose a file</u><input type="file" id="fileIn" accept=".csv,.txt,.tsv,text/csv" class="hidden"></label><br><span class="small">or paste CSV text below</span></div>' +
      '<textarea id="csvText" class="mono mt" placeholder="item_nr;name;type;work_minutes;lead_time_days" style="min-height:90px"></textarea>' +
      '<div class="flex mt"><button class="btn btn-primary" id="parseBtn">Preview</button><span class="muted small">Templates: <a href="#" data-tpl="parts">parts.csv</a> · <a href="#" data-tpl="resources">resources.csv</a> · <a href="#" data-tpl="steps">steps.csv</a> · <a href="#" data-tpl="bom">bom.csv</a></span></div>' +
      '<div id="preview" class="mt"></div>' +
      '</div>' +
      '<div><div class="panel"><div class="panel-head"><h2>Export</h2></div>' +
      '<div class="form-row"><label class="f"><span>CSV delimiter</span><select id="delim"><option value=";">; (Excel, Finnish locale)</option><option value=",">, (comma)</option><option value="\t">Tab</option></select></label></div>' +
      '<div class="flex"><button class="btn" data-exp="parts">Parts CSV</button><button class="btn" data-exp="resources">Resources CSV</button><button class="btn" data-exp="steps">Steps CSV (all recipes)</button><button class="btn" data-exp="bom">BOM lines CSV</button></div>' +
      '<hr style="border:0;border-top:1px solid var(--border);margin:14px 0">' +
      '<div class="flex"><button class="btn btn-primary" id="expJson">Download full backup (JSON)</button><label class="btn">Restore backup (JSON)<input type="file" id="jsonIn" accept=".json,application/json" class="hidden"></label></div>' +
      '<p class="muted small mt">The JSON backup contains parts, recipes, plans and calendar settings. Restoring merges by item nr / recipe name, or replaces everything if you choose so.</p>' +
      '</div>' +
      '<div class="panel help"><h3>CSV formats</h3>' +
      '<p><b>parts.csv</b> — one row per item: <code>item_nr, name, type (purchased|manufactured), unit, work_minutes, lead_time_days, notes</code></p>' +
      '<p><b>resources.csv</b> — equipment and worker pools: <code>name, type (equipment|labor), capacity, lot_size, process_hours, calendar (24/7|shop), notes</code></p>' +
      '<p><b>steps.csv</b> — one row per routing step: <code>recipe, step_nr, step_name, step_type, output_item_nr, components, work_minutes, workers, worker_pool, fixed_minutes, process_hours, resource, lot_size, transfer_per_lot, predecessors, notes</code>. <code>components</code> is <code>ITEM:qty|ITEM:qty</code>. <code>resource</code> and <code>worker_pool</code> are resource names (created if missing). <code>predecessors</code> lists extra step numbers (dependencies through parts are automatic).</p>' +
      '<p><b>bom.csv</b> — one row per component line (alternative to the inline components column): <code>recipe, step_nr, component_item_nr, qty</code></p>' +
      '<p>Step types: assembly, subassembly, bonding, test, inspection, packaging, other. Finnish and common ERP header names (e.g. <code>nimike</code>, <code>työaika</code>, <code>Operation No</code>, <code>Setup time</code>) are recognised too.</p>' +
      '</div></div></div>');
    host.appendChild(panel);

    const csvText = panel.querySelector('#csvText');
    const readFile = f => { DataUI.fileName = f.name; const rd = new FileReader(); rd.onload = () => { csvText.value = rd.result; DataUI.parse(); }; rd.readAsText(f, 'utf-8'); };
    panel.querySelector('#fileIn').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });
    const dz = panel.querySelector('#dz');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    panel.querySelector('#parseBtn').addEventListener('click', () => DataUI.parse());
    panel.querySelectorAll('[data-tpl]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); DataUI.template(a.dataset.tpl); }));
    panel.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', () => {
      const d = panel.querySelector('#delim').value;
      const k = b.dataset.exp;
      const text = k === 'parts' ? CSV.exportParts(d) : k === 'resources' ? CSV.exportResources(d) : k === 'steps' ? CSV.exportSteps(st.recipes, d) : CSV.exportBOM(st.recipes, d);
      UI.download(k + '_' + U.isoDate(new Date()) + '.csv', text);
    }));
    panel.querySelector('#expJson').addEventListener('click', () => UI.download('assembly_planner_backup_' + U.isoDate(new Date()) + '.json', Store.exportJSON(), 'application/json'));
    panel.querySelector('#jsonIn').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const obj = JSON.parse(rd.result);
          const box = UI.modal('<h2>Restore backup</h2><p>' + (obj.parts || []).length + ' parts, ' + (obj.recipes || []).length + ' recipes, ' + (obj.plans || []).length + ' plans in file.</p><div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn" id="j-merge">Merge into current data</button><button class="btn btn-danger" id="j-replace">Replace all data</button></div>');
          box.querySelector('#j-merge').addEventListener('click', () => { Store.importJSON(obj, 'merge'); Store.save(); UI.closeModal(); UI.toast('Backup merged', 'ok'); DataUI.render(); });
          box.querySelector('#j-replace').addEventListener('click', () => { Store.importJSON(obj, 'replace'); Store.save(); UI.closeModal(); UI.toast('Backup restored', 'ok'); DataUI.render(); });
        } catch (err) { UI.toast('Invalid JSON: ' + err.message, 'err'); }
      };
      rd.readAsText(f, 'utf-8'); e.target.value = '';
    });
    if (DataUI.preselected) { csvText.placeholder = 'Paste ' + DataUI.preselected + ' CSV here or choose a file…'; }
    if (csvText.value.trim()) DataUI.parse();
  };

  DataUI.template = function (ds) {
    const t = {
      parts: 'item_nr;name;type;unit;work_minutes;lead_time_days;notes\r\nP-1001;Cylinder housing, machined;purchased;pcs;0;21;\r\nS-3004;Cylinder assembly;manufactured;pcs;45;0;\r\n',
      steps: 'recipe;step_nr;step_name;step_type;output_item_nr;components;work_minutes;workers;worker_pool;fixed_minutes;process_hours;resource;lot_size;transfer_per_lot;predecessors;notes\r\nHA-200;10;Bond piston to rod;bonding;S-3001;P-1002:1|P-1003:1|P-1020:0.05;25;1;Assemblers;5;12;Bonding fixtures;;yes;;Cure 12 h per fixture\r\nHA-200;40;Assemble cylinder;subassembly;S-3004;P-1001:1|S-3001:1|P-1010:1;45;2;Assemblers;20;0;;4;yes;;\r\nHA-200;60;Pressure test;test;S-3004;S-3004:1;10;1;Test technicians;0;0.5;Pressure test bench;;yes;40;\r\n',
      resources: 'name;type;capacity;lot_size;process_hours;calendar;notes\r\nBonding fixtures;equipment;6;1;12;24/7;One rod per fixture\r\nTest cabinet 1;equipment;1;10;6;24/7;\r\nAssemblers;labor;3;;;;\r\n',
      bom: 'recipe;step_nr;component_item_nr;qty\r\nHA-200;10;P-1002;1\r\nHA-200;10;P-1003;1\r\nHA-200;40;P-1001;1\r\n'
    }[ds];
    UI.download(ds + '_template.csv', t);
  };

  DataUI.parse = function () {
    const text = document.getElementById('csvText').value;
    const prev = document.getElementById('preview');
    if (!text.trim()) { prev.innerHTML = ''; return; }
    const parsed = U.parseCSV(text);
    if (!parsed.headers.length || !parsed.rows.length) { prev.innerHTML = '<div class="alert warn">No data rows found. The first line must be a header row.</div>'; return; }
    DataUI.parsed = parsed;
    let guess = CSV.autoMap(parsed.headers, DataUI.preselected);
    if (DataUI.preselected) { guess.dataset = DataUI.preselected; guess.mapping = guess.allMappings[DataUI.preselected]; }
    DataUI.dataset = guess.dataset; DataUI.mapping = guess.mapping;
    DataUI.renderMapping();
  };

  DataUI.renderMapping = function () {
    const prev = document.getElementById('preview');
    const parsed = DataUI.parsed, ds = DataUI.dataset, def = CSV.DATASETS[ds];
    const st = Store.state;
    let html = '<div class="alert info">' + parsed.rows.length + ' rows, ' + parsed.headers.length + ' columns, delimiter "' + (parsed.delimiter === '\t' ? 'tab' : parsed.delimiter) + '".</div>';
    html += '<div class="form-row"><label class="f"><span>Import as</span><select id="dsSel">' + Object.keys(CSV.DATASETS).map(k => '<option value="' + k + '"' + (k === ds ? ' selected' : '') + '>' + CSV.DATASETS[k].label + '</option>').join('') + '</select></label>';
    html += '<label class="f"><span>Mode</span><select id="modeSel"><option value="merge">Merge: update existing, add new</option><option value="replace">Replace: ' + (ds === 'parts' ? 'delete parts not in file' : ds === 'steps' ? 'replace all steps of the recipes in file' : 'replace components of listed steps') + '</option></select></label>';
    if (ds !== 'parts') html += '<label class="f"><span>Target recipe (when file has no recipe column)</span><select id="rcSel"><option value="">— new recipe named after the file —</option>' + st.recipes.map(r => '<option value="' + r.id + '"' + (r.id === st.ui.recipeId ? ' selected' : '') + '>' + UI.esc(r.name) + '</option>').join('') + '</select></label>';
    html += '</div>';
    html += '<table class="tbl map-table"><thead><tr><th>Field</th><th>CSV column</th><th>Sample</th></tr></thead><tbody>';
    def.fields.forEach(f => {
      const col = DataUI.mapping[f.key] || '';
      html += '<tr><td>' + UI.esc(f.label) + (f.required ? ' <span class="badge err">required</span>' : '') + '</td><td><select data-field="' + f.key + '"><option value="">— not imported —</option>' + parsed.headers.map(h => '<option value="' + UI.esc(h) + '"' + (h === col ? ' selected' : '') + '>' + UI.esc(h) + '</option>').join('') + '</select></td><td class="muted small mono">' + (col ? UI.esc(parsed.rows.slice(0, 3).map(r => r[col]).filter(Boolean).join(' · ').slice(0, 60)) : '') + '</td></tr>';
    });
    html += '</tbody></table>';
    const missing = def.fields.filter(f => f.required && !DataUI.mapping[f.key]);
    html += '<div class="flex mt"><button class="btn btn-primary" id="doImport" ' + (missing.length ? 'disabled' : '') + '>Import ' + parsed.rows.length + ' rows</button>' + (missing.length ? '<span class="muted small">Map the required field(s): ' + missing.map(f => f.label).join(', ') + '</span>' : '') + '</div>';
    html += '<h3 class="mt">Preview</h3><div class="tbl-wrap" style="max-height:220px"><table class="tbl"><thead><tr>' + parsed.headers.map(h => '<th>' + UI.esc(h) + '</th>').join('') + '</tr></thead><tbody>' + parsed.rows.slice(0, 8).map(r => '<tr>' + parsed.headers.map(h => '<td class="small">' + UI.esc(r[h]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    prev.innerHTML = html;
    prev.querySelector('#dsSel').addEventListener('change', e => { DataUI.dataset = e.target.value; DataUI.mapping = CSV.autoMap(parsed.headers).allMappings[DataUI.dataset]; DataUI.renderMapping(); });
    prev.querySelectorAll('select[data-field]').forEach(sel => sel.addEventListener('change', () => { DataUI.mapping[sel.dataset.field] = sel.value; DataUI.renderMapping(); }));
    const btn = prev.querySelector('#doImport');
    btn.addEventListener('click', () => {
      const mode = prev.querySelector('#modeSel').value;
      const rcSel = prev.querySelector('#rcSel');
      try {
        const report = CSV.apply({ dataset: DataUI.dataset, rows: parsed.rows, mapping: DataUI.mapping, mode, targetRecipeId: rcSel ? rcSel.value : null, defaultRecipeName: (DataUI.fileName || 'Imported recipe').replace(/\.[^.]+$/, '') });
        Store.save();
        let msg = 'Imported: ' + report.added + ' added, ' + report.updated + ' updated.';
        if (report.createdParts.length) msg += ' Created ' + report.createdParts.length + ' missing part(s): ' + report.createdParts.slice(0, 6).join(', ') + (report.createdParts.length > 6 ? '…' : '') + '.';
        if (report.createdResources && report.createdResources.length) msg += ' Created resource(s): ' + report.createdResources.join(', ') + ' (check capacity and lot size on the Resources tab).';
        if (report.recipes.length) msg += ' New recipe(s): ' + report.recipes.join(', ') + '.';
        prev.innerHTML = '<div class="alert ok">' + UI.esc(msg) + '</div>' + (report.errors.length ? '<div class="alert warn"><ul>' + report.errors.slice(0, 20).map(e => '<li>' + UI.esc(e) + '</li>').join('') + '</ul></div>' : '') +
          '<div class="flex"><button class="btn" id="goParts">Open Parts</button><button class="btn" id="goRes">Open Resources</button><button class="btn" id="goRecipes">Open Recipes</button></div>';
        prev.querySelector('#goParts').addEventListener('click', () => root.App.showTab('parts'));
        prev.querySelector('#goRes').addEventListener('click', () => root.App.showTab('resources'));
        prev.querySelector('#goRecipes').addEventListener('click', () => root.App.showTab('recipes'));
        document.getElementById('csvText').value = '';
        UI.toast('Import done', 'ok');
      } catch (err) { UI.toast('Import failed: ' + err.message, 'err'); console.error(err); }
    });
  };

  root.DataUI = DataUI;
})(window);
