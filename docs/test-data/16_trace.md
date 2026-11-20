# 16 — Trace

> Entity: read-only view over `lots`, `events`, `event_lot_links`, `products`. Screen: `/trace`.
> API: `GET /trace/:lotId/forward`, `GET /trace/:lotId/backward`, `GET /trace/:lotId/full`.

---

## 1. Purpose and prerequisites

Trace walks the event graph from one starting lot. Forward finds downstream lots produced from it. Backward finds upstream lots consumed into it. Full combines both.

| Rule | Value | Citation |
|---|---|---|
| Roles | All four org roles | `trace/trace.routes.js:14-33` |
| Start lot must belong to org | Otherwise `404 Lot not found` | `trace/trace.service.js:70-76` |
| Active events only | `status = 'active'` in both directions | `trace/trace.service.js:133-137,207-211` |
| Max hops | 50 | `trace/trace.service.js:7,141,215` |
| Cache TTL | 300 seconds | `trace/trace.service.js:6,59-65` |
| Cache key | `trace:v3:<org>:v<version>:<lot>:<direction>` | `trace/trace.service.js:17-18` |
| Cache invalidation | Increment `trace-version:<org>` after committed event create/void/amend/import | `trace/trace.service.js:33-40`; `events/events.service.js:199-202,346-348,417-419`; `import-processor.js:196-198` |
| Cycle guard | Recursive path array prevents revisiting a lot | `trace/trace.service.js:109,141,183,215` |
| Hop limit warning | `truncated: true` when max hop >= 50 | `trace/trace.service.js:321-327` |
| Invalid lot UUID | `422`, field `lotId`, message `Invalid lot ID` | `trace/trace.validation.js:3-5` |
| Cross-tenant lot | `404`, message `Lot not found` | `trace/trace.service.js:74` |

Create locations, products, lots, and events first. A lot with no links returns a one-node trace, not an error.

---

## 2. Screen: `/trace`

Header `Trace`; subtitle `Track any lot forward or backward through your supply chain` (`TracePage.jsx:156-159`).

### 2.1 Controls

| UI Label | API / State | Values | Expected |
|---|---|---|---|
| Select Lot | `selectedLotId`; `GET /lots?limit=100&search=` | First 100 lots, label `<TLC> — <productName>` | Selecting a lot runs the query |
| Search lots... | `lotSearch` → `search` on `/lots` | Free text | Filters the selector server-side; the selected lot remains selected even if it no longer matches |
| Direction | `direction` | `Full Trace` (default), `Forward`, `Backward` | Switches the active query |
| Trace (row action) | sets `selectedLotId` | Any non-start node | Re-centers the trace on that lot |

Citations: `TracePage.jsx:31-35,50-72,170-220`.

### 2.2 Results header

| UI Element | API Field | Display | Citation |
|---|---|---|---|
| Starting lot code | `startLot.traceabilityLotCode` | Text | `TracePage.jsx:255-261` |
| Lots traced | `nodes.length` | `N lots traced` | `TracePage.jsx:263-266` |
| Hops deep | `hops` | `N hops deep` | `TracePage.jsx:267-271` |
| Cached badge | `cached` | `Cached` when a Redis hit occurred | `TracePage.jsx:272-277` |
| Truncation banner | `truncated` | `Trace truncated at 50 hops. The full supply chain may extend further.` | `TracePage.jsx:280-286` |

### 2.3 Table tab

| Column | API Field | Display | Citation |
|---|---|---|---|
| Lot Code | `traceabilityLotCode` | Link to `/lots/:id`; `Start` badge when `isStart` | `TracePage.jsx:77-92` |
| Product | `productName`, `productSku` | Name plus `SKU: <sku>` | `TracePage.jsx:93-105` |
| Quantity | `quantity`, `uom` | Localized number plus UOM | `TracePage.jsx:106-114` |
| Hop | `hop` | Badge; negative for backward, zero for start | `TracePage.jsx:115-123` |
| Status | `status` | `Active`, `Recalled`, `Void` | `TracePage.jsx:37-48,124-128` |
| Actions | — | `Trace` for non-start nodes | `TracePage.jsx:129-148` |

### 2.4 Tree tab

`TraceTree` groups nodes by absolute hop. Start at hop 0. Forward nodes render to the right; backward nodes render to the left. Edges show the event type and date. Selecting a node re-centers the trace. Citation: `TracePage.jsx:310-322,333-430`.

### 2.5 Empty states

| Condition | Display |
|---|---|
| No lot selected | `Select a lot to begin` / `Choose a lot from the dropdown above to trace its path through the supply chain.` |
| No nodes beyond start | `No connected lots` / `This lot has no linked events in the selected direction.` |
| Query failed | `Trace failed` / `Something went wrong running the trace. Please try again.` with `Retry` |
| Loading | Skeletons |

Citations: `TracePage.jsx:224-249,301-307`.

### 2.6 Known UX trap

The Recall Simulation detail page links to `/trace?lotId=<uuid>` (`RecallSimulationDetailPage.jsx:54`). `TracePage` never reads `lotId` from the URL; it initializes `selectedLotId` to `''` (`TracePage.jsx:51`). The link opens an empty trace page. This is a finding for `99_discrepancies_and_findings.md`.

---

## 3. API behavior

### 3.1 Forward

Forward starts at the lot, finds active events where the lot is an **input**, then returns the event's output lots. It repeats until no new output, a cycle, or 50 hops (`trace/trace.service.js:85-153`).

### 3.2 Backward

Backward starts at the lot, finds active events where the lot is an **output**, then returns the event's input lots. Hop values are negative (`trace/trace.service.js:159-223`).

### 3.3 Full

Full runs forward and backward, deduplicates nodes by lot id, and deduplicates edges by `from:to:eventId` (`trace/trace.service.js:228-270`). `hops` is the maximum absolute hop. `direction` is `"full"`.

### 3.4 Response

```json
{
  "success": true,
  "message": "Full trace completed",
  "data": {
    "nodes": [
      {
        "id": "<lot-uuid>",
        "traceabilityLotCode": "SPN-2026-0001",
        "productId": "<product-uuid>",
        "productName": "Organic Baby Spinach",
        "productSku": "GV-SPN-001",
        "status": "active",
        "quantity": "500.0000",
        "uom": "kg",
        "hop": 0,
        "isStart": true
      }
    ],
    "edges": [
      {
        "from": "<lot-uuid>",
        "to": "<lot-uuid>",
        "eventId": "<event-uuid>",
        "eventType": "transformation",
        "eventDatetime": "2026-06-02T09:15:00.000Z"
      }
    ],
    "hops": 1,
    "truncated": false,
    "startLot": {
      "id": "<lot-uuid>",
      "traceabilityLotCode": "SPN-2026-0001"
    },
    "direction": "full"
  }
}
```

A cache hit adds `"cached": true` at the top level of `data` (`trace/trace.service.js:89,163,232`). Node `quantity` is a string because PostgreSQL `decimal` is returned as a string.

---

## 4. Baseline expected traces

### ORG-001

| ID | Start lot | Direction | Nodes (hop) | Edges | Hops | Notes |
|---|---|---|---|---|---|---|
| `TRC-001` | LOT-001 | forward | LOT-001 (0), LOT-004 (1) | EVT-003 transformation | 1 | Shipping has no output node |
| `TRC-002` | LOT-001 | backward | LOT-001 (0) | — | 0 | No upstream event consumes LOT-001 as output |
| `TRC-003` | LOT-001 | full | LOT-001 (0), LOT-004 (1) | EVT-003 | 1 | Same as forward plus empty backward |
| `TRC-004` | LOT-004 | backward | LOT-004 (0), LOT-001 (-1), LOT-003 (-1) | Two edges, both `eventId=EVT-003`, `to` LOT-004 | 1 | Full trace has 3 nodes |
| `TRC-005` | LOT-004 | forward | LOT-004 (0) | — | 0 | Shipping EVT-004 has no outputs, so the customer is not a node |
| `TRC-006` | LOT-004 | full | LOT-004 (0), LOT-001 (-1), LOT-003 (-1) | Two edges, both `eventId=EVT-003`, `to` LOT-004 | 1 | Start node is LOT-004 |
| `TRC-007` | LOT-005 | full | LOT-005 (0) | — | 0 | Recalled lot still traces; status `recalled` |
| `TRC-008` | LOT-006 | full | LOT-006 (0) | — | 0 | EVT-007 is void and excluded; even if active, shipping has no output |
| `TRC-009` | LOT-007 | full | LOT-007 (0) | — | 0 | Void lot still resolves as a start lot |

TRC-004 edge count: two input links on EVT-003 produce two edges that share `eventId=EVT-003`. The SQL dedupe key is `(id, via_event_id)`, so each input lot produces exactly one edge. `[VERIFIED-CODE]`

### ORG-003

| ID | Start lot | Direction | Nodes | Hops | Notes |
|---|---|---|---|---|---|
| `TRC-010` | LOT-013 | forward | LOT-013 (0), LOT-014 (1), LOT-015 (1) | 1 | One transformation, two outputs |
| `TRC-011` | LOT-013 | full | Same 3 nodes | 1 | No upstream |
| `TRC-012` | LOT-014 | backward | LOT-014 (0), LOT-013 (-1) | 1 | Whey LOT-015 is a sibling, not an ancestor of cheddar |

### ORG-004

| ID | Start lot | Direction | Nodes | Hops | Notes |
|---|---|---|---|---|---|
| `TRC-013` | LOT-017 | forward | LOT-017 (0), LOT-019 (1) | 1 | EVT-020 |
| `TRC-014` | LOT-019 | backward | LOT-019 (0), LOT-017 (-1) | 1 | EVT-020 |
| `TRC-015` | LOT-018 | forward | LOT-018 (0) | 0 | Tuna has no transformation |

### ORG-005

| ID | Start lot | Direction | Nodes | Hops | Notes |
|---|---|---|---|---|---|
| `TRC-016` | LOT-020 | forward | LOT-020 (0), LOT-023 (1) | 1 | EVT-023 |
| `TRC-017` | LOT-023 | backward | LOT-023 (0), LOT-020 (-1) | 1 | EVT-023 |

### ORG-002

| ID | Start lot | Direction | Nodes | Hops | Notes |
|---|---|---|---|---|---|
| `TRC-018` | LOT-011 | forward | LOT-011 (0) | 0 | EVT-015 shipping has no outputs |
| `TRC-019` | LOT-011 | backward | LOT-011 (0) | 0 | Creation has no inputs |
| `TRC-020` | LOT-012 | full | LOT-012 (0) | 0 | No links beyond creation |

Baseline traces never exceed 1 hop. Create the deep-chain fixture in §5 to exercise multi-hop, truncation, and cycle behavior.

---

## 5. Deep-chain fixture for multi-hop and cycle tests

These records are **scenario-generated**, not part of the 25 baseline lots. Create them in ORG-001 with the same product, PRD-001, or a dedicated product.

| Step | Record | Value |
|---|---|---|
| 1 | Lot `LOT-DEEP-A` | TLC `DEEP-2026-A`, qty 100 kg, uom `kg`, product PRD-001 |
| 2 | Lot `LOT-DEEP-B` | TLC `DEEP-2026-B`, qty 90 kg |
| 3 | Lot `LOT-DEEP-C` | TLC `DEEP-2026-C`, qty 80 kg |
| 4 | Event `EVT-DEEP-1` | creation at LOC-001, output `LOT-DEEP-A` 100 kg |
| 5 | Event `EVT-DEEP-2` | transformation at LOC-002, input `LOT-DEEP-A` 90 kg, output `LOT-DEEP-B` 90 kg |
| 6 | Event `EVT-DEEP-3` | transformation at LOC-002, input `LOT-DEEP-B` 80 kg, output `LOT-DEEP-C` 80 kg |

Expected `GET /trace/<LOT-DEEP-A>/forward`: 3 nodes at hops 0, 1, 2; 2 edges; `hops=2`; `truncated=false`.

Expected `GET /trace/<LOT-DEEP-C>/backward`: 3 nodes at hops 0, -1, -2; 2 edges.

### Cycle test

The API cannot create a cycle through the UI in one pass because output lots usually are new. To force a cycle, use the API to create a transformation where an existing downstream lot is also an input:

| Step | Event | Links |
|---|---|---|
| 1 | `EVT-CYCLE-1` creation | output `LOT-DEEP-A` |
| 2 | `EVT-CYCLE-2` transformation | input `LOT-DEEP-A`, output `LOT-DEEP-B` |
| 3 | `EVT-CYCLE-3` transformation | input `LOT-DEEP-B`, output `LOT-DEEP-A` |

The third event is allowed; event validation does not check whether the output already exists. Forward trace from `LOT-DEEP-A` must stop at `LOT-DEEP-A` because the recursive `path` array prevents revisiting it (`trace/trace.service.js:141`). Expected nodes: A, B. Hops: 1. No infinite loop.

Record the actual node count. If the CTE returns A at hop 2, that is a bug.

---

## 6. Negative cases

| ID | Case | Request | Expected |
|---|---|---|---|
| `NEG-TRC-01` | Invalid UUID | `GET /trace/abc/forward` | `422`, field `lotId`, message `Invalid lot ID` |
| `NEG-TRC-02` | Unknown UUID | random v4 | `404`, message `Lot not found` |
| `NEG-TRC-03` | Cross-tenant lot | ORG-001 token + LOT-011 UUID | `404`, message `Lot not found` |
| `NEG-TRC-04` | Cross-tenant full | same | `404`, message `Lot not found` |
| `NEG-TRC-05` | No auth | no bearer | `401`, code `AUTH_REQUIRED` |
| `NEG-TRC-06` | Invalid token | malformed bearer | `401`, code `AUTH_INVALID_TOKEN` |
| `NEG-TRC-07` | Expired token | use an access token after 30 minutes | `401`, code `AUTH_TOKEN_EXPIRED`, message `Token expired` |
| `NEG-TRC-08` | Deactivated user token | USR-010 token, then deactivate | `401`, deny key blocks |
| `NEG-TRC-09` | Auditor traces | USR-008 | `200`; all four roles can read |
| `NEG-TRC-10` | API key role | role `api_key` is not allowed on trace routes | `403`, message `Insufficient permissions to access this resource` |
| `NEG-TRC-11` | Super admin traces | USR-000 with a tenant header? | `[UNVERIFIED-RUNTIME]`; `tenantScope` requires `req.user.organizationId`, and the seed super admin may have no org |
| `NEG-TRC-12` | `GET /trace/<lot>/forward?x=1` | unknown query | No query validation on trace routes; unknown query ignored |
| `NEG-TRC-13` | Redis down | stop Redis, trace | Falls back to DB; `cached` absent; logs warning (`trace/trace.service.js:46-65`) |
| `NEG-TRC-14` | Cache stale after event | trace, create event, trace again | Version bump makes new key; second result is fresh and `cached=false` |
| `NEG-TRC-15` | Void event in graph | void EVT-020, trace LOT-017 | LOT-019 disappears from forward trace; LOT-017 remains one node |
| `NEG-TRC-16` | Amended event in graph | amend EVT-020, trace LOT-017 | Original excluded; replacement active event edges used |
| `NEG-TRC-17` | Deleted/void lot as start | trace LOT-007 | `200`; node status `void` |
| `NEG-TRC-18` | Recalled lot as start | trace LOT-005 | `200`; node status `recalled` |

---

## 7. Cache tests

| ID | Steps | Expected |
|---|---|---|
| `CACHE-01` | Call full trace for LOT-001 twice | First `cached` absent; second `cached=true`; identical nodes |
| `CACHE-02` | Wait 301 seconds, call again | `cached` absent; cache expired |
| `CACHE-03` | Trace, create a new event linked to LOT-001, trace again | New key version; `cached=false`; new node appears |
| `CACHE-04` | Trace, void an event, trace again | Voided edge disappears |
| `CACHE-05` | Trace, run an import that adds an event, trace again | Version bumped after each committed group (`import-processor.js:196-198`) |
| `CACHE-06` | Trace ORG-001, then trace ORG-002 | Different cache keys; no cross-tenant data |
| `CACHE-07` | `redis-cli FLUSHDB`, trace | Cache miss; DB result; repopulates |

Cache is best-effort. A Redis outage must not fail the request (`trace/trace.service.js:46-65`).

---

## 8. Role matrix

| Role | Forward | Backward | Full | Notes |
|---|---|---|---|---|
| `org_admin` | 200 | 200 | 200 | — |
| `compliance_manager` | 200 | 200 | 200 | — |
| `operator` | 200 | 200 | 200 | — |
| `auditor` | 200 | 200 | 200 | Read-only |
| `api_key` | 403 | 403 | 403 | Not in allowed list |
| `super_admin` | 200 if tenant scope resolves | same | same | `rbac` bypass, but `tenantScope` still needs an org |

Citation: `trace/trace.routes.js:14-33`; `rbac.js:13-15`.

---

## 9. Cleanup

Trace writes only cache keys: `trace:v3:*` and `trace-version:<org>`. Delete them with `redis-cli DEL trace-version:<org>` or `FLUSHDB`. Voiding events is the only way to remove an edge from the live trace; rows remain for audit.
