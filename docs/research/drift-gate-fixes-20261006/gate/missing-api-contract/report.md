<!-- drift-gate-v1 -->
## Drift Gate Report

**Result:** `FAIL`

| Signal | Value |
|---|---:|
| Change types | `cli-public-interface, other` |
| Scanned files | 72 |
| Skipped ignored files | 0 |
| Skipped binary files | 0 |
| Skipped large files | 0 |
| Evaluated rules | 6 |
| Runtime | 0.013s |
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

**Triggered:** `scripts/write-api-spec.mjs` (modified)

| Field | Value |
|---|---|
| Severity | `BLOCKER` |
| Change type | `other` |
| Change intensity | `impl-only` |
| Trigger files | `scripts/write-api-spec.mjs` (modified) |
| Matched policy pattern | `scripts/write-api-spec.mjs` |
| Missing docs/contracts | **Generated OpenAPI copies**: `docs/openapi-rest.json`, `docs/Bookhaedo-API.yml`, `frontend/public/openapi.json` |
| Docs group status | PASS **Actual API regressions**<br>FAIL **Generated OpenAPI copies** |
| Cross-file relation | - |
| Blast radius | `missing requirement group: Generated OpenAPI copies` |

**Suggested fix**

Update `docs/openapi-rest.json` or `docs/Bookhaedo-API.yml` or `frontend/public/openapi.json` so it reflects the changed contract.

**Checklist**

- [ ] Generated OpenAPI copies 업데이트

<details>
<summary>Raw evidence</summary>

```diff
# scripts/write-api-spec.mjs
--- a/scripts/write-api-spec.mjs
+++ b/scripts/write-api-spec.mjs
@@ -169,6 +169,11 @@ paths['/trips/{id}/days/{date}/ai-recommendations'].post.responses[429]={
+// These writes acquire the parent trip lock and may return a bounded conflict.
+schemas.TripWriteConflict=requiredObject({...schemas.Error.properties,code:{type:'string',enum:['TRIP_WRITE_BUSY','CONFLICT']}},['error','code','requestId']);
+for(const [path,method] of [['/trips/{id}','patch'],['/trips/{id}/cost-settings','patch'],['/trips/{id}','delete']]) {
+  paths[path][method].responses[409]=response(ref('TripWriteConflict'),'여행 잠금 대기 3초 초과(TRIP_WRITE_BUSY) 또는 데이터 충돌(CONFLICT). 자동 재전송하지 말고 현재 여행을 확인한 뒤 다시 시도한다.');
+}
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

- [`api-contract`](#rule-api-contract) matched 1 trigger file(s)
  - intensity: `impl-only`
  - matched patterns: `scripts/write-api-spec.mjs`
  - missing groups: **Generated OpenAPI copies**: `docs/openapi-rest.json`, `docs/Bookhaedo-API.yml`, `frontend/public/openapi.json`

</details>