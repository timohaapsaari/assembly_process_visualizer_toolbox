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

  function Calendar(settings) {
    this.s = Object.assign({}, DEFAULTS, settings || {});
    this.start = hm(this.s.shiftStart, DEFAULTS.shiftStart) ?? 420;
    this.end = hm(this.s.shiftEnd, DEFAULTS.shiftEnd) ?? 930;
    if (this.end <= this.start) this.end = this.start + 480;
    this.brk = hm(this.s.breakStart, DEFAULTS.breakStart);
    this.brkLen = Math.max(0, U.num(this.s.breakMinutes, 0));
    this.hol = new Set((this.s.holidays || []).map(h => String(h).trim()).filter(Boolean));
    this.workdays = new Set((this.s.workdays || []).map(Number));
  }

  Calendar.DEFAULTS = DEFAULTS;

  Calendar.prototype.isWorkingDay = function (d) {
    return this.workdays.has(d.getDay()) && !this.hol.has(U.isoDate(d));
  };

  Calendar.prototype.hasWorkdays = function () { return this.workdays.size > 0; };

  /** Working windows for the given day as [{a: Date, b: Date}], in order. */
  Calendar.prototype.windows = function (d) {
    if (!this.isWorkingDay(d)) return [];
    const base = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const at = m => new Date(base.getTime() + m * 60000);
    const wins = [];
    if (this.brk != null && this.brkLen > 0 && this.brk > this.start && this.brk + this.brkLen < this.end) {
      wins.push({ a: at(this.start), b: at(this.brk) });
      wins.push({ a: at(this.brk + this.brkLen), b: at(this.end) });
    } else {
      wins.push({ a: at(this.start), b: at(this.end) });
    }
    return wins;
  };

  Calendar.prototype.minutesPerDay = function () {
    let m = this.end - this.start;
    if (this.brk != null && this.brkLen > 0 && this.brk > this.start && this.brk + this.brkLen < this.end) m -= this.brkLen;
    return m;
  };

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

  /** End of the shift on the given date (used as default due time). */
  Calendar.prototype.shiftEndOn = function (d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, this.end, 0, 0);
  };
  Calendar.prototype.shiftStartOn = function (d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, this.start, 0, 0);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calendar;
  else root.Calendar = Calendar;
})(typeof window !== 'undefined' ? window : globalThis);
