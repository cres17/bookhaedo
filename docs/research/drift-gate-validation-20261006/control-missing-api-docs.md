<!-- drift-gate-v1 -->
## Drift Gate Report

**Result:** `FAIL`

| Signal | Value |
|---|---:|
| Change types | `cli-public-interface, other` |
| Scanned files | 35 |
| Skipped ignored files | 0 |
| Skipped binary files | 0 |
| Skipped large files | 0 |
| Evaluated rules | 7 |
| Runtime | 0.033s |
| BLOCKER | 1 |
| MAJOR | 0 |
| MINOR | 0 |
| NIT | 0 |
| Temporal warnings | 0 |

**Analysis methods:** `grammar+heuristic`, `heuristic`
Fallback and unavailable-input reasons are recorded in the JSON analysis_notes.

### Required Action

This PR has blocking contract drift. Update the required docs or add a justified `drift-ignore`.

### [blocker] BLOCKER

<a id="rule-api-contract"></a>
#### `api-contract` `[추정]` (low confidence)

Contract drift rule was not satisfied.

**Triggered:** `server/day-alternatives.ts` (modified)<br>`server/routes/ai-recommendations.ts` (modified)<br>`server/routes/trips.ts` (modified)<br>`server/weather-alternatives.ts` (modified)

| Field | Value |
|---|---|
| Severity | `BLOCKER` |
| Change type | `other` |
| Change intensity | `route-contract-change` |
| Trigger files | `server/day-alternatives.ts` (modified)<br>`server/routes/ai-recommendations.ts` (modified)<br>`server/routes/trips.ts` (modified)<br>`server/weather-alternatives.ts` (modified) |
| Matched policy pattern | `server/day-alternatives.ts`, `server/routes/**`, `server/weather-alternatives.ts` |
| Missing docs/contracts | **OpenAPI copies**: `docs/openapi-rest.json`, `docs/Bookhaedo-API.yml`, `frontend/public/openapi.json` |
| Docs group status | FAIL **OpenAPI copies** |
| Cross-file relation | - |
| Blast radius | `CI/CD pipeline`<br>`OpenAPI/spec documentation`<br>`authorization behavior`<br>`external API consumers`<br>`missing requirement group: OpenAPI copies`<br>`ops/runbook owners`<br>`release notes`<br>`repository secrets`<br>`role/permission owners`<br>`security documentation` |

**Suggested fix**

Update `docs/openapi-rest.json` or `docs/Bookhaedo-API.yml` or `frontend/public/openapi.json` so it reflects the changed contract.

**Checklist**

- [ ] OpenAPI copies 업데이트

<details>
<summary>Raw evidence</summary>

```diff
# server/day-alternatives.ts
--- a/server/day-alternatives.ts
+++ b/server/day-alternatives.ts
@@ -1,7 +1,9 @@
+import { replaceDayItems } from './itinerary-write.js';
+import { lockTripForWrite } from './trip-write.js';
+import { operation } from './observability/metrics.js';
-import { randomUUID } from 'node:crypto';
@@ -149,7 +151,7 @@ export async function dayContext(
-  // One statement snapshot binds the revision, transport mode, and ordered items. Writes additionally lock the day row.
+  // One statement snapshot binds revision, mode and items. Write callers lock trip before day.
@@ -192,6 +194,7 @@ async function previewPlan(plan: any, mode: string, date: string, signal?: Abort
+  operation('dayRead'),
@@ -256,6 +259,7 @@ dayAlternatives.get(
+  operation('dayWrite'),
@@ -269,6 +273,7 @@ dayAlternatives.patch(
+      await lockTripForWrite(db, req.params.id, res.locals.user.id);
@@ -293,7 +298,7 @@ dayAlternatives.patch(
-        `SELECT ${placeSelect} FROM geo_data.place WHERE id=ANY($1::text[])`,
+        `SELECT ${placeSelect} FROM geo_data.place WHERE id=ANY($1::text[]) ORDER BY id COLLATE "C" FOR SHARE`,
@@ -319,30 +324,7 @@ dayAlternatives.patch(
-      const notes = new Map(context.items.map((p: any) => [p.id, p.note || '']));
-      const budgets = new Map(
-        (
-          await db.query(
-            'SELECT place_id,estimated_cost,start_minute,end_minute FROM planner.itinerary_item WHERE day_id=$1',
-            [context.dayId],
-          )
```

</details>

**Override**

Only if this drift is intentional, add this to the PR description:

```md
drift-ignore: api-contract
reason: <why this is safe>
```

<details>
<summary>Rule summary</summary>

- Gate decision: `FAIL`
- Violations: 1
- Skipped rules: 0
- Rejected ignores: 0
- Temporal warnings: 0

</details>

<details>
<summary>Explain evaluation</summary>

### Evaluated signals

- Change types: `cli-public-interface, other`
- Gate: fail_on_blocker=True, fail_on_major_count=1

### Rule decisions

- [`api-contract`](#rule-api-contract) matched 4 trigger file(s)
  - intensity: `route-contract-change`
  - matched patterns: `server/day-alternatives.ts`, `server/routes/**`, `server/weather-alternatives.ts`
  - missing groups: **OpenAPI copies**: `docs/openapi-rest.json`, `docs/Bookhaedo-API.yml`, `frontend/public/openapi.json`

</details>