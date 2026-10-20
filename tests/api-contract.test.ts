import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
it('direct API router operations exist in the generated OpenAPI contract', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../docs/openapi-rest.json', import.meta.url), 'utf8'),
  );
  for (const name of ['auth', 'catalog', 'trips', 'providers', 'health', 'ai-recommendations']) {
    const source = await readFile(new URL(`../server/routes/${name}.ts`, import.meta.url), 'utf8');
    for (const match of source.matchAll(
      /(?:app|healthRoutes|aiRecommendations)\.(get|post|put|patch|delete)\(\s*'\/api([^']+)'/g,
    )) {
      const path = match[2]!.replace(/:([A-Za-z]+)/g, '{$1}');
      expect(spec.paths[path]?.[match[1]!], `${match[1]} ${path}`).toBeDefined();
    }
  }
});
