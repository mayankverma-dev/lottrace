# 19 — Recall Simulations

> Entity: `recall_simulations`. Screens: `/recall` (list + Run Simulation dialog), `/recall/:id` (result detail).
> API: `POST /recall`, `GET /recall`, `GET /recall/:id`.

---

## 1. Purpose and prerequisites

A recall simulation runs a full trace from one lot and stores a summary: how many lots, locations, products, and hops the trace touched. It is a read-only drill. It does not change lot status, create events, or send notifications.

| Rule | Value | Citation |
|---|---|---|
| Create roles | `org_admin`, `compliance_manager` | `recall/routes.js:12-17` |
| List/detail roles | `org_admin`, `compliance_manager`, `auditor` | `recall/routes.js:19-30` |
| Name | 1–255 chars, required; message `Name is required` | `recall/validation.js:5` |
| Triggering lot | UUID, required; message `Invalid lot ID` | `recall/validation.js:6` |
| `params` | Any object, optional, default `{}`; not used by the service | `recall/validation.js:7`; `recall/service.js:7` |
| Lot ownership | Must belong to caller's org; else `404 Lot not found` | `recall/service.js:10-11` |
| Execution | Synchronous inside the request | `recall/service.js:23-51` |
| Stored statuses | `pending` default; service inserts `running`, then `complete` or `failed` | `20240101000012_create_recall_simulations.js:14`; `recall/service.js:19,46-47,53-55` |
| Result summary | `{ affectedLots, affectedLocations, affectedProducts, hops }` | `recall/service.js:36-41` |
| `affectedLots` | `traceResult.nodes.length` | `recall/service.js:26` |
| `affectedLocations` | Distinct `location_id` of events used as trace edges | `recall/service.js:27-33` |
| `affectedProducts` | Distinct `productId` among trace nodes | `recall/service.js:34` |
| `hops` | `traceResult.hops` (max absolute hop) | `recall/service.js:40` |
| Trace basis | Full trace; active events only | `recall/service.js:24`; `trace/trace.service.js:228-270` |
| Audit row | **None** | `recall/routes.js` has no `auditLogger` |
| Notification row | **None** | `recall/service.js` inserts no notification |

Create locations, products, lots, and events first. A lot with no links produces a valid one-node result with zero hops.

---

## 2. Record set

5 baseline simulations, all `complete`. Values are computed from the canonical event graph in `15_events.md`.

| ID | Org | Name | Triggering lot | affectedLots | affectedLocations | affectedProducts | hops | Run by |
|---|---|---|---|---|---|---|---|---|
| `REC-001` | ORG-001 | `Q2 Spinach Recall Drill` | LOT-001 | 2 | 1 | 2 | 1 | USR-003 |
| `REC-002` | ORG-001 | `Spring Mix Contamination Drill` | LOT-004 | 3 | 1 | 3 | 1 | USR-004 |
| `REC-003` | ORG-003 | `Milk Recall Tabletop` | LOT-013 | 3 | 1 | 3 | 1 | USR-018 |
| `REC-004` | ORG-004 | `Salmon Withdrawal Drill` | LOT-017 | 2 | 1 | 2 | 1 | USR-024 |
| `REC-005` | ORG-005 | `Flour Recall Drill` | LOT-020 | 2 | 1 | 1 | 1 | USR-029 |

Derivations:

- `REC-001`: full trace of LOT-001 = LOT-001 plus forward output LOT-004. One edge via EVT-003 at LOC-002. Products PRD-001 and PRD-003.
- `REC-002`: full trace of LOT-004 = LOT-004 plus backward inputs LOT-001 and LOT-003. Two edges, both EVT-003. Products PRD-001, PRD-002, PRD-003.
- `REC-003`: LOT-013 plus outputs LOT-014 and LOT-015. One edge per output, both EVT-017 at LOC-010. Products PRD-009, PRD-010, PRD-011.
- `REC-004`: LOT-017 plus output LOT-019 via EVT-020 at LOC-013. Products PRD-012 and PRD-014.
- `REC-005`: LOT-020 plus output LOT-023 via EVT-023 at LOC-016. Both lots use PRD-015, so `affectedProducts` is **1**, not 2.

`REC-001` and `REC-002` intentionally share an organization so the list pager and sort can be checked. All five names are unique; the schema does not enforce uniqueness, so duplicate names are allowed.

`result_storage_key` is always null. The service never writes it, despite the column comment saying large results go to S3 (`20240101000012_create_recall_simulations.js:13`). Finding.

---

## 3. Screen: `/recall` — list

Header `Recall Simulations`; description `Run and review mock recalls to test your traceability readiness.`; icon `AlertTriangle` (`RecallSimulationsPage.jsx:99-103`).

### 3.1 Controls

| UI Label | API / State | Values | Expected |
|---|---|---|---|
| Run Simulation | opens dialog | Button; visible only with `recall.write` (admin/compliance) | Dialog opens |
| Simulation Name | `name` | Text, placeholder `e.g., Q3 Mock Recall - Widget A` | Required; inline `Name is required` when empty |
| Triggering Lot | `triggeringLotId` | Select from first 50 lots (`limit: 50`) | Required; inline `Lot is required` when empty |
| Cancel | — | Button | Closes dialog, keeps values |
| Run Simulation (submit) | `POST /recall` | Button; `Running...` while pending | Success closes dialog and navigates to `/recall/<id>` |

Citations: `RecallSimulationsPage.jsx:26-29,37-55,104-155`.

The lot selector loads only the first 50 lots, with no search (`RecallSimulationsPage.jsx:39`). An organization with more than 50 lots cannot pick the rest. The lot option label is the TLC only (`RecallSimulationsPage.jsx:133-136`).

Client validation is `min(1)` only. Names longer than 255 chars pass the client and fail the server with `422`.

### 3.2 Table

| UI Label | API Field | Display | Citation |
|---|---|---|---|
| Simulation Name | `name` | Medium text | `RecallSimulationsPage.jsx:58-64` |
| Status | `status` | `Complete` green, `Running` amber, `Failed` red | `RecallSimulationsPage.jsx:65-76` |
| Run Date | `run_at` | `MMM d, yyyy HH:mm` | `RecallSimulationsPage.jsx:77-81` |
| Actions | — | `View Results` link to `/recall/:id` | `RecallSimulationsPage.jsx:82-94` |

Order is `run_at desc`. The page requests `limit: 10` with the standard pager (`RecallSimulationsPage.jsx:37,175-181`).

### 3.3 Empty and loading states

| Condition | Display |
|---|---|
| No simulations | `No simulations run yet` / `Run a mock recall to verify your trace engine and compliance readiness.`; action `Run Simulation` when allowed |
| Loading | Table loading state |
| Auditor | No `Run Simulation` button; list still visible |

Citation: `RecallSimulationsPage.jsx:159-183`.

ORG-006: empty state with `Run Simulation` visible for USR-033 (sole `org_admin`).

---

## 4. Screen: `/recall/:id` — detail

Back link `Back to Simulations`; title is the simulation name; description `Run on <PPP at p>`; header action `View Full Trace Tree` (`RecallSimulationDetailPage.jsx:42-60`).

### 4.1 Result card

Card title `Simulation Results`; description `Summary of impact identified by the trace engine` (`RecallSimulationDetailPage.jsx:65-72`).

| UI Label | API Field | Display | Citation |
|---|---|---|---|
| Affected Lots | `result_summary.affectedLots` | Number or `0` | `RecallSimulationDetailPage.jsx:87-93` |
| Locations | `result_summary.affectedLocations` | Number or `0` | `RecallSimulationDetailPage.jsx:94-100` |
| Products | `result_summary.affectedProducts` | Number or `0` | `RecallSimulationDetailPage.jsx:101-107` |
| Max Depth | `result_summary.hops` | `<n> hops` | `RecallSimulationDetailPage.jsx:108-114` |

### 4.2 Details card

| UI Label | API Field | Display |
|---|---|---|
| Status | `status` | `Complete`, `Running`, `Failed` badge |
| Run Date | `run_at` | `PPP` date only |

Citation: `RecallSimulationDetailPage.jsx:120-136`.

### 4.3 Status states

| Status | Result card |
|---|---|
| `running` | Spinner; `Trace engine is calculating impact...` |
| `failed` | `Simulation failed to complete.` |
| `complete` | Four summary numbers |

Because the service runs synchronously, `running` is only observable if the request is inspected while in flight or the row is forced in SQL. The list and detail normally see `complete` or `failed`. `[VERIFIED-CODE]`

### 4.4 Missing and error states

| Condition | Display |
|---|---|
| Unknown/cross-org id | `Simulation not found`; `Back to Simulations` link |
| Loading | Skeletons |
| Trace call throws | Stored status `failed`; detail shows failure text |

Citation: `RecallSimulationDetailPage.jsx:17-35,80-84`.

`View Full Trace Tree` links to `/trace?lotId=<triggering_lot_id>`, but `TracePage` ignores the `lotId` query parameter and starts with no lot selected (`TracePage.jsx:51`). The button opens an empty trace screen. Finding.

---

## 5. Validation and negative cases

| ID | Case | Request / input | Expected |
|---|---|---|---|
| `NEG-REC-01` | Empty name | `{"name":"","triggeringLotId":"<uuid>"}` | `422`, field `name`, `Name is required` |
| `NEG-REC-02` | Name 256 chars | long string | `422`, field `name`, `Too big: expected string to have <=255 characters` |
| `NEG-REC-03` | Missing name | omit | `422`, field `name`, invalid type/required |
| `NEG-REC-04` | Missing lot | omit | `422`, field `triggeringLotId`, invalid type/required |
| `NEG-REC-05` | Malformed lot UUID | `"abc"` | `422`, field `triggeringLotId`, `Invalid lot ID` |
| `NEG-REC-06` | Unknown lot UUID | random v4 | `404`, message `Lot not found` |
| `NEG-REC-07` | Cross-tenant lot | ORG-001 token + LOT-011 | `404`, message `Lot not found` |
| `NEG-REC-08` | Operator creates | USR-005 | `403`, `Insufficient permissions to access this resource` |
| `NEG-REC-09` | Auditor creates | USR-008 | `403`, same |
| `NEG-REC-10` | Auditor lists | USR-008 | `200` |
| `NEG-REC-11` | Operator lists | USR-005 | `403`, same denial |
| `NEG-REC-12` | Cross-tenant detail | ORG-001 token + ORG-002 sim id | `404`, message `Simulation not found` |
| `NEG-REC-13` | Malformed id in detail | `/recall/abc` | Postgres UUID cast error; likely `500` `[UNVERIFIED-RUNTIME]` (no params validation) |
| `NEG-REC-14` | `limit=101` | list query | `422`, field `limit`, max 100 |
| `NEG-REC-15` | `page=0` | list query | `422`, field `page`, min 1 |
| `NEG-REC-16` | `params` is a string | `{"params":"x"}` | `422`, field `params`, expected object |
| `NEG-REC-17` | Duplicate name | same name twice | `201` both; no uniqueness rule |
| `NEG-REC-18` | `params` arbitrary object | `{"mode":"drill"}` | `201`; stored but ignored by the trace |
| `NEG-REC-19` | Unknown extra body key | `{"x":1}` | Zod strips unknown keys by default; request succeeds `[VERIFIED-CODE]` |
| `NEG-REC-20` | Void lot as trigger | LOT-007 | `201`; trace succeeds and reports the lot as a node |
| `NEG-REC-21` | Recalled lot as trigger | LOT-005 | `201`; trace succeeds |
| `NEG-REC-22` | Empty graph | ORG-006 lot impossible; create a lot first | `201` with 1 lot, 0 locations, 1 product, 0 hops |
| `NEG-REC-23` | Trace engine throws | hard to force | Row `failed`; `409`/`500` from the original error; no result summary `[UNVERIFIED-RUNTIME]` |

---

## 6. Expected API responses

`POST /api/v1/recall` → `201`, message `Recall simulation completed`:

```json
{
  "success": true,
  "message": "Recall simulation completed",
  "data": {
    "id": "<uuid>",
    "organization_id": "<org-uuid>",
    "name": "Q2 Spinach Recall Drill",
    "triggering_lot_id": "<LOT-001-uuid>",
    "params": {},
    "result_summary": {
      "affectedLots": 2,
      "affectedLocations": 1,
      "affectedProducts": 2,
      "hops": 1
    },
    "result_storage_key": null,
    "status": "complete",
    "run_by": "<USR-003-uuid>",
    "run_at": "2026-06-30T12:00:00.000Z",
    "completed_at": "2026-06-30T12:00:00.000Z"
  }
}
```

`GET /api/v1/recall?page=1&limit=10` → standard paginated envelope, message `Simulations retrieved`. Rows are raw snake_case.

`GET /api/v1/recall/:id` → `200`, same row, message `Simulation retrieved`.

The UI reads snake_case and `result_summary` directly.

---

## 7. Semantics to verify

| ID | Check | Expected |
|---|---|---|
| `REC-T01` | Run `REC-001` from LOT-001 | Summary 2 / 1 / 2 / 1 |
| `REC-T02` | Run `REC-002` from LOT-004 | Summary 3 / 1 / 3 / 1 |
| `REC-T03` | Run `REC-003` from LOT-013 | Summary 3 / 1 / 3 / 1 |
| `REC-T04` | Run `REC-004` from LOT-017 | Summary 2 / 1 / 2 / 1 |
| `REC-T05` | Run `REC-005` from LOT-020 | Summary 2 / 1 / **1** / 1 |
| `REC-T06` | Void EVT-020, rerun `REC-004` | Summary **1 / 0 / 1 / 0**; the downstream fillet disappears |
| `REC-T07` | Amend EVT-020, rerun `REC-004` | Uses the active replacement; summary unchanged |
| `REC-T08` | Run from a lot with a required KDE gap | Summary unaffected; gaps do not block simulations |
| `REC-T09` | Run from LOT-005 (`recalled`) | `201`; `affectedLots` 1 |
| `REC-T10` | Run from LOT-007 (`void`) | `201`; `affectedLots` 1 |
| `REC-T11` | Add a 3-hop chain (`TRC` deep fixture), run simulation | `hops=2`; `affectedLots=3`; `affectedLocations` counts each distinct event location |
| `REC-T12` | Trigger from a lot with only a shipping event | `affectedLots` 1; `affectedLocations` 0 because shipping has no edge |
| `REC-T13` | Two simulations in a row | Both rows persist; list newest first; no dedupe |
| `REC-T14` | Check bell after a run | No new notification; no `recall_simulation` row is created |
| `REC-T15` | Check audit log after a run | No `recall.*` row |

`REC-T06` expected math: full trace from LOT-017 after EVT-020 is voided has only the start node. One product (PRD-012), zero edges, so zero locations and zero hops.

`REC-T12` uses LOT-004: forward shipping EVT-004 has no outputs, but backward EVT-003 still creates edges. To get zero edges, use a creation-only lot such as LOT-009 or LOT-010; summary = 1 / 0 / 1 / 0.

---

## 8. Roles

| Role | Run | List | Detail | UI |
|---|---|---|---|---|
| `org_admin` | 201 | 200 | 200 | Button visible |
| `compliance_manager` | 201 | 200 | 200 | Button visible |
| `operator` | 403 | 403 | 403 | Route not linked in sidebar |
| `auditor` | 403 | 200 | 200 | No button |
| `api_key` | 403 | 403 | 403 | Not applicable |
| `super_admin` | 201 if tenant scope resolves | 200 | 200 | RBAC bypass only |

Citation: `recall/routes.js:12-30`; `rbac.js:13-15`.

Check the sidebar: auditor can reach list/detail only if a nav item exists. If the nav hides Recall for auditors, use the direct URL. `[UNVERIFIED-RUNTIME]` for nav visibility.

---

## 9. Known gaps

| Gap | Detail | Citation |
|---|---|---|
| No notification | `recall_simulation` icon exists but nothing inserts it | `recall/service.js`; `NotificationBell.jsx:29-31` |
| No audit row | Runs are not in the audit log | `recall/routes.js` |
| No stored full result | `result_storage_key` unused | `recall/service.js:14-21` |
| Synchronous run | Large graphs block the request; no queue | `recall/service.js:23-51` |
| Trace link broken | `/trace?lotId=` is ignored by TracePage | `RecallSimulationDetailPage.jsx:54`; `TracePage.jsx:51` |
| Detail id unvalidated | Malformed id reaches Postgres | `recall/routes.js:26-30` |
| Lot picker capped | First 50 lots only | `RecallSimulationsPage.jsx:39` |
| No recall status change | Simulations never mark lots `recalled` | `recall/service.js` |

---

## 10. Cleanup

Simulations cannot be deleted through the API. Reset the database or delete rows directly in the disposable dev database:

```sql
DELETE FROM recall_simulations WHERE organization_id = '<org-uuid>';
```

No storage objects are created, so there is nothing to clean in S3.
