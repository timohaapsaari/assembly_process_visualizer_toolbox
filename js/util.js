/* Shared utilities: ids, dates, numbers, CSV parse/serialize. Browser + Node. */
(function (root) {
  'use strict';

  const U = {};

  U.uid = function (prefix) {
    const s = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return (prefix ? prefix + '_' : '') + s;
  };

  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.round = (v, d) => { const p = Math.pow(10, d || 0); return Math.round(v * p) / p; };

  /** Parse a number tolerant of decimal commas ("1,5"), spaces and units. */
  U.num = function (v, def) {
    if (v === null || v === undefined) return def === undefined ? 0 : def;
    if (typeof v === 'number') return isFinite(v) ? v : (def === undefined ? 0 : def);
    let s = String(v).trim();
    if (!s) return def === undefined ? 0 : def;
    s = s.replace(/\s/g, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') < 0) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    const m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return def === undefined ? 0 : def;
    const n = parseFloat(m[0]);
    return isFinite(n) ? n : (def === undefined ? 0 : def);
  };

  U.pad2 = n => (n < 10 ? '0' : '') + n;

  /** Format Date as local "YYYY-MM-DD". */
  U.isoDate = function (d) {
    d = d instanceof Date ? d : new Date(d);
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  };
  /** Format Date as local "YYYY-MM-DD HH:MM". */
  U.isoDateTime = function (d) {
    d = d instanceof Date ? d : new Date(d);
    return U.isoDate(d) + ' ' + U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  };
  /** Format local "HH:MM". */
  U.hhmm = function (d) {
    d = d instanceof Date ? d : new Date(d);
    return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  U.dayName = d => DAYS[(d instanceof Date ? d : new Date(d)).getDay()];
  /** "Tue 15.09 07:00" */
  U.niceDateTime = function (d) {
    d = d instanceof Date ? d : new Date(d);
    return DAYS[d.getDay()] + ' ' + U.pad2(d.getDate()) + '.' + U.pad2(d.getMonth() + 1) + ' ' + U.hhmm(d);
  };
  U.niceDate = function (d) {
    d = d instanceof Date ? d : new Date(d);
    return DAYS[d.getDay()] + ' ' + U.pad2(d.getDate()) + '.' + U.pad2(d.getMonth() + 1) + '.';
  };

  /** Parse "YYYY-MM-DD" (+ optional " HH:MM" / "THH:MM") as local time. Returns Date or null. */
  U.parseLocal = function (s) {
    if (s instanceof Date) return isNaN(s) ? null : s;
    if (!s) return null;
    s = String(s).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0, 0);
    m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/); // 15.9.2026
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0, 0);
    const d = new Date(s);
    return isNaN(d) ? null : d;
  };

  U.minutesToText = function (min) {
    min = Math.round(min);
    if (!min) return '0 min';
    const h = Math.floor(min / 60), m = min % 60;
    if (h === 0) return m + ' min';
    if (m === 0) return h + ' h';
    return h + ' h ' + m + ' min';
  };
  U.hoursToText = function (h) {
    if (h == null || isNaN(h)) return '';
    if (h >= 48) return U.round(h / 24, 1) + ' d';
    return U.round(h, 1) + ' h';
  };

  U.escapeHtml = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  U.deepClone = o => JSON.parse(JSON.stringify(o));

  U.by = (key) => (a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0);

  U.normHeader = s => String(s || '').toLowerCase().replace(/[^a-z0-9äöå]+/g, '');

  /* ---------- CSV ---------- */

  /** Detect delimiter from the first line. */
  U.detectDelimiter = function (text) {
    const line = text.split(/\r?\n/).find(l => l.trim().length) || '';
    const cands = [',', ';', '\t', '|'];
    let best = ',', bestN = -1;
    cands.forEach(c => {
      // count delimiters outside quotes
      let n = 0, q = false;
      for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch === c) n++; }
      if (n > bestN) { bestN = n; best = c; }
    });
    return best;
  };

  /** Parse CSV text into { headers: [], rows: [{}], delimiter }. Handles quotes, CRLF, BOM. */
  U.parseCSV = function (text, delimiter) {
    text = String(text || '').replace(/^﻿/, '');
    const d = delimiter || U.detectDelimiter(text);
    const records = [];
    let row = [], field = '', q = false, i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { q = true; i++; continue; }
      if (ch === d) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); records.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field.length || row.length) { row.push(field); records.push(row); }
    const nonEmpty = records.filter(r => r.some(c => String(c).trim() !== ''));
    if (!nonEmpty.length) return { headers: [], rows: [], delimiter: d };
    const headers = nonEmpty[0].map(h => String(h).trim());
    const rows = nonEmpty.slice(1).map(r => {
      const o = {};
      headers.forEach((h, idx) => { o[h] = (r[idx] === undefined ? '' : String(r[idx]).trim()); });
      return o;
    });
    return { headers, rows, delimiter: d };
  };

  /** Serialize rows (array of objects) to CSV using the given column list [{key,label}]. */
  U.toCSV = function (rows, columns, delimiter) {
    const d = delimiter || ',';
    const esc = v => {
      let s = v == null ? '' : String(v);
      if (/["\r\n]/.test(s) || s.indexOf(d) >= 0) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const head = columns.map(c => esc(c.label || c.key)).join(d);
    const body = rows.map(r => columns.map(c => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(d));
    return [head].concat(body).join('\r\n');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = U;
  else root.U = U;
})(typeof window !== 'undefined' ? window : globalThis);
