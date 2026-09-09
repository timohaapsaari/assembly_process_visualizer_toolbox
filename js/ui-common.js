/* Shared UI helpers: element creation, toasts, modals, downloads, part picker, tooltip. */
(function (root) {
  'use strict';
  const U = root.U, Store = root.Store, Scheduler = root.Scheduler;
  const UI = {};

  UI.el = function (html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  UI.esc = U.escapeHtml;

  UI.toast = function (msg, kind, ms) {
    const t = UI.el('<div class="toast ' + (kind || '') + '">' + UI.esc(msg) + '</div>');
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), ms || 3500);
  };

  UI.modal = function (html) {
    const m = document.getElementById('modal'), box = document.getElementById('modalBox');
    box.innerHTML = html;
    m.classList.remove('hidden');
    const closeBtns = box.querySelectorAll('[data-close]');
    closeBtns.forEach(b => b.addEventListener('click', UI.closeModal));
    return box;
  };
  UI.closeModal = function () { document.getElementById('modal').classList.add('hidden'); document.getElementById('modalBox').innerHTML = ''; };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') UI.closeModal(); });
  document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') UI.closeModal(); });

  UI.confirm = function (msg, okLabel) {
    return new Promise(resolve => {
      const box = UI.modal('<h2>Please confirm</h2><p>' + UI.esc(msg) + '</p><div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn btn-danger" id="cf-ok">' + UI.esc(okLabel || 'OK') + '</button></div>');
      box.querySelector('#cf-ok').addEventListener('click', () => { UI.closeModal(); resolve(true); });
      box.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => resolve(false)));
    });
  };

  UI.download = function (filename, text, mime) {
    const blob = new Blob(['﻿' + text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  UI.typeBadge = function (typeId) {
    const t = Scheduler.typeInfo(typeId);
    return '<span class="badge type" style="background:' + t.color + '">' + UI.esc(t.label) + '</span>';
  };
  UI.partLabel = function (p) { return p ? (UI.esc(p.itemNr) + ' <span class="muted">' + UI.esc(p.name) + '</span>') : '<span class="badge err">missing part</span>'; };
  UI.typeSelect = function (value, cls) {
    return '<select class="' + (cls || '') + '">' + Scheduler.STEP_TYPES.map(t => '<option value="' + t.id + '"' + (t.id === value ? ' selected' : '') + '>' + UI.esc(t.label) + '</option>').join('') + '</select>';
  };

  /* ---------- tooltip ---------- */
  const tip = document.getElementById('tooltip');
  UI.showTip = function (html, x, y) {
    tip.innerHTML = html; tip.classList.remove('hidden');
    UI.moveTip(x, y);
  };
  UI.moveTip = function (x, y) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 10;
    if (top + h > window.innerHeight - 8) top = y - h - 10;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  };
  UI.hideTip = function () { tip.classList.add('hidden'); };

  /* ---------- part picker ----------
     opts: { placeholder, onPick(part), allowNew (bool), value (part id), width }
     Returns a wrapper element; .setValue(partId) to update. */
  UI.partPicker = function (opts) {
    opts = opts || {};
    const wrap = UI.el('<span class="picker"><input type="text" class="' + (opts.cls || 'w-l') + '" placeholder="' + UI.esc(opts.placeholder || 'Search item nr or name…') + '" autocomplete="off"><div class="picker-list hidden"></div></span>');
    const inp = wrap.querySelector('input'), list = wrap.querySelector('.picker-list');
    let hl = 0, items = [];
    const display = p => p ? (p.itemNr + ' – ' + p.name) : '';
    wrap.setValue = function (partId) { const p = Store.partsById()[partId]; inp.value = display(p); inp.dataset.partId = partId || ''; };
    if (opts.value) wrap.setValue(opts.value);

    function build() {
      const q = inp.value.trim().toLowerCase();
      const toks = q.split(/\s+/).filter(Boolean);
      items = Store.state.parts.filter(p => {
        if (opts.filter && !opts.filter(p)) return false;
        const hay = (p.itemNr + ' ' + p.name).toLowerCase();
        return toks.every(t => hay.indexOf(t) >= 0);
      }).sort((a, b) => a.itemNr.localeCompare(b.itemNr, undefined, { numeric: true })).slice(0, 40);
      let html = items.map((p, i) => '<div data-i="' + i + '" class="' + (i === hl ? 'hl' : '') + '">' + UI.esc(p.itemNr) + ' <span class="pn">' + UI.esc(p.name) + '</span> <span class="badge ' + p.type + '">' + p.type[0].toUpperCase() + '</span></div>').join('');
      if (opts.allowNew !== false && q) html += '<div class="new" data-new="1">+ Create new part "' + UI.esc(inp.value.trim()) + '"</div>';
      if (!html) html = '<div class="muted">No parts</div>';
      list.innerHTML = html;
      list.classList.remove('hidden');
    }
    function pick(p) {
      inp.value = display(p); inp.dataset.partId = p.id; list.classList.add('hidden');
      if (opts.onPick) opts.onPick(p);
      if (opts.clearAfterPick) { inp.value = ''; inp.dataset.partId = ''; }
    }
    function createNew() {
      const text = inp.value.trim();
      list.classList.add('hidden');
      UI.quickCreatePart(text, p => pick(p));
    }
    inp.addEventListener('focus', () => { hl = 0; build(); });
    inp.addEventListener('input', () => { hl = 0; inp.dataset.partId = ''; build(); });
    inp.addEventListener('keydown', e => {
      if (list.classList.contains('hidden')) return;
      const n = items.length + (opts.allowNew !== false && inp.value.trim() ? 1 : 0);
      if (e.key === 'ArrowDown') { hl = Math.min(n - 1, hl + 1); build(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); build(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (hl < items.length) pick(items[hl]); else if (n > items.length) createNew(); }
      else if (e.key === 'Escape') { list.classList.add('hidden'); }
    });
    inp.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
    list.addEventListener('mousedown', e => {
      const d = e.target.closest('div[data-i], div[data-new]'); if (!d) return;
      e.preventDefault();
      if (d.dataset.new) createNew(); else pick(items[+d.dataset.i]);
    });
    return wrap;
  };

  UI.quickCreatePart = function (text, cb) {
    const m = String(text || '').match(/^(\S+)\s*[–-]?\s*(.*)$/);
    const nr = m ? m[1] : '', name = m && m[2] ? m[2] : '';
    const box = UI.modal('<h2>New part</h2>' +
      '<div class="form-row"><label class="f"><span>Item nr</span><input type="text" id="np-nr" class="w-m" value="' + UI.esc(nr) + '"></label>' +
      '<label class="f grow"><span>Name</span><input type="text" id="np-name" style="width:100%" value="' + UI.esc(name) + '"></label></div>' +
      '<div class="form-row"><label class="f"><span>Type</span><select id="np-type"><option value="purchased">Purchased</option><option value="manufactured">Manufactured</option></select></label>' +
      '<label class="f"><span>Work time / unit (min)</span><input type="number" id="np-work" value="0" min="0" step="0.5"></label>' +
      '<label class="f"><span>Lead time (days)</span><input type="number" id="np-lead" value="0" min="0"></label>' +
      '<label class="f"><span>Unit</span><input type="text" id="np-unit" class="w-s" value="pcs"></label></div>' +
      '<div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="np-ok">Create part</button></div>');
    const ok = () => {
      const itemNr = box.querySelector('#np-nr').value.trim();
      if (!itemNr) { UI.toast('Item nr is required', 'err'); return; }
      if (Store.partByItemNr(itemNr)) { UI.toast('Item nr already exists', 'err'); return; }
      const p = Store.addPart({ itemNr, name: box.querySelector('#np-name').value.trim() || itemNr, type: box.querySelector('#np-type').value,
        workMinutes: U.num(box.querySelector('#np-work').value), leadTimeDays: U.num(box.querySelector('#np-lead').value), unit: box.querySelector('#np-unit').value || 'pcs' });
      Store.save(); UI.closeModal(); UI.toast('Part ' + itemNr + ' created', 'ok');
      if (cb) cb(p);
    };
    box.querySelector('#np-ok').addEventListener('click', ok);
    box.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); }));
    (nr ? box.querySelector('#np-name') : box.querySelector('#np-nr')).focus();
  };

  /** Bind an input to an object field; calls onChange(value) after write. type: 'num'|'text'|'int' */
  UI.bind = function (input, obj, key, type, onChange) {
    const ev = input.tagName === 'SELECT' || input.type === 'checkbox' || input.type === 'date' || input.type === 'time' ? 'change' : 'input';
    input.addEventListener(ev, () => {
      let v = input.type === 'checkbox' ? input.checked : input.value;
      if (type === 'num') v = U.num(v, 0);
      if (type === 'int') v = Math.round(U.num(v, 0));
      obj[key] = v;
      Store.save();
      if (onChange) onChange(v);
    });
  };

  /** Debounce helper. */
  UI.debounce = function (fn, ms) { let t; return function () { clearTimeout(t); const a = arguments, s = this; t = setTimeout(() => fn.apply(s, a), ms || 200); }; };

  root.UI = UI;
})(window);
