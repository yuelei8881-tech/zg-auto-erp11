export type Customer = {
  id: string; type: '个人' | '公司' | '车队'; name: string; phone: string;
  secondaryPhone?: string; email?: string; address?: string; membership?: string; billingTerms?: string; notes?: string;
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
  cost: number; price: number; markupPercent?: number; qty: number; minimum: number; location?: string; notes?: string;
  inventoryType?: '销售配件' | '日常消耗品';
};

export type LaborItem = {
  id: string; description: string; hours: number; rate: number; technician?: string; total: number;
  descriptionEn?: string;
  billingMode?: 'hourly' | 'flat'; flatAmount?: number;
  linkedPartItemId?: string;
};

export type PartItem = {
  id: string; partId?: string; partNo: string; name: string; qty: number;
  nameEn?: string;
  cost: number; price: number; total: number; costTotal: number;
  serviceOnly?: boolean;
};

export type WorkOrderStatus = '等待检查' | '等待批准' | '等待配件' | '维修中' | '已完成' | '已交车' | '已取消';

export type InspectionChecklist = {
  intake: boolean; exterior: boolean; scan: boolean; diagnosis: boolean; estimate: boolean;
};

export type ReviewHistoryItem = {
  id: string; action: '提交审查' | '批准维修' | '退回补充'; by: string; at: string; note?: string;
};

export type EvidencePhoto = {
  id: string;
  category: '车牌' | '正前' | '正后' | '左侧' | '右侧' | '左前' | '右前' | '左后' | '右后' | '仪表里程' | '已有损伤' | '故障扫描' | '维修中' | '维修完成' | '其他';
  dataUrl: string;
  storagePath?: string;
  fileName: string;
  note?: string;
  capturedAt: string;
  capturedBy: string;
  customerVisible?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
};

export type WorkOrder = {
  id: string; number: string; date: string; customerId?: string; customer: string; phone?: string;
  vehicleId?: string; vehicle: string; plate?: string; vin?: string; mileage?: number;
  fleetId?: string; company?: string; driverId?: string; driver?: string; driverPhone?: string;
  authorizedContact?: string; po?: string; complaint?: string; diagnosis?: string; workPerformed?: string;
  technician?: string; status: WorkOrderStatus; laborItems: LaborItem[]; partItems: PartItem[];
  outsource: number; discount: number; taxRate: number; taxOverride?: number; laborTotal: number; partsTotal: number;
  partsCost: number; tax: number; total: number; paid: number; balance: number; grossProfit: number;
  paymentMethod?: string; billingDueDate?: string; inventoryCommitted?: boolean; notes?: string;
  technicianUserId?: string;
  claimedAt?: string; claimedBy?: string;
  technicianCompletedAt?: string; completedBy?: string; completedByUserId?: string;
  archivedAt?: string; archivedBy?: string; archiveReason?: string;
  inspectionChecklist?: InspectionChecklist;
  reviewStatus?: '未提交' | '待审查' | '已通过' | '退回补充';
  reviewNotes?: string; submittedForReviewAt?: string; reviewedBy?: string; reviewedAt?: string;
  reviewHistory?: ReviewHistoryItem[];
  evidencePhotos?: EvidencePhoto[];
  customerSignature?: string;
  customerSignedAt?: string;
  customerSignedBy?: string;
  settlementTotal?: number;
  customerApprovalStatus?: '未发送' | '待客户确认' | '客户已批准' | '客户已拒绝' | '已过期';
  customerApprovalAt?: string;
  customerApprovalBy?: string;
  customerApprovalNote?: string;
  customerApprovalUrl?: string;
  workflowStage?: '接车登记' | '技师诊断' | '报价待确认' | '维修施工' | '完工待结账' | '已结账';
  complaintEn?: string; diagnosisEn?: string; workPerformedEn?: string;
  printTime?: string; workTimeNote?: string;
  documentSendHistory?: Array<{
    id: string; documentType: string; email?: string; phone?: string; channel?: 'email' | 'sms'; sentAt: string;
    status: 'sent' | 'queued' | 'mail-client' | 'failed'; providerId?: string; error?: string;
  }>;
};

export type ApprovalRequest = {
  id: string; workOrderId?: string; workOrderNumber?: string;
  type: '删除工单' | '工单折扣' | '实际结账金额' | '支出'; status: '待授权' | '已批准' | '已拒绝' | '已执行';
  requestedBy: string; requestedById: string; requestedAt: string; reason: string;
  oldValue?: number; newValue?: number; proposedOrder?: WorkOrder; proposedExpense?: Expense;
  approvedBy?: string; approvedById?: string; approvedAt?: string; decisionNote?: string;
};

export type ChangeLog = {
  id: string; workOrderId: string; workOrderNumber: string; action: string;
  actor: string; actorId: string; at: string; detail: string; before?: unknown; after?: unknown;
};

export type InventoryLog = {
  id: string; date: string; partId: string; partNo: string; partName: string; type: string;
  change: number; before: number; after: number; reference?: string; note?: string;
  unitCost?: number; totalCost?: number;
};

export type Payment = {
  id: string; date: string; workOrderId: string; workOrderNumber: string; customer: string;
  amount: number; method: string; reference?: string; note?: string;
  splits?: Array<{ method: string; amount: number }>;
  archivedAt?: string;
};

export type Expense = { id: string; date: string; category: string; vendor?: string; amount: number; method?: string; note?: string };

export type Campaign = {
  id: string; name: string; start: string; end: string; benefit: string;
  warrantyMonths: number; warrantyMiles: number; partsFree: boolean; laborFree: boolean;
  terms?: string; status: '启用' | '停用';
};

export type Warranty = {
  id: string; vehicleId?: string; vehicle: string; plate?: string; item: string;
  originalRO?: string; start: string; end: string; mileageLimit: number;
  coverage: '仅配件' | '仅人工' | '配件和人工'; status: '有效' | '已使用' | '已到期' | '作废'; notes?: string;
};

export type ShopSettings = {
  id: string; shopName: string; address: string; phone: string; email?: string;
  defaultLaborRate: number; defaultTaxRate: number; invoiceTerms?: string;
};

export type ServicePackage = {
  id: string; name: string; laborDescription: string;
  billingMode: 'hourly' | 'flat'; hours: number; rate: number; flatAmount?: number;
  parts: Array<{ partId: string; qty: number }>;
  archived?: boolean; archivedAt?: string; archivedBy?: string; archiveReason?: string;
};

export type AppStore = {
  customers: Customer[]; fleets: Fleet[]; drivers: Driver[]; vehicles: Vehicle[];
  workOrders: WorkOrder[]; parts: Part[]; inventoryLogs: InventoryLog[];
  payments: Payment[]; expenses: Expense[]; settings: ShopSettings[];
  campaigns: Campaign[]; warranties: Warranty[]; servicePackages: ServicePackage[];
  approvalRequests: ApprovalRequest[]; changeLogs: ChangeLog[];
  [key: string]: unknown[];
};
