import { resolve4 } from 'node:dns/promises';
import { BlockList } from 'node:net';
import http from 'node:http';
import https from 'node:https';
const denied = new BlockList();
for (const [ip, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  denied.addSubnet(ip, bits);
export function websiteUrl(value: unknown) {
  try {
    if (typeof value !== 'string' || !value.trim()) return null;
    const u = new URL(value);
    if (
      !['http:', 'https:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.port ||
      !u.hostname.includes('.') ||
      /(^|\.)(localhost|local|test|invalid|example|example\.com|example\.org|example\.net)$/.test(
        u.hostname,
      )
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
const cache = new Map<string, { ok: boolean; until: number }>();
async function probe(value: string, depth = 0): Promise<boolean> {
  const clean = websiteUrl(value);
  if (!clean || depth > 3) return false;
  const u = new URL(clean);
  const addresses = await resolve4(u.hostname);
  if (!addresses.length || addresses.some((ip) => denied.check(ip))) return false;
  const response = await new Promise<{ status: number; location?: string }>((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).request(
      u,
      {
        method: 'HEAD',
        headers: { 'User-Agent': 'Bookhaedo-LinkCheck/1.0' },
        lookup: ((_host: any, _options: any, cb: any) =>
          _options?.all
            ? cb(null, [{ address: addresses[0], family: 4 }])
            : cb(null, addresses[0], 4)) as any,
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode || 0, location: res.headers.location });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('timeout')), 2000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
  if (response.status >= 300 && response.status < 400 && response.location)
    return probe(new URL(response.location, u).href, depth + 1);
  return response.status >= 200 && response.status < 300;
}
export async function checkedWebsite(value: unknown) {
  const url = websiteUrl(value);
  if (!url) return null;
  const old = cache.get(url);
  if (old && old.until > Date.now()) return old.ok ? url : null;
  let ok = false;
  try {
    ok = await Promise.race([
      probe(url),
      new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 3500);
        t.unref();
      }),
    ]);
  } catch {
    ok = false;
  }
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(url, { ok, until: Date.now() + 600000 });
  return ok ? url : null;
}
