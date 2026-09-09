/* Calendar & settings tab. */
(function (root) {
  'use strict';
  const U = root.U, UI = root.UI, Store = root.Store, Calendar = root.Calendar;
  const SettingsUI = {};
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  SettingsUI.render = function () {
    const host = document.getElementById('tab-settings');
    const s = Store.state.settings;
    host.innerHTML = '';
    const panel = UI.el('<div class="grid-2">' +
      '<div class="panel"><div class="panel-head"><h2>Shop calendar</h2></div>' +
      '<p class="muted small">Work time (setup and per-unit labor) is scheduled only inside these working hours. Curing and wait times run on calendar time by default (24/7), like paint drying over a weekend.</p>' +
      '<div class="form-row"><label class="f"><span>Working days</span><div class="flex" id="wd"></div></label></div>' +
      '<div class="form-row">' +
      '<label class="f"><span>Shift start</span><input type="time" id="s-start" value="' + UI.esc(s.shiftStart) + '"></label>' +
      '<label class="f"><span>Shift end</span><input type="time" id="s-end" value="' + UI.esc(s.shiftEnd) + '"></label>' +
      '<label class="f"><span>Break start</span><input type="time" id="s-brk" value="' + UI.esc(s.breakStart || '') + '"></label>' +
      '<label class="f"><span>Break length (min)</span><input type="number" id="s-brklen" min="0" value="' + U.num(s.breakMinutes) + '"></label>' +
      '</div>' +
      '<div class="form-row"><label class="check"><input type="checkbox" id="s-cure" ' + (s.cureUsesCalendar ? 'checked' : '') + '> Process / cure time of steps without a resource runs 24/7 (calendar time)</label></div>' +
      '<div class="form-row"><label class="f"><span>General worker pool size (steps without a worker pool; 0 = no check)</span><input type="number" id="s-max" min="0" value="' + U.num(s.maxWorkers) + '"></label></div>' +
      '<div class="muted small" id="s-summary"></div>' +
      '</div>' +
      '<div class="panel"><div class="panel-head"><h2>Holidays / non-working days</h2></div>' +
      '<p class="muted small">One date per line (YYYY-MM-DD). Also accepts 24.12.2026.</p>' +
      '<textarea id="s-hol" style="min-height:180px" class="mono">' + UI.esc((s.holidays || []).join('\n')) + '</textarea>' +
      '<div class="flex mt"><button class="btn btn-sm" id="s-fi">Add Finnish public holidays (this &amp; next year)</button></div>' +
      '<hr style="border:0;border-top:1px solid var(--border);margin:14px 0">' +
      '<div class="panel-head"><h3>Data</h3></div>' +
      '<div class="flex"><button class="btn btn-sm" id="s-demo">Load demo data</button><button class="btn btn-sm btn-danger" id="s-clear">Clear all data</button></div>' +
      '<p class="muted small mt">Data is stored in this browser (localStorage). Use Import / Export to back up as JSON or CSV.</p>' +
      '</div></div>');
    host.appendChild(panel);

    const wd = panel.querySelector('#wd');
    DAYS.forEach((d, i) => {
      const l = UI.el('<label class="check"><input type="checkbox" value="' + i + '" ' + ((s.workdays || []).indexOf(i) >= 0 ? 'checked' : '') + '> ' + d + '</label>');
      l.querySelector('input').addEventListener('change', () => {
        s.workdays = Array.from(wd.querySelectorAll('input:checked')).map(x => +x.value);
        Store.save(); summary();
      });
      wd.appendChild(l);
    });
    const summary = () => {
      const cal = Store.calendar();
      panel.querySelector('#s-summary').textContent = 'Net working time per day: ' + U.minutesToText(cal.minutesPerDay()) + ' · ' + (s.workdays || []).length + ' working days per week · ' + (s.holidays || []).length + ' holidays';
    };
    UI.bind(panel.querySelector('#s-start'), s, 'shiftStart', 'text', summary);
    UI.bind(panel.querySelector('#s-end'), s, 'shiftEnd', 'text', summary);
    UI.bind(panel.querySelector('#s-brk'), s, 'breakStart', 'text', summary);
    UI.bind(panel.querySelector('#s-brklen'), s, 'breakMinutes', 'num', summary);
    UI.bind(panel.querySelector('#s-cure'), s, 'cureUsesCalendar');
    UI.bind(panel.querySelector('#s-max'), s, 'maxWorkers', 'int');
    const hol = panel.querySelector('#s-hol');
    hol.addEventListener('input', UI.debounce(() => {
      s.holidays = hol.value.split(/\n/).map(x => x.trim()).filter(Boolean).map(x => { const d = U.parseLocal(x); return d ? U.isoDate(d) : x; });
      Store.save(); summary();
    }, 300));
    panel.querySelector('#s-fi').addEventListener('click', () => {
      const y = new Date().getFullYear();
      const add = [];
      [y, y + 1].forEach(yy => add.push.apply(add, SettingsUI.finnishHolidays(yy)));
      s.holidays = Array.from(new Set((s.holidays || []).concat(add))).sort();
      hol.value = s.holidays.join('\n'); Store.save(); summary();
    });
    panel.querySelector('#s-demo').addEventListener('click', async () => {
      if (await UI.confirm('Add the demo parts, recipe and plan to your data?', 'Load demo')) { Store.loadDemo(); Store.save(); UI.toast('Demo data loaded', 'ok'); root.App.showTab('plan'); }
    });
    panel.querySelector('#s-clear').addEventListener('click', async () => {
      if (await UI.confirm('Delete ALL parts, recipes and plans from this browser? Export a backup first if needed.', 'Delete everything')) { Store.clearAll(); Store.save(); UI.toast('All data cleared'); root.App.showTab('plan'); }
    });
    summary();
  };

  /** Finnish public holidays for a year (Easter-based dates computed). */
  SettingsUI.finnishHolidays = function (y) {
    const easter = (() => { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); })();
    const off = n => { const d = new Date(easter); d.setDate(d.getDate() + n); return U.isoDate(d); };
    const list = [y + '-01-01', y + '-01-06', off(-2), off(1), y + '-05-01', off(39), y + '-12-06', y + '-12-24', y + '-12-25', y + '-12-26'];
    // Midsummer Eve: Friday between Jun 19-25
    for (let d = 19; d <= 25; d++) { const dt = new Date(y, 5, d); if (dt.getDay() === 5) { list.push(U.isoDate(dt)); break; } }
    return list;
  };

  root.SettingsUI = SettingsUI;
})(window);
