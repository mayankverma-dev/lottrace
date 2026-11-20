# Progress — Test Data Bible

> Tracks the state of `docs/test-data/`. Update this file when a session pauses.
> The app is not modified by this work.

---

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Orientation, repo and docs read, branch verified | Complete |
| 1 | Entity and screen inventory (`01_inventory.md`) | Complete |
| 2 | Field registry (`02_field_registry.md`) | Complete |
| 3 | Design notes and fixture graph (`03_design_notes.md`) | Complete |
| 4 | Organizations (`10_organizations.md`) | Complete |
| 5 | Users and auth (`11_users_auth.md`) | Complete |
| 6 | Locations (`12_locations.md`) | Complete |
| 7 | Products (`13_products.md`) | Complete |
| 8 | Lots (`14_lots.md`) | Complete |
| 9 | Events, attachments, idempotency (`15_events.md`) | Complete |
| 10 | Trace (`16_trace.md`) | Complete |
| 11 | Imports (`17_imports.md`) | Complete |
| 12 | Dashboard, gaps, exports, audit, notifications (`18_reports_audit.md`) | Complete |
| 13 | Recall (`19_recall.md`) | Complete |
| 14 | Roles and auth matrix (`20_auth_roles.md`) | Complete |
| 15 | E2E scenarios (`30_scenarios_e2e.md`) | Complete |
| 16 | Import files (`40_import_files.md` + `imports/`) | Complete |
| 17 | Search, filter, sort, pagination (`50_search_filter.md`) | Complete |
| 18 | Coverage matrix (`90_coverage_matrix.md`) | Complete |
| 19 | Findings (`99_discrepancies_and_findings.md`) | Complete |
| 20 | Quality gates and final consistency pass | Complete |

---

## Files written

| Count | Item |
|---|---|
| 21 | Markdown files in `docs/test-data/` (20 content files plus this status file) |
| 11 | CSV fixtures in `docs/test-data/imports/` |

Markdown files: `00_README_INDEX.md`, `01_inventory.md`, `02_field_registry.md`, `03_design_notes.md`, `10_organizations.md`, `11_users_auth.md`, `12_locations.md`, `13_products.md`, `14_lots.md`, `15_events.md`, `16_trace.md`, `17_imports.md`, `18_reports_audit.md`, `19_recall.md`, `20_auth_roles.md`, `30_scenarios_e2e.md`, `40_import_files.md`, `50_search_filter.md`, `90_coverage_matrix.md`, `99_discrepancies_and_findings.md`, `PROGRESS.md`.

CSV fixtures: `IMP-001_receiving_valid.csv`, `IMP-002_creation_errors.csv`, `IMP-003_transformation_valid.csv`, `IMP-004_shipping_errors.csv`, `IMP-005_header_only.csv`, `IMP-006_creation_valid.csv`, `IMP-007_transformation_group_error.csv`, `IMP-008_receiving_northwind.csv`, `IMP-009_creation_prairie.csv`, `IMP-010_transformation_prairie_errors.csv`, `OPT-kde_gap_creation.csv`.

---

## Fixture scale

| Entity | Count |
|---|---|
| Organizations | 6 (`ORG-001`…`ORG-006`) |
| Users | 33 generated + 1 seeded `super_admin` |
| Locations | 17 |
| Products | 17 |
| Lots | 25 |
| Events | 22 persisted rows + `EVT-012` void operation (23 lifecycle records) |
| Attachments | 6 |
| Import jobs | 10 |
| Recall simulations | 5 |
| Report exports | 6 |
| Baseline notifications | 8 |
| E2E scenarios | 14 |
| Negative-case IDs | 320 |
| Other test IDs | 162 |

Per-organization event split: ORG-001 = 12, ORG-002 = 2, ORG-003 = 3, ORG-004 = 3, ORG-005 = 2, ORG-006 = 0.

---

## State baselines

| State | Meaning | ORG-001 events | ORG-001 lots | Active lots | Gaps |
|---|---|---|---|---|---|
| `B0` | Seed + manual fixtures, before imports | 12 | 11 | 9 | 1 |
| `B1` | After `IMP-001`…`IMP-007` | 18 | 19 | 17 | 1 |
| `B2` | Optional KDE-gap import | 19 | 20 | 18 | 2 |

Dashboard and export expectations use `B0`. Reset before a clean E2E run.

---

## Verification completed

| Gate | How | Result |
|---|---|---|
| Coverage | Every mounted module and route mapped; every table has a section | Pass |
| Consistency | IDs, counts, and cross-references checked across files | Pass |
| Constraint spot-checks | 20+ rules re-read from code at the cited line | Pass |
| Honesty | Runtime-unverifiable items marked `[UNVERIFIED-RUNTIME]` or `[INFRA]` | Pass |
| No source changes | `git status` limited to `docs/test-data/` | Pass |

Corrections made during the final pass:

- Operator lot editing is visible in the UI (`LotDetailPage.jsx:128` gates on `events.create`), not hidden.
- Operator location creation and import upload are the real UI/API mismatches.
- `limit=1e2` is accepted, not rejected.
- `dateFrom` without milliseconds is accepted; `+00:00` offsets are rejected.
- Event count is 22 rows plus one void operation.
- Notification prefix is `NTF-`, not `NT-`.
- Scenario count is 14, not 18.
- Import status schema comment lists four values; code writes five.

---

## Open items

| ID | Item | Owner |
|---|---|---|
| `Q-01` | Import KDE contract: accept columns or reject them | Product |
| `Q-02` | Audit event creation | Backend |
| `Q-03` | Recall sets lot status | Product |
| `Q-04` | Operator location/import permissions | Product + Backend |
| `Q-05` | Inactive locations for backdated events | Product |
| `Q-06` | Auditor import UI | Frontend |
| `Q-07` | Compliance manager lot void | Product + Frontend |

All are detailed in `99_discrepancies_and_findings.md` §7.

---

## Resume instructions

1. Read `00_README_INDEX.md` §2 and §7.
2. Read `03_design_notes.md` for the fixture graph.
3. Read this file for state.
4. Continue from the first incomplete phase.
5. Do not modify `backend/`, `frontend/`, `scan-pwa/`, migrations, seeds, or config.
