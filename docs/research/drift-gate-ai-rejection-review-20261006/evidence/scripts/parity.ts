import { approvedResourceUrl } from '/tmp/claude-0/-home-user-bookhaedo/d57e8189-41b4-5c1e-a392-5bab35ef0022/scratchpad/dg/bookhaedo-head/server/tourism-source-policy';
import { execFileSync } from 'node:child_process';
const base = 'https://www.harp.lg.jp/opendata/dataset/2207/resource/8257/';
const cases: [string,string,boolean][] = [
 ['ok-encoded-utf8', base+'%E8%A6%B3.csv', true],
 ['ok-ascii', base+'a.csv', true],
 ['encoded-dot-dot', base+'%2e%2e/x.csv', false],
 ['encoded-dot-dot-upper', base+'%2E%2E/x.csv', false],
 ['encoded-slash', base+'a%2fb.csv', false],
 ['encoded-backslash', base+'a%5cb.csv', false],
 ['double-encoded-dot', base+'%252e%252e/x.csv', false],
 ['encoded-percent', base+'a%25b.csv', false],
 ['encoded-null', base+'a%00.csv', false],
 ['encoded-ctrl', base+'a%0a.csv', false],
 ['invalid-pct', base+'a%zz.csv', false],
 ['truncated-pct', base+'a%E8%A6.csv', false],
 ['userinfo', 'https://u:p@www.harp.lg.jp/opendata/dataset/2207/resource/8257/a.csv', false],
 ['query', base+'a.csv?x=1', false],
 ['fragment', base+'a.csv#x', false],
 ['other-host', 'https://evil.example/opendata/dataset/2207/resource/8257/a.csv', false],
 ['http', 'http://www.harp.lg.jp/opendata/dataset/2207/resource/8257/a.csv', false],
 ['raw-nonascii', base+'観.csv', false],
 ['outside-prefix', 'https://www.harp.lg.jp/other/a.csv', false],
 ['dot-segment', base+'../x.csv', false],
 ['uppercase-host', 'https://WWW.HARP.LG.JP/opendata/dataset/2207/resource/8257/a.csv', false],
 ['port', 'https://www.harp.lg.jp:443/opendata/dataset/2207/resource/8257/a.csv', false],
];
let bad = 0;
const py = (u: string) => execFileSync('python3', ['-I','-c','import sys; sys.path.insert(0,"/tmp/claude-0/-home-user-bookhaedo/d57e8189-41b4-5c1e-a392-5bab35ef0022/scratchpad/dg/bookhaedo-head/scripts/tourism"); import source_policy as p; print(p.approved_resource_url(sys.argv[1]))', u]).toString().trim() === 'True';
for (const [name, url, expected] of cases) {
  const ts = approvedResourceUrl(url), pyv = py(url);
  const flag = (ts !== expected || pyv !== expected) ? (ts !== pyv ? 'MISMATCH' : 'UNEXPECTED') : 'ok';
  if (flag !== 'ok') bad++;
  console.log(flag.padEnd(10), name.padEnd(22), 'expected', String(expected).padEnd(5), 'ts', String(ts).padEnd(5), 'py', pyv);
}
console.log('cases', cases.length, 'problems', bad);
