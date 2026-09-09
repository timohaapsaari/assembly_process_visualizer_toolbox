/* Application state, persistence (localStorage), demo data. */
(function (root) {
  'use strict';
  const U = root.U, Calendar = root.Calendar;
  const KEY = 'apv.state.v1';

  const Store = {
    state: null,
    listeners: [],

    blank() {
      return {
        version: 1,
        parts: [],
        resources: [],
        calendars: [],
        recipes: [],
        plans: [],
        settings: Object.assign({}, Calendar.DEFAULTS, { holidays: [] }),
        ui: { tab: 'plan', recipeId: null, planId: null, ganttMode: 'jit', zoom: 1 }
      };
    },

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) { this.state = Object.assign(this.blank(), JSON.parse(raw)); }
      } catch (e) { console.warn('state load failed', e); }
      if (!this.state) { this.state = this.blank(); this.loadDemo(); }
      this.state.settings = Object.assign({}, Calendar.DEFAULTS, this.state.settings || {});
      this.migrate();
      return this.state;
    },

    /** Upgrade older saved states in place. */
    migrate() {
      const st = this.state;
      if (!Array.isArray(st.resources)) st.resources = [];
      if (!Array.isArray(st.calendars)) st.calendars = [];
      if (!Array.isArray(st.settings.shifts) || !st.settings.shifts.length) st.settings.shifts = [Calendar.legacyShift(st.settings)];
      st.resources.forEach(r => { if (r.calendarId === undefined) r.calendarId = null; });
      (st.recipes || []).forEach(r => (r.steps || []).forEach(s => {
        if (s.processHours == null) { s.processHours = U.num(s.cureHours, 0); }
        delete s.cureHours;
        if (s.lotSize == null) s.lotSize = 0;
        if (s.resourceId === undefined) s.resourceId = null;
        if (s.workerPoolId === undefined) s.workerPoolId = null;
        if (s.transferPerLot === undefined) s.transferPerLot = false;
        if (s.yieldPct == null) s.yieldPct = 100;
      }));
    },

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { console.warn('save failed', e); }
      this.listeners.forEach(fn => fn(this.state));
    },
    onChange(fn) { this.listeners.push(fn); },

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

    /* ---- recipes ---- */
    newStep(o) {
      return Object.assign({ id: U.uid('s'), nr: 10, name: '', type: 'assembly', outputPartId: null, components: [],
        workMinutes: 0, workers: 1, fixedMinutes: 0, processHours: 0, resourceId: null, lotSize: 0, workerPoolId: null, transferPerLot: false, yieldPct: 100, extraPreds: [], notes: '' }, o || {});
    },
    newRecipe(o) { return Object.assign({ id: U.uid('r'), name: '', finalPartId: null, steps: [], notes: '' }, o || {}); },
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
    exportJSON() { return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), parts: this.state.parts, resources: this.state.resources, calendars: this.state.calendars, recipes: this.state.recipes, plans: this.state.plans, settings: this.state.settings }, null, 2); },
    importJSON(obj, mode) {
      if (!obj || !Array.isArray(obj.parts)) throw new Error('Not a valid backup file (missing parts array).');
      if (mode === 'replace') {
        this.state.parts = obj.parts || []; this.state.resources = obj.resources || []; this.state.calendars = obj.calendars || []; this.state.recipes = obj.recipes || []; this.state.plans = obj.plans || [];
        if (obj.settings) this.state.settings = Object.assign({}, Calendar.DEFAULTS, obj.settings);
      } else {
        const byNr = {}; this.state.parts.forEach(p => { byNr[String(p.itemNr).toLowerCase()] = p; });
        const idMap = {};
        (obj.parts || []).forEach(p => {
          const ex = byNr[String(p.itemNr).toLowerCase()];
          if (ex) { Object.assign(ex, p, { id: ex.id }); idMap[p.id] = ex.id; }
          else { this.state.parts.push(p); idMap[p.id] = p.id; }
        });
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

    clearAll() { this.state = this.blank(); },
    /** Resources usable as process equipment / worker pools. */
    equipment() { return (this.state.resources || []).filter(r => r.type !== 'labor'); },
    laborPools() { return (this.state.resources || []).filter(r => r.type === 'labor'); },

    /* ---- demo ---- */
    loadDemo() {
      const st = this.state;
      const P = (itemNr, name, type, o) => { const p = this.addPart(Object.assign({ itemNr, name, type }, o || {})); return p.id; };
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

      const R = (o) => this.addResource(o).id;
      const fixtures = R({ name: 'Bonding fixtures', type: 'equipment', capacity: 6, lotSize: 1, processHours: 12, calendar: '24_7', notes: 'One rod per fixture, 12 h cure at room temperature.' });
      const rack = R({ name: 'Potting rack', type: 'equipment', capacity: 1, lotSize: 8, processHours: 24, calendar: '24_7' });
      const testRig = R({ name: 'Sensor test rig', type: 'equipment', capacity: 1, lotSize: 1, processHours: 0.25, calendar: 'shop' });
      const bench = R({ name: 'Pressure test bench', type: 'equipment', capacity: 1, lotSize: 1, processHours: 0.5, calendar: 'shop' });
      const burnin = R({ name: 'Burn-in cabinet', type: 'equipment', capacity: 1, lotSize: 4, processHours: 8, calendar: '24_7', notes: '4 actuators per 8 h cycle.' });
      const twoShift = this.addCalendar({ name: 'Two shifts (test dept.)', shifts: [
        { days: [1, 2, 3, 4, 5], start: '07:00', end: '15:30', breakStart: '11:00', breakMinutes: 30 },
        { days: [1, 2, 3, 4], start: '15:30', end: '23:00', breakStart: '19:00', breakMinutes: 30 }
      ] }).id;
      const assemblers = R({ name: 'Assemblers', type: 'labor', capacity: 3 });
      const testers = R({ name: 'Test technicians', type: 'labor', capacity: 1, calendarId: twoShift });

      const r = this.addRecipe({ name: 'HA-200 hydraulic actuator', finalPartId: actT, notes: 'Demo recipe: bonding on 6 fixtures with 12 h cure, potting rack with 24 h cure, pressure test bench, burn-in cabinet 4 pcs per 8 h.' });
      const S = (o) => { const s = this.newStep(o); r.steps.push(s); return s.id; };
      const s10 = S({ nr: 10, name: 'Bond piston to rod', type: 'bonding', outputPartId: rodA, components: [{ partId: rod, qty: 1 }, { partId: pist, qty: 1 }, { partId: glue, qty: 0.05 }], workMinutes: 25, workers: 1, fixedMinutes: 5, processHours: 12, resourceId: fixtures, workerPoolId: assemblers, transferPerLot: true, notes: 'One rod per fixture; adhesive cures 12 h at room temperature before handling.' });
      const s20 = S({ nr: 20, name: 'Pot sensor PCB with magnet & cable', type: 'bonding', outputPartId: sensA, components: [{ partId: pcb, qty: 1 }, { partId: magn, qty: 1 }, { partId: cable, qty: 1 }, { partId: potting, qty: 0.1 }], workMinutes: 20, workers: 1, fixedMinutes: 10, processHours: 24, resourceId: rack, workerPoolId: assemblers, transferPerLot: true, notes: 'Rack holds 8 modules per 24 h cure.' });
      const s30 = S({ nr: 30, name: 'Sensor module electrical test', type: 'test', outputPartId: sensT, components: [{ partId: sensA, qty: 1 }], workMinutes: 3, workers: 1, fixedMinutes: 0, processHours: 0.25, resourceId: testRig, workerPoolId: testers, transferPerLot: true, yieldPct: 95, notes: '3 min hook-up per module, then 15 min automated test on the rig. 5 % fail.' });
      const s40 = S({ nr: 40, name: 'Assemble cylinder (housing, rod sub-assy, seals, bearing)', type: 'subassembly', outputPartId: cylA, components: [{ partId: hous, qty: 1 }, { partId: rodA, qty: 1 }, { partId: seal, qty: 1 }, { partId: bear, qty: 2 }], workMinutes: 45, workers: 2, fixedMinutes: 20, processHours: 0, workerPoolId: assemblers, lotSize: 4, transferPerLot: true });
      const s50 = S({ nr: 50, name: 'Final assembly (cylinder + sensor + end cap)', type: 'assembly', outputPartId: act, components: [{ partId: cylA, qty: 1 }, { partId: sensT, qty: 1 }, { partId: endcap, qty: 1 }, { partId: bolts, qty: 8 }, { partId: oil, qty: 0.5 }], workMinutes: 60, workers: 2, fixedMinutes: 30, processHours: 0, workerPoolId: assemblers, lotSize: 4, transferPerLot: true });
      const s60 = S({ nr: 60, name: 'Pressure test 350 bar', type: 'test', outputPartId: act, components: [{ partId: act, qty: 1 }], workMinutes: 10, workers: 1, fixedMinutes: 0, processHours: 0.5, resourceId: bench, workerPoolId: testers, transferPerLot: true, yieldPct: 92, notes: '10 min mounting, 30 min automated pressure cycle per actuator. 8 % fail and are scrapped.' });
      const s70 = S({ nr: 70, name: 'Burn-in cycling 8 h', type: 'test', outputPartId: act, components: [{ partId: act, qty: 1 }], workMinutes: 5, workers: 1, fixedMinutes: 10, processHours: 8, resourceId: burnin, workerPoolId: testers, transferPerLot: true, extraPreds: [s60], notes: 'Cabinet takes 4 actuators per unattended 8 h cycle.' });
      const s80 = S({ nr: 80, name: 'Final inspection & packaging', type: 'packaging', outputPartId: actT, components: [{ partId: act, qty: 1 }, { partId: box, qty: 1 }], workMinutes: 15, workers: 1, fixedMinutes: 0, processHours: 0, workerPoolId: assemblers, extraPreds: [s70] });
      void s10; void s20; void s30; void s40; void s50; void s80;

      const plan = this.newPlan({ name: 'Order 4711 – 12 pcs HA-200', recipeId: r.id, qty: 12 });
      st.plans.push(plan);
      st.ui.recipeId = r.id; st.ui.planId = plan.id;
    }
  };

  root.Store = Store;
})(window);
