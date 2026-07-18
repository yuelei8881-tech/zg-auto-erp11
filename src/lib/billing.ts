export const MONTHLY_BILLING_TERM = '每月1日结账';
export const MONTHLY_PAYMENT_METHOD = '月结（每月1日）';

export function nextMonthlyBillingDate(base = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric',
  });
  const parts = Object.fromEntries(formatter.formatToParts(base).map(part => [part.type, part.value]));
  let year = Number(parts.year);
  let month = Number(parts.month) + 1;
  if (month === 13) { year += 1; month = 1; }
  return `${year}-${String(month).padStart(2, '0')}-01`;
}
