import { expect, it } from 'vitest';
import { expenseWorkbook } from '../server/expense-workbook';
import { expenseSheets } from '../shared/expense-export';
const report = {
  data: [
    {
      scope: 'SHARED',
      label: '=HYPERLINK("x")',
      amount: 3200,
      payerId: 'a',
      shares: [
        { id: 'a', amount: 1600 },
        { id: 'b', amount: 1600 },
      ],
    },
    {
      scope: 'PERSONAL',
      label: '개인 선물',
      amount: 900,
      payerId: 'a',
      shares: [{ id: 'a', amount: 900 }],
    },
  ],
  total: 3200,
  personalTotal: 900,
  transfers: [{ from: 'b', to: 'a', amount: 1600 }],
  budgets: [
    {
      visitDate: '2026-10-10',
      name: '식당',
      estimatedCost: 3000,
      sharedCount: 1,
      sharedActual: 3200,
    },
  ],
};
it('공동/개인 출력 범위를 분리하고 예상 대비 실제 차액을 계산한다', () => {
  expect(JSON.stringify(expenseSheets(report, '여행', [], 'SHARED'))).not.toContain('개인 선물');
  const personal = expenseSheets(report, '여행', [], 'PERSONAL');
  expect(personal).toHaveLength(1);
  expect(JSON.stringify(personal)).not.toContain('HYPERLINK');
  expect(expenseSheets(report, '여행', [], 'ALL')[1]!.rows.at(-1)).toContain(200);
});
it('엑셀은 정상 ZIP 헤더와 숫자 셀을 쓰며 지출명을 실행 수식으로 만들지 않는다', () => {
  const bytes = expenseWorkbook(report, '여행 <검토>', [], 'ALL');
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  expect(bytes.readUInt32LE(bytes.length - 22)).toBe(0x06054b50);
  const content = bytes.toString('utf8');
  expect(content).toContain('inlineStr');
  expect(content).toContain('=HYPERLINK(&quot;x&quot;)');
  expect(content).not.toContain('<f>');
  expect(content).toContain('<v>3200</v>');
  expect(content).toContain('여행 &lt;검토&gt;');
});
