# KITA — Vue / REST / PostgreSQL

- Active frontend: `frontend/src` (Vue 3, Vue Router, Vite).
- Active backend: `server` (Express REST API, PostgreSQL via pg).
- Actual database: `geo_data` catalog + `planner` authentication and itinerary schema.
- SQL migrations: `db/schema.sql`, `db/planner.sql`; preserve imported catalog data.
- Static browser documents such as Swagger and the print-ready Appendix live in `frontend/public`.
- Run `npm run build`, `npm test`, and `npm run test:e2e` for changes affecting the full flow.
- `.env` contains private keys. Never print it or commit it. `VITE_*` values are public browser configuration.
- Every trip route must verify the signed-in user is the owner or an accepted trip member. Trip deletion and invitation management require ownership. Do not return password hashes, invitation token hashes or session tokens in JSON.
- Do not label straight-line distances as road distances or fabricate travel times/forecasts.
- Keep `docs/erd.dbml` and `docs/openapi-rest.json` aligned with the SQL and Express implementation.
