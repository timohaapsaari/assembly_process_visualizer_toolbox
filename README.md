# Assembly Process Planner

Browser-based tool for planning and visualising complex mechanical assembly processes:
multi-level sub-assemblies, test phases, chemical curing / wait times, worker counts, and
backward scheduling from a delivery date.

No build step, no server, no dependencies: open `index.html` in a browser. Data is kept in the
browser's localStorage and can be exported/imported as CSV or JSON. A first open loads a demo
(hydraulic actuator with assembly workers, test workers, test chambers and curing chambers);
"Replace with demo data" under Calendar & settings restores it later.

## Features

- **Parts admin** – item nr, name, purchased/manufactured, unit, default work time per unit,
  supplier lead time. Inline editing, filtering, CSV import/export.
- **Resources** – equipment (bonding fixtures, curing ovens, test chambers, burn-in cabinets) with
  capacity, lot size and own calendar (24/7, shop hours or a named shift calendar), and worker
  pools with headcount and their own shift calendar. Capacity × lot size limits how many pieces
  can be in a process at once. **Defaults by step type** (e.g. test steps → test workers + test
  chambers, bonding → curing chambers) are applied to new and imported steps automatically and
  to existing recipes with one click.
- **Recipe builder** – build the assembly process as steps. A step either *produces* a new item
  from component parts, or *continues from the previous step* (dispensing, curing, testing…) and
  works on that step's item; only the step that creates an item has to name it. When a step
  uses the output of another step the dependency is derived automatically (sub-assemblies flow
  into later steps). Recipes chain: a component that is the final product of another recipe
  pulls that recipe's steps into the plan, recursively. Per step:
  - work time per unit (labor minutes) and number of workers from a worker pool
    (elapsed = per-unit × qty ÷ workers)
  - fixed time per lot (setup, loading, test rig)
  - process / cure time per lot (adhesive curing, potting, test cycle, burn-in) on a process
    resource; the step runs lot by lot in waves limited by the resource capacity
  - "next step per lot": the successor starts on the first finished lot (transfer batch)
  - yield %: failed units are scrapped, so the plan starts demand ÷ yield units at that step and
    the extra demand flows upstream into assembly counts and purchased material
  - extra "also after" predecessors, notes, step type (assembly, sub-assembly, bonding/curing,
    test, inspection, packaging)
  - live validation, per-unit lead time, critical path and product structure tree
- **Planning** – choose recipe, quantity and delivery date, plus optional **sub-assembly due
  dates** (a sub-assembly shipped earlier or separately, with extra pieces). Quantities are
  exploded through all steps, every step is scheduled **backwards** lot by lot from the due date
  through the shop calendar (latest start = just-in-time), and a forward pass from the earliest
  start gives float and the **critical path**. If the latest start lies in the past the plan is
  flagged as not achievable with the earliest possible finish.
  - Gantt (attended work inside working hours, hatched process time per lot, non-working time
    shaded, float, dependency arrows, start/due/sub-assembly lines, hover details, zoom)
  - **resource occupancy chart**: one lane per fixture / chamber / person, utilisation,
    double bookings in red, bottleneck resource tile
  - precedence network diagram
  - step schedule table with lots and waves, worker load per day with capacity warning
  - materials to purchase with need dates and order-by dates from lead times
  - CSV export of the schedule and the material list, print/PDF
- **Step types** – editable list with colours (assembly, sub-assembly, bonding/curing, test,
  inspection, packaging, other by default; add e.g. potting, calibration, leak test). Types drive
  colours and the resource defaults, not the scheduling itself.
- **Calendars** – shop calendar with one or more shifts per day, holidays (Finnish public
  holidays one click), plus named calendars (e.g. a two-shift test department) that worker pools
  and shop-hours equipment can follow. Curing on 24/7 equipment runs through nights and weekends
  while assembly stays inside its shifts.
- **CSV import** – ERP exports for parts, resources, routing steps and BOM lines. Delimiter (`,` `;` tab)
  and decimal commas are auto-detected, headers are auto-mapped (English and Finnish aliases)
  with a manual mapping/preview step. JSON backup/restore of everything.

## Scheduling model

Follows the routing time-element model used by MRP/ERP systems (setup / run time per unit ÷
crew size / wait time), backward scheduling from the demand due date with a working calendar,
and critical-path analysis:

- a step's units are split into lots (lot size from the step or its resource); per lot the attended
  work = fixed minutes + work minutes per unit × lot units ÷ workers, placed inside working hours,
  followed by the unattended process time on the resource calendar (24/7 or shop)
- the crew works the lots one after another; a lot can only be loaded when one of the resource's
  units (fixture, chamber) is free, so quantities above capacity × lot size run in waves
- with "next step per lot" a successor lot starts as soon as the cumulative predecessor output
  covers its needs; otherwise it waits for the predecessor's last lot
- units per step come from exploding the required quantity through the component structure and
  dividing by the step yield (rounded up); a step whose output is also one of its inputs (e.g. a
  test on the same item) is a pass-through and raises the demand on the producing step
- attended work follows the worker pool's calendar, the process follows the equipment's calendar
- backward pass: latest finish of a lot = earliest start of the successor lot that needs it (or the
  due date / sub-assembly due date); mirrored for crew and capacity; forward pass from the
  earliest start gives earliest dates, float and the critical path (chain of driving predecessors)
- resource occupancy is checked after scheduling: overlapping lots beyond the capacity of a
  resource or worker pool are reported as conflicts (infinite-capacity scheduling with capacity
  evaluation, as in standard ERP scheduling; finite-capacity sequencing across orders is a
  planned second pass)
- purchased part need date = start of the first consuming step; order-by = need date − lead time

## Files

```
index.html          app shell
css/app.css         styles
js/util.js          helpers, CSV parser/serialiser
js/calendar.js      working calendar math
js/scheduler.js     graph, quantity explosion, backward/forward scheduling, load profile
js/store.js         state, persistence, demo data
js/csv-io.js        CSV dataset definitions, header auto-mapping, import/export
js/ui-*.js          tabs: plan, recipes, parts, resources, data, settings
samples/*.csv       example ERP-style files (parts, resources, steps, bom)
test/test.js        unit tests (node test/test.js)
test/e2e.js         browser smoke test (node test/e2e.js, needs playwright)
```

## CSV formats

`parts.csv`: `item_nr, name, type (purchased|manufactured), unit, work_minutes, lead_time_days, notes`

`resources.csv`: `name, type (equipment|labor), capacity, lot_size, process_hours, calendar (24/7, shop, or a named calendar), notes`

`steps.csv`: `recipe, step_nr, step_name, step_type, output_item_nr, components, work_minutes,
workers, worker_pool, fixed_minutes, process_hours, resource, lot_size, transfer_per_lot,
yield_pct, continues_previous, deliver_qty, predecessors, notes` – a row with no output and no
components (other than the first row) is taken as continuing the previous step – `components` is `ITEM:qty|ITEM:qty`, `resource` and `worker_pool` are
resource names (created if missing), `predecessors` lists extra step numbers. The older
`cure_hours` header is accepted for `process_hours`.

`bom.csv`: `recipe, step_nr, component_item_nr, qty` (alternative to the inline components column)

Parts and resources referenced by steps but missing are created automatically on import.
