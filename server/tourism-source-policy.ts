import { readFileSync } from 'node:fs';
import { z } from 'zod';
const policy = z
  .object({
    version: z.literal(1),
    harp: z
      .object({
        origin: z.url(),
        datasetPrefix: z.string().startsWith('/'),
        minimumIntervalSeconds: z.number().int().positive(),
      })
      .strict(),
    exceptions: z.array(
      z
        .object({
          sourceId: z.string(),
          sourceUrl: z.url(),
          resourceUrl: z.url(),
          parserVersion: z.enum(['harp-csv-v1', 'sapporo-csv-v1']),
          minimumIntervalSeconds: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict()
  .parse(
    JSON.parse(readFileSync(new URL('../ops/tourism/source-policy.json', import.meta.url), 'utf8')),
  );
export type SourcePolicyInput = {
  id: string;
  sourceUrl: string;
  resourceUrl?: string;
  parserVersion?: string;
};
function cleanUrl(value: string) {
  // Keep the wire URL unchanged: accept valid UTF-8 filenames, never decode path structure.
  if (typeof value !== 'string' || value.length > 8192 || /[^\x21-\x7e]|[\\?#]/.test(value))
    return null;
  try {
    const u = new URL(value);
    if (
      value !== u.href ||
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.host.includes('%')
    )
      return null;
    if (/%(?:2e|2f|5c|25|3f|23)/i.test(u.pathname) || /%(?![a-f0-9]{2})/i.test(u.pathname))
      return null;
    const decoded = decodeURIComponent(u.pathname);
    if (/[\x00-\x1f\x7f]/.test(decoded) || decoded.split('/').some((p) => p === '.' || p === '..'))
      return null;
    return u;
  } catch {
    return null;
  }
}
function harpUrl(value: string) {
  const u = cleanUrl(value);
  return !!u && u.origin === policy.harp.origin && u.pathname.startsWith(policy.harp.datasetPrefix);
}
export function approvedSourcePolicy(source: SourcePolicyInput) {
  if (harpUrl(source.sourceUrl) && (source.parserVersion ?? 'harp-csv-v1') === 'harp-csv-v1')
    return { minimumIntervalSeconds: policy.harp.minimumIntervalSeconds };
  const exception = policy.exceptions.find(
    (p) =>
      p.sourceId === source.id &&
      p.sourceUrl === source.sourceUrl &&
      p.resourceUrl === source.resourceUrl &&
      p.parserVersion === source.parserVersion,
  );
  return exception ? { minimumIntervalSeconds: exception.minimumIntervalSeconds } : null;
}
export function approvedResourceUrl(value: string) {
  return (
    harpUrl(value) || (!!cleanUrl(value) && policy.exceptions.some((p) => p.resourceUrl === value))
  );
}
export function resourceBelongsToSource(source: SourcePolicyInput, value: string) {
  if (!approvedSourcePolicy(source) || !approvedResourceUrl(value)) return false;
  if (source.resourceUrl && value !== source.resourceUrl) return false;
  if (harpUrl(source.sourceUrl)) {
    const page = new URL(source.sourceUrl);
    const resource = new URL(value);
    return (
      resource.origin === page.origin &&
      resource.pathname.startsWith(page.pathname.replace('.html', '/'))
    );
  }
  return value === source.resourceUrl;
}
