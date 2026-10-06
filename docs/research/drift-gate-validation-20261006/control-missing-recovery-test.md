<!-- drift-gate-v1 -->
## Drift Gate Report

**Result:** `FAIL`

| Signal | Value |
|---|---:|
| Change types | `cli-public-interface, other` |
| Scanned files | 37 |
| Skipped ignored files | 0 |
| Skipped binary files | 0 |
| Skipped large files | 0 |
| Evaluated rules | 7 |
| Runtime | 0.018s |
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

<a id="rule-recommendation-recovery"></a>
#### `recommendation-recovery` `[추정]` (low confidence)

Contract drift rule was not satisfied.

**Triggered:** `frontend/src/components/DayAlternatives.vue` (modified)

| Field | Value |
|---|---|
| Severity | `BLOCKER` |
| Change type | `other` |
| Change intensity | `auth-policy-change` |
| Trigger files | `frontend/src/components/DayAlternatives.vue` (modified) |
| Matched policy pattern | `frontend/src/components/DayAlternatives.vue` |
| Missing docs/contracts | **Browser regressions**: `tests/e2e/tourism-save-recovery.spec.ts` |
| Docs group status | PASS **Recovery contract**<br>FAIL **Browser regressions** |
| Cross-file relation | - |
| Blast radius | `authorization behavior`<br>`missing requirement group: Browser regressions`<br>`role/permission owners`<br>`security documentation` |

**Suggested fix**

Update `tests/e2e/tourism-save-recovery.spec.ts` so it reflects the changed contract.

**Checklist**

- [ ] Browser regressions 업데이트

<details>
<summary>Raw evidence</summary>

```diff
# frontend/src/components/DayAlternatives.vue
--- a/frontend/src/components/DayAlternatives.vue
+++ b/frontend/src/components/DayAlternatives.vue
@@ -2,17 +2,18 @@
-import { api, json } from '../api';
+import { api, json, ApiError } from '../api';
+  transportMode: string;
-const emit = defineEmits<{ saved: []; preview: [value: any]; dismiss: [] }>();
+const emit = defineEmits<{ saved: []; refresh: []; preview: [value: any]; dismiss: [] }>();
@@ -23,7 +24,8 @@ const opened = ref(false),
-  conditionsChanged = ref(false);
+  conditionsChanged = ref(false),
+  outcomeUnknown = ref(false);
@@ -46,7 +48,9 @@ onUnmounted(() => {
-const signature = computed(() => `${props.tripId}|${props.date}|${props.revision}`);
+const signature = computed(
+  () => `${props.tripId}|${props.date}|${props.revision}|${props.transportMode}`,
+);
@@ -91,6 +95,7 @@ const weatherCopy = computed(() =>
+  if (outcomeUnknown.value) return;
@@ -155,6 +160,7 @@ async function replaceDay() {
+    outcomeUnknown.value ||
@@ -166,9 +172,8 @@ async function replaceDay() {
-    await api(
-      endpoint.value,
-      json('PATCH', {
+    await api(endpoint.value, {
+      ...json('PATCH', {
```

</details>

**Override**

Only if this drift is intentional, add this to the PR description:

```md
drift-ignore: recommendation-recovery
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

- [`recommendation-recovery`](#rule-recommendation-recovery) matched 1 trigger file(s)
  - intensity: `auth-policy-change`
  - matched patterns: `frontend/src/components/DayAlternatives.vue`
  - missing groups: **Browser regressions**: `tests/e2e/tourism-save-recovery.spec.ts`

</details>