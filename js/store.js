/* Application state, persistence (localStorage), demo data. */
(function (root) {
  'use strict';
  const U = root.U, Calendar = root.Calendar, Scheduler = root.Scheduler;
  const KEY = 'apv.state.v1';
  const SNAP_KEY = 'apv.snapshots.v1';
  const SNAP_MAX = 6;

  const Store = {
    state: null,
    listeners: [],

    blank() {
      return {
        version: 1,
        parts: [],
        resources: [],
        calendars: [],
        stepTypes: Scheduler.DEFAULT_STEP_TYPES.map(t => Object.assign({}, t)),
        recipes: [],
        plans: [],
        settings: Object.assign({}, Calendar.DEFAULTS, { holidays: [], defaultsByType: {}, stdResourcesSeeded: true }),
        ui: { tab: 'plan', recipeId: null, planId: null, ganttMode: 'jit', zoom: 1 }
      };
    },

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) { this.state = Object.assign(this.blank(), JSON.parse(raw)); }
      } catch (e) { console.warn('state load failed', e); }
      if (!this.state) { this.state = this.blank(); this.state.firstRun = true; }
      this.state.settings = Object.assign({}, Calendar.DEFAULTS, this.state.settings || {});
      this.migrate();
      return this.state;
    },

    /** Upgrade older saved states in place. */
    migrate() {
      const st = this.state;
      if (!Array.isArray(st.resources)) st.resources = [];
      if (!Array.isArray(st.calendars)) st.calendars = [];
      if (!Array.isArray(st.stepTypes) || !st.stepTypes.length) st.stepTypes = Scheduler.DEFAULT_STEP_TYPES.map(t => Object.assign({}, t));
      Scheduler.setTypes(st.stepTypes);
      if (!Array.isArray(st.settings.shifts) || !st.settings.shifts.length) st.settings.shifts = [Calendar.legacyShift(st.settings)];
      st.resources.forEach(r => { if (r.calendarId === undefined) r.calendarId = null; });
      if (!st.settings.defaultsByType || typeof st.settings.defaultsByType !== 'object') st.settings.defaultsByType = {};
      // Existing data without any resources: seed the standard groups once so the resource views have something to show.
      if (!st.resources.length && (st.recipes || []).length && !st.settings.stdResourcesSeeded) {
        st.settings.stdResourcesSeeded = true;
        this.addStandardResources();
        this.applyDefaultsToAll(false);
      }
      if (st.resources.length) st.settings.stdResourcesSeeded = true;
      (st.recipes || []).forEach(r => { if (!Array.isArray(r.deliverables)) r.deliverables = []; });
      (st.recipes || []).forEach(r => (r.steps || []).forEach(s => {
        if (s.processHours == null) { s.processHours = U.num(s.cureHours, 0); }
        delete s.cureHours;
        if (s.lotSize == null) s.lotSize = 0;
        if (s.resourceId === undefined) s.resourceId = null;
        if (s.workerPoolId === undefined) s.workerPoolId = null;
        if (s.transferPerLot === undefined) s.transferPerLot = false;
        if (s.yieldPct == null) s.yieldPct = 100;
        if (s.continuesPrevious === undefined) s.continuesPrevious = false;
      }));
    },

    /* ---- step types ---- */
    typeIdFor(label) {
      let base = String(label || 'type').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'type';
      let id = base, n = 2; while (this.state.stepTypes.some(t => t.id === id)) id = base + '_' + (n++);
      return id;
    },
    addStepType(label, color) { const t = { id: this.typeIdFor(label), label: label || 'New type', color: color || '#64748b' }; this.state.stepTypes.push(t); Scheduler.setTypes(this.state.stepTypes); return t; },
    stepTypeUsage(id) { let n = 0; this.state.recipes.forEach(r => r.steps.forEach(s => { if (s.type === id) n++; })); return n; },
    deleteStepType(id, replacementId) {
      if (this.state.stepTypes.length <= 1) return false;
      this.state.stepTypes = this.state.stepTypes.filter(t => t.id !== id);
      const rep = replacementId && this.state.stepTypes.some(t => t.id === replacementId) ? replacementId : (this.state.stepTypes.find(t => t.id === 'other') || this.state.stepTypes[0]).id;
      this.state.recipes.forEach(r => r.steps.forEach(s => { if (s.type === id) s.type = rep; }));
      const d = this.state.settings.defaultsByType || {}; delete d[id];
      Scheduler.setTypes(this.state.stepTypes);
      return true;
    },
    moveStepType(id, dir) { const l = this.state.stepTypes; const i = l.findIndex(t => t.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= l.length) return; const x = l[i]; l[i] = l[j]; l[j] = x; Scheduler.setTypes(l); },

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { console.warn('save failed', e); }
      this.listeners.forEach(fn => fn(this.state));
    },
    onChange(fn) { this.listeners.push(fn); },

    /* ---- snapshots (undo for destructive actions) ---- */
    snapshots() { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'); } catch (e) { return []; } },
    /** Save a copy of the current state before a destructive action. */
    snapshot(label) {
      try {
        const st = this.state;
        if (!st.parts.length && !st.recipes.length && !st.resources.length) return false;
        const json = JSON.stringify({ parts: st.parts, resources: st.resources, calendars: st.calendars, stepTypes: st.stepTypes, recipes: st.recipes, plans: st.plans, settings: st.settings });
        if (json.length > 3000000) return false;
        const list = this.snapshots();
        list.unshift({ t: new Date().toISOString(), label: label || 'snapshot', parts: st.parts.length, recipes: st.recipes.length, plans: st.plans.length, json });
        while (list.length > SNAP_MAX) list.pop();
        localStorage.setItem(SNAP_KEY, JSON.stringify(list));
        return true;
      } catch (e) { console.warn('snapshot failed', e); return false; }
    },
    restoreSnapshot(index) {
      const snap = this.snapshots()[index]; if (!snap) throw new Error('Snapshot not found');
      this.snapshot('before restoring "' + snap.label + '"');
      const obj = JSON.parse(snap.json);
      this.state = Object.assign(this.blank(), { parts: obj.parts || [], resources: obj.resources || [], calendars: obj.calendars || [], stepTypes: obj.stepTypes || undefined, recipes: obj.recipes || [], plans: obj.plans || [], settings: Object.assign({}, Calendar.DEFAULTS, obj.settings || {}) });
      this.migrate();
    },
    deleteSnapshot(index) { const l = this.snapshots(); l.splice(index, 1); localStorage.setItem(SNAP_KEY, JSON.stringify(l)); },

    calendar() { return new Calendar(this.state.settings); },
    /** Calendar for a named calendar id (null / unknown = shop calendar). Holidays are shared. */
    calendarFor(id) {
      const c = (this.state.calendars || []).find(x => x.id === id);
      if (!c) return this.calendar();
      return new Calendar(Object.assign({}, this.state.settings, { shifts: c.shifts && c.shifts.length ? c.shifts : this.state.settings.shifts }));
    },
    calendarsById() { const m = {}; (this.state.calendars || []).forEach(c => { m[c.id] = this.calendarFor(c.id); }); return m; },
    calendarByName(name) { name = String(name || '').trim().toLowerCase(); return (this.state.calendars || []).find(c => String(c.name).trim().toLowerCase() === name); },
    newCalendar(o) { return Object.assign({ id: U.uid('cal'), name: '', shifts: [Calendar.legacyShift(this.state.settings)] }, o || {}); },
    addCalendar(o) { const c = this.newCalendar(o); this.state.calendars.push(c); return c; },
    deleteCalendar(id) {
      this.state.calendars = this.state.calendars.filter(c => c.id !== id);
      this.state.resources.forEach(r => { if (r.calendarId === id) r.calendarId = null; });
    },

    /* ---- parts ---- */
    partsById() { const m = {}; this.state.parts.forEach(p => { m[p.id] = p; }); return m; },
    partByItemNr(nr) { nr = String(nr || '').trim().toLowerCase(); return this.state.parts.find(p => String(p.itemNr).trim().toLowerCase() === nr); },
    newPart(o) {
      return Object.assign({ id: U.uid('p'), itemNr: '', name: '', type: 'purchased', unit: 'pcs', workMinutes: 0, leadTimeDays: 0, notes: '' }, o || {});
    },
    addPart(o) { const p = this.newPart(o); this.state.parts.push(p); return p; },
    partUsage(partId) {
      const uses = [];
      this.state.recipes.forEach(r => {
        if (r.finalPartId === partId) uses.push({ recipe: r, role: 'final product' });
        r.steps.forEach(s => {
          if (s.outputPartId === partId) uses.push({ recipe: r, step: s, role: 'output' });
          if ((s.components || []).some(c => c.partId === partId)) uses.push({ recipe: r, step: s, role: 'component' });
        });
      });
      return uses;
    },
    deletePart(partId) {
      this.state.parts = this.state.parts.filter(p => p.id !== partId);
      this.state.recipes.forEach(r => {
        if (r.finalPartId === partId) r.finalPartId = null;
        r.steps.forEach(s => {
          if (s.outputPartId === partId) s.outputPartId = null;
          s.components = (s.components || []).filter(c => c.partId !== partId);
        });
      });
    },

    /* ---- resources ---- */
    resourcesById() { const m = {}; (this.state.resources || []).forEach(r => { m[r.id] = r; }); return m; },
    resourceByName(name) { name = String(name || '').trim().toLowerCase(); return (this.state.resources || []).find(r => String(r.name).trim().toLowerCase() === name); },
    newResource(o) {
      return Object.assign({ id: U.uid('res'), name: '', type: 'equipment', capacity: 1, lotSize: 1, processHours: 0, calendar: '24_7', calendarId: null, notes: '' }, o || {});
    },
    addResource(o) { const r = this.newResource(o); this.state.resources.push(r); return r; },
    resourceUsage(resId) {
      const uses = [];
      this.state.recipes.forEach(r => r.steps.forEach(s => { if (s.resourceId === resId || s.workerPoolId === resId) uses.push({ recipe: r, step: s }); }));
      return uses;
    },
    deleteResource(resId) {
      this.state.resources = this.state.resources.filter(r => r.id !== resId);
      this.state.recipes.forEach(r => r.steps.forEach(s => { if (s.resourceId === resId) s.resourceId = null; if (s.workerPoolId === resId) s.workerPoolId = null; }));
    },

    /** Default worker pool / equipment for a step type: {poolId, resourceId}. */
    defaultsFor(type) { const d = (this.state.settings.defaultsByType || {})[type] || {}; const rb = this.resourcesById(); return { poolId: rb[d.poolId] ? d.poolId : null, resourceId: rb[d.resourceId] ? d.resourceId : null }; },
    /**
     * Apply the step-type defaults to a step. overwrite=false only fills empty assignments.
     * Returns true when something changed.
     */
    applyDefaults(step, overwrite) {
      const d = this.defaultsFor(step.type); const rb = this.resourcesById();
      let changed = false;
      if (d.poolId && (overwrite || !step.workerPoolId)) { if (step.workerPoolId !== d.poolId) { step.workerPoolId = d.poolId; changed = true; } }
      if (d.resourceId && (overwrite || !step.resourceId)) {
        if (step.resourceId !== d.resourceId) {
          step.resourceId = d.resourceId; changed = true;
          const res = rb[d.resourceId];
          if (res && !U.num(step.processHours) && U.num(res.processHours)) step.processHours = res.processHours;
          if (res && U.num(res.lotSize) > 0 && !step.transferPerLot) step.transferPerLot = true;
        }
      }
      return changed;
    },
    /**
     * Create the standard resource groups (assembly workers, test workers, test chambers, curing chambers) if they do
     * not exist yet, and fill empty step-type defaults with them. Returns {created: [names], defaultsSet: n}.
     */
    addStandardResources() {
      const created = [];
      const ensure = (name, o) => { let r = this.resourceByName(name); if (!r) { r = this.addResource(Object.assign({ name }, o)); created.push(name); } return r; };
      const cal = this.calendar();
      const twoShiftName = 'Two shifts (test dept.)';
      let two = this.calendarByName(twoShiftName);
      if (!two) {
        const day = this.state.settings.shifts && this.state.settings.shifts[0] ? this.state.settings.shifts[0] : Calendar.legacyShift(this.state.settings);
        two = this.addCalendar({ name: twoShiftName, shifts: [
          { days: (day.days || [1, 2, 3, 4, 5]).slice(), start: day.start, end: day.end, breakStart: day.breakStart, breakMinutes: day.breakMinutes },
          { days: [1, 2, 3, 4], start: day.end || cal.endHHMM(), end: '23:00', breakStart: '', breakMinutes: 0 }
        ] });
        created.push('calendar "' + twoShiftName + '"');
      }
      const asm = ensure('Assembly workers', { type: 'labor', capacity: 4, lotSize: 0, notes: 'Day shift.' });
      const tst = ensure('Test workers', { type: 'labor', capacity: 2, lotSize: 0, calendarId: two.id, notes: 'Two shifts.' });
      const tch = ensure('Test chambers', { type: 'equipment', capacity: 2, lotSize: 4, processHours: 8, calendar: '24_7', notes: '2 chambers, 4 pcs each; automated cycles run unattended.' });
      const cch = ensure('Curing chambers', { type: 'equipment', capacity: 2, lotSize: 6, processHours: 12, calendar: '24_7', notes: '2 chambers, 6 fixtures each; curing runs overnight.' });
      const d = this.state.settings.defaultsByType || (this.state.settings.defaultsByType = {});
      const want = { assembly: { poolId: asm.id }, subassembly: { poolId: asm.id }, inspection: { poolId: asm.id }, packaging: { poolId: asm.id }, other: { poolId: asm.id },
                     bonding: { poolId: asm.id, resourceId: cch.id }, test: { poolId: tst.id, resourceId: tch.id } };
      let defaultsSet = 0;
      Object.keys(want).forEach(t => { d[t] = d[t] || {}; if (!d[t].poolId && want[t].poolId) { d[t].poolId = want[t].poolId; defaultsSet++; } if (!d[t].resourceId && want[t].resourceId) { d[t].resourceId = want[t].resourceId; defaultsSet++; } });
      return { created, defaultsSet };
    },
    /** Apply defaults to every step of every recipe (or one recipe). Returns number of steps changed. */
    applyDefaultsToAll(overwrite, recipeId) {
      let n = 0;
      this.state.recipes.forEach(r => { if (recipeId && r.id !== recipeId) return; r.steps.forEach(s => { if (this.applyDefaults(s, overwrite)) n++; }); });
      return n;
    },

    /* ---- recipes ---- */
    newStep(o) {
      return Object.assign({ id: U.uid('s'), nr: 10, name: '', type: 'assembly', outputPartId: null, components: [],
        workMinutes: 0, workers: 1, fixedMinutes: 0, processHours: 0, resourceId: null, lotSize: 0, workerPoolId: null, transferPerLot: false, yieldPct: 100, continuesPrevious: true, extraPreds: [], notes: '' }, o || {});
    },
    newRecipe(o) { return Object.assign({ id: U.uid('r'), name: '', finalPartId: null, deliverables: [], steps: [], notes: '' }, o || {}); },
    /** Mark a part as delivered separately with a quantity per product (0 removes it). */
    setDeliverable(recipe, partId, qtyPerProduct) {
      recipe.deliverables = (recipe.deliverables || []).filter(d => d.partId !== partId);
      if (U.num(qtyPerProduct) > 0) recipe.deliverables.push({ partId, qtyPerProduct: U.num(qtyPerProduct) });
    },
    addRecipe(o) { const r = this.newRecipe(o); this.state.recipes.push(r); return r; },
    recipe(id) { return this.state.recipes.find(r => r.id === id); },
    nextStepNr(recipe) { return recipe.steps.length ? Math.max.apply(null, recipe.steps.map(s => U.num(s.nr))) + 10 : 10; },
    renumberSteps(recipe) { recipe.steps.forEach((s, i) => { s.nr = (i + 1) * 10; }); },

    /* ---- plans ---- */
    newPlan(o) {
      const cal = this.calendar();
      const due = new Date(); due.setDate(due.getDate() + 21);
      return Object.assign({ id: U.uid('pl'), name: '', recipeId: null, qty: 10, dueDate: U.isoDate(due), dueTime: cal.endHHMM(),
        planStartDate: U.isoDate(new Date()), planStartTime: cal.startHHMM(), notes: '', milestones: [] }, o || {});
    },

    /* ---- backup ---- */
    exportJSON() { return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), parts: this.state.parts, resources: this.state.resources, calendars: this.state.calendars, stepTypes: this.state.stepTypes, recipes: this.state.recipes, plans: this.state.plans, settings: this.state.settings }, null, 2); },
    importJSON(obj, mode) {
      if (!obj || !Array.isArray(obj.parts)) throw new Error('Not a valid backup file (missing parts array).');
      this.snapshot(mode === 'replace' ? 'before restoring a backup (replace)' : 'before merging a backup');
      if (mode === 'replace') {
        this.state.parts = obj.parts || []; this.state.resources = obj.resources || []; this.state.calendars = obj.calendars || []; this.state.recipes = obj.recipes || []; this.state.plans = obj.plans || [];
        if (Array.isArray(obj.stepTypes) && obj.stepTypes.length) this.state.stepTypes = obj.stepTypes;
        if (obj.settings) this.state.settings = Object.assign({}, Calendar.DEFAULTS, obj.settings);
      } else {
        const byNr = {}; this.state.parts.forEach(p => { byNr[String(p.itemNr).toLowerCase()] = p; });
        const idMap = {};
        (obj.parts || []).forEach(p => {
          const ex = byNr[String(p.itemNr).toLowerCase()];
          if (ex) { Object.assign(ex, p, { id: ex.id }); idMap[p.id] = ex.id; }
          else { this.state.parts.push(p); idMap[p.id] = p.id; }
        });
        (obj.stepTypes || []).forEach(t => { if (t && t.id && !this.state.stepTypes.some(x => x.id === t.id)) this.state.stepTypes.push({ id: t.id, label: t.label || t.id, color: t.color || '#64748b' }); });
        const calMap = {};
        (obj.calendars || []).forEach(x => {
          const ex = this.calendarByName(x.name);
          if (ex) { Object.assign(ex, x, { id: ex.id }); calMap[x.id] = ex.id; } else { this.state.calendars.push(x); calMap[x.id] = x.id; }
        });
        const resMap = {};
        (obj.resources || []).forEach(x => {
          x.calendarId = calMap[x.calendarId] || x.calendarId || null;
          const ex = this.resourceByName(x.name);
          if (ex) { Object.assign(ex, x, { id: ex.id }); resMap[x.id] = ex.id; } else { this.state.resources.push(x); resMap[x.id] = x.id; }
        });
        (obj.recipes || []).forEach(r => {
          r.finalPartId = idMap[r.finalPartId] || r.finalPartId;
          r.steps.forEach(s => { s.resourceId = resMap[s.resourceId] || s.resourceId || null; s.workerPoolId = resMap[s.workerPoolId] || s.workerPoolId || null; });
          r.steps.forEach(s => { s.outputPartId = idMap[s.outputPartId] || s.outputPartId; (s.components || []).forEach(c => { c.partId = idMap[c.partId] || c.partId; }); });
          const ex = this.state.recipes.find(x => x.name === r.name);
          if (ex) Object.assign(ex, r, { id: ex.id }); else this.state.recipes.push(r);
        });
        (obj.plans || []).forEach(p => { if (!this.state.plans.find(x => x.id === p.id)) this.state.plans.push(p); });
      }
      this.migrate();
    },

    /** Empty workspace. Keeps the shop calendar and holidays; everything else is removed. */
    clearAll() {
      this.snapshot('before clear all data');
      const keep = Object.assign({}, this.state.settings, { defaultsByType: {}, stdResourcesSeeded: true });
      const types = this.state.stepTypes;
      this.state = this.blank();
      this.state.settings = keep;
      if (types && types.length) { this.state.stepTypes = types; Scheduler.setTypes(types); }
    },
    /** Does the workspace still contain demo objects? */
    hasDemoData() {
      const st = this.state;
      return st.recipes.some(r => r.demo || /^HA-200 hydraulic actuator$/i.test(r.name)) || st.plans.some(p => p.demo || /^Order 4711/i.test(p.name));
    },
    /**
     * Remove only the demo objects: the demo recipe and plan, then demo parts, resources and calendars that are no
     * longer used by anything. User-entered data is left untouched. Returns counts.
     */
    removeDemoData() {
      this.snapshot('before removing demo data');
      const st = this.state;
      const DEMO_NRS = /^(P-10(01|02|03|10|20|30|40)|P-20(01|02|03|04)|P-90(01|02|10)|S-300[1-4]|F-400[01])$/;
      const DEMO_RES = /^(Assembly workers|Test workers|Test chambers|Curing chambers|Bonding fixtures|Potting rack|Sensor test rig|Pressure test bench|Burn-in cabinet|Assemblers|Test technicians)$/i;
      const n = { recipes: 0, plans: 0, parts: 0, resources: 0, calendars: 0 };
      const isDemoRecipe = r => r.demo || /^HA-200 hydraulic actuator$/i.test(r.name);
      st.recipes = st.recipes.filter(r => { if (isDemoRecipe(r)) { n.recipes++; return false; } return true; });
      st.plans = st.plans.filter(p => { if (p.demo || /^Order 4711/i.test(p.name) || !st.recipes.some(r => r.id === p.recipeId)) { n.plans++; return false; } return true; });
      const usedParts = new Set(), usedRes = new Set();
      st.recipes.forEach(r => { if (r.finalPartId) usedParts.add(r.finalPartId); r.steps.forEach(s => { if (s.outputPartId) usedParts.add(s.outputPartId); (s.components || []).forEach(c => usedParts.add(c.partId)); if (s.resourceId) usedRes.add(s.resourceId); if (s.workerPoolId) usedRes.add(s.workerPoolId); }); });
      st.parts = st.parts.filter(p => { if ((p.demo || DEMO_NRS.test(p.itemNr)) && !usedParts.has(p.id)) { n.parts++; return false; } return true; });
      st.resources = st.resources.filter(r => { if ((r.demo || DEMO_RES.test(r.name)) && !usedRes.has(r.id)) { n.resources++; return false; } return true; });
      const usedCal = new Set(st.resources.map(r => r.calendarId).filter(Boolean));
      st.calendars = st.calendars.filter(c => { if ((c.demo || /^Two shifts \(test dept\.\)$/i.test(c.name)) && !usedCal.has(c.id)) { n.calendars++; return false; } return true; });
      const rb = this.resourcesById(); const d = st.settings.defaultsByType || {};
      Object.keys(d).forEach(t => { if (d[t].poolId && !rb[d[t].poolId]) d[t].poolId = null; if (d[t].resourceId && !rb[d[t].resourceId]) d[t].resourceId = null; });
      if (!st.recipes.some(r => r.id === st.ui.recipeId)) st.ui.recipeId = st.recipes.length ? st.recipes[0].id : null;
      if (!st.plans.some(p => p.id === st.ui.planId)) st.ui.planId = st.plans.length ? st.plans[0].id : null;
      return n;
    },
    /** Resources usable as process equipment / worker pools. */
    equipment() { return (this.state.resources || []).filter(r => r.type !== 'labor'); },
    laborPools() { return (this.state.resources || []).filter(r => r.type === 'labor'); },

    /* ---- demo ---- */
    loadDemo() {
      const st = this.state;
      const P = (itemNr, name, type, o) => { const p = this.addPart(Object.assign({ itemNr, name, type, demo: true }, o || {})); return p.id; };
      const hous = P('P-1001', 'Cylinder housing, machined', 'purchased', { leadTimeDays: 21, workMinutes: 0 });
      const rod = P('P-1002', 'Piston rod, chromed', 'purchased', { leadTimeDays: 14 });
      const pist = P('P-1003', 'Piston', 'purchased', { leadTimeDays: 10 });
      const seal = P('P-1010', 'Seal kit', 'purchased', { leadTimeDays: 5 });
      const glue = P('P-1020', 'Structural adhesive 2K', 'purchased', { leadTimeDays: 3 });
      const bear = P('P-1030', 'Guide bearing', 'purchased', { leadTimeDays: 7 });
      const pcb = P('P-2001', 'Position sensor PCB', 'purchased', { leadTimeDays: 28 });
      const magn = P('P-2002', 'Sensor magnet', 'purchased', { leadTimeDays: 7 });
      const cable = P('P-2003', 'Cable assembly M12', 'purchased', { leadTimeDays: 10 });
      const potting = P('P-2004', 'Potting compound', 'purchased', { leadTimeDays: 5 });
      const endcap = P('P-1040', 'End cap', 'purchased', { leadTimeDays: 14 });
      const bolts = P('P-9001', 'Bolt M8x30', 'purchased', { leadTimeDays: 2 });
      const oil = P('P-9002', 'Hydraulic oil 1 l', 'purchased', { leadTimeDays: 2 });
      const box = P('P-9010', 'Shipping box', 'purchased', { leadTimeDays: 3 });
      const rodA = P('S-3001', 'Rod sub-assembly (rod + piston)', 'manufactured', { workMinutes: 25 });
      const sensA = P('S-3002', 'Sensor module, potted', 'manufactured', { workMinutes: 20 });
      const sensT = P('S-3003', 'Sensor module, tested', 'manufactured');
      const cylA = P('S-3004', 'Cylinder assembly', 'manufactured', { workMinutes: 45 });
      const act = P('F-4000', 'Hydraulic actuator HA-200', 'manufactured', { workMinutes: 60 });
      const actT = P('F-4001', 'Hydraulic actuator HA-200, tested & packed', 'manufactured');

      const R = (o) => this.addResource(Object.assign({ demo: true }, o)).id;
      const twoShift = this.addCalendar({ name: 'Two shifts (test dept.)', demo: true, shifts: [
        { days: [1, 2, 3, 4, 5], start: '07:00', end: '15:30', breakStart: '11:00', breakMinutes: 30 },
        { days: [1, 2, 3, 4], start: '15:30', end: '23:00', breakStart: '19:00', breakMinutes: 30 }
      ] }).id;
      const assemblers = R({ name: 'Assembly workers', type: 'labor', capacity: 4, lotSize: 0, notes: 'Day shift.' });
      const testers = R({ name: 'Test workers', type: 'labor', capacity: 2, lotSize: 0, calendarId: twoShift, notes: 'Two shifts.' });
      const testChambers = R({ name: 'Test chambers', type: 'equipment', capacity: 2, lotSize: 4, processHours: 8, calendar: '24_7', notes: '2 chambers, 4 actuators each; automated cycles run unattended.' });
      const cureChambers = R({ name: 'Curing chambers', type: 'equipment', capacity: 2, lotSize: 6, processHours: 12, calendar: '24_7', notes: '2 chambers, 6 fixtures each; curing runs overnight.' });
      st.settings.defaultsByType = {
        assembly: { poolId: assemblers }, subassembly: { poolId: assemblers }, inspection: { poolId: assemblers }, packaging: { poolId: assemblers }, other: { poolId: assemblers },
        bonding: { poolId: assemblers, resourceId: cureChambers },
        test: { poolId: testers, resourceId: testChambers }
      };
      void assemblers; void testers; void testChambers; void cureChambers;

      const r = this.addRecipe({ name: 'HA-200 hydraulic actuator', demo: true, finalPartId: actT, notes: 'Demo recipe. Resources come from the step-type defaults: bonding steps cure in the curing chambers, test steps run in the test chambers with test workers, everything else uses assembly workers.' });
      const S = (o) => { const s = this.newStep(Object.assign({ continuesPrevious: false }, o)); this.applyDefaults(s, false); r.steps.push(s); return s.id; };
      const s10 = S({ nr: 10, name: 'Bond piston to rod', type: 'bonding', outputPartId: rodA, components: [{ partId: rod, qty: 1 }, { partId: pist, qty: 1 }, { partId: glue, qty: 0.05 }], workMinutes: 25, workers: 1, fixedMinutes: 5, processHours: 12, transferPerLot: true, notes: 'Adhesive cures 12 h in the curing chamber before handling.' });
      const s20 = S({ nr: 20, name: 'Pot sensor PCB with magnet & cable', type: 'bonding', outputPartId: sensA, components: [{ partId: pcb, qty: 1 }, { partId: magn, qty: 1 }, { partId: cable, qty: 1 }, { partId: potting, qty: 0.1 }], workMinutes: 20, workers: 1, fixedMinutes: 10, processHours: 24, transferPerLot: true, notes: 'Potting cures 24 h in the curing chamber.' });
      const s30 = S({ nr: 30, name: 'Sensor module electrical test', type: 'test', outputPartId: sensT, components: [{ partId: sensA, qty: 1 }], workMinutes: 3, workers: 1, fixedMinutes: 5, processHours: 0.5, transferPerLot: true, yieldPct: 95, notes: '3 min hook-up per module, then a 30 min automated test in the chamber. 5 % fail.' });
      const s40 = S({ nr: 40, name: 'Assemble cylinder (housing, rod sub-assy, seals, bearing)', type: 'subassembly', outputPartId: cylA, components: [{ partId: hous, qty: 1 }, { partId: rodA, qty: 1 }, { partId: seal, qty: 1 }, { partId: bear, qty: 2 }], workMinutes: 45, workers: 2, fixedMinutes: 20, processHours: 0, lotSize: 4, transferPerLot: true });
      const s50 = S({ nr: 50, name: 'Final assembly (cylinder + sensor + end cap)', type: 'assembly', outputPartId: act, components: [{ partId: cylA, qty: 1 }, { partId: sensT, qty: 1 }, { partId: endcap, qty: 1 }, { partId: bolts, qty: 8 }, { partId: oil, qty: 0.5 }], workMinutes: 60, workers: 2, fixedMinutes: 30, processHours: 0, lotSize: 4, transferPerLot: true });
      const s60 = S({ nr: 60, name: 'Pressure test 350 bar', type: 'test', outputPartId: act, components: [{ partId: act, qty: 1 }], workMinutes: 10, workers: 1, fixedMinutes: 10, processHours: 1, transferPerLot: true, yieldPct: 92, notes: '10 min mounting per actuator, 1 h pressure cycle per chamber load. 8 % fail and are scrapped.' });
      const s70 = S({ nr: 70, name: 'Burn-in cycling 8 h', type: 'test', outputPartId: act, components: [{ partId: act, qty: 1 }], workMinutes: 5, workers: 1, fixedMinutes: 10, processHours: 8, transferPerLot: true, extraPreds: [s60], notes: 'Chamber takes 4 actuators per unattended 8 h cycle.' });
      const s80 = S({ nr: 80, name: 'Final inspection & packaging', type: 'packaging', outputPartId: actT, components: [{ partId: act, qty: 1 }, { partId: box, qty: 1 }], workMinutes: 15, workers: 1, fixedMinutes: 0, processHours: 0, extraPreds: [s70] });
      void s10; void s20; void s30; void s40; void s50; void s80;

      const plan = this.newPlan({ name: 'Order 4711 – 12 pcs HA-200', recipeId: r.id, qty: 12, demo: true });
      st.plans.push(plan);
      st.ui.recipeId = r.id; st.ui.planId = plan.id;
    }
  };

  root.Store = Store;
})(window);
