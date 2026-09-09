/* Shop working calendar: shifts, breaks, workdays, holidays. Browser + Node. */
(function (root) {
  'use strict';
  const U = (typeof module !== 'undefined' && module.exports) ? require('./util.js') : root.U;

  const DEFAULTS = {
    workdays: [1, 2, 3, 4, 5],       // 0=Sun .. 6=Sat
    shiftStart: '07:00',
    shiftEnd: '15:30',
    breakStart: '11:00',
    breakMinutes: 30,
    holidays: [],                    // ['2026-12-24', ...]
    cureUsesCalendar: true,          // curing runs 24/7 (true) or only during working time (false)
    maxWorkers: 0                    // 0 = no limit check
  };

  function hm(s, def) {
    const m = String(s || def).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return (+m[1]) * 60 + (+m[2]);
  }

  /** Normalise one shift definition {days, start, end, breakStart, breakMinutes} into minute offsets. */
  function normShift(sh) {
    const start = hm(sh.start, DEFAULTS.shiftStart) ?? 420;
    let end = hm(sh.end, DEFAULTS.shiftEnd) ?? 930;
    if (end <= start) end = start + 480;
    const brk = hm(sh.breakStart, null);
    const brkLen = Math.max(0, U.num(sh.breakMinutes, 0));
    return { days: new Set((sh.days || []).map(Number)), start, end, brk: brk != null && brkLen > 0 && brk > start && brk + brkLen < end ? brk : null, brkLen };
  }

  /**
   * settings: { workdays, shiftStart, shiftEnd, breakStart, breakMinutes, holidays, cureUsesCalendar, shifts? }
   * When `shifts` (array of {days, start, end, breakStart, breakMinutes}) is given it defines the working windows;
   * otherwise the single legacy shift from workdays/shiftStart/shiftEnd is used.
   */
  function Calendar(settings) {
    this.s = Object.assign({}, DEFAULTS, settings || {});
    const legacy = { days: this.s.workdays, start: this.s.shiftStart, end: this.s.shiftEnd, breakStart: this.s.breakStart, breakMinutes: this.s.breakMinutes };
    const defs = Array.isArray(this.s.shifts) && this.s.shifts.length ? this.s.shifts : [legacy];
    this.shifts = defs.map(normShift);
    const first = this.shifts[0];
    this.start = Math.min.apply(null, this.shifts.map(x => x.start));
    this.end = Math.max.apply(null, this.shifts.map(x => x.end));
    this.brk = first.brk; this.brkLen = first.brkLen;
    this.hol = new Set((this.s.holidays || []).map(h => String(h).trim()).filter(Boolean));
    this.workdays = new Set();
    this.shifts.forEach(sh => sh.days.forEach(d => this.workdays.add(d)));
  }

  Calendar.DEFAULTS = DEFAULTS;
  /** Shift definitions as plain objects (for UI / persistence). */
  Calendar.legacyShift = s => ({ days: (s.workdays || DEFAULTS.workdays).slice(), start: s.shiftStart || DEFAULTS.shiftStart, end: s.shiftEnd || DEFAULTS.shiftEnd, breakStart: s.breakStart || '', breakMinutes: U.num(s.breakMinutes, 0) });

  Calendar.prototype.isWorkingDay = function (d) {
    return this.workdays.has(d.getDay()) && !this.hol.has(U.isoDate(d));
  };

  Calendar.prototype.hasWorkdays = function () { return this.workdays.size > 0; };

  /** Working windows for the given day as [{a: Date, b: Date}], sorted and merged. */
  Calendar.prototype.windows = function (d) {
    if (!this.isWorkingDay(d)) return [];
    const base = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const at = m => new Date(base.getTime() + m * 60000);
    const raw = [];
    const dow = d.getDay();
    this.shifts.forEach(sh => {
      if (!sh.days.has(dow)) return;
      if (sh.brk != null) { raw.push([sh.start, sh.brk]); raw.push([sh.brk + sh.brkLen, sh.end]); }
      else raw.push([sh.start, sh.end]);
    });
    raw.sort((x, y) => x[0] - y[0]);
    const merged = [];
    raw.forEach(w => { const last = merged[merged.length - 1]; if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]); else merged.push(w.slice()); });
    return merged.map(w => ({ a: at(w[0]), b: at(w[1]) }));
  };

  /** Working minutes on a given date. */
  Calendar.prototype.minutesOn = function (d) {
    return this.windows(d).reduce((a, w) => a + (w.b - w.a) / 60000, 0);
  };

  /** Average working minutes per working day over a week (Mon 2029-01-01 base, ignoring holidays). */
  Calendar.prototype.minutesPerDay = function () {
    let total = 0, n = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(2029, 0, 1 + i); // 2029-01-01 is a Monday; no holidays assumed in this probe
      if (!this.workdays.has(d.getDay())) continue;
      const base = new Date(d); const save = this.hol; this.hol = new Set();
      total += this.minutesOn(base); n++;
      this.hol = save;
    }
    return n ? total / n : 0;
  };
  /** Default shift end / start as "HH:MM" strings (first shift definition). */
  Calendar.prototype.endHHMM = function () { const m = this.shifts[0].end; return U.pad2(Math.floor(m / 60)) + ':' + U.pad2(m % 60); };
  Calendar.prototype.startHHMM = function () { const m = this.shifts[0].start; return U.pad2(Math.floor(m / 60)) + ':' + U.pad2(m % 60); };

  function nextDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0); }
  function prevDayEnd(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, -1); }

  /** Earliest working instant >= t. */
  Calendar.prototype.snapForward = function (t) {
    if (!this.hasWorkdays()) return new Date(t);
    let cur = new Date(t);
    for (let guard = 0; guard < 4000; guard++) {
      const wins = this.windows(cur);
      for (const w of wins) {
        if (cur < w.a) return new Date(w.a);
        if (cur >= w.a && cur < w.b) return new Date(cur);
      }
      cur = nextDay(cur);
    }
    return new Date(t);
  };

  /** Latest working instant <= t. */
  Calendar.prototype.snapBackward = function (t) {
    if (!this.hasWorkdays()) return new Date(t);
    let cur = new Date(t);
    for (let guard = 0; guard < 4000; guard++) {
      const wins = this.windows(cur).slice().reverse();
      for (const w of wins) {
        if (cur > w.b) return new Date(w.b);
        if (cur > w.a && cur <= w.b) return new Date(cur);
      }
      cur = prevDayEnd(cur);
    }
    return new Date(t);
  };

  /** Add working minutes forward from t. */
  Calendar.prototype.addWorking = function (t, minutes) {
    if (!this.hasWorkdays()) return new Date(t.getTime() + minutes * 60000);
    let cur = this.snapForward(t);
    let left = minutes;
    for (let guard = 0; guard < 4000; guard++) {
      const wins = this.windows(cur);
      for (const w of wins) {
        if (cur >= w.b) continue;
        const from = cur > w.a ? cur : w.a;
        const avail = (w.b - from) / 60000;
        if (left <= avail + 1e-9) return new Date(from.getTime() + left * 60000);
        left -= avail;
        cur = new Date(w.b);
      }
      cur = nextDay(cur);
    }
    return cur;
  };

  /** Subtract working minutes backward from t. */
  Calendar.prototype.subtractWorking = function (t, minutes) {
    if (!this.hasWorkdays()) return new Date(t.getTime() - minutes * 60000);
    let cur = this.snapBackward(t);
    let left = minutes;
    for (let guard = 0; guard < 4000; guard++) {
      const wins = this.windows(cur).slice().reverse();
      for (const w of wins) {
        if (cur <= w.a) continue;
        const to = cur < w.b ? cur : w.b;
        const avail = (to - w.a) / 60000;
        if (left <= avail + 1e-9) return new Date(to.getTime() - left * 60000);
        left -= avail;
        cur = new Date(w.a);
      }
      cur = prevDayEnd(cur);
    }
    return cur;
  };

  /** Working minutes between a and b (a <= b). */
  Calendar.prototype.workingMinutesBetween = function (a, b) {
    if (b <= a) return 0;
    if (!this.hasWorkdays()) return (b - a) / 60000;
    let total = 0;
    let cur = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 0, 0, 0, 0);
    for (let guard = 0; guard < 4000 && cur < b; guard++) {
      for (const w of this.windows(cur)) {
        const s = w.a > a ? w.a : a, e = w.b < b ? w.b : b;
        if (e > s) total += (e - s) / 60000;
      }
      cur = nextDay(cur);
    }
    return total;
  };

  /** Add calendar (24/7) hours, or working hours if cure follows the shop calendar. */
  Calendar.prototype.addCure = function (t, hours) {
    if (!hours) return new Date(t);
    if (this.s.cureUsesCalendar) return new Date(t.getTime() + hours * 3600000);
    return this.addWorking(t, hours * 60);
  };
  Calendar.prototype.subtractCure = function (t, hours) {
    if (!hours) return new Date(t);
    if (this.s.cureUsesCalendar) return new Date(t.getTime() - hours * 3600000);
    return this.subtractWorking(t, hours * 60);
  };

  /** End of the last shift on the given date (used as default due time). */
  Calendar.prototype.shiftEndOn = function (d) {
    const w = this.windows(d);
    return w.length ? new Date(w[w.length - 1].b) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, this.end, 0, 0);
  };
  Calendar.prototype.shiftStartOn = function (d) {
    const w = this.windows(d);
    return w.length ? new Date(w[0].a) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, this.start, 0, 0);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calendar;
  else root.Calendar = Calendar;
})(typeof window !== 'undefined' ? window : globalThis);
