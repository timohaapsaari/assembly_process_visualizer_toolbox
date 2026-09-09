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
      '<p class="muted small">Attended work is scheduled only inside these shifts. Worker pools and shop-hours equipment can use a different named calendar (below), e.g. a two-shift test department. Process and cure times on 24/7 equipment run through nights and weekends.</p>' +
      '<div id="s-shifts"></div>' +
      '<div class="form-row"><label class="check"><input type="checkbox" id="s-cure" ' + (s.cureUsesCalendar ? 'checked' : '') + '> Process / cure time of steps without a resource runs 24/7 (calendar time)</label></div>' +
      '<div class="form-row"><label class="f"><span>General worker pool size (steps without a worker pool; 0 = no check)</span><input type="number" id="s-max" min="0" value="' + U.num(s.maxWorkers) + '"></label></div>' +
      '<div class="muted small" id="s-summary"></div>' +
      '</div>' +
      '<div class="panel"><div class="panel-head"><h2>Named calendars</h2><span class="spacer"></span><button class="btn btn-sm btn-primary" id="c-add">+ Calendar</button></div>' +
      '<p class="muted small">Additional shift patterns for worker pools and shop-hours equipment, e.g. "Two shifts" or "Weekend crew". Holidays apply to all calendars. Assign them on the Resources tab.</p>' +
      '<div id="c-list"></div></div>' +
      '<div class="panel"><div class="panel-head"><h2>Step types</h2><span class="spacer"></span><button class="btn btn-sm btn-primary" id="t-add">+ Step type</button></div>' +
      '<p class="muted small">Categories for recipe steps: colour in the Gantt and network, and the row in "Defaults by step type" on the Resources tab. The type does not change scheduling; times, resources, yield and parts do.</p>' +
      '<div id="t-list"></div></div>' +
      '<div class="panel"><div class="panel-head"><h2>Holidays / non-working days</h2></div>' +
      '<p class="muted small">One date per line (YYYY-MM-DD). Also accepts 24.12.2026.</p>' +
      '<textarea id="s-hol" style="min-height:180px" class="mono">' + UI.esc((s.holidays || []).join('\n')) + '</textarea>' +
      '<div class="flex mt"><button class="btn btn-sm" id="s-fi">Add Finnish public holidays (this &amp; next year)</button></div>' +
      '<hr style="border:0;border-top:1px solid var(--border);margin:14px 0">' +
      '<div class="panel-head"><h3>Data</h3></div>' +
      '<div class="flex"><button class="btn btn-sm" id="s-demo">Replace with demo data</button><button class="btn btn-sm btn-danger" id="s-clear">Clear all data</button></div>' +
      '<p class="muted small mt">Data is stored in this browser (localStorage). Use Import / Export to back up as JSON or CSV.</p>' +
      '</div></div>');
    host.appendChild(panel);

    const summary = () => {
      const cal = Store.calendar();
      panel.querySelector('#s-summary').textContent = 'Average working time per working day: ' + U.minutesToText(cal.minutesPerDay()) + ' · ' + cal.workdays.size + ' working days per week · ' + (s.holidays || []).length + ' holidays';
    };
    const syncLegacy = () => { const f = s.shifts[0]; if (f) { s.workdays = f.days.slice(); s.shiftStart = f.start; s.shiftEnd = f.end; s.breakStart = f.breakStart; s.breakMinutes = f.breakMinutes; } };
    if (!Array.isArray(s.shifts) || !s.shifts.length) s.shifts = [Calendar.legacyShift(s)];
    SettingsUI.shiftEditor(panel.querySelector('#s-shifts'), s.shifts, () => { syncLegacy(); Store.save(); summary(); }, true);
    SettingsUI.renderCalendars(panel.querySelector('#c-list'));
    SettingsUI.renderStepTypes(panel.querySelector('#t-list'));
    panel.querySelector('#t-add').addEventListener('click', () => {
      const box = UI.modal('<h2>New step type</h2><div class="form-row"><label class="f grow"><span>Name</span><input type="text" id="nt-name" style="width:100%" placeholder="e.g. Potting, Calibration, Leak test"></label><label class="f"><span>Colour</span><input type="color" id="nt-color" value="#0ea5e9"></label></div><div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="nt-ok">Add</button></div>');
      const ok = () => { const name = box.querySelector('#nt-name').value.trim(); if (!name) { UI.toast('Name is required', 'err'); return; } Store.addStepType(name, box.querySelector('#nt-color').value); Store.save(); UI.closeModal(); SettingsUI.renderStepTypes(panel.querySelector('#t-list')); };
      box.querySelector('#nt-ok').addEventListener('click', ok);
      box.querySelector('#nt-name').addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      box.querySelector('#nt-name').focus();
    });
    panel.querySelector('#c-add').addEventListener('click', () => { Store.addCalendar({ name: 'Calendar ' + (Store.state.calendars.length + 1) }); Store.save(); SettingsUI.renderCalendars(panel.querySelector('#c-list')); });
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
      if (await UI.confirm('Replace ALL current data with the demo (parts, resources, calendars, recipe, plan)? Export a backup first if you want to keep your data.', 'Replace with demo')) { Store.clearAll(); Store.loadDemo(); Store.state.settings.cleanupOffered = true; Store.save(); UI.toast('Demo data loaded', 'ok'); root.App.showTab('plan'); }
    });
    panel.querySelector('#s-clear').addEventListener('click', async () => {
      if (await UI.confirm('Delete ALL parts, resources, calendars, recipes and plans from this browser? The shop calendar and holidays are kept. Export a backup first if needed.', 'Delete everything')) { Store.clearAll(); Store.save(); UI.toast('Workspace cleared. Start with Resources and Parts.', 'ok', 5000); root.App.showTab('resources'); }
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

  /** Editable list of shift rows for a `shifts` array. onChange() after every edit. */
  SettingsUI.shiftEditor = function (host, shifts, onChange, keepOne) {
    host.innerHTML = '';
    shifts.forEach((sh, i) => {
      const row = UI.el('<div class="form-row" style="margin-bottom:6px;align-items:flex-end">' +
        '<label class="f"><span>Shift ' + (i + 1) + ' days</span><div class="flex days"></div></label>' +
        '<label class="f"><span>Start</span><input type="time" class="st" value="' + UI.esc(sh.start || '') + '"></label>' +
        '<label class="f"><span>End</span><input type="time" class="en" value="' + UI.esc(sh.end || '') + '"></label>' +
        '<label class="f"><span>Break start</span><input type="time" class="bs" value="' + UI.esc(sh.breakStart || '') + '"></label>' +
        '<label class="f"><span>Break (min)</span><input type="number" class="bl w-s" min="0" value="' + U.num(sh.breakMinutes) + '"></label>' +
        '<button class="btn btn-icon btn-danger" title="Remove shift" ' + (keepOne && shifts.length === 1 ? 'disabled' : '') + '>✕</button></div>');
      const days = row.querySelector('.days');
      DAYS.forEach((d, di) => {
        const l = UI.el('<label class="check"><input type="checkbox" value="' + di + '" ' + ((sh.days || []).indexOf(di) >= 0 ? 'checked' : '') + '> ' + d + '</label>');
        l.querySelector('input').addEventListener('change', () => { sh.days = Array.from(days.querySelectorAll('input:checked')).map(x => +x.value); onChange(); });
        days.appendChild(l);
      });
      const bindT = (cls, key, num) => row.querySelector(cls).addEventListener('change', e => { sh[key] = num ? U.num(e.target.value) : e.target.value; onChange(); });
      bindT('.st', 'start'); bindT('.en', 'end'); bindT('.bs', 'breakStart'); bindT('.bl', 'breakMinutes', true);
      row.querySelector('button').addEventListener('click', () => { shifts.splice(i, 1); onChange(); SettingsUI.shiftEditor(host, shifts, onChange, keepOne); });
      host.appendChild(row);
    });
    const add = UI.el('<button class="btn btn-sm">+ Add shift (e.g. evening shift)</button>');
    add.addEventListener('click', () => { const last = shifts[shifts.length - 1] || Calendar.legacyShift(Store.state.settings); shifts.push({ days: (last.days || [1, 2, 3, 4, 5]).slice(), start: last.end || '15:30', end: '23:00', breakStart: '', breakMinutes: 0 }); onChange(); SettingsUI.shiftEditor(host, shifts, onChange, keepOne); });
    host.appendChild(add);
  };

  SettingsUI.renderCalendars = function (host) {
    host.innerHTML = '';
    const list = Store.state.calendars || [];
    if (!list.length) { host.appendChild(UI.el('<p class="muted small">No named calendars. The shop calendar applies to everything.</p>')); return; }
    list.forEach(c => {
      const box = UI.el('<div class="step-card" style="border-left-color:#64748b;margin-bottom:8px"><div class="head"><input type="text" class="name" value="' + UI.esc(c.name) + '" placeholder="Calendar name"><span class="muted small used"></span><span class="spacer"></span><button class="btn btn-icon btn-danger" title="Delete calendar">✕</button></div><div class="shifts mt"></div><div class="muted small mt sum"></div></div>');
      const used = Store.state.resources.filter(r => r.calendarId === c.id).map(r => r.name);
      box.querySelector('.used').textContent = used.length ? 'used by ' + used.join(', ') : 'not used by any resource';
      UI.bind(box.querySelector('.name'), c, 'name');
      const sum = () => { const cal = Store.calendarFor(c.id); box.querySelector('.sum').textContent = 'Average ' + U.minutesToText(cal.minutesPerDay()) + ' per working day · ' + cal.workdays.size + ' days per week'; };
      SettingsUI.shiftEditor(box.querySelector('.shifts'), c.shifts, () => { Store.save(); sum(); }, true);
      box.querySelector('button.btn-danger').addEventListener('click', async () => { if (await UI.confirm('Delete calendar "' + c.name + '"? Resources using it fall back to the shop calendar.', 'Delete')) { Store.deleteCalendar(c.id); Store.save(); SettingsUI.renderCalendars(host); } });
      sum();
      host.appendChild(box);
    });
  };

  SettingsUI.renderStepTypes = function (host) {
    host.innerHTML = '';
    const list = Store.state.stepTypes;
    const tbl = UI.el('<table class="tbl"><thead><tr><th></th><th>Name</th><th>Colour</th><th>Id (CSV value)</th><th class="num">Steps</th><th></th></tr></thead><tbody></tbody></table>');
    const tb = tbl.querySelector('tbody');
    list.forEach((t, i) => {
      const used = Store.stepTypeUsage(t.id);
      const tr = UI.el('<tr><td class="nowrap"><button class="btn btn-icon" data-mv="-1" title="Move up" ' + (i === 0 ? 'disabled' : '') + '>↑</button> <button class="btn btn-icon" data-mv="1" title="Move down" ' + (i === list.length - 1 ? 'disabled' : '') + '>↓</button></td>' +
        '<td><span class="badge type prev" style="background:' + UI.esc(t.color) + '">' + UI.esc(t.label) + '</span> <input type="text" class="lbl w-l" value="' + UI.esc(t.label) + '"></td>' +
        '<td><input type="color" class="col" value="' + UI.esc(t.color) + '"></td><td class="mono muted">' + UI.esc(t.id) + '</td><td class="num">' + used + '</td>' +
        '<td><button class="btn btn-icon btn-danger" title="Delete type" ' + (list.length <= 1 ? 'disabled' : '') + '>✕</button></td></tr>');
      tr.querySelector('.lbl').addEventListener('input', e => { t.label = e.target.value; tr.querySelector('.prev').textContent = t.label; root.Scheduler.setTypes(list); Store.save(); });
      tr.querySelector('.col').addEventListener('input', e => { t.color = e.target.value; tr.querySelector('.prev').style.background = t.color; root.Scheduler.setTypes(list); Store.save(); });
      tr.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', () => { Store.moveStepType(t.id, +b.dataset.mv); Store.save(); SettingsUI.renderStepTypes(host); }));
      tr.querySelector('.btn-danger').addEventListener('click', async () => {
        const others = list.filter(x => x.id !== t.id);
        const box = UI.modal('<h2>Delete step type "' + UI.esc(t.label) + '"</h2><p>' + (used ? used + ' step(s) use this type. They will be changed to:' : 'No steps use this type.') + '</p>' + (used ? '<select id="dt-rep">' + others.map(x => '<option value="' + x.id + '"' + (x.id === 'other' ? ' selected' : '') + '>' + UI.esc(x.label) + '</option>').join('') + '</select>' : '') + '<div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn btn-danger" id="dt-ok">Delete</button></div>');
        box.querySelector('#dt-ok').addEventListener('click', () => { const sel = box.querySelector('#dt-rep'); Store.deleteStepType(t.id, sel ? sel.value : null); Store.save(); UI.closeModal(); SettingsUI.renderStepTypes(host); });
      });
      tb.appendChild(tr);
    });
    host.appendChild(tbl);
  };

  root.SettingsUI = SettingsUI;
})(window);
