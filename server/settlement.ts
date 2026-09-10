export function splitYen(amount: number, participantIds: string[]) {
  const ids = [...new Set(participantIds)].sort();
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000 || !ids.length)
    throw new Error('Invalid expense');
  return ids.map((id, i) => ({
    id,
    amount: Math.floor(amount / ids.length) + (i < amount % ids.length ? 1 : 0),
  }));
}
export function settle(balances: { id: string; balance: number }[]) {
  const debtors = balances.filter((b) => b.balance < 0).map((b) => ({ ...b }));
  const creditors = balances.filter((b) => b.balance > 0).map((b) => ({ ...b }));
  const transfers: { from: string; to: string; amount: number }[] = [];
  for (const d of debtors)
    for (const c of creditors) {
      const amount = Math.min(-d.balance, c.balance);
      if (amount > 0) {
        transfers.push({ from: d.id, to: c.id, amount });
        d.balance += amount;
        c.balance -= amount;
      }
    }
  return transfers;
}
