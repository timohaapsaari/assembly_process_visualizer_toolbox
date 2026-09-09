/* CSV import/export: dataset definitions, header auto-mapping, apply to store. */
(function (root) {
  'use strict';
  const U = root.U, Store = root.Store, Scheduler = root.Scheduler;

  const DATASETS = {
    parts: {
      label: 'Parts (items)',
      key: 'itemNr',
      fields: [
        { key: 'itemNr', label: 'Item nr', required: true, aliases: ['itemnr', 'itemnumber', 'itemno', 'item', 'partnumber', 'partnr', 'partno', 'part', 'sku', 'material', 'materialnumber', 'articlenumber', 'article', 'code', 'itemcode', 'productcode', 'nimike', 'nimikenumero', 'tuotenumero', 'tuotekoodi', 'osanumero', 'id'] },
        { key: 'name', label: 'Name', aliases: ['name', 'description', 'desc', 'itemname', 'partname', 'title', 'nimi', 'kuvaus', 'nimitys'] },
        { key: 'type', label: 'Type (purchased/manufactured)', aliases: ['type', 'itemtype', 'kind', 'category', 'procurement', 'procurementtype', 'makebuy', 'source', 'tyyppi', 'hankinta'] },
        { key: 'unit', label: 'Unit', aliases: ['unit', 'uom', 'unitofmeasure', 'yksikkö', 'yks'] },
        { key: 'workMinutes', label: 'Work time (min)', aliases: ['workminutes', 'workmin', 'worktime', 'worktimemin', 'laborminutes', 'labourminutes', 'labor', 'labour', 'minutes', 'runtime', 'runtimemin', 'cycletime', 'työaika', 'tyoaika', 'työaikamin'] },
        { key: 'leadTimeDays', label: 'Lead time (days)', aliases: ['leadtimedays', 'leadtime', 'leadtimed', 'lead', 'procurementleadtime', 'deliverytime', 'deliverydays', 'toimitusaika', 'toimitusaikapv', 'hankintaaika'] },
        { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comment', 'comments', 'remarks', 'huomautus', 'huom', 'lisätiedot'] }
      ]
    },
    steps: {
      label: 'Recipe steps (routing)',
      key: 'stepNr',
      fields: [
        { key: 'recipe', label: 'Recipe / product', aliases: ['recipe', 'recipename', 'routing', 'routingname', 'process', 'product', 'productname', 'bomname', 'assembly', 'resepti', 'tuote', 'reititys'] },
        { key: 'stepNr', label: 'Step nr', required: true, aliases: ['stepnr', 'stepno', 'stepnumber', 'step', 'operation', 'operationnr', 'operationno', 'operationnumber', 'opnr', 'opno', 'op', 'seq', 'sequence', 'sequencenr', 'vaihe', 'vaihenro', 'työvaihe', 'tyovaihe', 'nro'] },
        { key: 'name', label: 'Step name', required: true, aliases: ['name', 'stepname', 'operationname', 'description', 'desc', 'title', 'nimi', 'kuvaus', 'vaiheennimi'] },
        { key: 'type', label: 'Step type', aliases: ['type', 'steptype', 'operationtype', 'category', 'tyyppi', 'vaihetyyppi'] },
        { key: 'outputItemNr', label: 'Output item nr', aliases: ['outputitemnr', 'output', 'outputitem', 'outputpart', 'produces', 'produceditem', 'resultitem', 'parent', 'parentitem', 'parentitemnr', 'tuotos', 'tuloste'] },
        { key: 'components', label: 'Components (ITEM:qty|ITEM:qty)', aliases: ['components', 'component', 'inputs', 'input', 'materials', 'bom', 'consumes', 'komponentit', 'osat'] },
        { key: 'workMinutes', label: 'Work time per unit (min)', aliases: ['workminutes', 'workmin', 'worktime', 'worktimeperunit', 'runtime', 'runtimemin', 'runtimeperunit', 'perunit', 'perunitmin', 'minutesperunit', 'laborminutes', 'labourminutes', 'cycletime', 'työaika', 'tyoaika', 'yksikköaika'] },
        { key: 'workers', label: 'Workers', aliases: ['workers', 'worker', 'workercount', 'crew', 'crewsize', 'operators', 'persons', 'people', 'headcount', 'resources', 'työntekijät', 'tyontekijat', 'henkilöt', 'miehitys'] },
        { key: 'fixedMinutes', label: 'Fixed time per run (min)', aliases: ['fixedminutes', 'fixed', 'fixedtime', 'setup', 'setupminutes', 'setuptime', 'setupmin', 'batchtime', 'perrun', 'asetusaika', 'kiinteäaika'] },
        { key: 'processHours', label: 'Process / cure time per lot (h)', aliases: ['processhours', 'process', 'processtime', 'curehours', 'cure', 'curetime', 'curing', 'wait', 'waittime', 'waithours', 'drying', 'dryingtime', 'machinetime', 'machinehours', 'testtime', 'kovettuminen', 'kovetusaika', 'odotusaika', 'kuivumisaika', 'prosessiaika', 'koneaika'] },
        { key: 'resource', label: 'Process resource (equipment)', aliases: ['resource', 'equipment', 'machine', 'workcenter', 'workcentre', 'station', 'cabinet', 'chamber', 'oven', 'fixture', 'resurssi', 'laite', 'kone', 'työpiste', 'tyopiste'] },
        { key: 'lotSize', label: 'Lot size (pcs per run)', aliases: ['lotsize', 'lot', 'batchsize', 'batch', 'lotqty', 'eräkoko', 'erakoko', 'erä'] },
        { key: 'workerPool', label: 'Worker pool', aliases: ['workerpool', 'pool', 'team', 'laborpool', 'labourpool', 'crewname', 'tiimi', 'ryhmä'] },
        { key: 'transferPerLot', label: 'Successor may start per lot (yes/no)', aliases: ['transferperlot', 'transfer', 'transferbatch', 'overlap', 'perlot', 'siirtoerä', 'limitys'] },
        { key: 'yieldPct', label: 'Yield % (good units out)', aliases: ['yieldpct', 'yield', 'fpy', 'firstpassyield', 'passrate', 'goodrate', 'saanto', 'saantoprosentti', 'hyväksymisaste'] },
        { key: 'predecessors', label: 'Extra predecessors (step nrs)', aliases: ['predecessors', 'predecessor', 'preds', 'after', 'dependson', 'depends', 'previous', 'prev', 'edeltäjät', 'edeltavat', 'edeltäjä'] },
        { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comment', 'comments', 'remarks', 'instructions', 'huomautus', 'huom', 'ohje'] }
      ]
    },
    resources: {
      label: 'Resources (equipment & worker pools)',
      key: 'name',
      fields: [
        { key: 'name', label: 'Resource name', required: true, aliases: ['name', 'resource', 'resourcename', 'equipment', 'machine', 'workcenter', 'workcentre', 'station', 'nimi', 'resurssi', 'laite', 'kone'] },
        { key: 'type', label: 'Type (equipment/labor)', aliases: ['type', 'resourcetype', 'kind', 'category', 'tyyppi'] },
        { key: 'capacity', label: 'Capacity (units / persons)', aliases: ['capacity', 'units', 'count', 'quantity', 'qty', 'number', 'persons', 'headcount', 'kapasiteetti', 'lukumäärä', 'lkm', 'henkilöt'] },
        { key: 'lotSize', label: 'Lot size (pcs per unit per run)', aliases: ['lotsize', 'lot', 'batchsize', 'batch', 'eräkoko', 'erakoko'] },
        { key: 'processHours', label: 'Default process time per lot (h)', aliases: ['processhours', 'process', 'processtime', 'runhours', 'runtime', 'cycletime', 'curehours', 'hours', 'prosessiaika', 'kovetusaika'] },
        { key: 'calendar', label: 'Calendar (24/7, shop, or a calendar name)', aliases: ['calendar', 'schedule', 'availability', 'shift', 'shifts', 'kalenteri', 'vuorot'] },
        { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comment', 'comments', 'remarks', 'huomautus', 'huom'] }
      ]
    },
    bom: {
      label: 'Step components (BOM lines)',
      key: 'stepNr',
      fields: [
        { key: 'recipe', label: 'Recipe / product', aliases: ['recipe', 'recipename', 'routing', 'process', 'product', 'productname', 'assembly', 'resepti', 'tuote'] },
        { key: 'stepNr', label: 'Step nr', required: true, aliases: ['stepnr', 'stepno', 'stepnumber', 'step', 'operation', 'operationnr', 'operationno', 'opnr', 'opno', 'op', 'seq', 'sequence', 'vaihe', 'vaihenro', 'työvaihe', 'nro'] },
        { key: 'componentItemNr', label: 'Component item nr', required: true, aliases: ['componentitemnr', 'component', 'componentitem', 'componentnr', 'item', 'itemnr', 'itemnumber', 'part', 'partnumber', 'partnr', 'material', 'child', 'childitem', 'childitemnr', 'sku', 'komponentti', 'nimike', 'osa'] },
        { key: 'qty', label: 'Quantity per unit', aliases: ['qty', 'quantity', 'qtyper', 'quantityper', 'qtyperunit', 'amount', 'usage', 'määrä', 'maara', 'kpl', 'lkm'] }
      ]
    }
  };

  const CSV = { DATASETS };

  /** Guess dataset type and a header->field mapping. */
  CSV.autoMap = function (headers, preferred) {
    const norm = headers.map(h => U.normHeader(h));
    const score = {};
    const maps = {};
    Object.keys(DATASETS).forEach(ds => {
      const def = DATASETS[ds];
      const map = {};
      let sc = 0;
      def.fields.forEach(f => {
        // exact alias match first
        let idx = norm.findIndex((h, i) => f.aliases.indexOf(h) >= 0 && !Object.values(map).includes(headers[i]));
        if (idx < 0) idx = norm.findIndex((h, i) => f.aliases.some(a => a.length > 3 && h.indexOf(a) >= 0) && !Object.values(map).includes(headers[i]));
        if (idx >= 0) { map[f.key] = headers[idx]; sc += f.required ? 3 : 1; }
      });
      def.fields.filter(f => f.required).forEach(f => { if (!map[f.key]) sc -= 5; });
      score[ds] = sc; maps[ds] = map;
    });
    let best = preferred && DATASETS[preferred] ? preferred : Object.keys(score).sort((a, b) => score[b] - score[a])[0];
    // special: a 'bom' file has componentItemNr + qty but no 'name'; a steps file needs name
    if (!preferred) {
      if (maps.resources.name && maps.resources.capacity && !maps.steps.stepNr && !maps.parts.itemNr) best = 'resources';
      if (maps.bom.componentItemNr && maps.bom.qty && !maps.steps.name) best = 'bom';
      if (maps.steps.name && maps.steps.stepNr && !maps.bom.componentItemNr) best = 'steps';
      if (maps.parts.itemNr && !maps.steps.stepNr && !maps.bom.stepNr) best = 'parts';
    }
    return { dataset: best, mapping: maps[best], allMappings: maps };
  };

  function normType(v) {
    v = String(v || '').trim().toLowerCase();
    if (!v) return 'purchased';
    if (/^(m|make|manu|manufactured|produced|assembl|sub|own|valm|oma|tuot|f|final|phantom)/.test(v)) return 'manufactured';
    return 'purchased';
  }
  function normStepType(v) {
    v = String(v || '').trim().toLowerCase();
    if (!v) return 'assembly';
    const t = Scheduler.STEP_TYPES.find(t => t.id === v || t.label.toLowerCase() === v);
    if (t) return t.id;
    if (/test|koe|testaus|burn/.test(v)) return 'test';
    if (/bond|glue|cure|cur|adhes|pot|paint|dry|liim|kovet|maal/.test(v)) return 'bonding';
    if (/insp|check|qc|quality|tark/.test(v)) return 'inspection';
    if (/pack|ship|pakk/.test(v)) return 'packaging';
    if (/sub|osakok/.test(v)) return 'subassembly';
    if (/assem|kokoon|asenn/.test(v)) return 'assembly';
    return 'other';
  }
  CSV.normType = normType; CSV.normStepType = normStepType;

  /** Parse "A:2|B:1" / "A:2;B:1" / "A x2, B" component strings. */
  CSV.parseComponents = function (s) {
    const out = [];
    String(s || '').split(/[|;\n]+|,(?=\s+\S|[A-Za-z])/).map(x => x.trim()).filter(Boolean).forEach(tok => {
      let m = tok.match(/^(.+?)\s*[:x×*=]\s*([\d.,]+)\s*$/i);
      if (m) out.push({ itemNr: m[1].trim(), qty: U.num(m[2], 1) });
      else if ((m = tok.match(/^([\d.,]+)\s*[x×*]\s*(.+)$/i))) out.push({ itemNr: m[2].trim(), qty: U.num(m[1], 1) });
      else out.push({ itemNr: tok, qty: 1 });
    });
    return out;
  };

  function getVal(row, mapping, key) { const h = mapping[key]; return h ? row[h] : undefined; }

  /**
   * Apply an import. opts: { dataset, rows, mapping, mode: 'merge'|'replace', targetRecipeId, defaultRecipeName }
   * Returns a report { added, updated, createdParts:[], errors:[], recipes:[] }.
   */
  CSV.apply = function (opts) {
    const st = Store.state;
    const report = { added: 0, updated: 0, createdParts: [], errors: [], recipes: [] };
    const M = opts.mapping, rows = opts.rows;

    const ensurePart = (itemNr, extra) => {
      itemNr = String(itemNr || '').trim();
      if (!itemNr) return null;
      let p = Store.partByItemNr(itemNr);
      if (!p) {
        p = Store.addPart(Object.assign({ itemNr, name: itemNr, type: 'purchased' }, extra || {}));
        report.createdParts.push(itemNr);
      }
      return p;
    };

    if (opts.dataset === 'parts') {
      if (opts.mode === 'replace') {
        const keep = new Set(rows.map(r => String(getVal(r, M, 'itemNr') || '').trim().toLowerCase()).filter(Boolean));
        st.parts.slice().forEach(p => { if (!keep.has(String(p.itemNr).toLowerCase())) Store.deletePart(p.id); });
      }
      rows.forEach((r, i) => {
        const itemNr = String(getVal(r, M, 'itemNr') || '').trim();
        if (!itemNr) { report.errors.push('Row ' + (i + 2) + ': missing item nr'); return; }
        let p = Store.partByItemNr(itemNr);
        const o = {};
        if (M.name) o.name = getVal(r, M, 'name') || itemNr;
        if (M.type) o.type = normType(getVal(r, M, 'type'));
        if (M.unit && getVal(r, M, 'unit')) o.unit = getVal(r, M, 'unit');
        if (M.workMinutes) o.workMinutes = U.num(getVal(r, M, 'workMinutes'), 0);
        if (M.leadTimeDays) o.leadTimeDays = U.num(getVal(r, M, 'leadTimeDays'), 0);
        if (M.notes) o.notes = getVal(r, M, 'notes') || '';
        if (p) { Object.assign(p, o); report.updated++; }
        else { Store.addPart(Object.assign({ itemNr, name: itemNr }, o)); report.added++; }
      });
      return report;
    }

    if (opts.dataset === 'resources') {
      rows.forEach((r, i) => {
        const name = String(getVal(r, M, 'name') || '').trim();
        if (!name) { report.errors.push('Row ' + (i + 2) + ': missing resource name'); return; }
        let res = Store.resourceByName(name);
        const o = {};
        if (M.type) o.type = /^(l|labor|labour|worker|people|person|crew|team|henkil|työ|tyo)/i.test(String(getVal(r, M, 'type') || '')) ? 'labor' : 'equipment';
        if (M.capacity) o.capacity = Math.max(1, Math.round(U.num(getVal(r, M, 'capacity'), 1)));
        if (M.lotSize) o.lotSize = Math.max(0, U.num(getVal(r, M, 'lotSize'), 1));
        if (M.processHours) o.processHours = Math.max(0, U.num(getVal(r, M, 'processHours'), 0));
        if (M.calendar) {
          const cv = String(getVal(r, M, 'calendar') || '').trim();
          const named = cv ? Store.calendarByName(cv) : null;
          if (named) { o.calendar = 'shop'; o.calendarId = named.id; }
          else if (!cv || /24|always|continuous|jatkuva/i.test(cv)) { o.calendar = '24_7'; o.calendarId = null; }
          else { o.calendar = 'shop'; o.calendarId = null; if (!/^(shop|shift|work|vuoro|työ|default)/i.test(cv)) report.errors.push('Row ' + (i + 2) + ': calendar "' + cv + '" not found, using shop calendar'); }
        }
        if (M.notes) o.notes = getVal(r, M, 'notes') || '';
        if (res) { Object.assign(res, o); report.updated++; }
        else { Store.addResource(Object.assign({ name }, o)); report.added++; }
      });
      return report;
    }

    const ensureResource = (name, type) => {
      name = String(name || '').trim();
      if (!name) return null;
      let res = Store.resourceByName(name);
      if (!res) { res = Store.addResource({ name, type: type || 'equipment', capacity: 1, lotSize: type === 'labor' ? 0 : 1 }); report.createdResources = (report.createdResources || []).concat(name); }
      return res;
    };

    // recipe resolution for steps / bom
    const recipeCache = {};
    const resolveRecipe = (r) => {
      let name = M.recipe ? String(getVal(r, M, 'recipe') || '').trim() : '';
      if (!name) {
        if (opts.targetRecipeId) { const rc = Store.recipe(opts.targetRecipeId); if (rc) return rc; }
        name = opts.defaultRecipeName || 'Imported recipe';
      }
      const key = name.toLowerCase();
      if (recipeCache[key]) return recipeCache[key];
      let rc = st.recipes.find(x => String(x.name).trim().toLowerCase() === key);
      if (!rc) { rc = Store.addRecipe({ name }); report.recipes.push(name); }
      recipeCache[key] = rc;
      return rc;
    };
    const stepKey = v => String(v || '').trim().toLowerCase();

    if (opts.dataset === 'steps') {
      const touched = new Set();
      if (opts.mode === 'replace') {
        rows.forEach(r => { const rc = resolveRecipe(r); if (!touched.has(rc.id)) { touched.add(rc.id); rc.steps = []; } });
      }
      rows.forEach((r, i) => {
        const nr = String(getVal(r, M, 'stepNr') || '').trim();
        if (!nr) { report.errors.push('Row ' + (i + 2) + ': missing step nr'); return; }
        const rc = resolveRecipe(r);
        let s = rc.steps.find(x => stepKey(x.nr) === stepKey(nr));
        const o = { nr: /^\d+$/.test(nr) ? +nr : nr };
        if (M.name) o.name = getVal(r, M, 'name') || ('Step ' + nr);
        if (M.type) o.type = normStepType(getVal(r, M, 'type'));
        if (M.outputItemNr && getVal(r, M, 'outputItemNr')) { const p = ensurePart(getVal(r, M, 'outputItemNr'), { type: 'manufactured' }); o.outputPartId = p ? p.id : null; if (p && p.type !== 'manufactured') p.type = 'manufactured'; }
        if (M.workMinutes) o.workMinutes = U.num(getVal(r, M, 'workMinutes'), 0);
        if (M.workers) o.workers = Math.max(1, U.num(getVal(r, M, 'workers'), 1));
        if (M.fixedMinutes) o.fixedMinutes = U.num(getVal(r, M, 'fixedMinutes'), 0);
        if (M.processHours) o.processHours = U.num(getVal(r, M, 'processHours'), 0);
        if (M.resource) { const res = ensureResource(getVal(r, M, 'resource'), 'equipment'); o.resourceId = res ? res.id : null; }
        if (M.lotSize) o.lotSize = Math.max(0, U.num(getVal(r, M, 'lotSize'), 0));
        if (M.workerPool) { const res = ensureResource(getVal(r, M, 'workerPool'), 'labor'); o.workerPoolId = res ? res.id : null; }
        if (M.transferPerLot) o.transferPerLot = /^(1|y|yes|true|x|k|kyllä|kylla)$/i.test(String(getVal(r, M, 'transferPerLot') || '').trim());
        if (M.yieldPct) { let y = U.num(getVal(r, M, 'yieldPct'), 100); if (y > 0 && y <= 1) y *= 100; o.yieldPct = y > 0 ? Math.min(100, y) : 100; }
        if (M.notes) o.notes = getVal(r, M, 'notes') || '';
        if (M.components) {
          o.components = CSV.parseComponents(getVal(r, M, 'components')).map(c => { const p = ensurePart(c.itemNr); return p ? { partId: p.id, qty: c.qty } : null; }).filter(Boolean);
        }
        if (M.predecessors) o._preds = String(getVal(r, M, 'predecessors') || '').split(/[|;,\s]+/).map(x => x.trim()).filter(Boolean);
        if (s) { Object.assign(s, o); report.updated++; }
        else { s = Store.newStep(Object.assign({ name: 'Step ' + nr }, o)); rc.steps.push(s); report.added++; }
      });
      // resolve predecessors by step nr, sort by nr
      st.recipes.forEach(rc => {
        rc.steps.forEach(s => {
          if (s._preds) {
            s.extraPreds = s._preds.map(nr => { const t = rc.steps.find(x => stepKey(x.nr) === stepKey(nr)); return t ? t.id : null; }).filter(Boolean);
            delete s._preds;
          }
        });
        rc.steps.sort((a, b) => U.num(a.nr) - U.num(b.nr));
        if (!rc.finalPartId) CSV.guessFinalPart(rc);
      });
      return report;
    }

    if (opts.dataset === 'bom') {
      const cleared = new Set();
      rows.forEach((r, i) => {
        const nr = String(getVal(r, M, 'stepNr') || '').trim();
        const comp = String(getVal(r, M, 'componentItemNr') || '').trim();
        if (!nr || !comp) { report.errors.push('Row ' + (i + 2) + ': missing step nr or component'); return; }
        const rc = resolveRecipe(r);
        let s = rc.steps.find(x => stepKey(x.nr) === stepKey(nr));
        if (!s) { s = Store.newStep({ nr: /^\d+$/.test(nr) ? +nr : nr, name: 'Step ' + nr }); rc.steps.push(s); rc.steps.sort((a, b) => U.num(a.nr) - U.num(b.nr)); report.added++; }
        if (opts.mode === 'replace' && !cleared.has(s.id)) { cleared.add(s.id); s.components = []; }
        const p = ensurePart(comp);
        const qty = M.qty ? U.num(getVal(r, M, 'qty'), 1) : 1;
        const ex = s.components.find(c => c.partId === p.id);
        if (ex) { ex.qty = qty; report.updated++; } else { s.components.push({ partId: p.id, qty }); report.updated++; }
      });
      st.recipes.forEach(rc => { if (!rc.finalPartId) CSV.guessFinalPart(rc); });
      return report;
    }
    throw new Error('Unknown dataset');
  };

  /** Final part = output of a step that no other step consumes (prefer last step). */
  CSV.guessFinalPart = function (rc) {
    const consumed = new Set();
    rc.steps.forEach(s => (s.components || []).forEach(c => { if (c.partId !== s.outputPartId) consumed.add(c.partId); }));
    const cands = rc.steps.filter(s => s.outputPartId && !consumed.has(s.outputPartId));
    if (cands.length) rc.finalPartId = cands[cands.length - 1].outputPartId;
  };

  /* ---------- export ---------- */
  CSV.exportParts = function (delim) {
    return U.toCSV(Store.state.parts, [
      { key: 'itemNr', label: 'item_nr' }, { key: 'name', label: 'name' }, { key: 'type', label: 'type' }, { key: 'unit', label: 'unit' },
      { key: 'workMinutes', label: 'work_minutes' }, { key: 'leadTimeDays', label: 'lead_time_days' }, { key: 'notes', label: 'notes' }
    ], delim);
  };
  CSV.exportSteps = function (recipes, delim) {
    const pb = Store.partsById(), rb = Store.resourcesById();
    const rows = [];
    recipes.forEach(rc => rc.steps.forEach(s => rows.push({
      recipe: rc.name, step_nr: s.nr, step_name: s.name, step_type: s.type,
      output_item_nr: pb[s.outputPartId] ? pb[s.outputPartId].itemNr : '',
      components: (s.components || []).map(c => (pb[c.partId] ? pb[c.partId].itemNr : '?') + ':' + c.qty).join('|'),
      work_minutes: s.workMinutes, workers: s.workers, worker_pool: rb[s.workerPoolId] ? rb[s.workerPoolId].name : '', fixed_minutes: s.fixedMinutes,
      process_hours: s.processHours, resource: rb[s.resourceId] ? rb[s.resourceId].name : '', lot_size: s.lotSize || '', transfer_per_lot: s.transferPerLot ? 'yes' : 'no', yield_pct: s.yieldPct == null ? 100 : s.yieldPct,
      predecessors: (s.extraPreds || []).map(id => { const t = rc.steps.find(x => x.id === id); return t ? t.nr : ''; }).filter(Boolean).join(';'),
      notes: s.notes || ''
    })));
    return U.toCSV(rows, ['recipe', 'step_nr', 'step_name', 'step_type', 'output_item_nr', 'components', 'work_minutes', 'workers', 'worker_pool', 'fixed_minutes', 'process_hours', 'resource', 'lot_size', 'transfer_per_lot', 'yield_pct', 'predecessors', 'notes'].map(k => ({ key: k })), delim);
  };
  CSV.exportResources = function (delim) {
    return U.toCSV(Store.state.resources || [], [
      { key: 'name' }, { key: 'type' }, { key: 'capacity' }, { key: 'lotSize', label: 'lot_size' }, { key: 'processHours', label: 'process_hours' },
      { key: 'calendar', get: r => { if (r.type === 'labor' || r.calendar === 'shop') { const c = (Store.state.calendars || []).find(x => x.id === r.calendarId); return c ? c.name : 'shop'; } return '24/7'; } }, { key: 'notes' }
    ], delim);
  };
  CSV.exportBOM = function (recipes, delim) {
    const pb = Store.partsById();
    const rows = [];
    recipes.forEach(rc => rc.steps.forEach(s => (s.components || []).forEach(c => rows.push({
      recipe: rc.name, step_nr: s.nr, step_name: s.name, component_item_nr: pb[c.partId] ? pb[c.partId].itemNr : '?', component_name: pb[c.partId] ? pb[c.partId].name : '', qty: c.qty
    }))));
    return U.toCSV(rows, ['recipe', 'step_nr', 'step_name', 'component_item_nr', 'component_name', 'qty'].map(k => ({ key: k })), delim);
  };

  root.CSV = CSV;
})(window);
