export type ExportScope = 'SHARED' | 'PERSONAL' | 'ALL';
export type ExpenseSheet = { name: string; rows: (string | number | null)[][]; headers: number[] };
export function expenseSheets(
  report: any,
  title: string,
  members: { id: string; name: string }[],
  scope: ExportScope,
): ExpenseSheet[] {
  const person = (id: string) => members.find((m) => m.id === id)?.name || '탈퇴한 동행자';
  const entries = report.data.filter((e: any) => scope === 'ALL' || e.scope === scope);
  const scopeName =
    scope === 'SHARED'
      ? '공동 지출'
      : scope === 'PERSONAL'
        ? '내 개인 지출'
        : '공동 + 내 개인 지출';
  const sheets: ExpenseSheet[] = [
    {
      name: '지출 내역',
      headers: [0, 5],
      rows: [
        [title, scopeName],
        ['내보낸 시각', new Date().toISOString()],
        ['공동 지출 합계 (JPY)', scope === 'PERSONAL' ? null : report.total],
        ['내 개인 지출 합계 (JPY)', scope === 'SHARED' ? null : report.personalTotal],
        ['개인 지출은 본인 기록만 포함하며 공동 정산에서 제외됩니다.'],
        [
          '구분',
          '일정일 / 기록일(KST)',
          '장소',
          '지출 내용',
          '실제 금액 (JPY)',
          '결제자',
          '분담 내역',
        ],
        ...entries.map((e: any) => [
          e.scope === 'PERSONAL' ? '개인' : '공동',
          e.visitDate ||
            (e.createdAt
              ? new Date(e.createdAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
              : ''),
          e.placeName || '',
          e.label,
          e.amount,
          person(e.payerId),
          e.scope === 'PERSONAL'
            ? '본인 전액'
            : e.shares.map((s: any) => `${person(s.id)} ${s.amount}엔`).join(' / '),
        ]),
      ],
    },
  ];
  if (scope !== 'PERSONAL') {
    sheets.push({
      name: '예상과 실제',
      headers: [0, 3],
      rows: [
        ['장소별 예상과 공동 실제 지출 (JPY)'],
        [
          '현재 일정에 입력된 예상 비용입니다. 실제 금액은 이 날짜·장소에 연결된 공동 지출 합계입니다.',
        ],
        ['미기록은 0원 지출을 뜻하지 않습니다. 개인 지출은 비교에서 제외됩니다.'],
        ['날짜', '장소', '예상 금액 (JPY)', '공동 실제 금액 (JPY)', '실제 - 예상 (JPY)', '기록 수'],
        ...report.budgets.map((b: any) => [
          b.visitDate,
          b.name,
          b.estimatedCost,
          b.sharedCount ? b.sharedActual : null,
          b.sharedCount ? b.sharedActual - b.estimatedCost : null,
          b.sharedCount,
        ]),
      ],
    });
    sheets.push({
      name: '공동 정산',
      headers: [0, 2],
      rows: [
        ['공동 지출 송금 안내'],
        ['송금은 직접 진행해주세요. 개인 지출은 포함하지 않습니다.'],
        ['보내는 사람', '받는 사람', '금액 (JPY)'],
        ...report.transfers.map((t: any) => [person(t.from), person(t.to), t.amount]),
      ],
    });
  }
  return sheets;
}
