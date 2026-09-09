# Assembly Process Planner

Browser-based tool for planning and visualising complex mechanical assembly processes:
multi-level sub-assemblies, test phases, chemical curing / wait times, worker counts, and
backward scheduling from a delivery date.

No build step, no server, no dependencies: open `index.html` in a browser. Data is kept in the
browser's localStorage and can be exported/imported as CSV or JSON.

## Features

- **Parts admin** – item nr, name, purchased/manufactured, unit, default work time per unit,
  supplier lead time. Inline editing, filtering, CSV import/export.
- **Recipe builder** – build the assembly process as steps. Each step *produces* an output part
  and *uses* component parts with quantities; when a step uses the output of another step the
  dependency is derived automatically (sub-assemblies flow into later steps). Per step:
  - work time per unit (labor minutes) and number of workers (elapsed = per-unit × qty ÷ workers)
  - fixed time per run (setup, test rig, batch time)
  - cure / wait hours (adhesive curing, potting, burn-in) – calendar time, no workers
  - extra "also after" predecessors, notes, step type (assembly, sub-assembly, bonding/curing,
    test, inspection, packaging)
  - live validation, per-unit lead time, critical path and product structure tree
- **Planning** – choose recipe, quantity and delivery date. Quantities are exploded through all
  steps, every step is scheduled **backwards** from the due date through the shop calendar
  (latest start = just-in-time), and a forward pass from the earliest start gives float and the
  **critical path**. If the latest start lies in the past the plan is flagged as not achievable
  with the earliest possible finish.
  - Gantt (work inside working hours, hatched cure time, non-working time shaded, float,
    dependency arrows, start/due lines, hover details, zoom)
  - precedence network diagram
  - step schedule table, worker load per day with capacity warning
  - materials to purchase with need dates and order-by dates from lead times
  - CSV export of the schedule and the material list, print/PDF
- **Shop calendar** – working days, shift start/end, break, holidays (Finnish public holidays
  one click), whether curing runs 24/7, max available workers.
- **CSV import** – ERP exports for parts, routing steps and BOM lines. Delimiter (`,` `;` tab)
  and decimal commas are auto-detected, headers are auto-mapped (English and Finnish aliases)
  with a manual mapping/preview step. JSON backup/restore of everything.

## Scheduling model

Follows the routing time-element model used by MRP/ERP systems (setup / run time per unit ÷
crew size / wait time), backward scheduling from the demand due date with a working calendar,
and critical-path analysis:

- step elapsed work = fixed minutes + work minutes per unit × units ÷ workers, placed only inside
  working hours
- cure / wait time runs on calendar time (nights and weekends count), configurable
- units per step come from exploding the required quantity through the component structure;
  a step whose output is also one of its inputs (e.g. a test on the same item) is a pass-through
- backward pass: latest finish of a step = earliest latest-start of its successors (due date for
  the final step); forward pass from the earliest start gives earliest dates and float
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
js/ui-*.js          tabs: plan, recipes, parts, data, settings
samples/*.csv       example ERP-style files (parts, steps, bom)
test/test.js        unit tests (node test/test.js)
test/e2e.js         browser smoke test (node test/e2e.js, needs playwright)
```

## CSV formats

`parts.csv`: `item_nr, name, type (purchased|manufactured), unit, work_minutes, lead_time_days, notes`

`steps.csv`: `recipe, step_nr, step_name, step_type, output_item_nr, components, work_minutes,
workers, fixed_minutes, cure_hours, predecessors, notes` – `components` is `ITEM:qty|ITEM:qty`,
`predecessors` lists extra step numbers.

`bom.csv`: `recipe, step_nr, component_item_nr, qty` (alternative to the inline components column)

Parts referenced by steps but missing from the parts list are created automatically on import.
