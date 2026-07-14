export type Customer = {
  id: string; type: '个人' | '公司' | '车队'; name: string; phone: string;
  secondaryPhone?: string; email?: string; address?: string; membership?: string; notes?: string;
};

export type Fleet = {
  id: string; company: string; contact: string; phone: string; billingEmail?: string;
  terms?: string; creditLimit?: number; notes?: string;
};

export type Driver = {
  id: string; fleetId?: string; company: string; name: string; phone: string;
  licenseLast4?: string; authorized?: boolean; notes?: string;
};

export type Vehicle = {
  id: string; ownerType: '个人' | '公司' | '车队'; ownerId?: string; ownerName: string;
  unit?: string; plate: string; state?: string; vin: string; year: string; make: string;
  model: string; engine?: string; color?: string; mileage?: number; driverId?: string;
  driverName?: string; driverPhone?: string; notes?: string;
};

export type Part = {
  id: string; partNo: string; oemNo?: string; name: string; brand?: string; supplier?: string;
  cost: number; price: number; qty: number; minimum: number; location?: string; notes?: string;
};

export type LaborItem = {
  id: string; description: string; hours: number; rate: number; technician?: string; total: number;
};

export type PartItem = {
  id: string; partId?: string; partNo: string; name: string; qty: number;
  cost: number; price: number; total: number; costTotal: number;
};

export type WorkOrderStatus = '等待检查' | '等待批准' | '等待配件' | '维修中' | '已完成' | '已交车' | '已取消';

export type WorkOrder = {
  id: string; number: string; date: string; customerId?: string; customer: string; phone?: string;
  vehicleId?: string; vehicle: string; plate?: string; vin?: string; mileage?: number;
  fleetId?: string; company?: string; driverId?: string; driver?: string; driverPhone?: string;
  authorizedContact?: string; po?: string; complaint?: string; diagnosis?: string; workPerformed?: string;
  technician?: string; status: WorkOrderStatus; laborItems: LaborItem[]; partItems: PartItem[];
  outsource: number; discount: number; taxRate: number; laborTotal: number; partsTotal: number;
  partsCost: number; tax: number; total: number; paid: number; balance: number; grossProfit: number;
  paymentMethod?: string; inventoryCommitted?: boolean; notes?: string;
};

export type InventoryLog = {
  id: string; date: string; partId: string; partNo: string; partName: string; type: string;
  change: number; before: number; after: number; reference?: string; note?: string;
};

export type Payment = {
  id: string; date: string; workOrderId: string; workOrderNumber: string; customer: string;
  amount: number; method: string; reference?: string; note?: string;
};

export type Expense = { id: string; date: string; category: string; vendor?: string; amount: number; method?: string; note?: string };

export type ShopSettings = {
  id: string; shopName: string; address: string; phone: string; email?: string;
  defaultLaborRate: number; defaultTaxRate: number; invoiceTerms?: string;
};

export type AppStore = {
  customers: Customer[]; fleets: Fleet[]; drivers: Driver[]; vehicles: Vehicle[];
  workOrders: WorkOrder[]; parts: Part[]; inventoryLogs: InventoryLog[];
  payments: Payment[]; expenses: Expense[]; settings: ShopSettings[];
  [key: string]: unknown[];
};
