<!-- drift-gate-v1 -->
## Drift Gate Report

**Result:** `FAIL`

| Signal | Value |
|---|---:|
| Change types | `cli-public-interface, other` |
| Scanned files | 74 |
| Skipped ignored files | 0 |
| Skipped binary files | 0 |
| Skipped large files | 0 |
| Evaluated rules | 6 |
| Runtime | 0.016s |
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

<a id="rule-course-recovery"></a>
#### `course-recovery` `[추정]` (low confidence)

Contract drift rule was not satisfied.

**Triggered:** `frontend/src/components/DayAlternatives.vue` (modified)<br>`frontend/src/recommendation-recovery.ts` (added)<br>`frontend/src/views/Planner.vue` (modified)

| Field | Value |
|---|---|
| Severity | `BLOCKER` |
| Change type | `other` |
| Change intensity | `auth-policy-change` |
| Trigger files | `frontend/src/components/DayAlternatives.vue` (modified)<br>`frontend/src/recommendation-recovery.ts` (added)<br>`frontend/src/views/Planner.vue` (modified) |
| Matched policy pattern | `frontend/src/components/DayAlternatives.vue`, `frontend/src/recommendation-recovery.ts`, `frontend/src/views/Planner.vue` |
| Missing docs/contracts | **State and browser regressions**: `tests/recommendation-recovery.test.ts`, `tests/e2e/tourism-save-recovery.spec.ts` |
| Docs group status | PASS **Recovery contract**<br>FAIL **State and browser regressions** |
| Cross-file relation | - |
| Blast radius | `authorization behavior`<br>`missing requirement group: State and browser regressions`<br>`role/permission owners`<br>`security documentation` |

**Suggested fix**

Update `tests/recommendation-recovery.test.ts` or `tests/e2e/tourism-save-recovery.spec.ts` so it reflects the changed contract.

**Checklist**

- [ ] State and browser regressions 업데이트

<details>
<summary>Raw evidence</summary>

```diff
# frontend/src/components/DayAlternatives.vue
--- a/frontend/src/components/DayAlternatives.vue
+++ b/frontend/src/components/DayAlternatives.vue
@@ -1,7 +1,9 @@
-import type { Place } from '../types';
+import type { Place, Trip } from '../types';
+import { state } from '../store';
+import { recommendationRecovery, type RecoveryContext } from '../recommendation-recovery';
@@ -13,19 +15,37 @@ const props = defineProps<{
-const emit = defineEmits<{ saved: []; refresh: []; preview: [value: any]; dismiss: [] }>();
+const emit = defineEmits<{
+  refresh: [snapshot: Trip];
+  preview: [value: any];
+  dismiss: [];
+}>();
-  saving = ref(false),
-  conditionsChanged = ref(false),
-  outcomeUnknown = ref(false);
+  conditionsChanged = ref(false);
+const context = computed(() => ({
+  userId: state.user?.id || '',
+  tripId: props.tripId,
+  date: props.date,
+}));
+const commandState = computed(() => recommendationRecovery.get(context.value)?.status);
+const saving = computed(() => commandState.value === 'saving' || commandState.value === 'checking');
+const outcomeUnknown = computed(
+  () => commandState.value === 'unknown' || commandState.value === 'checking',
```

</details>

**Override**

Only if this drift is intentional, add this to the PR description:

```md
drift-ignore: course-recovery
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

- [`course-recovery`](#rule-course-recovery) matched 3 trigger file(s)
  - intensity: `auth-policy-change`
  - matched patterns: `frontend/src/components/DayAlternatives.vue`, `frontend/src/recommendation-recovery.ts`, `frontend/src/views/Planner.vue`
  - missing groups: **State and browser regressions**: `tests/recommendation-recovery.test.ts`, `tests/e2e/tourism-save-recovery.spec.ts`

</details>