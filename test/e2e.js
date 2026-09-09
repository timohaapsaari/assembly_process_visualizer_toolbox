/* Browser smoke test. Run: node test/e2e.js  (needs playwright + chromium; screenshots go to $SHOTS or the OS temp dir) */
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();
const path = require('path');
const SHOTS = process.env.SHOTS || require('os').tmpdir() + '/apv-shots/'; require('fs').mkdirSync(SHOTS, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  const url = 'file://' + path.resolve(__dirname, '../index.html');
  await page.goto(url);
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + 'plan.png', fullPage: true });
  // KPI values
  console.log('KPIs:', await page.$$eval('.kpi', els => els.map(e => e.querySelector('.k').textContent + ': ' + e.querySelector('.v').textContent)));
  console.log('alerts:', await page.$$eval('.alert', els => els.map(e => e.textContent.slice(0, 120))));
  // switch to ASAP
  await page.click('[data-mode="asap"]'); await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + 'plan_asap.png', fullPage: true });
  await page.click('[data-mode="jit"]');
  // hover a bar
  const bar = await page.$('g.bar'); if (bar) { await bar.hover(); await page.waitForTimeout(100); console.log('tooltip visible:', !(await page.$eval('#tooltip', t => t.classList.contains('hidden')))); }
  // change qty to 60 -> should become infeasible
  await page.fill('#pl-qty', '80'); await page.waitForTimeout(400);
  console.log('after qty 80:', await page.$$eval('.kpi', els => els.slice(0, 1).map(e => e.querySelector('.v').textContent)));
  await page.screenshot({ path: SHOTS + 'plan_infeasible.png', fullPage: false });
  await page.fill('#pl-qty', '12'); await page.waitForTimeout(400);

  // recipes tab
  await page.click('#tabs button[data-tab="recipes"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + 'recipes.png', fullPage: true });
  console.log('validation:', await page.$eval('#r-validation', e => e.textContent.slice(0, 150)));
  // add a step
  const before = await page.$$eval('.step-card', c => c.length);
  await page.click('#s-add'); await page.waitForTimeout(200);
  const after = await page.$$eval('.step-card', c => c.length);
  console.log('steps before/after add:', before, after);
  const last = (await page.$$('.step-card')).pop();
  await last.$eval('input.name', (i) => { i.value = 'Label & ship'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  // pick output via picker: type and choose "create new"
  const outInp = await last.$('.out input');
  await outInp.click(); await outInp.type('F-4002 Labelled actuator');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  console.log('modal open (new part):', !(await page.$eval('#modal', m => m.classList.contains('hidden'))));
  await page.click('#np-ok'); await page.waitForTimeout(300);
  console.log('deps of new step:', await last.$eval('.deps', d => d.textContent));
  await page.screenshot({ path: SHOTS + 'recipes_added.png', fullPage: false });
  // delete that step
  await last.$eval('button[data-act="del"]', b => b.click()); await page.waitForTimeout(200);
  await page.click('#cf-ok'); await page.waitForTimeout(300);
  console.log('steps after delete:', await page.$$eval('.step-card', c => c.length));

  // parts tab
  await page.click('#tabs button[data-tab="parts"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + 'parts.png', fullPage: true });
  console.log('parts rows:', await page.$$eval('#ptbl tbody tr', r => r.length));

  // data tab: import steps csv into a new recipe from the sample
  await page.click('#tabs button[data-tab="data"]'); await page.waitForTimeout(300);
  const fs = require('fs');
  const csv = fs.readFileSync(path.resolve(__dirname, '../samples/') + '/steps.csv', 'utf8').replace(/HA-200 hydraulic actuator/g, 'HA-200 imported');
  await page.fill('#csvText', csv);
  await page.click('#parseBtn'); await page.waitForTimeout(300);
  console.log('detected dataset:', await page.$eval('#dsSel', s => s.value));
  console.log('mapping:', await page.$$eval('select[data-field]', s => s.map(x => x.dataset.field + '=' + x.value).join(', ')));
  await page.screenshot({ path: SHOTS + 'import_preview.png', fullPage: true });
  await page.click('#doImport'); await page.waitForTimeout(300);
  console.log('import result:', await page.$eval('#preview .alert', e => e.textContent));
  // parts import (merge)
  await page.fill('#csvText', fs.readFileSync(path.resolve(__dirname, '../samples/') + '/parts.csv', 'utf8'));
  await page.click('#parseBtn'); await page.waitForTimeout(300);
  console.log('detected dataset 2:', await page.$eval('#dsSel', s => s.value));
  await page.click('#doImport'); await page.waitForTimeout(300);
  console.log('import result 2:', await page.$eval('#preview .alert', e => e.textContent));
  // bom import
  await page.fill('#csvText', fs.readFileSync(path.resolve(__dirname, '../samples/') + '/bom.csv', 'utf8'));
  await page.click('#parseBtn'); await page.waitForTimeout(300);
  console.log('detected dataset 3:', await page.$eval('#dsSel', s => s.value));
  await page.click('#doImport'); await page.waitForTimeout(300);
  console.log('import result 3:', await page.$eval('#preview .alert', e => e.textContent));

  // check imported recipe schedules identically to demo recipe
  const cmp = await page.evaluate(() => {
    const st = Store.state; const pb = Store.partsById(); const cal = Store.calendar();
    const due = new Date(2026, 9, 2, 15, 30), start = new Date(2026, 8, 9, 7, 0);
    return st.recipes.map(r => { const res = Scheduler.schedule({ recipe: r, partsById: pb, resourcesById: Store.resourcesById(), qty: 12, due, planStart: start, calendar: cal }); return r.name + ': steps=' + r.steps.length + ' final=' + (pb[r.finalPartId] || {}).itemNr + ' reqStart=' + U.isoDateTime(res.requiredStart) + ' labor=' + U.round(res.totals.laborHours, 1) + ' warnings=' + res.warnings.length + ' purchases=' + res.purchases.length; });
  });
  console.log(cmp);

  // resources tab
  await page.click('#tabs button[data-tab="resources"]'); await page.waitForTimeout(300);
  console.log('resources rows:', await page.$$eval('#res-body tr', r => r.length));
  await page.screenshot({ path: SHOTS + 'resources.png', fullPage: true });
  // plan: add a sub-assembly due date and check it renders
  await page.click('#tabs button[data-tab="plan"]'); await page.waitForTimeout(400);
  await page.click('#ms-add'); await page.waitForTimeout(400);
  await page.$eval('.ms-date', (i) => { i.value = '2026-09-11'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(400);
  console.log('milestone tiles:', await page.$$eval('.kpi .k', els => els.filter(e => /Sub-assembly/.test(e.textContent)).map(e => e.parentElement.querySelector('.v').textContent)));
  console.log('conflict alerts:', await page.$$eval('.alert.err', els => els.map(e => e.textContent.slice(0, 90))));
  console.log('resource gantt lanes:', await page.$$eval('#rgantt g.riv', g => g.length));
  await page.screenshot({ path: SHOTS + 'plan_resources.png', fullPage: true });
  await page.$eval('.form-row button.btn-danger', b => b.click()); await page.waitForTimeout(300);

  // settings
  await page.click('#tabs button[data-tab="settings"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + 'settings.png', fullPage: true });
  await page.click('#s-fi'); await page.waitForTimeout(200);
  console.log('summary:', await page.$eval('#s-summary', e => e.textContent));

  // reload persistence
  await page.reload(); await page.waitForTimeout(500);
  console.log('after reload tab:', await page.$eval('#tabs button.active', b => b.dataset.tab), 'recipes:', await page.evaluate(() => Store.state.recipes.length));
  await page.click('#tabs button[data-tab="plan"]'); await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + 'plan_final.png', fullPage: true });
  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('E2E FAILED', e); process.exit(1); });
