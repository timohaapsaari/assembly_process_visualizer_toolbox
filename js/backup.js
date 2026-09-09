/* Auto-backup to a file on disk / network drive (File System Access API, Chrome & Edge). */
(function (root) {
  'use strict';
  const U = root.U, UI = root.UI, Store = root.Store;
  const Backup = { handle: null, lastWrite: null, error: null, supported: typeof window.showSaveFilePicker === 'function' };

  /* tiny IndexedDB key-value store for the file handle (handles cannot go into localStorage) */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('apv-backup', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
  async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }
  async function idbDel(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite').objectStore('kv').delete(k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }

  Backup.status = function () {
    if (!Backup.supported) return { state: 'unsupported', text: 'Auto-backup to a file needs Chrome or Edge. Use the manual JSON download instead.' };
    if (!Backup.handle && Backup.pending) return { state: 'pending', text: 'Backup file "' + Backup.pending.name + '" is linked but needs permission after reload.' };
    if (!Backup.handle) return { state: 'none', text: 'No backup file linked.' };
    return { state: 'on', text: 'Auto-backup to "' + Backup.handle.name + '"' + (Backup.lastWrite ? ', last written ' + U.niceDateTime(Backup.lastWrite) : '') + (Backup.error ? ' · last error: ' + Backup.error : '') };
  };

  /** Pick (or create) the backup file. Must be called from a user gesture. */
  Backup.link = async function () {
    const h = await window.showSaveFilePicker({ suggestedName: 'assembly_planner_backup.json', types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }] });
    await idbSet('handle', h);
    Backup.handle = h; Backup.pending = null;
    await Backup.write();
  };
  Backup.unlink = async function () { await idbDel('handle'); Backup.handle = null; Backup.pending = null; Backup.lastWrite = null; };

  /** Re-enable after a reload (needs a user gesture for requestPermission). */
  Backup.resume = async function () {
    if (!Backup.pending) return false;
    const p = await Backup.pending.requestPermission({ mode: 'readwrite' });
    if (p === 'granted') { Backup.handle = Backup.pending; Backup.pending = null; await Backup.write(); return true; }
    return false;
  };

  Backup.write = async function () {
    if (!Backup.handle) return;
    try {
      const w = await Backup.handle.createWritable();
      await w.write(Store.exportJSON()); await w.close();
      Backup.lastWrite = new Date(); Backup.error = null;
    } catch (e) { Backup.error = e.message; console.warn('backup write failed', e); }
    if (root.DataUI && root.DataUI.refreshBackupStatus) root.DataUI.refreshBackupStatus();
  };

  /** Read the linked file (for restore when the browser storage was wiped). */
  Backup.read = async function () {
    const h = Backup.handle || Backup.pending; if (!h) return null;
    if (!Backup.handle) { const p = await h.requestPermission({ mode: 'readwrite' }); if (p !== 'granted') return null; Backup.handle = h; Backup.pending = null; }
    const f = await h.getFile(); return JSON.parse(await f.text());
  };

  Backup.init = async function () {
    if (!Backup.supported) return;
    try {
      const h = await idbGet('handle');
      if (!h) return;
      const p = await h.queryPermission({ mode: 'readwrite' });
      if (p === 'granted') { Backup.handle = h; } else { Backup.pending = h; }
      if (root.DataUI && root.DataUI.refreshBackupStatus) root.DataUI.refreshBackupStatus();
      // browser storage empty but a backup file exists: offer restore
      const st = Store.state;
      if (!st.parts.length && !st.recipes.length && !st.resources.length && !st.firstRunHandled) {
        const box = UI.modal('<h2>Restore from backup file?</h2><p>This browser has no data, but a backup file "' + UI.esc(h.name) + '" is linked. Restore it?</p><div class="modal-actions"><button class="btn" data-close>No</button><button class="btn btn-primary" id="bk-restore">Restore</button></div>');
        box.querySelector('#bk-restore').addEventListener('click', async () => {
          try { const obj = await Backup.read(); if (obj) { Store.importJSON(obj, 'replace'); Store.save(); UI.closeModal(); root.App.showTab('plan'); UI.toast('Restored from backup file', 'ok'); } }
          catch (e) { UI.toast('Restore failed: ' + e.message, 'err'); }
        });
      }
    } catch (e) { console.warn('backup init failed', e); }
  };

  // write after every save, debounced
  let t = null;
  Store.onChange(() => { if (!Backup.handle) return; clearTimeout(t); t = setTimeout(() => Backup.write(), 1500); });

  root.Backup = Backup;
})(window);
