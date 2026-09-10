import { it, expect } from 'vitest';
import { websiteUrl, checkedWebsite } from '../server/website-check';
it('없는 URL, 위험한 스킴과 예시 도메인을 링크로 만들지 않는다', () => {
  for (const value of [
    null,
    '',
    'none',
    'javascript:alert(1)',
    'https://example.com/missing',
    'http://localhost/x',
    'https://a.test',
    'https://user:pass@abc.jp',
    'http://abc.jp:8080',
  ])
    expect(websiteUrl(value)).toBeNull();
  expect(websiteUrl('https://www.sapporo.travel/')).toBe('https://www.sapporo.travel/');
});
it('사설·메타데이터 주소는 접속 대상으로 허용하지 않는다', async () => {
  expect(await checkedWebsite('http://127.0.0.1/')).toBeNull();
  expect(await checkedWebsite('http://169.254.169.254/')).toBeNull();
});
