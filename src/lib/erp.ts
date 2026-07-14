import type { LaborItem, PartItem, WorkOrder } from '../types';

export const money = (value: number | undefined) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2,
}).format(Number(value || 0));

export const today = () => new Date().toISOString().slice(0, 10);
export const uid = () => crypto.randomUUID();
export const num = (value: unknown) => Number(value || 0);

export function recalculateWorkOrder(order: Partial<WorkOrder>): WorkOrder {
  const laborItems = (order.laborItems || []).map((item: LaborItem) => ({
    ...item, hours: num(item.hours), rate: num(item.rate), total: num(item.hours) * num(item.rate),
  }));
  const partItems = (order.partItems || []).map((item: PartItem) => ({
    ...item, qty: num(item.qty), cost: num(item.cost), price: num(item.price),
    total: num(item.qty) * num(item.price), costTotal: num(item.qty) * num(item.cost),
  }));
  const laborTotal = laborItems.reduce((sum, item) => sum + item.total, 0);
  const partsTotal = partItems.reduce((sum, item) => sum + item.total, 0);
  const partsCost = partItems.reduce((sum, item) => sum + item.costTotal, 0);
  const outsource = num(order.outsource);
  const discount = num(order.discount);
  const taxRate = num(order.taxRate);
  const taxable = Math.max(0, partsTotal - discount);
  const tax = taxable * taxRate / 100;
  const total = Math.max(0, laborTotal + partsTotal + outsource + tax - discount);
  const paid = num(order.paid);
  return {
    id: order.id || uid(), number: order.number || '', date: order.date || today(),
    customer: order.customer || '', vehicle: order.vehicle || '', status: order.status || '等待检查',
    ...order, laborItems, partItems, outsource, discount, taxRate, laborTotal, partsTotal,
    partsCost, tax, total, paid, balance: Math.max(0, total - paid),
    grossProfit: laborTotal + partsTotal - partsCost - outsource - discount,
  } as WorkOrder;
}

export async function decodeVin(vin: string) {
  const clean = vin.trim().toUpperCase();
  if (clean.length !== 17) throw new Error('VIN 必须是 17 位。');
  const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(clean)}?format=json`);
  if (!response.ok) throw new Error('VIN 服务暂时无法连接。');
  const data = await response.json() as { Results?: Array<Record<string, string>> };
  const row = data.Results?.[0];
  if (!row) throw new Error('没有找到 VIN 资料。');
  return {
    vin: clean, year: row.ModelYear || '', make: row.Make || '', model: row.Model || '',
    engine: [row.DisplacementL && `${row.DisplacementL}L`, row.EngineCylinders && `${row.EngineCylinders}缸`, row.FuelTypePrimary].filter(Boolean).join(' '),
  };
}

export function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char));
}
