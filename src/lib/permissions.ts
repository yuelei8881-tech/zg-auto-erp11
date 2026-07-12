import type {PageKey,Role} from '../types';
const map:Record<Role,PageKey[]>={
owner:['dashboard','customers','fleets','vehicles','appointments','workOrders','estimates','invoices','inventory','purchaseOrders','vendors','finance','warranties','approvals','users','audit','settings'],
manager:['dashboard','customers','fleets','vehicles','appointments','workOrders','estimates','invoices','inventory','purchaseOrders','vendors','finance','warranties','approvals','users','audit'],
advisor:['dashboard','customers','fleets','vehicles','appointments','workOrders','estimates','invoices','finance','warranties'],
technician:['dashboard','vehicles','appointments','workOrders','warranties'],
accounting:['dashboard','customers','fleets','workOrders','estimates','invoices','finance','approvals','audit'],
warehouse:['dashboard','inventory','purchaseOrders','vendors','workOrders']};
export const canAccess=(role:Role,page:PageKey)=>map[role]?.includes(page)??false;
