/* App shell: tabs, help, boot. */
(function (root) {
  'use strict';
  const UI = root.UI, Store = root.Store;
  const App = {};
  const TABS = { plan: root.PlanUI, recipes: root.RecipesUI, parts: root.PartsUI, resources: root.ResourcesUI, data: root.DataUI, settings: root.SettingsUI };

  App.showTab = function (name) {
    if (!TABS[name]) name = 'plan';
    Store.state.ui.tab = name; Store.save();
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    TABS[name].render();
    window.scrollTo(0, 0);
  };

  /** First open in this browser: choose demo or empty workspace. */
  App.firstRun = function () {
    App.showTab('plan');
    const box = UI.modal('<h2>Welcome</h2><p>No data in this browser yet. How do you want to start?</p>' +
      '<div class="grid-2 mt"><div class="panel" style="margin:0"><h3>Explore the demo</h3><p class="muted small">A hydraulic actuator with sub-assemblies, curing chambers, test chambers, worker pools, yields and a plan. Good for seeing how everything fits together. You can clear it later.</p><button class="btn btn-primary" id="fr-demo">Load demo data</button></div>' +
      '<div class="panel" style="margin:0"><h3>Start empty</h3><p class="muted small">Build your own product: set the calendar, import or enter parts and resources, then build the recipe. The help (?) has a step-by-step flow for large structures.</p><button class="btn" id="fr-empty">Start with an empty workspace</button></div></div>');
    box.querySelector('#fr-demo').addEventListener('click', () => { Store.clearAll(); Store.loadDemo(); Store.save(); UI.closeModal(); App.showTab('plan'); });
    box.querySelector('#fr-empty').addEventListener('click', () => { Store.save(); UI.closeModal(); App.showTab('settings'); UI.toast('Empty workspace. Start with the calendar, then Resources and Parts.', 'ok', 5000); });
  };

  App.help = function () {
    UI.modal('<h2>How to use</h2><div class="help">' +
      '<h3>1. Parts</h3><p>Define every item: purchased components (with supplier lead time) and manufactured sub-assemblies / products (with default work time per unit). Or import from your ERP as CSV.</p>' +
      '<h3>2. Recipes</h3><p>Build the assembly process as steps. Each step <b>produces</b> an output part and <b>uses</b> component parts with quantities. When a step uses the output of another step, the dependency is created automatically, so sub-assemblies flow into later steps. Per step you define:</p>' +
      '<ul><li><b>Work time / unit</b> — labor minutes per output unit; divided by the number of <b>workers</b>, taken from a <b>worker pool</b>.</li><li><b>Fixed time / lot</b> — setup, loading or test-rig time per lot that does not scale with quantity.</li><li><b>Process time / lot</b> — unattended hours after the attended work (adhesive curing, potting, test cycle, burn-in) on a <b>process resource</b> (fixtures, oven, test chamber). The resource\'s capacity × lot size limits how many pieces are in process at once, so large quantities run in waves. 24/7 resources keep running over nights and weekends.</li><li><b>Successor may start per lot</b> — the next step starts on the first finished lot instead of waiting for the whole batch.</li><li><b>Also after</b> — extra ordering constraints not expressed by parts (e.g. a test on the same item).</li></ul>' +
      '<p>A test on the same item: use the item as both input and output (pass-through). The next step waits for the test.</p>' +
      '<h3>3. Resources</h3><p>Equipment (capacity, lot size, 24/7 or shop calendar) and worker pools (headcount). The plan shows a resource Gantt with occupancy, utilisation and double bookings.</p>' +
      '<h3>4. Plan</h3><p>Choose recipe, quantity and delivery date. Sub-assemblies with their own delivery dates can be added as extra due dates. All quantities are exploded through the steps and every step is scheduled <b>backwards</b> from the delivery date (latest start, just-in-time). A forward pass from the earliest start gives the float and the <b>critical path</b> (red). If the latest start is before today, the plan is not achievable as-is: the tool shows the earliest finish and what to change.</p>' +
      '<p>The Gantt shows work (coloured by step type) inside working hours, cure as hatched orange, non-working time grey. Hover for details, click to highlight. Materials table gives order-by dates from part lead times.</p>' +
      '<h3>5. Calendar</h3><p>Set shifts, breaks, working days and holidays. Add a max worker count to get capacity warnings.</p>' +
      '<h3>Building a large structure</h3><ol style="margin:4px 0 8px 18px;padding:0">' +
      '<li><b>Calendar &amp; resources first.</b> Shifts, holidays, then worker pools and equipment with capacity and lot sizes, and the defaults by step type.</li>' +
      '<li><b>Parts from the ERP.</b> Import parts.csv with every purchased item and every sub-assembly item number. Lead times for purchased parts.</li>' +
      '<li><b>Work top-down from the final product.</b> Create the final assembly step first: output = final item, components = its top-level sub-assemblies and purchased parts. Then, for every sub-assembly component, add the step(s) that produce it, and so on down the tree. Each new step consumes parts already named, so no sub-assembly is left unused.</li>' +
      '<li><b>Tests and cures as their own steps.</b> A test on the same item: input = output = the item, with yield %. A cure: process time on a curing resource, tick "next step per lot".</li>' +
      '<li><b>One branch at a time.</b> Finish a sub-assembly branch, check the summary (lead time, critical path, warnings), then move to the next. Large trees are easier in a spreadsheet: fill steps.csv / bom.csv and import.</li>' +
      '<li><b>Renumber in process order</b> at the end (drag to order, then Renumber) and validate with a plan.</li></ol>' +
      '<h3>Data</h3><p>Everything is saved in this browser. Use Import / Export for CSV round-trips with your ERP and JSON backups.</p>' +
      '</div><div class="modal-actions"><button class="btn btn-primary" data-close>Close</button></div>');
  };

  document.addEventListener('DOMContentLoaded', () => {
    Store.load();
    document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => App.showTab(b.dataset.tab)));
    document.getElementById('btnHelp').addEventListener('click', App.help);
    if (Store.state.firstRun) { delete Store.state.firstRun; App.firstRun(); }
    else App.showTab(Store.state.ui.tab || 'plan');
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (Store.state.ui.tab === 'plan' && root.PlanUI.result) root.PlanUI.renderResult(root.PlanUI.result); }, 200); });
  });

  root.App = App;
})(window);
