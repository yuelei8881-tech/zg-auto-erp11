import type { AppStore } from '../types';
export function isActiveFinancialRecord(row: { status?: string; archivedAt?: string; archived?: boolean }) {
  return !row.archivedAt && !row.archived && row.status !== '已作废' && row.status !== '已取消';
}
export function financialStore(store: AppStore): AppStore {
  return { ...store, workOrders: store.workOrders.filter(isActiveFinancialRecord),
    payments: store.payments.filter(isActiveFinancialRecord), expenses: store.expenses.filter(isActiveFinancialRecord) };
}
