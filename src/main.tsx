import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FormalGate } from './FormalGate';
import type { CloudRow, CloudSession, CloudStore, StaffMember } from './lib/cloud';
import { decodeVin, escapeHtml, money, recalculateWorkOrder, today, uid } from './lib/erp';
import { MONTHLY_BILLING_TERM, MONTHLY_PAYMENT_METHOD, nextMonthlyBillingDate } from './lib/billing';
import type { AppStore, ApprovalRequest, Campaign, ChangeLog, Customer, Driver, Expense, Fleet, InventoryLog, Part, Payment, ServicePackage, ShopSettings, Vehicle, Warranty, WorkOrder } from './types';
import { WorkOrderEditor } from './WorkOrderEditor';
import { SmartTools } from './SmartTools';
import { ActivityCenter } from './ActivityCenter';
import { StaffPage } from './StaffPage';
import { BRAND_LOGO_SVG } from './brandLogo';
import { PwaInstall } from './PwaInstall';
import { registerPwa } from './pwa';
import { recognizeVehiclePhoto } from './lib/ocr';
import { CustomerApprovalPage } from './CustomerApprovalPage';
import { printDocumentV077 } from './printDocument';
import { printRepairHistory } from './printRepairHistory';
import { PublicWebsite } from './PublicWebsite';
import './styles.css';
import './v0763.css';
import './extra.css';
import './v0770.css';
import './v0780.css';

type Page = 'dashboard' | 'customers' | 'fleets' | 'vehicles' | 'workOrders' | 'parts' | 'finance' | 'campaigns' | 'staff' | 'smart' | 'settings';
type ModalState = { type: 'customer' | 'fleet' | 'driver' | 'vehicle' | 'part' | 'expense' | 'campaign' | 'warranty' | 'settings'; value?: Record<string, unknown> } | null;

const emptyStore: AppStore = { customers: [], fleets: [], drivers: [], vehicles: [], workOrders: [], parts: [], inventoryLogs: [], payments: [], expenses: [], settings: [], campaigns: [], warranties: [], servicePackages: [], approvalRequests: [], changeLogs: [] };
const defaultSettings: ShopSettings = { id: '00000000-0000-4000-8000-000000000075', shopName: 'Z&G AUTO REPAIR', address: '319 Agostino Rd, San Gabriel, CA 91776', phone: '626-508-0888', email: '', defaultLaborRate: 165, defaultTaxRate: 9.5, invoiceTerms: 'Thank you for your business.' };

const nav: Array<{ id: Page; icon: string; label: string }> = [
  { id: 'dashboard', icon: '⌂', label: '经营首页' }, { id: 'customers', icon: '👤', label: '客户管理' },
  { id: 'fleets', icon: '🚛', label: '车队与司机' }, { id: 'vehicles', icon: '🚗', label: '车辆管理' },
  { id: 'workOrders', icon: '▤', label: '维修工单' }, { id: 'parts', icon: '▦', label: '库存管理' },
  { id: 'finance', icon: '$', label: '财务与收款' }, { id: 'smart', icon: '✦', label: '智能工具' },
  { id: 'campaigns', icon: '★', label: '活动与保修' }, { id: 'staff', icon: '♙', label: '员工与权限' },
  { id: 'settings', icon: '⚙', label: '系统设置' },
];

const roleDefaults: Record<string, string[]> = {
  owner: ['*'],
  manager: ['customers', 'customerContact', 'workOrders', 'createWorkOrders', 'diagnosis', 'pricing', 'assignTechnician', 'collectPayment', 'printDocuments', 'finance', 'inventory', 'campaigns', 'staff', 'archive', 'approve', 'smart', 'settings'],
  frontdesk: ['customers', 'customerContact', 'workOrders', 'createWorkOrders', 'diagnosis', 'pricing', 'assignTechnician', 'collectPayment', 'printDocuments', 'campaigns', 'smart'],
  technician: ['assignedWorkOrders', 'claimWorkOrders', 'completeWorkOrders', 'diagnosis', 'smart'],
  finance: ['customers', 'customerContact', 'workOrders', 'pricing', 'collectPayment', 'printDocuments', 'finance', 'approve'],
  warehouse: ['workOrders', 'inventory'],
};

function can(cloud: CloudSession, key: string) {
  if (cloud.role === 'owner') return true;
  if (Object.prototype.hasOwnProperty.call(cloud.permissions, key)) return Boolean(cloud.permissions[key]);
  return (roleDefaults[cloud.role] || []).includes(key);
}

function canOpenPage(cloud: CloudSession, page: Page) {
  if (page === 'dashboard') return true;
  const map: Partial<Record<Page, string>> = { customers: 'customers', fleets: 'customers', vehicles: 'customers', workOrders: cloud.role === 'technician' ? 'assignedWorkOrders' : 'workOrders', parts: 'inventory', finance: 'finance', campaigns: 'campaigns', staff: 'staff', smart: 'smart', settings: 'settings' };
  return can(cloud, map[page] || page);
}

function compactWorkOrderSnapshot(value?: WorkOrder) {
  if (!value) return value;
  return { ...value, evidencePhotos: [] };
}

async function evidenceContent(value: string) {
  if (value.startsWith('data:')) return value.split(',')[1] || '';
  const response = await fetch(value);
  if (!response.ok) throw new Error('无法读取证据照片附件。');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function App({ cloud }: { cloud: CloudSession }) {
  const [store, setStore] = useState<AppStore>(emptyStore);
  const [page, setPage] = useState<Page>('dashboard');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [displayName, setDisplayName] = useState(cloud.user.name || cloud.user.email.split('@')[0]);
  const [modal, setModal] = useState<ModalState>(null);
  const [editingOrder, setEditingOrder] = useState<WorkOrder | 'new' | null>(null);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const refreshRequestId = useRef(0);
  const mutationGeneration = useRef(0);
  const paymentInFlight = useRef(new Set<string>());
  const numberRepairInFlight = useRef(false);

  const refresh = async (quiet = false) => {
    const requestId = ++refreshRequestId.current;
    const mutationAtStart = mutationGeneration.current;
    if (!quiet) setLoading(true);
    try {
      const loaded = normalizeStore(await cloud.loadStore());
      if (requestId !== refreshRequestId.current || mutationAtStart !== mutationGeneration.current) return;
      setStore(loaded);
    }
    catch (error) { if (!quiet) alert(`读取服务器失败：${error instanceof Error ? error.message : error}`); }
    finally { if (!quiet) setLoading(false); }
  };

  useEffect(() => {
    void refresh();
    void cloud.listStaff().then(data => setStaffMembers(data.members.filter(item => item.status === 'active'))).catch(() => undefined);
    return cloud.subscribe(() => { void refresh(true); });
  }, [cloud.organizationId]);

  const settings = store.settings[0] || defaultSettings;
  const actorName = displayName || cloud.user.name || cloud.user.email;

  const searchSuggestions = useMemo(() => {
    const query = normalizeSearch(searchDraft);
    if (!query) return [] as Array<{ page: Page; label: string; meta: string; query: string }>;
    const candidates: Array<{ page: Page; label: string; meta: string; query: string; haystack: string }> = [];
    for (const item of store.customers) candidates.push({ page: 'customers', label: item.name, meta: `客户 · ${item.phone || ''}`, query: item.phone || item.name, haystack: `${item.name} ${item.phone} ${item.email || ''}` });
    for (const item of store.fleets) candidates.push({ page: 'fleets', label: item.company, meta: `车队 · ${item.phone || ''}`, query: item.company, haystack: `${item.company} ${item.phone} ${item.billingEmail || ''}` });
    for (const item of store.drivers) candidates.push({ page: 'fleets', label: item.name, meta: `司机 · ${item.phone || ''}`, query: item.phone || item.name, haystack: `${item.name} ${item.phone} ${item.company || ''}` });
    for (const item of store.vehicles) candidates.push({ page: 'vehicles', label: item.plate || item.vin || `${item.year} ${item.make}`, meta: `${item.year} ${item.make} ${item.model} · ${item.vin || ''}`, query: item.plate || item.vin, haystack: `${item.plate} ${item.vin} ${item.year} ${item.make} ${item.model} ${item.ownerName || ''}` });
    for (const item of store.workOrders) candidates.push({ page: 'workOrders', label: item.number, meta: `${item.customer} · ${item.plate}`, query: item.number, haystack: `${item.number} ${item.customer} ${item.phone} ${item.plate} ${item.vin} ${item.driver || ''}` });
    return candidates.filter(item => normalizeSearch(item.haystack).includes(query)).slice(0, 8);
  }, [searchDraft, store]);

  const runGlobalSearch = () => {
    const query = searchDraft.trim();
    setSearch(query);
    if (!query) return;
    const matches = (rows: object[]) => filterRows(rows, query).length > 0;
    if (matches(store.workOrders)) setPage('workOrders');
    else if (matches(store.vehicles)) setPage('vehicles');
    else if (matches(store.customers)) setPage('customers');
    else if (matches([...store.fleets, ...store.drivers])) setPage('fleets');
    else if (matches(store.parts)) setPage('parts');
  };

  const editOwnProfile = async () => {
    const nextName = prompt('请输入您希望在首页和维修工单上显示的姓名：', actorName);
    if (!nextName?.trim() || nextName.trim() === actorName) return;
    try {
      await cloud.updateOwnProfile(nextName.trim());
      setDisplayName(nextName.trim());
      const data = await cloud.listStaff();
      setStaffMembers(data.members.filter(item => item.status === 'active'));
      alert('姓名已保存。以后领取和完成工单都会记录这个姓名。');
    } catch (error) {
      alert(`姓名保存失败：${error instanceof Error ? error.message : error}\n请确认员工账号已经启用。`);
    }
  };

  const persist = async <T extends { id: string }>(module: keyof AppStore, row: T) => {
    mutationGeneration.current += 1;
    setSyncing(true);
    const previous = store;
    setStore(current => ({ ...current, [module]: upsertLocal(current[module] as unknown as T[], row) }));
    try { await cloud.upsertRecord(String(module), row as unknown as CloudRow); }
    catch (error) { setStore(previous); alert(`保存失败：${error instanceof Error ? error.message : error}`); throw error; }
    finally { mutationGeneration.current += 1; setSyncing(false); }
  };

  const remove = async (module: keyof AppStore, id: string) => {
    const rows = store[module] as unknown as Array<Record<string, unknown> & { id: string }>;
    const existing = rows.find(item => item.id === id);
    if (!existing) return;
    const reason = prompt('根据数据保留规则，该记录不会被删除，只会作废归档。请输入原因：', '资料录入错误');
    if (!reason?.trim()) return;
    const archived = { ...existing, archived: true, archivedAt: new Date().toISOString(), archivedBy: actorName, archiveReason: reason.trim() };
    setSyncing(true);
    const previous = store;
    setStore(current => ({ ...current, [module]: upsertLocal(current[module] as unknown as Array<Record<string, unknown> & { id: string }>, archived) }));
    try { await cloud.upsertRecord(String(module), archived as unknown as CloudRow); }
    catch (error) { setStore(previous); alert(`归档失败：${error instanceof Error ? error.message : error}`); }
    finally { setSyncing(false); }
  };

  const writeChangeLog = async (order: WorkOrder, action: string, detail: string, before?: unknown, after?: unknown) => {
    const log: ChangeLog = {
      id: uid(), workOrderId: order.id, workOrderNumber: order.number, action,
      actor: actorName, actorId: cloud.user.id, at: new Date().toISOString(), detail,
      before: compactWorkOrderSnapshot(before as WorkOrder | undefined),
      after: compactWorkOrderSnapshot(after as WorkOrder | undefined),
    };
    await persist('changeLogs', log);
  };

  const requestApproval = async (request: Omit<ApprovalRequest, 'id' | 'status' | 'requestedBy' | 'requestedById' | 'requestedAt'>) => {
    const row: ApprovalRequest = {
      ...request,
      proposedOrder: compactWorkOrderSnapshot(request.proposedOrder),
      id: uid(), status: '待授权', requestedBy: actorName,
      requestedById: cloud.user.id, requestedAt: new Date().toISOString(),
    };
    await persist('approvalRequests', row);
    const relatedOrder = store.workOrders.find(item => item.id === row.workOrderId) || row.proposedOrder;
    if (relatedOrder) await writeChangeLog(relatedOrder, '申请双人授权', `${row.type}：${row.reason}`);
  };

  const saveWorkOrder = async (rawOrder: WorkOrder, keepOpen = false): Promise<WorkOrder | undefined> => {
    const selectedOrderId = editingOrder !== 'new' ? editingOrder?.id : undefined;
    const existingOrder = store.workOrders.find(item => item.id === rawOrder.id);
    const continuingNewOrder = editingOrder === 'new';
    if (existingOrder && !continuingNewOrder && selectedOrderId !== rawOrder.id) {
      alert(`为了保护历史工单，当前没有明确选中 ${rawOrder.number}，本次修改不会保存。请返回工单列表并重新点击该工单后再编辑。`);
      return;
    }
    if (!existingOrder && editingOrder !== 'new') {
      alert('当前没有通过“新建工单”进入编辑，本次内容不会保存。');
      return;
    }
    let numberedOrder = rawOrder;
    const needsOfficialNumber = !/^RO-\d{4}-\d+$/i.test(String(rawOrder.number || ''));
    if (needsOfficialNumber && (continuingNewOrder || !!existingOrder)) {
      try {
        const assignedNumber = await cloud.reserveWorkOrderNumber(rawOrder.id);
        numberedOrder = { ...rawOrder, number: assignedNumber };
      } catch (error) {
        alert(`无法取得唯一工单号，本次内容尚未保存。${error instanceof Error ? `\n${error.message}` : ''}`);
        return;
      }
    }
    const computedOrder = recalculateWorkOrder({ ...numberedOrder, settlementTotal: undefined });
    const order = recalculateWorkOrder(numberedOrder);
    const old = store.workOrders.find(item => item.id === order.id);
    const oldComputed = old ? recalculateWorkOrder({ ...old, settlementTotal: undefined }) : undefined;
    const discountNeedsApproval = Number(order.discount || 0) !== Number(old?.discount || 0);
    const newHasOverride = rawOrder.settlementTotal !== undefined && Math.abs(Number(rawOrder.settlementTotal) - computedOrder.total) > 0.009;
    const oldHasOverride = !!old && old.settlementTotal !== undefined && Math.abs(Number(old.settlementTotal) - Number(oldComputed?.total || 0)) > 0.009;
    const settlementNeedsApproval = newHasOverride && (!oldHasOverride || Number(rawOrder.settlementTotal) !== Number(old?.settlementTotal));
    // Payment totals are controlled by the payment ledger. An editor that was
    // opened before a payment must never be allowed to write an older `paid`
    // value back over the settled work order.
    const authoritativePaid = old ? Number(old.paid || 0) : Number(order.paid || 0);
    if (order.total + 0.009 < authoritativePaid) {
      alert(`不能把工单总额改为 ${money(order.total)}：本单已经收款 ${money(authoritativePaid)}。请先由管理员更正收款流水，再修改工单金额。`);
      return;
    }
    const hasPaymentLedger = store.payments.some(payment => payment.workOrderId === order.id && !payment.archivedAt);
    const authoritativePaymentMethod = old && hasPaymentLedger ? old.paymentMethod : order.paymentMethod;
    const authoritativeBillingDueDate = old && hasPaymentLedger ? old.billingDueDate : order.billingDueDate;
    const deliveredOnServer = old?.status === '已交车';
    const currentOrder = recalculateWorkOrder({
      ...order, paid: authoritativePaid, paymentMethod: authoritativePaymentMethod, billingDueDate: authoritativeBillingDueDate,
      status: deliveredOnServer ? '已交车' : order.status, workflowStage: deliveredOnServer ? '已结账' : order.workflowStage,
    });
    const safeOrder = recalculateWorkOrder({ ...currentOrder, discount: old?.discount || 0, settlementTotal: oldHasOverride ? old?.settlementTotal : undefined });
    const oldUsage = usageMap(old && old.status !== '已取消' ? old : undefined);
    const newUsage = usageMap(order.status !== '已取消' ? order : undefined);
    const partChanges: Array<{ part: Part; nextQty: number; delta: number }> = [];
    for (const partId of new Set([...Object.keys(oldUsage), ...Object.keys(newUsage)])) {
      const part = store.parts.find(item => item.id === partId);
      if (!part) continue;
      const delta = (newUsage[partId] || 0) - (oldUsage[partId] || 0);
      const nextQty = Number(part.qty || 0) - delta;
      if (nextQty < 0) {
        alert(`${part.partNo} ${part.name} 库存不足。当前 ${part.qty}，本次还需 ${delta}。`);
        return undefined;
      }
      if (delta) partChanges.push({ part, nextQty, delta });
    }
    try {
      for (const change of partChanges) {
        await persist('parts', { ...change.part, qty: change.nextQty });
        const log: InventoryLog = { id: uid(), date: new Date().toISOString(), partId: change.part.id, partNo: change.part.partNo, partName: change.part.name, type: change.delta > 0 ? '工单领用' : '工单退回', change: -change.delta, before: change.part.qty, after: change.nextQty, reference: order.number };
        await persist('inventoryLogs', log);
      }
      const savedOrder = discountNeedsApproval || settlementNeedsApproval ? safeOrder : currentOrder;
      await persist('workOrders', { ...savedOrder, inventoryCommitted: savedOrder.status !== '已取消' });
      await writeChangeLog(savedOrder, old ? '修改工单' : '新建工单', old ? '工单内容已更新并保存到服务器' : '工单已建立并保存到服务器', old, savedOrder);
      if (discountNeedsApproval) await requestApproval({ workOrderId: order.id, workOrderNumber: order.number, type: '工单折扣', reason: `折扣由 ${money(old?.discount || 0)} 调整为 ${money(order.discount)}`, oldValue: old?.discount || 0, newValue: order.discount, proposedOrder: savedOrder });
      if (settlementNeedsApproval) await requestApproval({ workOrderId: order.id, workOrderNumber: order.number, type: '实际结账金额', reason: `实际结账金额申请调整为 ${money(order.settlementTotal)}`, oldValue: old?.settlementTotal ?? order.total, newValue: order.settlementTotal, proposedOrder: savedOrder });
      if (keepOpen) setEditingOrder(savedOrder);
      else { setEditingOrder(null); setPage('workOrders'); }
      alert(keepOpen ? `工单 ${order.number} 当前进度已保存，可以继续填写。` : discountNeedsApproval || settlementNeedsApproval ? `工单 ${order.number} 已保存到服务器；折扣/结账金额将在第二人授权后生效。` : `工单 ${order.number} 已保存到正式服务器，其他账号会自动同步。`);
      return savedOrder;
    } catch { /* persist already explains the error */ }
  };

  useEffect(() => {
    if (loading || cloud.role !== 'owner' || numberRepairInFlight.current) return;
    const unnumberedOrders = store.workOrders.filter(order => !/^RO-\d{4}-\d+$/i.test(String(order.number || '')));
    if (!unnumberedOrders.length) return;
    numberRepairInFlight.current = true;
    void (async () => {
      const assigned = new Map<string, string>();
      try {
        setSyncing(true);
        for (const order of unnumberedOrders) {
          const number = await cloud.reserveWorkOrderNumber(order.id);
          const repaired = { ...order, number };
          await cloud.upsertRecord('workOrders', repaired as unknown as CloudRow);
          assigned.set(order.id, number);
          for (const payment of store.payments.filter(item => item.workOrderId === order.id && item.workOrderNumber !== number)) {
            await cloud.upsertRecord('payments', { ...payment, workOrderNumber: number } as unknown as CloudRow);
          }
        }
        setStore(current => ({
          ...current,
          workOrders: current.workOrders.map(order => assigned.has(order.id) ? { ...order, number: assigned.get(order.id)! } : order),
          payments: current.payments.map(payment => assigned.has(payment.workOrderId) ? { ...payment, workOrderNumber: assigned.get(payment.workOrderId)! } : payment),
        }));
        alert(`历史工单编号修复完成：已为 ${assigned.size} 张工单分配正式编号。报价单、工单、发票和收据现在都可以正常预览。`);
      } catch (error) {
        alert(`历史工单编号修复未全部完成：${error instanceof Error ? error.message : error}\n系统下次打开时会继续修复剩余工单。`);
      } finally {
        numberRepairInFlight.current = false;
        setSyncing(false);
      }
    })();
  }, [loading, cloud.role, cloud.organizationId, store.workOrders, store.payments]);

  const checkoutAndDeliver = async (draft: WorkOrder, paymentMethod: string): Promise<WorkOrder | undefined> => {
    if (!can(cloud, 'collectPayment')) {
      alert('当前员工账号没有“收款并交车”权限，请由老板、经理、前台或财务账号操作。');
      return;
    }
    if (paymentInFlight.current.has(draft.id)) {
      alert('这张工单正在结账，请不要重复点击。');
      return;
    }
    const saved = store.workOrders.find(item => item.id === draft.id);
    if (!saved) {
      alert('请先保存工单，再确认结账交车。');
      return;
    }
    const base = recalculateWorkOrder({
      ...saved,
      paid: Number(saved.paid || 0),
      paymentMethod: paymentMethod || saved.paymentMethod,
    });
    const monthlyBilling = base.paymentMethod === MONTHLY_PAYMENT_METHOD || base.paymentMethod === '月结';
    paymentInFlight.current.add(base.id);
    setSyncing(true);
    try {
      let settled = base;
      let payment: Payment | undefined;
      if (base.balance > 0.009 && !monthlyBilling) {
        payment = {
          id: uid(), date: new Date().toISOString(), workOrderId: base.id, workOrderNumber: base.number,
          customer: base.customer, amount: base.balance, method: paymentMethod || '现金', note: '结账交车全额付款',
        };
        settled = recalculateWorkOrder(await cloud.recordPayment(base.id, payment as unknown as CloudRow) as unknown as WorkOrder);
      }
      const delivered = recalculateWorkOrder({ ...settled, status: '已交车', workflowStage: '已结账' });
      await persist('workOrders', delivered);
      setStore(current => ({
        ...current,
        payments: payment ? upsertLocal(current.payments, payment as Payment) : current.payments,
        workOrders: upsertLocal(current.workOrders, delivered),
      }));
      alert(payment
        ? `已按“${payment.method}”收款 ${money(payment.amount)}，工单已结清并交车。`
        : monthlyBilling ? '月结工单已确认交车，欠款继续保留到账期。' : '工单已确认交车。');
      setEditingOrder(null);
      setPage('workOrders');
      return delivered;
    } catch (error) {
      alert(`结账交车失败：${error instanceof Error ? error.message : error}\n系统不会重复记录收款，请刷新后核对。`);
      return;
    } finally {
      paymentInFlight.current.delete(base.id);
      setSyncing(false);
    }
  };

  const executeWorkOrderArchive = async (order: WorkOrder, reason: string) => {
    if (order.status !== '已取消') {
      for (const [partId, qty] of Object.entries(usageMap(order))) {
        const part = store.parts.find(item => item.id === partId); if (!part) continue;
        const next = part.qty + qty;
        await persist('parts', { ...part, qty: next });
        await persist('inventoryLogs', { id: uid(), date: new Date().toISOString(), partId, partNo: part.partNo, partName: part.name, type: '工单作废退回', change: qty, before: part.qty, after: next, reference: order.number } as InventoryLog);
      }
    }
    const archived = recalculateWorkOrder({ ...order, status: '已取消', archivedAt: new Date().toISOString(), archivedBy: actorName, archiveReason: reason, inventoryCommitted: false });
    await persist('workOrders', archived);
    await writeChangeLog(archived, '工单作废并归档', `原始工单永久保留。原因：${reason}`, order, archived);
  };

  const deleteWorkOrder = async (order: WorkOrder) => {
    const reason = prompt(`作废并归档工单 ${order.number} 需要另一位员工授权。\n原始资料不会删除。请输入原因：`, '重复/错误工单');
    if (!reason?.trim()) return;
    if (store.approvalRequests.some(item => item.workOrderId === order.id && item.type === '删除工单' && item.status === '待授权')) return alert('这张工单已有待处理的作废归档授权。');
    await requestApproval({ workOrderId: order.id, workOrderNumber: order.number, type: '删除工单', reason: reason.trim(), proposedOrder: order });
    alert('作废归档申请已提交。第二人批准后会标记作废，但原始工单和修改记录永久保留。');
  };

  const requestPaymentCorrection = async (payment: Payment) => {
    if (store.approvalRequests.some(item => item.paymentId === payment.id && item.type === '收款更正' && item.status === '待授权')) return alert('这笔收款已经有待处理的双人审核申请。');
    const rawAmount = prompt(`收款更正申请\n工单：${payment.workOrderNumber}\n当前实收：${money(payment.amount)}\n\n请输入更正后的实收金额；输入 0 表示作废：`, String(payment.amount));
    if (rawAmount === null) return;
    const amount = Math.round(Number(rawAmount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0) return alert('请输入大于或等于 0 的正确金额。');
    const method = amount > 0 ? (prompt('更正后的付款方式：', payment.method || '现金') || payment.method || '现金') : payment.method;
    const reason = prompt('请输入更正原因（必填）：', '收款录入错误');
    if (!reason?.trim()) return;
    const proposedPayment: Payment = { ...payment, amount, method, splits: undefined, status: amount <= 0 ? '已作废' : '已更正', originalAmount: payment.originalAmount ?? payment.amount, correctedAt: new Date().toISOString(), correctedBy: actorName, correctionReason: reason.trim(), archivedAt: amount <= 0 ? new Date().toISOString() : undefined };
    await requestApproval({ workOrderId: payment.workOrderId, workOrderNumber: payment.workOrderNumber, type: '收款更正', reason: reason.trim(), oldValue: payment.amount, newValue: amount, paymentId: payment.id, proposedPayment });
    alert('收款更正申请已提交。必须由另一位有审核权限的员工批准后才会生效。');
  };

  const approveRequest = async (request: ApprovalRequest) => {
    if (request.requestedById === cloud.user.id) return alert('双人授权规则：申请人不能批准自己的申请。请让另一位有审批权限的员工登录处理。');
    if (request.type === '收款更正') {
      const payment = store.payments.find(item => item.id === request.paymentId);
      const proposed = request.proposedPayment;
      const order = store.workOrders.find(item => item.id === request.workOrderId);
      if (!payment || !proposed || !order) return alert('收款更正资料不完整，无法批准。');
      if (!confirm(`批准收款更正？\n工单：${request.workOrderNumber}\n原实收：${money(payment.amount)}\n更正后：${money(proposed.amount)}\n申请人：${request.requestedBy}\n原因：${request.reason}`)) return;
      const otherPaid = store.payments.filter(item => item.workOrderId === order.id && item.id !== payment.id && !item.archivedAt).reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const paid = Math.round((otherPaid + Number(proposed.amount || 0)) * 100) / 100;
      const recalculated = recalculateWorkOrder({ ...order, paid });
      const reopened = recalculated.balance > 0.009 && order.status === '已交车' ? recalculateWorkOrder({ ...recalculated, status: '已完成', workflowStage: '完工待结账' }) : recalculated;
      await persist('payments', proposed);
      await persist('workOrders', reopened);
      await persist('approvalRequests', { ...request, status: '已执行', approvedBy: actorName, approvedById: cloud.user.id, approvedAt: new Date().toISOString() });
      await writeChangeLog(reopened, '双人授权收款更正', `收款由 ${money(payment.amount)} 更正为 ${money(proposed.amount)}；申请人 ${request.requestedBy}，批准人 ${actorName}。原因：${request.reason}`, order, reopened);
      return alert(`收款已更正为 ${money(proposed.amount)}。${reopened.balance > 0.009 ? `工单已重新打开，当前欠款 ${money(reopened.balance)}。` : '工单仍为结清状态。'}`);
    }
    if (request.type === '支出') {
      const expense = request.proposedExpense;
      if (!expense) return alert('支出申请资料不完整，无法批准。');
      if (!confirm(`批准这笔支出？\n类别：${expense.category}\n收款方：${expense.vendor || '—'}\n金额：${money(expense.amount)}\n申请人：${request.requestedBy}\n备注：${expense.note || '—'}`)) return;
      await persist('expenses', expense);
      await persist('approvalRequests', { ...request, status: '已执行', approvedBy: actorName, approvedById: cloud.user.id, approvedAt: new Date().toISOString() });
      return alert(`支出 ${money(expense.amount)} 已由 ${actorName} 批准并计入财务。`);
    }
    const order = store.workOrders.find(item => item.id === request.workOrderId);
    if (!order) return alert('关联工单不存在。');
    if (!confirm(`批准“${request.type}”？\n工单：${request.workOrderNumber}\n申请人：${request.requestedBy}\n原因：${request.reason}`)) return;
    if (request.type === '删除工单') await executeWorkOrderArchive(order, request.reason);
    if (request.type === '工单折扣') await persist('workOrders', recalculateWorkOrder({ ...order, discount: Number(request.newValue || 0) }));
    if (request.type === '实际结账金额') {
      const proposedTotal = Number(request.newValue || 0);
      if (proposedTotal + 0.009 < Number(order.paid || 0)) return alert(`无法批准：拟调整金额 ${money(proposedTotal)} 低于已收款 ${money(order.paid)}。请先更正收款流水。`);
      await persist('workOrders', recalculateWorkOrder({ ...order, settlementTotal: proposedTotal }));
    }
    await persist('approvalRequests', { ...request, status: '已执行', approvedBy: actorName, approvedById: cloud.user.id, approvedAt: new Date().toISOString() });
    await writeChangeLog(order, '双人授权已执行', `${request.type}由 ${actorName} 批准；申请人 ${request.requestedBy}。`, request.oldValue, request.newValue);
  };

  const rejectRequest = async (request: ApprovalRequest) => {
    if (request.requestedById === cloud.user.id) return alert('申请人不能处理自己的授权申请。');
    const note = prompt('请输入拒绝原因：', '资料不足/不同意调整'); if (!note?.trim()) return;
    await persist('approvalRequests', { ...request, status: '已拒绝', approvedBy: actorName, approvedById: cloud.user.id, approvedAt: new Date().toISOString(), decisionNote: note.trim() });
    const order = store.workOrders.find(item => item.id === request.workOrderId);
    if (order) await writeChangeLog(order, '双人授权被拒绝', `${request.type}由 ${actorName} 拒绝：${note.trim()}`);
  };

  const addPayment = async (order: WorkOrder) => {
    if (!can(cloud, 'collectPayment')) return alert('当前员工账号没有“收款并交车”权限。');
    if (paymentInFlight.current.has(order.id)) return alert('这张工单的收款正在处理中，请不要重复点击。');
    if (order.status === '已交车') return alert('这张工单已经完成交车，请勿重复收款。');
    if (order.balance <= 0.009) {
      if (!confirm(`工单 ${order.number} 已经付清。\n确认现在完成交车？`)) return;
      await checkoutAndDeliver(order, order.paymentMethod || '现金');
      return;
    }
    const existingMonthlyBilling = order.paymentMethod === MONTHLY_PAYMENT_METHOD || order.paymentMethod === '月结';
    if (existingMonthlyBilling) {
      if (!confirm(`工单 ${order.number} 是月结客户。\n确认交车并保留欠款 ${money(order.balance)}？\n本次不会产生收款流水，也不会增加今日实收。`)) return;
      await checkoutAndDeliver(order, MONTHLY_PAYMENT_METHOD);
      return;
    }
    const paymentChoice = prompt(`工单 ${order.number}\n当前欠款：${money(order.balance)}\n\n请选择结账方式：\n1 = 全额付款\n2 = 部分付款\n3 = 月结（今日暂不收款）\n4 = 多种支付方式组合付款`, '1');
    if (paymentChoice === null) return;
    const choice = paymentChoice.trim();
    if (choice === '3' || choice === '月结') {
      const billingDueDate = nextMonthlyBillingDate();
      const monthlyOrder = recalculateWorkOrder({ ...order, paymentMethod: MONTHLY_PAYMENT_METHOD, billingDueDate });
      await checkoutAndDeliver(monthlyOrder, MONTHLY_PAYMENT_METHOD);
      return;
    }
    if (!['1', '2', '4', '全额付款', '部分付款', '组合付款'].includes(choice)) return alert('请选择 1、2、3 或 4。');
    let amount = order.balance;
    const mixedPayment = choice === '4' || choice === '组合付款';
    let paymentType = choice === '2' || choice === '部分付款' ? '部分付款' : '全额付款';
    if (paymentType === '部分付款') {
      const raw = prompt(`当前欠款 ${money(order.balance)}\n请输入本次实际收到的金额：`, '');
      if (raw === null) return;
      amount = Number(raw);
      if (!amount || amount <= 0 || amount >= order.balance - 0.009) return alert('部分付款金额必须大于 0，并且小于当前欠款。若已付清请选择“全额付款”。');
    }
    const splits: Array<{ method: string; amount: number }> = [];
    if (mixedPayment) {
      const rawTotal = prompt(`当前欠款 ${money(order.balance)}\n请输入本次组合付款总金额；留空表示全部付清：`, '');
      if (rawTotal === null) return;
      amount = rawTotal.trim() ? Number(rawTotal) : order.balance;
      if (!Number.isFinite(amount) || amount <= 0 || amount > order.balance + 0.009) return alert('组合付款总额必须大于 0，并且不能超过当前欠款。');
      paymentType = amount >= order.balance - 0.009 ? '全额付款' : '部分付款';
      let remaining = Math.round(amount * 100) / 100;
      while (remaining > 0.009) {
        const method = prompt(`组合付款剩余 ${money(remaining)}\n请输入付款方式：现金 / 刷卡 / 银行转账或 ACH / 支票 / Zelle / 扫码支付 / 在线付款 / 其他`, splits.length ? '银行转账 / ACH' : '现金');
        if (method === null) return;
        const rawSplit = prompt(`${method || '未记录'} 本次金额：`, String(remaining));
        if (rawSplit === null) return;
        const splitAmount = Math.round(Number(rawSplit) * 100) / 100;
        if (!Number.isFinite(splitAmount) || splitAmount <= 0 || splitAmount > remaining + 0.009) return alert('请输入正确金额，不能超过组合付款剩余金额。');
        splits.push({ method: method.trim() || '未记录', amount: splitAmount });
        remaining = Math.round((remaining - splitAmount) * 100) / 100;
      }
    }
    const method = mixedPayment ? splits.map(item => `${item.method} ${money(item.amount)}`).join(' ＋ ') : prompt('实际付款方式：现金 / 刷卡 / 银行转账或 ACH / 支票 / Zelle / 扫码支付 / 在线付款 / 其他', order.paymentMethod?.startsWith('月结') ? '现金' : order.paymentMethod || '现金') || '现金';
    const payment: Payment = { id: uid(), date: new Date().toISOString(), workOrderId: order.id, workOrderNumber: order.number, customer: order.customer, amount, method, note: mixedPayment ? `${paymentType} · 组合付款` : paymentType, splits: mixedPayment ? splits : undefined };
    paymentInFlight.current.add(order.id);
    setSyncing(true);
    try {
      const updatedOrder = recalculateWorkOrder(await cloud.recordPayment(order.id, payment as unknown as CloudRow) as unknown as WorkOrder);
      const deliveredOrder = recalculateWorkOrder({ ...updatedOrder, status: '已交车', workflowStage: '已结账' });
      await persist('workOrders', deliveredOrder);
      setStore(current => ({
        ...current,
        payments: upsertLocal(current.payments, payment),
        workOrders: upsertLocal(current.workOrders, deliveredOrder),
      }));
      alert(`${paymentType}已记录，并已完成交车。\n本次实收 ${money(amount)} 已计入今日收入。\n剩余欠款 ${money(deliveredOrder.balance)}。`);
    } catch (error) {
      alert(`收款失败：${error instanceof Error ? error.message : error}\n系统没有写入新的收款流水，请刷新后核对。`);
    } finally {
      paymentInFlight.current.delete(order.id);
      setSyncing(false);
    }
  };

  const receiveStock = async (part: Part, entry?: { qty: number; unitCost: number; reference: string }) => {
    const raw = entry ? String(entry.qty) : prompt(`${part.partNo} ${part.name}\n当前库存：${part.qty}\n请输入入库数量：`, '1');
    if (!raw) return; const qty = Number(raw); if (!qty || qty <= 0) return alert('请输入正确数量。');
    const rawCost = entry ? String(entry.unitCost) : prompt(`请输入本次真实采购单价（仅内部可见）：`, String(part.cost || 0));
    if (rawCost === null) return;
    const unitCost = Number(rawCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) return alert('请输入正确的采购单价。');
    const reference = entry ? entry.reference : prompt('请输入采购单/收据号码（可选）：', '') || '';
    const next = part.qty + qty;
    await persist('parts', { ...part, qty: next, cost: unitCost });
    await persist('inventoryLogs', { id: uid(), date: new Date().toISOString(), partId: part.id, partNo: part.partNo, partName: part.name, type: '采购入库', change: qty, before: part.qty, after: next, reference, unitCost, totalCost: qty * unitCost } as InventoryLog);
  };

  const claimWorkOrder = async (order: WorkOrder) => {
    if (order.archivedAt || ['已完成', '已交车', '已取消'].includes(order.status)) {
      return alert(`工单 ${order.number} 已经${order.status}，不能再领取。`);
    }
    if (order.technicianUserId && order.technicianUserId !== cloud.user.id) return alert(`这张工单已由 ${order.technician || '其他员工'} 领取。`);
    if (!confirm(`确定领取工单 ${order.number}？\n领取后会在工单和永久修改记录中显示您的姓名。`)) return;
    const updated = recalculateWorkOrder({ ...order, technicianUserId: cloud.user.id, technician: actorName, claimedAt: new Date().toISOString(), claimedBy: actorName, status: order.status === '等待检查' ? '维修中' : order.status });
    await persist('workOrders', updated);
    await writeChangeLog(updated, '员工领取工单', `${actorName} 自主领取了工单。`, order, updated);
  };

  const completeWorkOrder = async (order: WorkOrder) => {
    const assignedToMe = order.technicianUserId === cloud.user.id || order.technician === actorName || order.technician === cloud.user.email;
    if (!assignedToMe && !can(cloud, 'assignTechnician')) return alert('请先领取这张工单，或由经理分配后再完成维修。');
    if (!confirm(`确认工单 ${order.number} 的维修已经完成？\n系统会永久记录完成人和完成时间。`)) return;
    const now = new Date().toISOString();
    const updated = recalculateWorkOrder({ ...order, technicianUserId: order.technicianUserId || cloud.user.id, technician: order.technician || actorName, status: '已完成', workflowStage: '完工待结账', technicianCompletedAt: now, completedBy: actorName, completedByUserId: cloud.user.id });
    await persist('workOrders', updated);
    await writeChangeLog(updated, '维修完成', `${actorName} 标记维修完成。`, order, updated);
  };

  const openModal = (type: NonNullable<ModalState>['type'], value?: object) => setModal({ type, value: value ? { ...value } as Record<string, unknown> : undefined });
  const closeModal = () => setModal(null);

  const saveModal = async (type: NonNullable<ModalState>['type'], data: Record<string, unknown>) => {
    const row: Record<string, unknown> & { id: string } = { ...data, id: String(data.id || uid()) };
    if (type === 'customer') {
      const phone = normalizePhone(row.phone);
      const email = normalizeText(row.email);
      const duplicate = store.customers.find(item => item.id !== row.id && ((phone && normalizePhone(item.phone) === phone) || (email && normalizeText(item.email) === email)));
      if (duplicate) {
        const archivedCustomer = duplicate as Customer & { archived?: boolean; archivedAt?: string; archivedBy?: string; archiveReason?: string };
        const wasArchived = Boolean(archivedCustomer.archived);
        if (wasArchived) {
          const restore = confirm(`客户已经存在，但目前处于归档状态。\n\n现有客户：${duplicate.name}\n联系电话：${duplicate.phone || '未记录'}\n\n是否恢复这位客户并直接打开客户列表？`);
          if (!restore) return;
          await persist('customers', {
            ...duplicate,
            archived: false,
            archivedAt: undefined,
            archivedBy: undefined,
            archiveReason: undefined,
          });
        }
        closeModal();
        setSearch(duplicate.name || duplicate.phone || '');
        setSearchDraft(duplicate.name || duplicate.phone || '');
        setPage('customers');
        alert(`${wasArchived ? '客户已经恢复' : '已找到现有客户'}：${duplicate.name}\n联系电话：${duplicate.phone || '未记录'}\n系统已为您打开客户列表。`);
        return;
      }
    }
    if (type === 'fleet') {
      const phone = normalizePhone(row.phone);
      const email = normalizeText(row.billingEmail);
      const company = normalizeText(row.company);
      const duplicate = store.fleets.find(item => item.id !== row.id && ((phone && normalizePhone(item.phone) === phone) || (email && normalizeText(item.billingEmail) === email) || (company && normalizeText(item.company) === company)));
      if (duplicate) {
        const matchedBy = phone && normalizePhone(duplicate.phone) === phone ? `联系电话 ${duplicate.phone}` : email && normalizeText(duplicate.billingEmail) === email ? `账单邮箱 ${duplicate.billingEmail}` : `公司名称 ${duplicate.company}`;
        alert(`车队/公司已经存在，不能重复添加。\n匹配信息：${matchedBy}\n现有公司：${duplicate.company}\n联系人：${duplicate.contact || '未记录'}`);
        return;
      }
    }
    if (type === 'vehicle') {
      const plate = normalizeVehicleIdentifier(row.plate);
      const vin = normalizeVehicleIdentifier(row.vin);
      const duplicate = store.vehicles.find(item => item.id !== row.id && ((vin && normalizeVehicleIdentifier(item.vin) === vin) || (plate && normalizeVehicleIdentifier(item.plate) === plate)));
      if (duplicate) {
        const matchedBy = vin && normalizeVehicleIdentifier(duplicate.vin) === vin ? `VIN ${duplicate.vin}` : `车牌 ${duplicate.plate}`;
        alert(`车辆已经存在，不能重复添加。\n匹配信息：${matchedBy}\n现有车辆：${duplicate.year} ${duplicate.make} ${duplicate.model}\n所属客户：${duplicate.ownerName || '未记录'}`);
        return;
      }
      row.plate = plate;
      row.vin = vin;
    }
    if (type === 'driver' && row.fleetId) {
      const fleet = store.fleets.find(item => item.id === row.fleetId);
      if (fleet) row.company = fleet.company;
    }
    if (type === 'vehicle' && row.ownerId) {
      const owner = row.ownerType === '个人'
        ? store.customers.find(item => item.id === row.ownerId)
        : store.fleets.find(item => item.id === row.ownerId);
      if (owner) row.ownerName = 'name' in owner ? owner.name : owner.company;
      const driver = store.drivers.find(item => item.id === row.driverId);
      if (driver) { row.driverName = driver.name; row.driverPhone = driver.phone; }
    }
    if (type === 'warranty' && row.vehicleId) {
      const vehicle = store.vehicles.find(item => item.id === row.vehicleId);
      if (vehicle) { row.vehicle = `${vehicle.year} ${vehicle.make} ${vehicle.model}`; row.plate = vehicle.plate; }
    }
    if (type === 'part') {
      row.cost = Math.max(0, Number(row.cost) || 0);
      row.price = Math.max(0, Number(row.price) || 0);
      row.markupPercent = Math.max(0, Number(row.markupPercent) || 0);
    }
    if (type === 'expense') {
      const expense = row as unknown as Expense;
      if (!Number.isFinite(Number(expense.amount)) || Number(expense.amount) <= 0) return alert('请输入正确的支出金额。');
      await requestApproval({ type: '支出', reason: `${expense.category} · ${expense.vendor || '未填写收款方'} · ${money(expense.amount)}`, proposedExpense: expense });
      closeModal();
      return alert('支出申请已提交，必须由另一位有审批权限的员工批准后才会计入支出。');
    }
    if (type === 'settings') await persist('settings', row as unknown as ShopSettings);
    else await persist(`${type}s` as keyof AppStore, row as { id: string });
    closeModal();
    if (type === 'customer') {
      setSearch('');
      setSearchDraft('');
      setPage('customers');
      const verificationRequestId = ++refreshRequestId.current;
      const confirmedStore = normalizeStore(await cloud.loadStore());
      const confirmed = confirmedStore.customers.some(item => item.id === row.id && !(item as Customer & { archived?: boolean }).archived);
      if (!confirmed) throw new Error('服务器没有确认客户记录，请检查网络后重新保存。');
      if (verificationRequestId === refreshRequestId.current) setStore(confirmedStore);
      alert(`客户“${String(row.name || '')}”已保存并显示在客户列表。`);
    }
  };

  if (editingOrder) return <WorkOrderEditor key={editingOrder === 'new' ? 'new-work-order' : editingOrder.id} value={editingOrder === 'new' ? undefined : editingOrder} customers={store.customers} vehicles={store.vehicles} fleets={store.fleets} drivers={store.drivers} workOrders={store.workOrders} parts={store.parts.filter(item => item.inventoryType !== '日常消耗品')} servicePackages={store.servicePackages} settings={settings} nextNumber={nextWorkOrderNumber(store.workOrders)} onCreateVehicle={vehicle => persist('vehicles', vehicle)} onSaveServicePackage={(item: ServicePackage) => persist('servicePackages', item)} onDeleteServicePackage={(id: string) => remove('servicePackages', id)} onPrint={(order, type) => printDocumentV077(recalculateWorkOrder(order), settings, type, store.payments)} onSave={saveWorkOrder} onCheckoutAndDeliver={checkoutAndDeliver} onCancel={() => setEditingOrder(null)} cloud={cloud} currentUser={actorName} currentUserId={cloud.user.id} technicians={staffMembers} canApproveReview={can(cloud, 'approve')} canAssignTechnician={can(cloud, 'assignTechnician')} canEditPricing={can(cloud, 'pricing')} canViewFinancials={can(cloud, 'pricing') || can(cloud, 'finance')} canCheckoutAndDeliver={can(cloud, 'collectPayment')} canPrintDocuments={can(cloud, 'printDocuments')} />;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">Z&G</div><div><b>AUTO ERP</b><small>正式服务器版</small></div></div>
      <nav>{nav.filter(item => canOpenPage(cloud, item.id)).map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setSearch(''); setSearchDraft(''); }}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <div className="side-foot"><small>{cloud.organizationName}</small><b>{actorName}</b><span>{cloud.user.email}</span><button onClick={() => confirm('确定退出当前账号？') && void cloud.signOut()}>退出登录</button></div>
    </aside>
    <main className="main"><header className="topbar"><div className="global-search">⌕<input value={searchDraft} onChange={e => setSearchDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && runGlobalSearch()} placeholder="搜索客户、电话、VIN、车牌、工单、司机…" /><button type="button" onClick={runGlobalSearch}>搜索</button>{searchSuggestions.length > 0 && <div className="search-suggestions">{searchSuggestions.map((item, index) => <button type="button" key={`${item.page}-${item.label}-${index}`} onClick={() => { setSearchDraft(item.query); setSearch(item.query); setPage(item.page); }}><b>{item.label}</b><small>{item.meta}</small></button>)}</div>}</div><div className="top-status"><span className={syncing ? 'syncing' : ''}>{syncing ? '正在同步…' : '● 云端已同步'}</span><span>{actorName}</span><b>v0.82.4</b><button type="button" className="topbar-logout" onClick={() => confirm('确定退出当前账号？') && void cloud.signOut()}>退出</button></div></header>
      {loading ? <div className="loading">正在读取正式服务器数据…</div> : <PageContent page={page} search={search} store={store} settings={settings} cloud={cloud} setPage={setPage} openModal={openModal} setEditingOrder={setEditingOrder} persist={persist} remove={remove} receiveStock={receiveStock} addPayment={addPayment} deleteWorkOrder={deleteWorkOrder} requestPaymentCorrection={requestPaymentCorrection} approveRequest={approveRequest} rejectRequest={rejectRequest} claimWorkOrder={claimWorkOrder} completeWorkOrder={completeWorkOrder} actorName={actorName} editOwnProfile={editOwnProfile} />}
    </main>
    {modal && <EntityModal state={modal} store={store} settings={settings} cloud={cloud} onClose={closeModal} onSave={saveModal} />}
  </div>;
}

type ContentProps = {
  page: Page; search: string; store: AppStore; settings: ShopSettings; cloud: CloudSession;
  setPage: (page: Page) => void; openModal: (type: NonNullable<ModalState>['type'], value?: object) => void;
  setEditingOrder: (value: WorkOrder | 'new' | null) => void;
  persist: <T extends { id: string }>(module: keyof AppStore, row: T) => Promise<void>;
  remove: (module: keyof AppStore, id: string) => Promise<void>; receiveStock: (part: Part, entry?: { qty: number; unitCost: number; reference: string }) => Promise<void>;
  addPayment: (order: WorkOrder) => Promise<void>; deleteWorkOrder: (order: WorkOrder) => Promise<void>;
  requestPaymentCorrection: (payment: Payment) => Promise<void>;
  approveRequest: (request: ApprovalRequest) => Promise<void>; rejectRequest: (request: ApprovalRequest) => Promise<void>;
  claimWorkOrder: (order: WorkOrder) => Promise<void>; completeWorkOrder: (order: WorkOrder) => Promise<void>;
  actorName: string; editOwnProfile: () => Promise<void>;
};

function PageContent(props: ContentProps) {
  const { page, store, settings, cloud } = props;
  if (page === 'dashboard') return <Dashboard {...props} />;
  if (page === 'customers') return <Customers {...props} />;
  if (page === 'fleets') return <Fleets {...props} />;
  if (page === 'vehicles') return <Vehicles {...props} />;
  if (page === 'workOrders') return <WorkOrders {...props} />;
  if (page === 'parts') return <Inventory {...props} />;
  if (page === 'finance') return <Finance {...props} />;
  if (page === 'campaigns') return <ActivityCenter organizationId={props.cloud.organizationId} campaigns={store.campaigns} warranties={store.warranties} vehicles={store.vehicles} onAddCampaign={() => props.openModal('campaign')} onEditCampaign={item => props.openModal('campaign', item)} onAddWarranty={() => props.openModal('warranty')} onEditWarranty={item => props.openModal('warranty', item)} onRemoveCampaign={id => props.remove('campaigns', id)} onRemoveWarranty={id => props.remove('warranties', id)} />;
  if (page === 'staff') return <StaffPage cloud={cloud} />;
  if (page === 'smart') return <SmartTools cloud={cloud} workOrders={store.workOrders} />;
  return <SettingsPage {...props} />;
}

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function Dashboard({ store, setPage, setEditingOrder, cloud, actorName, editOwnProfile }: ContentProps) {
  const metrics = useMemo(() => dashboardMetrics(store), [store]);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const laToday = losAngelesDateKey(new Date().toISOString());
  const laMonth = laToday.slice(0, 7);
  const validOrders = useMemo(() => store.workOrders.filter(item => item.status !== '已取消'), [store.workOrders]);
  const todayOrders = useMemo(() => validOrders.filter(item => losAngelesDateKey(item.date) === laToday), [validOrders, laToday]);
  const monthOrders = useMemo(() => validOrders.filter(item => losAngelesDateKey(item.date).startsWith(laMonth)), [validOrders, laMonth]);
  const todayPayments = useMemo(() => store.payments
    .filter(item => losAngelesDateKey(item.date) === laToday)
    .sort((a, b) => b.date.localeCompare(a.date)), [store.payments, laToday]);
  const monthPayments = useMemo(() => store.payments.filter(item => losAngelesDateKey(item.date).startsWith(laMonth)).sort((a, b) => b.date.localeCompare(a.date)), [store.payments, laMonth]);
  const todayExpenses = useMemo(() => store.expenses.filter(item => losAngelesDateKey(item.date) === laToday).sort((a, b) => b.date.localeCompare(a.date)), [store.expenses, laToday]);
  const monthExpenses = useMemo(() => store.expenses.filter(item => losAngelesDateKey(item.date).startsWith(laMonth)).sort((a, b) => b.date.localeCompare(a.date)), [store.expenses, laMonth]);
  const todayPaymentGroups = useMemo(() => Object.entries(todayPayments.reduce<Record<string, number>>((groups, payment) => {
    const entries = payment.splits?.length ? payment.splits : [{ method: payment.method?.trim() || '未记录', amount: Number(payment.amount || 0) }];
    entries.forEach(entry => { const method = entry.method?.trim() || '未记录'; groups[method] = (groups[method] || 0) + Number(entry.amount || 0); });
    return groups;
  }, {})).sort((a, b) => b[1] - a[1]), [todayPayments]);
  const metricDetails: Record<string, { title: string; total: number; formula: string; orders?: WorkOrder[]; payments?: Payment[]; expenses?: Expense[]; paymentGroups?: Array<[string, number]> }> = {
    todaySales: { title: '今日开单营业额明细', total: metrics.todaySales, formula: '今日所有未取消工单的总价合计', orders: todayOrders },
    todayReceived: { title: '今日实收组合明细', total: metrics.todayReceived, formula: '今日所有实际收款流水合计', payments: todayPayments, paymentGroups: todayPaymentGroups },
    todayGross: { title: '今日毛利润明细', total: metrics.todayGross, formula: '今日工单总价－配件成本（按每张工单毛利润汇总）', orders: todayOrders },
    receivables: { title: '未收款总额明细', total: metrics.receivables, formula: '所有未取消且仍有余额的工单欠款合计', orders: validOrders.filter(item => Number(item.balance || 0) > .009).sort((a, b) => b.date.localeCompare(a.date)) },
    monthSales: { title: '本月营业额明细', total: metrics.monthSales, formula: '本月所有未取消工单的总价合计', orders: monthOrders },
    monthReceived: { title: '本月实收明细', total: metrics.monthReceived, formula: '本月所有实际收款流水合计', payments: monthPayments },
    monthExpenses: { title: '本月支出明细', total: metrics.monthExpenses, formula: '本月所有已记录支出合计', expenses: monthExpenses },
    monthNet: { title: '本月净经营收益组成', total: metrics.monthNet, formula: `本月工单毛利润 ${money(metrics.monthGross)}－本月支出 ${money(metrics.monthExpenses)}`, orders: monthOrders, expenses: monthExpenses },
    todayExpenses: { title: '今日支出明细（洛杉矶时间）', total: metrics.todayExpenses, formula: '今日所有已记录支出合计', expenses: todayExpenses },
    todayPartsExpenses: { title: '今日配件支出明细', total: metrics.todayPartsExpenses, formula: '今日类别为“配件采购”的支出合计', expenses: todayExpenses.filter(item => item.category === '配件采购') },
    monthBookBalance: { title: '本月账面余额组成', total: metrics.monthBookBalance, formula: `本月实收 ${money(metrics.monthReceived)}－本月支出 ${money(metrics.monthExpenses)}`, payments: monthPayments, expenses: monthExpenses },
  };
  const activeMetric = selectedMetric ? metricDetails[selectedMetric] : undefined;
  const isTechnician = cloud.role === 'technician' && !can(cloud, 'workOrders');
  const visibleOrders = isTechnician ? store.workOrders.filter(order => !order.technicianUserId && !order.technician || order.technicianUserId === cloud.user.id || order.technician === actorName || order.technician === cloud.user.email) : store.workOrders;
  const recent = [...visibleOrders].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const showFinance = can(cloud, 'pricing') || can(cloud, 'finance');
  return <div className="page"><div className="hero"><div><button type="button" className="greeting-name" onClick={() => void editOwnProfile()}><h1>{greetingForNow()}，{actorName || 'Z&G AUTO REPAIR'}</h1></button></div><div className="toolbar">{can(cloud, 'customers') && <button onClick={() => setPage('customers')}>＋ 新客户</button>}{can(cloud, 'createWorkOrders') && <button className="primary" onClick={() => setEditingOrder('new')}>＋ 新建工单</button>}</div></div>
    <div className="dashboard-actions">{can(cloud, 'workOrders') && <button onClick={() => setPage('workOrders')}><b>维修工单</b><span>接车、检查、施工与结账</span></button>}{can(cloud, 'parts') && <button onClick={() => setPage('parts')}><b>库存查询</b><span>配件编号、名称与库存</span></button>}{can(cloud, 'finance') && <button onClick={() => setPage('finance')}><b>财务收款</b><span>收入、支出与欠款</span></button>}{can(cloud, 'campaigns') && <button onClick={() => setPage('campaigns')}><b>活动与保修</b><span>优惠活动和车辆保修</span></button>}</div>
    {showFinance ? <div className="kpi-grid"><Kpi label="今日开单营业额" value={money(metrics.todaySales)} tone="blue" onClick={() => setSelectedMetric('todaySales')} hint="点击查看金额组成" /><Kpi label="今日实收" value={money(metrics.todayReceived)} tone="green" onClick={() => setSelectedMetric('todayReceived')} hint="点击查看收款组合明细" /><Kpi label="今日毛利润" value={money(metrics.todayGross)} tone="purple" onClick={() => setSelectedMetric('todayGross')} hint="点击查看金额组成" /><Kpi label="未收款总额" value={money(metrics.receivables)} tone="orange" onClick={() => setSelectedMetric('receivables')} hint="点击查看欠款工单" /><Kpi label="本月营业额" value={money(metrics.monthSales)} onClick={() => setSelectedMetric('monthSales')} hint="点击查看金额组成" /><Kpi label="本月实收" value={money(metrics.monthReceived)} onClick={() => setSelectedMetric('monthReceived')} hint="点击查看收款明细" /><Kpi label="本月支出" value={money(metrics.monthExpenses)} onClick={() => setSelectedMetric('monthExpenses')} hint="点击查看支出明细" /><Kpi label="本月净经营收益" value={money(metrics.monthNet)} onClick={() => setSelectedMetric('monthNet')} hint="点击查看计算组成" /></div> : <div className="kpi-grid technician-kpis"><Kpi label="分配给我的工单" value={String(visibleOrders.length)} tone="blue" /><Kpi label="等待检查" value={String(visibleOrders.filter(item => item.status === '等待检查').length)} /><Kpi label="维修中" value={String(visibleOrders.filter(item => item.status === '维修中').length)} tone="purple" /><Kpi label="今日完成" value={String(visibleOrders.filter(item => item.date === today() && item.status === '已完成').length)} tone="green" /></div>}
    {showFinance && <div className="kpi-grid today-expense-kpi"><Kpi label="今日支出（洛杉矶时间）" value={money(metrics.todayExpenses)} tone="orange" onClick={() => setSelectedMetric('todayExpenses')} hint="点击查看支出明细" /><Kpi label="今日配件支出总额" value={money(metrics.todayPartsExpenses)} tone="purple" onClick={() => setSelectedMetric('todayPartsExpenses')} hint="点击查看配件支出" /><Kpi label="本月账面余额（实收－支出）" value={money(metrics.monthBookBalance)} tone="green" onClick={() => setSelectedMetric('monthBookBalance')} hint="点击查看计算组成" /></div>}
    <div className="dashboard-grid"><section className="panel wide"><div className="section-title"><h3>最近工单</h3><button onClick={() => setPage('workOrders')}>查看全部</button></div><table><thead><tr><th>工单</th><th>客户/车辆</th><th>状态</th>{showFinance && <><th>总价</th><th>欠款</th></>}</tr></thead><tbody>{recent.map(order => <tr key={order.id}><td><b>{order.number}</b><small>{order.date}</small></td><td>{order.customer}<small>{order.plate} · {order.vehicle}</small></td><td><Status value={order.status} /></td>{showFinance && <><td>{money(order.total)}</td><td className={order.balance > 0 ? 'warning-text' : ''}>{money(order.balance)}</td></>}</tr>)}</tbody></table>{!recent.length && <Empty text="还没有分配给您的工单。" />}</section>
      <section className="panel"><h3>今日车间</h3><div className="count-list"><div><span>等待批准</span><b>{visibleOrders.filter(item => item.status === '等待批准').length}</b></div><div><span>等待配件</span><b>{visibleOrders.filter(item => item.status === '等待配件').length}</b></div><div><span>维修中</span><b>{visibleOrders.filter(item => item.status === '维修中').length}</b></div><div><span>今日完成</span><b>{visibleOrders.filter(item => item.date === today() && item.status === '已完成').length}</b></div></div></section>
      {can(cloud, 'inventory') && <section className="panel"><h3>库存提醒</h3><div className="count-list"><div><span>低库存配件</span><b className="warning-text">{store.parts.filter(item => item.qty <= item.minimum).length}</b></div><div><span>库存品种</span><b>{store.parts.length}</b></div><div><span>库存成本</span><b>{money(store.parts.reduce((sum, item) => sum + item.qty * item.cost, 0))}</b></div></div><button className="full" onClick={() => setPage('parts')}>打开库存中心</button></section>}
    </div>
    {activeMetric && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setSelectedMetric(null)}><div className="modal today-payment-modal metric-detail-modal"><div className="modal-head"><div><p className="eyebrow">金额二级明细</p><h2>{activeMetric.title}</h2><span>合计 {money(activeMetric.total)}</span></div><button type="button" onClick={() => setSelectedMetric(null)}>×</button></div><div className="metric-formula"><span>计算方式</span><b>{activeMetric.formula}</b></div>{activeMetric.paymentGroups && <div className="payment-method-summary">{activeMetric.paymentGroups.map(([method, amount]) => <div key={method}><span>{method}</span><b>{money(amount)}</b></div>)}</div>}{activeMetric.orders && <DetailOrders rows={activeMetric.orders} mode={selectedMetric === 'todayGross' || selectedMetric === 'monthNet' ? 'gross' : selectedMetric === 'receivables' ? 'balance' : 'total'} />}{activeMetric.payments && <DetailPayments rows={activeMetric.payments} />}{activeMetric.expenses && <DetailExpenses rows={activeMetric.expenses} />}{!activeMetric.orders?.length && !activeMetric.payments?.length && !activeMetric.expenses?.length && <Empty text="这个项目目前没有明细记录。" />}</div></div>}
  </div>;
}

function DetailOrders({ rows, mode }: { rows: WorkOrder[]; mode: 'total' | 'gross' | 'balance' }) { return <div className="payment-detail-table metric-detail-section"><h3>工单组成（{rows.length} 张）</h3><table><thead><tr><th>日期 / 工单</th><th>客户 / 车辆</th><th>工单总价</th>{mode === 'gross' && <th>配件成本</th>}<th>{mode === 'gross' ? '毛利润' : mode === 'balance' ? '欠款' : '计入金额'}</th></tr></thead><tbody>{rows.map(order => <tr key={order.id}><td>{order.date}<small>{order.number}</small></td><td>{order.customer || '—'}<small>{order.plate || order.vehicle}</small></td><td>{money(order.total)}</td>{mode === 'gross' && <td>{money(order.partsCost)}</td>}<td><b>{money(mode === 'gross' ? order.grossProfit : mode === 'balance' ? order.balance : order.total)}</b></td></tr>)}</tbody></table></div>; }
function DetailPayments({ rows }: { rows: Payment[] }) { return <div className="payment-detail-table metric-detail-section"><h3>收款组成（{rows.length} 笔）</h3><table><thead><tr><th>时间 / 工单</th><th>客户</th><th>付款方式</th><th>金额</th></tr></thead><tbody>{rows.map(payment => <tr key={payment.id}><td>{new Date(payment.date).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}<small>{payment.workOrderNumber || '手工收入'}</small></td><td>{payment.customer || '—'}<small>{payment.note || ''}</small></td><td>{payment.splits?.length ? payment.splits.map(item => `${item.method} ${money(item.amount)}`).join(' + ') : payment.method || '未记录'}</td><td className="success-text"><b>{money(payment.amount)}</b></td></tr>)}</tbody></table></div>; }
function DetailExpenses({ rows }: { rows: Expense[] }) { return <div className="payment-detail-table metric-detail-section"><h3>支出组成（{rows.length} 笔）</h3><table><thead><tr><th>日期</th><th>类别 / 收款方</th><th>方式 / 备注</th><th>金额</th></tr></thead><tbody>{rows.map(expense => <tr key={expense.id}><td>{new Date(expense.date).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>{expense.category}<small>{expense.vendor || '—'}</small></td><td>{expense.method || '—'}<small>{expense.note || ''}</small></td><td className="warning-text"><b>{money(expense.amount)}</b></td></tr>)}</tbody></table></div>; }

function Customers({ store, search, openModal, remove, settings, cloud }: ContentProps) {
  const rows = filterRows(store.customers, search);
  const ordersFor = (item: Customer) => store.workOrders.filter(order => order.customerId === item.id || (!order.customerId && ((item.phone && order.phone === item.phone) || order.customer === item.name)));
  return <ListPage title="客户管理" subtitle="个人、公司和车队客户统一管理" action="＋ 添加客户" onAction={() => openModal('customer')}><table><thead><tr><th>客户</th><th>类型</th><th>电话</th><th>邮箱/地址</th><th>车辆</th><th /></tr></thead><tbody>{rows.map(item => <tr key={item.id}><td><b>{item.name}</b><small>{item.billingTerms || item.membership || '普通客户'}</small></td><td>{item.type}</td><td>{item.phone}<small>{item.secondaryPhone}</small></td><td>{item.email || '—'}<small>{item.address}</small></td><td>{store.vehicles.filter(vehicle => vehicle.ownerId === item.id).length}</td><td className="actions">{can(cloud, 'printDocuments') && <button className="primary-soft" onClick={() => printRepairHistory({ title: 'Customer Repair History / 客户维修档案', subtitle: item.name, contact: [item.phone, item.email].filter(Boolean).join(' · ') }, ordersFor(item), settings)}>打印维修档案</button>}<button onClick={() => openModal('customer', item)}>编辑</button><button className="danger-link" onClick={() => confirm('确定删除客户？') && remove('customers', item.id)}>删除</button></td></tr>)}</tbody></table>{!rows.length && <Empty text="没有找到客户。" />}</ListPage>;
}

function Fleets({ store, search, openModal, remove }: ContentProps) {
  const fleets = filterRows(store.fleets, search); const drivers = filterRows(store.drivers, search);
  return <div className="page"><div className="page-title"><div><p className="eyebrow">Fleet Management</p><h2>车队公司与司机</h2></div><div className="toolbar"><button onClick={() => openModal('driver')}>＋ 添加司机</button><button className="primary" onClick={() => openModal('fleet')}>＋ 添加车队公司</button></div></div>
    <div className="split-panels"><section className="panel"><h3>车队公司</h3><table><thead><tr><th>公司</th><th>联系人</th><th>月结</th><th /></tr></thead><tbody>{fleets.map(item => <tr key={item.id}><td><b>{item.company}</b><small>{item.phone}</small></td><td>{item.contact}<small>{item.billingEmail}</small></td><td>{item.terms || '现场付款'}</td><td className="actions"><button onClick={() => openModal('fleet', item)}>编辑</button><button className="danger-link" onClick={() => confirm('确定删除？') && remove('fleets', item.id)}>删除</button></td></tr>)}</tbody></table>{!fleets.length && <Empty text="尚未添加车队公司。" />}</section>
    <section className="panel"><h3>司机</h3><table><thead><tr><th>司机</th><th>公司</th><th>授权</th><th /></tr></thead><tbody>{drivers.map(item => <tr key={item.id}><td><b>{item.name}</b><small>{item.phone}</small></td><td>{item.company || '—'}</td><td>{item.authorized ? '可签字' : '仅送车'}</td><td className="actions"><button onClick={() => openModal('driver', item)}>编辑</button><button className="danger-link" onClick={() => confirm('确定删除？') && remove('drivers', item.id)}>删除</button></td></tr>)}</tbody></table>{!drivers.length && <Empty text="尚未添加司机。" />}</section></div></div>;
}

function Vehicles({ store, search, openModal, remove, setEditingOrder, settings, cloud }: ContentProps) {
  const rows = filterRows(store.vehicles, search);
  const [historyVehicle, setHistoryVehicle] = useState<Vehicle | null>(null);
  const history = historyVehicle ? store.workOrders.filter(order => order.vehicleId === historyVehicle.id || (!!historyVehicle.vin && order.vin === historyVehicle.vin) || (!!historyVehicle.plate && order.plate === historyVehicle.plate)).sort((a,b) => `${b.date}${b.number}`.localeCompare(`${a.date}${a.number}`)) : [];
  return <><ListPage title="车辆管理" subtitle="每辆车建立永久维修档案，支持按车牌、VIN、Unit Number、客户和司机搜索" action="＋ 添加车辆" onAction={() => openModal('vehicle')}><div className="card-table">{rows.map(item => { const itemHistory = store.workOrders.filter(order => order.vehicleId === item.id || (!!item.vin && order.vin === item.vin) || (!!item.plate && order.plate === item.plate)); const count = itemHistory.length; return <article className="vehicle-card" key={item.id}><div className="vehicle-avatar">{item.make?.slice(0, 1) || '🚗'}</div><div className="vehicle-main"><div><b>{item.year} {item.make} {item.model}</b><Status value={item.ownerType} /></div><p>{item.plate || '无车牌'} · Unit {item.unit || '—'}</p><small>VIN {item.vin || '—'}</small><small>{item.ownerName} {item.driverName ? `· 司机 ${item.driverName} ${item.driverPhone || ''}` : ''}</small><small className="history-count">维修记录 {count} 次</small></div><div className="vehicle-actions"><button className="primary-soft" onClick={() => setHistoryVehicle(item)}>维修档案</button>{can(cloud, 'printDocuments') && <button onClick={() => printRepairHistory({ title: 'Vehicle Repair History / 车辆维修档案', subtitle: `${item.year} ${item.make} ${item.model}`, contact: `${item.plate || 'No plate'} · VIN ${item.vin || '—'} · ${item.ownerName}` }, itemHistory, settings)}>打印档案</button>}<button onClick={() => openModal('vehicle', item)}>编辑</button><button onClick={() => setEditingOrder('new')}>开工单</button><button className="danger-link" onClick={() => confirm('确定删除车辆？') && remove('vehicles', item.id)}>删除</button></div></article>})}</div>{!rows.length && <Empty text="没有找到车辆。" />}</ListPage>
    {historyVehicle && <div className="modal-backdrop"><div className="modal vehicle-history-modal"><div className="modal-head"><div><p className="eyebrow">Vehicle Health Record / 车辆永久档案</p><h2>{historyVehicle.year} {historyVehicle.make} {historyVehicle.model}</h2><span>{historyVehicle.plate} · VIN {historyVehicle.vin || '—'} · {historyVehicle.ownerName}</span></div><button onClick={() => setHistoryVehicle(null)}>×</button></div><div className="vehicle-history-summary"><div><span>维修次数</span><b>{history.length}</b></div><div><span>累计金额</span><b>{money(history.reduce((sum,item) => sum + item.total,0))}</b></div><div><span>最后里程</span><b>{history[0]?.mileage?.toLocaleString() || historyVehicle.mileage?.toLocaleString() || '—'}</b></div><div><span>有效保修</span><b>{store.warranties.filter(item => item.vehicleId === historyVehicle.id && item.status === '有效').length}</b></div></div><div className="vehicle-timeline">{history.map(order => <article key={order.id}><div className="timeline-date"><b>{order.date}</b><span>{order.mileage?.toLocaleString() || '—'} mi</span></div><div className="timeline-card"><div><b>{order.number}</b><Status value={order.status} /><span className={`review-badge review-${order.reviewStatus || '未提交'}`}>{order.reviewStatus || '未提交'}</span></div><p><strong>客户描述：</strong>{order.complaint || '—'}</p><p><strong>诊断：</strong>{order.diagnosis || '—'}</p><p><strong>完成维修：</strong>{order.workPerformed || '—'}</p><small>人工：{order.laborItems.map(item => item.description).filter(Boolean).join('、') || '—'}</small><small>配件：{order.partItems.map(item => `${item.name} ×${item.qty}`).filter(Boolean).join('、') || '—'}</small><div className="timeline-total"><b>{money(order.total)}</b><button onClick={() => { setHistoryVehicle(null); setEditingOrder(order); }}>打开工单</button></div></div></article>)}{!history.length && <Empty text="这辆车还没有维修记录。" />}</div></div></div>}
  </>;
}

function WorkOrders({ store, search, settings, cloud, setEditingOrder, addPayment, deleteWorkOrder, approveRequest, rejectRequest, claimWorkOrder, completeWorkOrder, actorName }: ContentProps) {
  const assignedOnly = cloud.role === 'technician' && !can(cloud, 'workOrders');
  const visible = assignedOnly ? store.workOrders.filter(order => (!order.technicianUserId && !order.technician) || order.technicianUserId === cloud.user.id || order.technician === actorName || order.technician === cloud.user.email) : store.workOrders;
  const rows = filterRows(visible, search).sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    if (byDate) return byDate;
    const aNumber = Number(a.number.match(/(\d+)$/)?.[1] || 0);
    const bNumber = Number(b.number.match(/(\d+)$/)?.[1] || 0);
    return bNumber - aNumber || b.number.localeCompare(a.number);
  });
  const pending = store.approvalRequests.filter(item => item.status === '待授权' && (can(cloud, 'approve') || item.requestedById === cloud.user.id));
  const canApprove = can(cloud, 'approve');
  const showFinance = can(cloud, 'pricing') || can(cloud, 'finance');
  const canEdit = can(cloud, 'workOrders') || can(cloud, 'diagnosis');
  const canPrint = can(cloud, 'printDocuments');
  const canSend = can(cloud, 'customerContact') || can(cloud, 'workOrders');
  useEffect(() => {
    if (!canEdit) return;
    const body = document.querySelector<HTMLTableSectionElement>('.work-order-table tbody');
    if (!body) return;
    const openRow = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target.closest('button, select, input, a, .actions')) return;
      const row = target.closest('tr');
      if (!row) return;
      const index = Array.from(body.children).indexOf(row);
      if (index >= 0 && rows[index]) setEditingOrder(rows[index]);
    };
    body.addEventListener('click', openRow);
    return () => body.removeEventListener('click', openRow);
  }, [canEdit, rows, setEditingOrder]);
  const visibleLogs = store.changeLogs.filter(log => visible.some(order => order.id === log.workOrderId));
  return <div className="page"><div className="page-title"><div><p className="eyebrow">Z&G AUTO ERP</p><h2>{assignedOnly ? '我的维修任务' : '维修工单'}</h2></div>{can(cloud, 'createWorkOrders') && <button className="primary" onClick={() => setEditingOrder('new')}>＋ 新建工单</button>}</div>
    {!!pending.length && <section className="panel approval-panel"><div className="section-title"><div><h3>待双人授权</h3><span>申请人与批准人必须是两个不同账号；所有决定永久记入日志</span></div><b>{pending.length} 项</b></div>{pending.map(item => <article className="approval-row" key={item.id}><div><b>{item.type === '删除工单' ? '作废/归档工单' : item.type} · {item.workOrderNumber}</b><small>申请人 {item.requestedBy} · {new Date(item.requestedAt).toLocaleString()}</small><p>{item.reason}</p></div><div className="actions">{canApprove && item.requestedById !== cloud.user.id ? <><button className="primary" onClick={() => void approveRequest(item)}>批准并执行</button><button onClick={() => void rejectRequest(item)}>拒绝</button></> : <span className="muted">{item.requestedById === cloud.user.id ? '等待另一账号批准' : '需要审批权限'}</span>}</div></article>)}</section>}
    <section className="panel work-order-table"><table><thead><tr><th>工单/日期</th><th>客户与车辆</th><th>技师/状态</th><th>检查/审查</th>{showFinance && <><th>总价</th><th>已付/欠款</th></>}<th /></tr></thead><tbody>{rows.map(order => { const checks = Object.values(order.inspectionChecklist || {}).filter(Boolean).length; const evidenceCount = (order.evidencePhotos || []).filter(item => !item.archivedAt).length; const isMine = order.technicianUserId === cloud.user.id || order.technician === actorName || order.technician === cloud.user.email; const isUnassigned = !order.technicianUserId && !order.technician; const isFinished = order.status === '已完成' || order.status === '已交车'; return <tr key={order.id} className={order.archivedAt ? 'archived-row' : ''}><td><b>{order.number}</b><small>{order.date} {order.po ? `· PO ${order.po}` : ''}</small>{order.archivedAt && <small className="archive-badge">已作废并归档</small>}</td><td>{order.customer}<small>{order.plate} · {order.vehicle}{order.driver ? ` · 司机 ${order.driver}` : ''}</small><small>证据 {evidenceCount} 张</small></td><td>{order.technician || (isFinished ? '未分配' : '未分配（可领取）')}<small><Status value={order.status} /></small>{order.completedBy && <small className="success-text">完成：{order.completedBy}{order.technicianCompletedAt ? ` · ${new Date(order.technicianCompletedAt).toLocaleString()}` : ''}</small>}</td><td><b>{checks}/5</b><small><span className={`review-badge review-${order.reviewStatus || '未提交'}`}>{order.reviewStatus || '未提交'}</span></small><small className={`approval-state approval-${order.customerApprovalStatus || '未发送'}`}>客户：{order.customerApprovalStatus || '未发送'}</small></td>{showFinance && <><td><b>{money(order.total)}</b><small>毛利 {money(order.grossProfit)}</small></td><td>{money(order.paid)}<small className={order.balance > 0 ? 'warning-text' : ''}>欠 {money(order.balance)}</small></td></>}<td className="actions">{assignedOnly && isUnassigned && !isFinished && order.status !== '已取消' && !order.archivedAt && <button className="primary" onClick={() => void claimWorkOrder(order)}>领取工单</button>}{assignedOnly && isMine && !isFinished && !order.archivedAt && <button className="primary" onClick={() => void completeWorkOrder(order)}>维修完成</button>}{canEdit && <button className={order.reviewStatus === '待审查' && canApprove ? 'primary' : ''} onClick={() => setEditingOrder(order)}>{order.reviewStatus === '待审查' && canApprove ? '审查' : '查看/编辑'}</button>}{can(cloud, 'collectPayment') && !order.archivedAt && <button onClick={() => addPayment(order)} disabled={order.balance <= 0}>收款</button>}{canPrint && <PrintMenu order={order} settings={settings} payments={store.payments} />}{canSend && !order.archivedAt && <SendMenu order={order} settings={settings} store={store} cloud={cloud} />}{can(cloud, 'archive') && !order.archivedAt && <button className="danger-link" onClick={() => deleteWorkOrder(order)}>申请作废</button>}{order.archivedAt && <small title={order.archiveReason}>原因：{order.archiveReason || '未填写'}</small>}</td></tr>})}</tbody></table>{!rows.length && <Empty text={assignedOnly ? '目前没有可领取或已分配给您的工单。' : '没有找到工单。'} />}</section>
    {(canApprove || cloud.role === 'owner' || cloud.role === 'manager') && <section className="panel"><div className="section-title"><h3>最近修改记录</h3><span>保留修改人、时间、内容以及授权结果，不允许清除</span></div><div className="change-log-list">{[...visibleLogs].sort((a,b) => b.at.localeCompare(a.at)).slice(0,50).map(log => <div key={log.id}><b>{log.workOrderNumber} · {log.action}</b><span>{log.actor} · {new Date(log.at).toLocaleString()}</span><small>{log.detail}</small></div>)}</div>{!visibleLogs.length && <Empty text="尚无工单修改记录。" />}</section>}
  </div>;
}

function Inventory({ store, search, openModal, remove, receiveStock, persist, actorName }: ContentProps) {
  const [draft, setDraft] = useState('');
  const [partQuery, setPartQuery] = useState('');
  const combinedQuery = [search, partQuery].filter(Boolean).join(' ');
  const rows = filterRows(store.parts.filter(item => item.inventoryType !== '日常消耗品'), combinedQuery);
  const consumables = filterRows(store.parts.filter(item => item.inventoryType === '日常消耗品'), combinedQuery);
  const low = rows.filter(item => item.qty <= item.minimum).length;
  const runQuery = () => setPartQuery(draft.trim());
  const adjustConsumable = async (item: Part) => {
    const raw = prompt(`手动设置“${item.name}”的当前库存\n现在库存：${item.qty}\n请输入调整后的实际数量：`, String(item.qty));
    if (raw === null) return;
    const after = Number(raw);
    if (!Number.isFinite(after) || after < 0) return alert('请输入大于或等于 0 的有效数量。');
    const reason = prompt('请输入本次手动调整原因：', '盘点调整');
    if (reason === null) return;
    const change = after - Number(item.qty || 0);
    if (Math.abs(change) < .0001) return alert('库存数量没有变化。');
    await persist('parts', { ...item, qty: after });
    await persist('inventoryLogs', { id: uid(), date: new Date().toISOString(), partId: item.id, partNo: item.partNo, partName: item.name, type: '消耗品手动调整', change, before: item.qty, after, reference: actorName, note: reason.trim() || '盘点调整' } as InventoryLog);
  };
  const claimConsumable = async (item: Part) => {
    const raw = prompt(`领取日常消耗品：${item.name}\n当前库存：${item.qty}\n请输入领取数量：`, '1');
    if (raw === null) return;
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty <= 0) return alert('请输入大于 0 的有效领取数量。');
    if (qty > Number(item.qty || 0)) return alert(`库存不足。当前只有 ${item.qty}，不能领取 ${qty}。`);
    const note = prompt('请输入用途或备注（可以留空）：', '车间日常使用');
    if (note === null) return;
    const after = Number(item.qty || 0) - qty;
    if (!confirm(`确认领取 ${item.name} × ${qty}？\n领取后库存：${after}`)) return;
    await persist('parts', { ...item, qty: after });
    await persist('inventoryLogs', { id: uid(), date: new Date().toISOString(), partId: item.id, partNo: item.partNo, partName: item.name, type: '消耗品领取', change: -qty, before: item.qty, after, reference: actorName, note: note.trim() || '车间日常使用' } as InventoryLog);
  };
  useEffect(() => {
    const body = document.querySelector('.inventory-query-bar')?.closest('section')?.querySelector('tbody');
    if (!body) return;
    const quickReceive = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target.closest('button, input, select, a, .actions')) return;
      const row = target.closest('tr');
      if (!row) return;
      const index = Array.from(body.children).indexOf(row);
      if (index >= 0 && rows[index]) void receiveStock(rows[index]);
    };
    body.addEventListener('click', quickReceive);
    return () => body.removeEventListener('click', quickReceive);
  }, [receiveStock, rows]);
  return <div className="page"><div className="page-title"><div><p className="eyebrow">Parts & Inventory</p><h2>库存管理</h2><p>{rows.length} 种销售配件 · {consumables.length} 种日常消耗品 · {low} 项配件低库存</p><p className="muted">销售配件用于客户工单；日常消耗品独立保存，只能手动调整或员工领取扣减。</p></div><button className="primary" onClick={() => openModal('part')}>＋ 添加库存物品</button></div><section className="panel"><div className="inventory-query-bar"><input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => event.key === 'Enter' && runQuery()} placeholder="输入编号、名称、品牌、供应商或库位" /><button className="primary" onClick={runQuery}>查询库存</button>{(draft || partQuery) && <button onClick={() => { setDraft(''); setPartQuery(''); }}>清除</button>}</div><h3>销售配件库存</h3><table><thead><tr><th>配件编号/名称</th><th>品牌/供应商</th><th>采购成本（内部）</th><th>客户销售价</th><th>库存</th><th>位置</th><th /></tr></thead><tbody>{rows.map(item => <tr className={item.qty <= item.minimum ? 'low-stock' : ''} key={item.id}><td><b>{item.partNo}</b><small>{item.oemNo ? `OEM ${item.oemNo} · ` : ''}{item.name}</small></td><td>{item.brand || '—'}<small>{item.supplier}</small></td><td>{money(item.cost)}</td><td>{money(item.price)}</td><td><b>{item.qty}</b><small>最低 {item.minimum}</small></td><td>{item.location || '—'}</td><td className="actions"><button className="primary-soft" onClick={() => receiveStock(item)}>采购入库</button><button onClick={() => openModal('part', item)}>编辑</button><button className="danger-link" onClick={() => confirm('确定删除配件？') && remove('parts', item.id)}>删除</button></td></tr>)}</tbody></table>{!rows.length && <Empty text="没有找到匹配的销售配件。" />}</section><section className="panel consumables-panel"><div className="section-title"><div><h3>日常消耗品库存</h3><span>领取会自动扣减；盘点差异可手动设置实际结存</span></div><b>{consumables.length} 种</b></div><table><thead><tr><th>编号 / 名称</th><th>库存</th><th>最低库存</th><th>库位 / 备注</th><th /></tr></thead><tbody>{consumables.map(item => <tr className={item.qty <= item.minimum ? 'low-stock' : ''} key={item.id}><td><b>{item.partNo}</b><small>{item.name}</small></td><td><b>{item.qty}</b></td><td>{item.minimum}</td><td>{item.location || '—'}<small>{item.notes || ''}</small></td><td className="actions"><button className="primary" onClick={() => void claimConsumable(item)}>领取减少</button><button onClick={() => void adjustConsumable(item)}>手动设置</button><button onClick={() => openModal('part', item)}>编辑</button><button className="danger-link" onClick={() => confirm('确定删除日常消耗品？') && remove('parts', item.id)}>删除</button></td></tr>)}</tbody></table>{!consumables.length && <Empty text="添加库存物品时选择“日常消耗品”，这里就会单独显示。" />}</section><section className="panel"><h3>最近库存流水</h3><table><thead><tr><th>时间</th><th>物品</th><th>类型</th><th>变化</th><th>结存</th><th>领取人/关联</th><th>备注</th></tr></thead><tbody>{[...store.inventoryLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50).map(log => <tr key={log.id}><td>{new Date(log.date).toLocaleString()}</td><td>{log.partNo}<small>{log.partName}</small></td><td>{log.type}</td><td className={log.change >= 0 ? 'success-text' : 'warning-text'}>{log.change > 0 ? '+' : ''}{log.change}</td><td>{log.after}</td><td>{log.reference || '—'}</td><td>{log.note || (log.unitCost === undefined ? '—' : `${money(log.unitCost)} / 件 · 合计 ${money(log.totalCost || 0)}`)}</td></tr>)}</tbody></table></section></div>;
}

function Finance({ store, openModal, persist, requestPaymentCorrection }: ContentProps) {
  const metrics = dashboardMetrics(store);
  const paymentRows = useMemo(() => [...store.payments].sort((a, b) => b.date.localeCompare(a.date)), [store.payments]);
  const expenseRows = useMemo(() => [...store.expenses].sort((a, b) => b.date.localeCompare(a.date)), [store.expenses]);
  useEffect(() => {
    const body = document.querySelector<HTMLTableSectionElement>('.split-panels section:first-child tbody');
    if (!body) return;
    const editPaymentMethods = async (event: Event) => {
      const target = event.target as HTMLElement;
      if (target.closest('button, input, select, a')) return;
      const row = target.closest('tr');
      if (!row) return;
      const payment = paymentRows[Array.from(body.children).indexOf(row)];
      if (!payment) return;
      const existing = payment.splits?.length ? payment.splits.map(item => `${item.method} ${item.amount}`).join(', ') : `${payment.method || '现金'} ${payment.amount}`;
      const raw = prompt(`修改收款方式组合（不会改变已付总额）\n工单：${payment.workOrderNumber}\n总额：${money(payment.amount)}\n\n格式示例：现金 1600, 刷卡 1030, 支票 1240`, existing);
      if (raw === null) return;
      const splits = raw.split(/[,，;+＋\n]+/).map(item => item.trim()).filter(Boolean).map(item => {
        const match = item.match(/^(.+?)\s*\$?\s*(\d+(?:\.\d{1,2})?)$/);
        return match ? { method: match[1].trim(), amount: Math.round(Number(match[2]) * 100) / 100 } : null;
      });
      if (!splits.length || splits.some(item => !item)) return alert('格式无法识别。请按照：现金 1600, 刷卡 1030, 支票 1240');
      const validSplits = splits as Array<{ method: string; amount: number }>;
      const splitTotal = Math.round(validSplits.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
      if (Math.abs(splitTotal - Number(payment.amount)) > 0.009) return alert(`各方式合计 ${money(splitTotal)}，必须等于原收款总额 ${money(payment.amount)}。`);
      const method = validSplits.map(item => `${item.method} ${money(item.amount)}`).join(' ＋ ');
      if (!confirm(`确认只修改支付方式？\n${method}\n\n已付总额仍为 ${money(payment.amount)}。`)) return;
      await persist('payments', { ...payment, method, splits: validSplits, note: `${payment.note || ''}${payment.note ? ' · ' : ''}支付方式已更正` });
      const order = store.workOrders.find(item => item.id === payment.workOrderId);
      if (order) await persist('workOrders', recalculateWorkOrder({ ...order, paymentMethod: method }));
      alert('支付方式组合已修改，已付总额和欠款没有改变。');
    };
    body.addEventListener('click', editPaymentMethods);
    return () => body.removeEventListener('click', editPaymentMethods);
  }, [paymentRows, persist, store.workOrders]);
  useEffect(() => {
    const body = document.querySelector<HTMLTableSectionElement>('.split-panels section:nth-child(2) tbody');
    if (!body) return;
    const showExpenseNote = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target.closest('button, input, select, a')) return;
      const row = target.closest('tr');
      if (!row) return;
      const index = Array.from(body.children).indexOf(row);
      const expense = expenseRows[index];
      if (!expense) return;
      alert(`支出详情\n\n日期：${expense.date}\n项目：${expense.category}\n收款方：${expense.vendor || '未填写'}\n金额：${money(expense.amount)}\n支付方式：${expense.method || '未记录'}\n备注：${expense.note?.trim() || '未填写备注'}`);
    };
    body.addEventListener('click', showExpenseNote);
    return () => body.removeEventListener('click', showExpenseNote);
  }, [expenseRows]);
  const recordIncome = async () => {
    const customer = prompt('收入来源或客户名称：', '其他收入');
    if (customer === null) return;
    const amount = Number(prompt('收入金额：', '0'));
    if (!Number.isFinite(amount) || amount <= 0) return alert('请输入大于 0 的收入金额。');
    const method = prompt('收款方式：', '现金') || '现金';
    const note = prompt('备注（可留空）：', '') || '';
    await persist('payments', { id: uid(), date: new Date().toISOString(), workOrderId: '', workOrderNumber: '手工收入', customer: customer.trim() || '其他收入', amount, method, note });
    alert('收入记录已保存到服务器。');
  };
  return <div className="page"><div className="page-title"><div><p className="eyebrow">Finance Center</p><h2>财务、收款与支出</h2></div><div className="title-actions"><button className="primary-soft" onClick={recordIncome}>＋ 记录收入</button><button className="primary" onClick={() => openModal('expense')}>＋ 记录支出</button></div></div><div className="kpi-grid"><Kpi label="今日实收" value={money(metrics.todayReceived)} tone="green" /><Kpi label="本月实收" value={money(metrics.monthReceived)} /><Kpi label="本月支出" value={money(metrics.monthExpenses)} tone="orange" /><Kpi label="本月净经营收益" value={money(metrics.monthNet)} tone="purple" /></div><div className="split-panels"><section className="panel"><h3>最近收款</h3><table><thead><tr><th>日期/工单</th><th>客户</th><th>方式</th><th>金额</th><th /></tr></thead><tbody>{[...store.payments].sort((a, b) => b.date.localeCompare(a.date)).map(item => <tr key={item.id}><td>{new Date(item.date).toLocaleDateString()}<small>{item.workOrderNumber}</small></td><td>{item.customer}<small>{item.status || '有效'}</small></td><td>{item.method}</td><td className={item.amount > 0 ? 'success-text' : 'muted'}><b>{money(item.amount)}</b>{item.originalAmount !== undefined && <small>原记录 {money(item.originalAmount)}</small>}</td><td><button onClick={() => void requestPaymentCorrection(item)}>申请更正</button></td></tr>)}</tbody></table></section><section className="panel"><h3>最近支出</h3><table><thead><tr><th>日期</th><th>类别/收款方</th><th>方式</th><th>金额</th></tr></thead><tbody>{[...store.expenses].sort((a, b) => b.date.localeCompare(a.date)).map(item => <tr key={item.id}><td>{item.date}</td><td>{item.category}<small>{item.vendor}</small></td><td>{item.method || '—'}</td><td className="warning-text"><b>{money(item.amount)}</b></td></tr>)}</tbody></table></section></div></div>;
}

async function prepareReceiptImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const maxSize = 1600;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.76);
}

async function detectReceiptBarcode(file: File) {
  const Detector = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: ImageBitmap) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
  if (!Detector) return '';
  try {
    const bitmap = await createImageBitmap(file);
    const results = await new Detector().detect(bitmap);
    bitmap.close();
    return results.map(item => item.rawValue || '').find(Boolean) || '';
  } catch { return ''; }
}

function SettingsPage({ settings, openModal, store }: ContentProps) {
  const downloadBackup = () => {
    const payload = JSON.stringify({ product: 'Z&G AUTO ERP', version: '0.79.6', exportedAt: new Date().toISOString(), settings, data: store }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `ZG_AUTO_ERP_backup_${today()}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="page"><div className="page-title"><div><p className="eyebrow">System Settings</p><h2>修理厂设置</h2></div><div className="title-actions"><button onClick={downloadBackup}>下载全部资料备份</button><button className="primary" onClick={() => openModal('settings', settings)}>编辑设置</button></div></div><section className="settings-card"><div className="print-logo">Z&G</div><div><h2>{settings.shopName}</h2><p>{settings.address || '尚未填写地址'}</p><p>{settings.phone || '尚未填写电话'} · {settings.email}</p></div><dl><div><dt>默认工时费率</dt><dd>{money(settings.defaultLaborRate)}/小时</dd></div><div><dt>默认配件税率</dt><dd>{settings.defaultTaxRate}%（仅配件）</dd></div></dl></section><section className="panel backup-panel"><div><h3>本地资料备份</h3><p>下载客户、车辆、工单、库存、财务、活动、员工权限和修改记录。服务器资料不会被删除。</p></div><button className="primary-soft" onClick={downloadBackup}>下载 JSON 备份</button></section><section className="panel"><h3>智能服务状态</h3><div className="integration-list"><div><b>VIN 自动识别</b><span className="success-text">已启用（NHTSA vPIC）</span></div><div><b>本地 OCR 车牌识别</b><span className="success-text">已启用（Tesseract）</span></div><div><b>浏览器语音输入</b><span className="success-text">兼容 Edge / Chrome</span></div><div><b>AI 故障诊断与照片分类</b><span>需部署 zg-ai 云函数并配置 OPENAI_API_KEY</span></div><div><b>邮件与短信通知</b><span>云端发送失败时自动打开本机邮件程序并保留客户确认链接</span></div><div><b>在线付款</b><span>需部署 zg-payment 云函数并配置 Stripe</span></div></div></section></div>;
}

function EntityModal({ state, store, settings, cloud, onClose, onSave }: { state: NonNullable<ModalState>; store: AppStore; settings: ShopSettings; cloud: CloudSession; onClose: () => void; onSave: (type: NonNullable<ModalState>['type'], data: Record<string, unknown>) => Promise<void> }) {
  const [data, setData] = useState<Record<string, unknown>>(() => initialForm(state.type, state.value, settings));
  const [saving, setSaving] = useState(false);
  const [vinBusy, setVinBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState<'plate' | 'vin' | ''>('');
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [fieldSearch, setFieldSearch] = useState<Record<string, string>>({});
  const fields = formFields(state.type, store);
  const patch = (key: string, value: unknown) => setData(current => {
    const next = { ...current, [key]: value };
    if (state.type === 'part' && (key === 'cost' || key === 'markupPercent')) {
      const cost = Number(next.cost) || 0;
      const markup = Math.max(0, Number(next.markupPercent) || 0);
      next.price = Math.round(cost * (1 + markup / 100) * 100) / 100;
    } else if (state.type === 'part' && key === 'price') {
      const cost = Number(next.cost) || 0;
      const price = Number(next.price) || 0;
      if (cost > 0) next.markupPercent = Math.max(0, Math.round(((price / cost) - 1) * 10000) / 100);
    }
    return next;
  });
  const runVin = async () => { setVinBusy(true); try { const result = await decodeVin(String(data.vin || '')); setData(current => ({ ...current, ...result })); } catch (error) { alert(error instanceof Error ? error.message : error); } finally { setVinBusy(false); } };
  const recognizePhoto = async (key: 'plate' | 'vin', file?: File) => {
    if (!file) return;
    setOcrBusy(key);
    try {
      const recognized = await recognizeVehiclePhoto(file, key, cloud.invokeFunction);
      if (!recognized) throw new Error(key === 'plate' ? '没有识别到车牌，请重新拍摄清晰、正面的车牌照片。' : '没有识别到17位 VIN，请重新拍摄仪表台或车门标签。');
      patch(key, recognized.toUpperCase());
      if (key === 'vin') {
        try { const result = await decodeVin(recognized); setData(current => ({ ...current, ...result, vin: recognized.toUpperCase() })); }
        catch { /* OCR value is still kept for manual confirmation. */ }
      }
    } catch (error) { alert(error instanceof Error ? error.message : String(error)); }
    finally { setOcrBusy(''); }
  };
  const recognizeReceipt = async (file?: File) => {
    if (!file) return;
    setReceiptBusy(true);
    try {
      const [image, detectedBarcode] = await Promise.all([prepareReceiptImage(file), detectReceiptBarcode(file)]);
      const result = await cloud.invokeFunction<{ answer?: string }>('zg-ai', {
        type: 'photo', image,
        prompt: `Analyze this US business purchase receipt for bookkeeping. Return ONLY valid JSON with this exact shape: {"vendor":"","date":"YYYY-MM-DD","total":0,"tax":0,"paymentMethod":"现金|银行卡|Zelle|支票|ACH|其他","receiptNumber":"","barcode":"","category":"配件采购|工具设备|外包加工|拖车|广告|其他","items":"short Chinese summary","confidence":0}. Use the final charged total, not subtotal. Never invent unreadable values. A barcode detected by the device, if any, is: ${detectedBarcode || 'none'}.`,
      });
      const raw = String(result.answer || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const parsed = JSON.parse(raw) as { vendor?: string; date?: string; total?: number; tax?: number; paymentMethod?: string; receiptNumber?: string; barcode?: string; category?: string; items?: string; confidence?: number };
      const total = Number(parsed.total || 0);
      if (!Number.isFinite(total) || total <= 0) throw new Error('没有可靠识别到小票总金额，请重新拍摄完整、清晰的小票。');
      const barcode = detectedBarcode || parsed.barcode || '';
      const receiptNumber = parsed.receiptNumber || '';
      const duplicateKey = receiptNumber || barcode;
      if (duplicateKey && store.expenses.some(expense => String(expense.note || '').includes(duplicateKey))) throw new Error(`这张小票可能已经录入（编号 ${duplicateKey}），为避免重复支出，本次没有自动填写。`);
      const note = [`AI小票识别`, parsed.items && `商品：${parsed.items}`, Number(parsed.tax || 0) > 0 && `税额：${money(Number(parsed.tax))}`, receiptNumber && `收据编号：${receiptNumber}`, barcode && `条码：${barcode}`, `识别可信度：${Math.round(Number(parsed.confidence || 0) * 100)}%`].filter(Boolean).join('\n');
      setData(current => ({ ...current, vendor: parsed.vendor || current.vendor || '', date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date : current.date, amount: total, method: parsed.paymentMethod || current.method || '银行卡', category: parsed.category || current.category || '其他', note }));
      alert(`小票识别完成：${parsed.vendor || '未识别商家'} · ${money(total)}。\n请检查自动填写内容，确认无误后再点击保存。`);
    } catch (error) { alert(`小票识别失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setReceiptBusy(false); }
  };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { await onSave(state.type, data); } finally { setSaving(false); } };
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">Z&G AUTO ERP</p><h2>{modalTitle(state.type, Boolean(state.value))}</h2></div><button type="button" onClick={onClose}>×</button></div><div className="form-grid two">{fields.map(field => {
    const photoField = state.type === 'vehicle' && (field.key === 'plate' || field.key === 'vin');
    if (field.type === 'receiptScan') return <label key={field.key} className="span-2 receipt-scanner"><span>AI购物小票识别</span><strong>{receiptBusy ? '正在读取商家、金额、日期、支付方式和条码…' : '拍摄完整小票或从相册选择；识别后请核对再保存'}</strong><input type="file" accept="image/*" capture="environment" disabled={receiptBusy} onChange={event => { void recognizeReceipt(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>;
    const fieldValue = field.type === 'number' && Number(data[field.key]) === 0 ? '' : String(data[field.key] ?? '');
    const filteredOptions = field.type === 'searchSelect'
      ? (field.options || []).filter(option => option.label.toLocaleLowerCase().includes(String(fieldSearch[field.key] || '').trim().toLocaleLowerCase()))
      : field.options;
    return <label key={field.key} className={field.wide ? 'span-2' : ''}><span>{field.label}</span>{field.type === 'searchSelect' ? <div className="search-select"><input type="search" value={fieldSearch[field.key] || ''} placeholder={field.searchPlaceholder || '输入关键词搜索'} onChange={event => setFieldSearch(current => ({ ...current, [field.key]: event.target.value }))} /><select required={field.required} value={String(data[field.key] ?? '')} onChange={e => patch(field.key, e.target.value)}><option value="">{filteredOptions?.length ? `请选择（找到 ${filteredOptions.length} 辆）` : '没有找到匹配车辆'}</option>{filteredOptions?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div> : field.type === 'select' ? <select required={field.required} value={String(data[field.key] ?? '')} onChange={e => patch(field.key, e.target.value)}><option value="">请选择</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === 'textarea' ? <textarea value={String(data[field.key] ?? '')} onChange={e => patch(field.key, e.target.value)} /> : field.type === 'checkbox' ? <input type="checkbox" checked={Boolean(data[field.key])} onChange={e => patch(field.key, e.target.checked)} /> : <div className={field.key === 'vin' || photoField ? 'input-action' : ''}><input required={field.required} type={field.type || 'text'} inputMode={field.type === 'number' ? 'decimal' : undefined} step={field.step} value={fieldValue} onChange={e => patch(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)} />{field.key === 'vin' && <button type="button" onClick={runVin}>{vinBusy ? '解析中…' : '联网解析'}</button>}{photoField && <span className="ocr-upload"><span>{ocrBusy === field.key ? '识别中…' : field.key === 'plate' ? '📷 拍照识别车牌' : '📷 拍照识别 VIN'}</span><input type="file" accept="image/*" capture="environment" disabled={Boolean(ocrBusy)} onChange={event => { void recognizePhoto(field.key as 'plate' | 'vin', event.target.files?.[0]); event.currentTarget.value = ''; }} /></span>}</div>}</label>;
  })}</div><div className="modal-foot"><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button></div></form></div>;
}

type Field = { key: string; label: string; type?: string; required?: boolean; wide?: boolean; step?: string; searchPlaceholder?: string; options?: Array<{ value: string; label: string }> };
function formFields(type: NonNullable<ModalState>['type'], store: AppStore): Field[] {
  const fleetOptions = store.fleets.map(item => ({ value: item.id, label: item.company }));
  const ownerOptions = [...store.customers.map(item => ({ value: item.id, label: `${item.name}（${item.type}）` })), ...store.fleets.map(item => ({ value: item.id, label: `${item.company}（车队）` }))];
  const driverOptions = store.drivers.map(item => ({ value: item.id, label: `${item.name} · ${item.phone}` }));
  if (type === 'customer') return [{ key: 'type', label: '客户类型', type: 'select', required: true, options: ['个人','公司','车队'].map(v => ({ value: v, label: v })) }, { key: 'name', label: '客户/公司名称', required: true }, { key: 'phone', label: '手机号码', required: true }, { key: 'secondaryPhone', label: '备用电话' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'address', label: '地址', wide: true }, { key: 'membership', label: '会员等级', type: 'select', options: ['普通会员','银卡会员','金卡会员','VIP会员'].map(v => ({ value: v, label: v })) }, { key: 'billingTerms', label: '结账方式', type: 'select', options: ['现场付款', MONTHLY_BILLING_TERM].map(v => ({ value: v, label: v })) }, { key: 'notes', label: '备注', type: 'textarea', wide: true }];
  if (type === 'fleet') return [{ key: 'company', label: '公司名称', required: true }, { key: 'contact', label: '主要联系人', required: true }, { key: 'phone', label: '联系电话', required: true }, { key: 'billingEmail', label: '账单邮箱', type: 'email' }, { key: 'terms', label: '付款条款', type: 'select', options: ['现场付款', MONTHLY_BILLING_TERM,'Net 15','Net 30','Net 45'].map(v => ({ value: v, label: v })) }, { key: 'creditLimit', label: '信用额度', type: 'number', step: '0.01' }, { key: 'notes', label: '车队备注', type: 'textarea', wide: true }];
  if (type === 'driver') return [{ key: 'fleetId', label: '所属公司', type: 'select', options: fleetOptions }, { key: 'company', label: '公司名称' }, { key: 'name', label: '司机姓名', required: true }, { key: 'phone', label: '司机电话', required: true }, { key: 'licenseLast4', label: '驾照后四位' }, { key: 'authorized', label: '允许签字/批准', type: 'checkbox' }, { key: 'notes', label: '备注', type: 'textarea', wide: true }];
  if (type === 'vehicle') return [{ key: 'ownerType', label: '客户类型', type: 'select', required: true, options: ['个人','公司','车队'].map(v => ({ value: v, label: v })) }, { key: 'ownerId', label: '所属客户/公司', type: 'select', options: ownerOptions }, { key: 'ownerName', label: '客户/公司名称', required: true }, { key: 'unit', label: 'Unit Number' }, { key: 'plate', label: '车牌', required: true }, { key: 'state', label: '州' }, { key: 'vin', label: 'VIN（17位）' }, { key: 'year', label: '年份', required: true }, { key: 'make', label: '品牌', required: true }, { key: 'model', label: '车型', required: true }, { key: 'engine', label: '发动机' }, { key: 'color', label: '颜色' }, { key: 'mileage', label: '当前里程', type: 'number' }, { key: 'driverId', label: '常用司机', type: 'select', options: driverOptions }, { key: 'driverName', label: '司机姓名' }, { key: 'driverPhone', label: '司机电话' }, { key: 'notes', label: '车辆备注', type: 'textarea', wide: true }];
  if (type === 'part') return [{ key: 'inventoryType', label: '库存分类', type: 'select', required: true, options: ['销售配件','日常消耗品'].map(v => ({ value: v, label: v })) }, { key: 'partNo', label: '物品编号/SKU', required: true }, { key: 'oemNo', label: 'OEM 编号（消耗品可空）' }, { key: 'name', label: '物品名称', required: true }, { key: 'brand', label: '品牌' }, { key: 'supplier', label: '供应商' }, { key: 'location', label: '货架位置' }, { key: 'cost', label: '真实采购单价（仅内部）', type: 'number', step: '0.01', required: true }, { key: 'markupPercent', label: '销售加价百分比 %（消耗品可填 0）', type: 'number', step: '0.01', required: true }, { key: 'price', label: '客户销售单价（消耗品可填 0）', type: 'number', step: '0.01', required: true }, { key: 'qty', label: '当前库存', type: 'number', required: true }, { key: 'minimum', label: '最低库存', type: 'number', required: true }, { key: 'notes', label: '备注/用途', type: 'textarea', wide: true }];
  if (type === 'expense') return [{ key: 'receiptScan', label: 'AI购物小票识别', type: 'receiptScan', wide: true }, { key: 'date', label: '日期', type: 'date', required: true }, { key: 'category', label: '支出类别', type: 'select', required: true, options: ['配件采购','房租','水电','工资','工具设备','外包加工','拖车','保险','广告','退款','其他'].map(v => ({ value: v, label: v })) }, { key: 'vendor', label: '收款方' }, { key: 'amount', label: '金额', type: 'number', step: '0.01', required: true }, { key: 'method', label: '付款方式', type: 'select', options: ['现金','银行卡','Zelle','支票','ACH','其他'].map(v => ({ value: v, label: v })) }, { key: 'note', label: '备注/收据号', type: 'textarea', wide: true }];
  if (type === 'campaign') return [{ key: 'name', label: '活动名称', required: true }, { key: 'status', label: '状态', type: 'select', required: true, options: ['启用','停用'].map(v => ({ value: v, label: v })) }, { key: 'start', label: '开始日期', type: 'date', required: true }, { key: 'end', label: '结束日期', type: 'date', required: true }, { key: 'benefit', label: '活动权益', type: 'textarea', wide: true, required: true }, { key: 'warrantyMonths', label: '保修月数', type: 'number' }, { key: 'warrantyMiles', label: '保修里程', type: 'number' }, { key: 'partsFree', label: '配件免费', type: 'checkbox' }, { key: 'laborFree', label: '人工免费', type: 'checkbox' }, { key: 'terms', label: '活动与保修条款', type: 'textarea', wide: true }];
  if (type === 'warranty') return [{ key: 'vehicleId', label: '保修车辆', type: 'searchSelect', required: true, wide: true, searchPlaceholder: '搜索客户、车牌、VIN、年份、品牌或车型', options: store.vehicles.map(item => ({ value: item.id, label: `${item.ownerName || '未填写客户'} · ${item.plate || '无车牌'} · VIN ${item.vin || '—'} · ${item.year} ${item.make} ${item.model}` })) }, { key: 'item', label: '保修项目', required: true }, { key: 'originalRO', label: '原始工单号' }, { key: 'start', label: '开始日期', type: 'date', required: true }, { key: 'end', label: '到期日期', type: 'date', required: true }, { key: 'mileageLimit', label: '里程上限', type: 'number' }, { key: 'coverage', label: '保障范围', type: 'select', required: true, options: ['仅配件','仅人工','配件和人工'].map(v => ({ value: v, label: v })) }, { key: 'status', label: '状态', type: 'select', required: true, options: ['有效','已使用','已到期','作废'].map(v => ({ value: v, label: v })) }, { key: 'notes', label: '保修说明', type: 'textarea', wide: true }];
  return [{ key: 'shopName', label: '修理厂名称', required: true }, { key: 'phone', label: '电话' }, { key: 'email', label: 'Email' }, { key: 'address', label: '地址', wide: true }, { key: 'defaultLaborRate', label: '默认工时费率', type: 'number', step: '0.01' }, { key: 'defaultTaxRate', label: '默认配件税率 %', type: 'number', step: '0.01' }, { key: 'invoiceTerms', label: '发票条款', type: 'textarea', wide: true }];
}

function initialForm(type: NonNullable<ModalState>['type'], value: Record<string, unknown> | undefined, settings: ShopSettings): Record<string, unknown> {
  if (value) {
    if (type === 'part' && value.markupPercent === undefined) {
      const cost = Number(value.cost) || 0;
      const price = Number(value.price) || 0;
      return { ...value, inventoryType: value.inventoryType || '销售配件', markupPercent: cost > 0 ? Math.max(0, Math.round(((price / cost) - 1) * 10000) / 100) : 30 };
    }
    if (type === 'part') return { ...value, inventoryType: value.inventoryType || '销售配件' };
    return value;
  }
  if (type === 'customer') return { type: '个人', membership: '普通会员', name: '', phone: '' };
  if (type === 'fleet') return { terms: 'Net 30', creditLimit: 0 };
  if (type === 'driver') return { authorized: false };
  if (type === 'vehicle') return { ownerType: '个人', mileage: 0 };
  if (type === 'part') return { inventoryType: '销售配件', cost: 0, markupPercent: 30, price: 0, qty: 0, minimum: 1 };
  if (type === 'expense') return { date: losAngelesDateKey(new Date().toISOString()), category: '配件采购', amount: 0, method: '银行卡' };
  if (type === 'campaign') return { start: today(), end: today(), warrantyMonths: 12, warrantyMiles: 12000, partsFree: true, laborFree: false, status: '启用' };
  if (type === 'warranty') return { start: today(), end: today(), mileageLimit: 12000, coverage: '仅配件', status: '有效' };
  return settings as unknown as Record<string, unknown>;
}

function modalTitle(type: NonNullable<ModalState>['type'], editing: boolean) { const names = { customer: '客户', fleet: '车队公司', driver: '司机', vehicle: '车辆', part: '配件', expense: '支出', campaign: '优惠活动', warranty: '车辆保修', settings: '系统设置' }; return `${editing ? '编辑' : '添加'}${names[type]}`; }

function normalizeVehicleIdentifier(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizePhone(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function normalizeText(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function ListPage({ title, subtitle, action, onAction, children }: { title: string; subtitle: string; action: string; onAction: () => void; children: React.ReactNode }) { return <div className="page"><div className="page-title"><div><p className="eyebrow">Z&G AUTO ERP</p><h2>{title}</h2><p>{subtitle}</p></div><button className="primary" onClick={onAction}>{action}</button></div><section className="panel">{children}</section></div>; }
function Kpi({ label, value, tone = '', onClick, hint }: { label: string; value: string; tone?: string; onClick?: () => void; hint?: string }) { const content = <><span>{label}</span><b>{value}</b>{hint && <small>{hint}</small>}</>; return onClick ? <button type="button" className={`kpi kpi-button ${tone}`} onClick={onClick}>{content}</button> : <div className={`kpi ${tone}`}>{content}</div>; }
function Status({ value }: { value: string }) { return <span className={`status status-${value.replace(/\s/g, '')}`}>{value}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty"><b>暂无数据</b><span>{text}</span></div>; }

function PrintMenu({ order, settings, payments }: { order: WorkOrder; settings: ShopSettings; payments: Payment[] }) { return <select className="print-select" value="" onChange={event => { const type = event.target.value; if (type) printDocumentV077(order, settings, type, payments); event.target.value = ''; }}><option value="">打印…</option><option value="Estimate">Estimate 报价单</option><option value="Repair Order">Repair Order 工单</option><option value="Invoice">Invoice 发票</option><option value="Receipt">Receipt 收据</option></select>; }

function SendMenu({ order, settings, store, cloud }: { order: WorkOrder; settings: ShopSettings; store: AppStore; cloud: CloudSession }) {
  const [sending, setSending] = useState(false);
  const customer = store.customers.find(item => item.id === order.customerId || item.name === order.customer);
  const fleet = store.fleets.find(item => item.id === order.customerId || item.company === order.company || item.company === order.customer);
  const savedEmail = customer?.email || fleet?.billingEmail || '';
  const savedPhone = order.driverPhone || order.phone || customer?.phone || fleet?.phone || '';
  const notify = async (subject: string, html: string, email: string, attachments?: Array<{ filename: string; content: string; contentId: string }>) => cloud.invokeFunction<{ id?: string; status?: string }>('zg-notify', { channel: 'email', type: 'email', to: email, subject, html, attachments: attachments || [] });
  const notifySms = async (phone: string, message: string) => cloud.invokeFunction<{ id?: string; status?: string }>('zg-notify', { channel: 'sms', type: 'sms', to: phone, message, workOrderId: order.id });
  const explainSendError = (error: unknown) => {
    let message = '未知发送错误';
    if (error instanceof Error) message = error.message;
    else if (typeof error === 'string') message = error;
    else if (error && typeof error === 'object') {
      const value = error as Record<string, unknown>;
      message = String(value.message || value.error || value.context || JSON.stringify(value));
    }
    if (!message || message === '[object Object]') return '服务器返回了无法识别的旧版错误。工单资料没有丢失，请更新通知函数后重试。';
    if (message.toLowerCase().includes('twilio')) return '服务器仍在运行旧版通知函数，邮件请求被错误送入短信通道。请更新 zg-notify 通知函数；工单资料没有丢失。';
    if (message.includes('RESEND_API_KEY') || message.includes('EMAIL_NOT_CONFIGURED')) return '邮件服务尚未配置 RESEND_API_KEY。工单资料没有丢失；配置邮件服务后即可由公司邮箱自动发送。';
    if (message.includes('RESEND_FROM') || message.includes('EMAIL_FROM') || message.toLowerCase().includes('sender')) return `邮件发件地址尚未验证：${message}`;
    if (message.includes('SMS_NOT_CONFIGURED') || message.includes('短信服务尚未配置')) return '短信服务程序已经安装，但 Twilio 账号和发送号码尚未配置。';
    if (message.toLowerCase().includes('function') && message.toLowerCase().includes('not found')) return '邮件云函数 zg-notify 尚未部署。';
    return message;
  };
  const openMailClient = (email: string, subject: string, body: string) => {
    const href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  };
  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      window.prompt('请复制下面的客户确认链接：', value);
      return false;
    }
  };
  const regularEmail = async (kind: string) => {
    const email = prompt('客户邮箱：', savedEmail);
    if (!email?.trim()) return;
    const title = kind === 'invoice' ? 'Invoice / 发票' : kind === 'inspection' ? 'Inspection Result / 检查结果' : kind === 'payment' ? 'Payment Reminder / 结账催费' : 'Repair Order / 维修工单';
    const detail = kind === 'inspection'
      ? `<p><b>检查/诊断：</b>${escapeHtml(order.diagnosis || '尚未填写')}</p><p><b>已完成维修：</b>${escapeHtml(order.workPerformed || '尚未填写')}</p>`
      : `<p><b>客户描述：</b>${escapeHtml(order.complaint || '—')}</p><p><b>诊断与维修：</b>${escapeHtml(`${order.diagnosis || ''} ${order.workPerformed || ''}`)}</p><p><b>总价：</b>${money(order.total)}　<b>已付：</b>${money(order.paid)}　<b>支付方式：</b>${escapeHtml(order.paymentMethod || '未记录')}　<b>欠款：</b>${money(order.balance)}</p>`;
    const subject = `${settings.shopName} · ${title} · ${order.number}`;
    const textBody = `${settings.shopName}\n${settings.address}\n${settings.phone}\n\n${title} ${order.number}\n客户：${order.customer}\n车辆：${order.vehicle} ${order.plate}\n总价：${money(order.total)}\n已付：${money(order.paid)}\n支付方式：${order.paymentMethod || '未记录'}\n欠款：${money(order.balance)}\n\n客户描述：${order.complaint || '—'}\n检查/诊断：${order.diagnosis || '—'}\n完成维修：${order.workPerformed || '—'}\n\n如有问题请致电 ${settings.phone}。`;
    try {
      await notify(subject, `<h2>${escapeHtml(settings.shopName)}</h2><p style="margin:6px 0">${escapeHtml(settings.address)}</p><p style="margin:6px 0;white-space:nowrap">Tel / 电话：${escapeHtml(settings.phone)}</p><hr><h3>${title} ${escapeHtml(order.number)}</h3><p>${escapeHtml(order.customer)} · ${escapeHtml(order.vehicle)} · ${escapeHtml(order.plate)}</p>${detail}<p>如有问题请致电 ${escapeHtml(settings.phone)}。</p>`, email.trim());
      alert('邮件已发送。');
    } catch (error) {
      openMailClient(email.trim(), subject, textBody);
      alert(`云端邮件暂未发出，已打开本机邮件程序并填好内容。\n原因：${explainSendError(error)}`);
    }
  };
  const sendCustomerDocument = async (kind: string) => {
    const email = prompt('客户邮箱：', savedEmail);
    if (!email?.trim()) return;
    const cleanEmail = email.trim();
    const documentNames: Record<string, string> = {
      estimate: 'Estimate / 报价单', repair: 'Repair Order / 维修工单',
      invoice: 'Invoice / 发票', receipt: 'Receipt / 收据',
    };
    const title = documentNames[kind] || documentNames.repair;
    const laborRows = order.laborItems.map(item => { const qty = Number(item.qty || 1); return `<tr><td>${escapeHtml(item.description)}${qty !== 1 ? ` × ${qty}` : ''}${item.descriptionEn ? `<br><em>${escapeHtml(item.descriptionEn)}</em>` : ''}</td><td style="text-align:right">${item.billingMode === 'flat' ? 'Flat' : Number(item.hours).toFixed(1)}${qty !== 1 ? ` ×${qty}` : ''}</td><td style="text-align:right">${money(item.total)}</td></tr>`; }).join('');
    const partRows = order.partItems.filter(item => !!(item.partId || item.partNo?.trim() || item.name?.trim())).map(item => `<tr><td>${escapeHtml(item.partNo)}</td><td>${escapeHtml(item.name)}${item.nameEn ? `<br><em>${escapeHtml(item.nameEn)}</em>` : ''}</td><td style="text-align:right">${item.qty}</td><td style="text-align:right">${money(item.price)}</td><td style="text-align:right">${money(item.total)}</td></tr>`).join('');
    const amountLabel = kind === 'receipt' ? 'Amount Paid / 已付款' : 'Total / 总计';
    const amount = kind === 'receipt' ? order.paid : order.total;
    const paymentMethodRow = ['invoice', 'receipt'].includes(kind) && order.paymentMethod
      ? `<tr><td>Payment Method / 支付方式</td><td style="text-align:right">${escapeHtml(order.paymentMethod)}</td></tr>`
      : '';
    const customerPhotos = (order.evidencePhotos || []).filter(photo => photo.customerVisible && !photo.archivedAt).slice(0, 8);
    const attachments = await Promise.all(customerPhotos.map(async (photo, index) => ({ filename: `${order.number}-${photo.category}-${index + 1}.jpg`, content: await evidenceContent(photo.dataUrl), contentId: `evidence-${index + 1}` })));
    const evidenceHtml = customerPhotos.length ? `<h3>Evidence Photos / 证据照片</h3><div>${customerPhotos.map((photo, index) => `<div style="margin:0 0 18px"><img src="cid:evidence-${index + 1}" alt="${escapeHtml(photo.category)}" style="max-width:100%;height:auto;border:1px solid #ccd3df"><p><b>${escapeHtml(photo.category)}</b> · ${escapeHtml(photo.note || '')}<br><small>${escapeHtml(new Date(photo.capturedAt).toLocaleString())}</small></p></div>`).join('')}</div>` : '';
    const baseHtml = `<div style="max-width:760px;margin:auto;font-family:Arial,sans-serif;color:#172033"><div style="text-align:center;border-bottom:3px solid #155eef;padding:18px"><h1 style="margin:0">Z&amp;G AUTO REPAIR</h1><p style="margin:14px 0 4px">${escapeHtml(settings.address)}</p><p style="margin:4px 0;white-space:nowrap">Tel / 电话：${escapeHtml(settings.phone)}</p><h2>${title}</h2><b>${escapeHtml(order.number)}</b></div><table style="width:100%;margin:18px 0;border-collapse:collapse"><tr><td><b>Customer / 客户</b><br>${escapeHtml(order.customer)}</td><td><b>Vehicle / 车辆</b><br>${escapeHtml(order.vehicle)} · ${escapeHtml(order.plate)}</td></tr><tr><td><b>Phone / 电话</b><br>${escapeHtml(order.phone)}</td><td><b>VIN</b><br>${escapeHtml(order.vin)}</td></tr></table><h3>Customer Concern / 客户描述</h3><p>${escapeHtml(order.complaint || '—')}</p><h3>Diagnosis &amp; Work / 检查与维修</h3><p>${escapeHtml(order.diagnosis || '—')}<br>${escapeHtml(order.workPerformed || '')}</p>${laborRows ? `<h3>Labor / 人工</h3><table style="width:100%;border-collapse:collapse" border="1" cellpadding="7"><tr><th>项目</th><th>工时/方式</th><th>金额</th></tr>${laborRows}</table>` : ''}${partRows ? `<h3>Parts / 配件</h3><table style="width:100%;border-collapse:collapse" border="1" cellpadding="7"><tr><th>编号</th><th>名称</th><th>数量</th><th>销售价</th><th>金额</th></tr>${partRows}</table>` : ''}<table style="width:360px;margin:20px 0 20px auto;border-collapse:collapse" border="1" cellpadding="8"><tr><td>Labor / 人工</td><td style="text-align:right">${money(order.laborTotal)}</td></tr><tr><td>Parts / 配件</td><td style="text-align:right">${money(order.partsTotal)}</td></tr><tr><td>Tax / 税</td><td style="text-align:right">${money(order.tax)}</td></tr><tr><td><b>${amountLabel}</b></td><td style="text-align:right"><b>${money(amount)}</b></td></tr>${kind === 'receipt' ? '' : `<tr><td>Balance Due / 欠款</td><td style="text-align:right">${money(order.balance)}</td></tr>`}</table><p style="text-align:center;color:#667085">${escapeHtml(settings.invoiceTerms || 'Thank you for your business.')}</p></div>`;
    const html = baseHtml
      .replace('</table><p style="text-align:center', `${paymentMethodRow}</table><p style="text-align:center`)
      .replace(/<\/div>$/, `${evidenceHtml}</div>`);
    const subject = `${settings.shopName} · ${title} · ${order.number}`;
    try {
      const result = await notify(subject, html, cleanEmail, attachments);
      await cloud.upsertRecord('workOrders', { ...order, documentSendHistory: [...(order.documentSendHistory || []), { id: uid(), documentType: title, email: cleanEmail, sentAt: new Date().toISOString(), status: 'sent', providerId: result.id }] } as unknown as CloudRow);
      alert(`${title} 已成功发送到 ${cleanEmail}，发送记录已保存。`);
    } catch (error) {
      const message = explainSendError(error);
      await cloud.upsertRecord('workOrders', { ...order, documentSendHistory: [...(order.documentSendHistory || []), { id: uid(), documentType: title, email: cleanEmail, sentAt: new Date().toISOString(), status: 'mail-client', error: message }] } as unknown as CloudRow);
      openMailClient(cleanEmail, subject, `${title}\n工单号：${order.number}\n客户：${order.customer}\n车辆：${order.vehicle} ${order.plate}\n总计：${money(order.total)}\n已付：${money(order.paid)}\n支付方式：${order.paymentMethod || '未记录'}\n欠款：${money(order.balance)}\n\n${settings.phone}`);
      alert(`云端邮件暂未发出，已打开本机邮件程序。系统已记录本次尝试。\n原因：${message}`);
    }
  };
  const approval = async () => {
    const email = prompt('接收在线确认链接的客户邮箱：', savedEmail);
    if (!email?.trim()) return;
    const { token } = await cloud.createCustomerApproval(order.id, email.trim(), order.customer, order as unknown as Record<string, unknown>);
    const url = `${window.location.origin}${window.location.pathname}?approval=${encodeURIComponent(token)}`;
    const updated: WorkOrder = { ...order, customerApprovalStatus: '待客户确认', customerApprovalUrl: url };
    await cloud.upsertRecord('workOrders', updated as unknown as CloudRow);
    try {
      await notify(`${settings.shopName} · 维修项目等待确认 · ${order.number}`, `<h2>维修项目在线确认</h2><p>${escapeHtml(order.customer)}，您好：</p><p>您的车辆 ${escapeHtml(order.vehicle)}（${escapeHtml(order.plate)}）维修项目等待确认。</p><p><b>预计总价：${money(order.total)}</b></p><p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#165dff;color:white;text-decoration:none;border-radius:6px">查看并确认维修</a></p><p>工单号：${escapeHtml(order.number)}</p>`, email.trim());
      alert('在线确认链接已经发送，客户确认或拒绝后会自动回传系统。');
    } catch (error) {
      const copied = await copyText(url);
      openMailClient(email.trim(), `${settings.shopName} · 维修项目等待确认 · ${order.number}`, `${order.customer}，您好：\n\n您的车辆 ${order.vehicle}（${order.plate}）维修项目等待确认，预计总价 ${money(order.total)}。\n\n请打开以下链接查看、签字并确认：\n${url}\n\n工单号：${order.number}\n${settings.phone}`);
      alert(`客户在线确认链接已经生成${copied ? '并复制' : ''}。云端邮件暂未发出，已打开本机邮件程序并填好确认链接。\n原因：${explainSendError(error)}`);
    }
  };
  const saveSmsHistory = async (documentType: string, phone: string, result: { id?: string; status?: string }) => {
    await cloud.upsertRecord('workOrders', { ...order, documentSendHistory: [...(order.documentSendHistory || []), { id: uid(), documentType, phone, channel: 'sms', sentAt: new Date().toISOString(), status: result.status === 'queued' ? 'queued' : 'sent', providerId: result.id }] } as unknown as CloudRow);
  };
  const sendSmsNotice = async (kind: 'repair' | 'invoice' | 'progress') => {
    const phone = prompt('客户手机号码：', savedPhone);
    if (!phone?.trim()) return;
    const statusEnglish: Record<string, string> = {
      '等待检查': 'Waiting for inspection', '等待批准': 'Waiting for approval', '等待配件': 'Waiting for parts',
      '维修中': 'Repair in progress', '已完成': 'Completed', '已交车': 'Delivered', '已取消': 'Canceled',
    };
    const commonWorkEnglish: Record<string, string> = {
      '换机油': 'Engine oil change', '已更换机油': 'Engine oil changed',
      '更换发动机机油和滤芯': 'Engine oil and filter replacement',
    };
    const workUpdateEnglish = String(order.workPerformedEn || '').trim()
      || commonWorkEnglish[String(order.workPerformed || '').trim()]
      || (order.workPerformed ? 'Service work has been updated' : '');
    const pickupNotice = ['已完成', '已交车'].includes(order.status) ? 'Your vehicle is ready for pickup. ' : '';
    const messages = {
      repair: `Z&G AUTO: Repair order ${order.number} for ${order.vehicle} is ready. Total ${money(order.total)}. Questions: ${settings.phone}.`,
      invoice: `Z&G AUTO: Invoice ${order.number} is ready. Total ${money(order.total)}, paid ${money(order.paid)}, balance ${money(order.balance)}. Questions: ${settings.phone}.`,
      progress: `Z&G AUTO: Update for ${order.number} (${order.vehicle}). Status: ${statusEnglish[order.status] || 'Updated'}. ${workUpdateEnglish ? `Work performed: ${workUpdateEnglish.slice(0, 180)}. ` : ''}${pickupNotice}Questions: ${settings.phone}.`,
    };
    const labels = { repair: '短信工单通知', invoice: '短信发票通知', progress: '短信维修进度通知' };
    const result = await notifySms(phone.trim(), messages[kind]);
    await saveSmsHistory(labels[kind], phone.trim(), result);
    alert(`${labels[kind]}已发送到 ${phone.trim()}，发送记录已保存。`);
  };
  const sendSmsApproval = async () => {
    const phone = prompt('接收在线维修确认的客户手机号码：', savedPhone);
    if (!phone?.trim()) return;
    const { token } = await cloud.createCustomerApproval(order.id, '', order.customer, order as unknown as Record<string, unknown>);
    const url = `${window.location.origin}${window.location.pathname}?approval=${encodeURIComponent(token)}`;
    const result = await notifySms(phone.trim(), `Z&G AUTO: Your estimate ${order.number} for ${order.vehicle} is ready (${money(order.total)}). Review, sign and approve: ${url}`);
    const updated: WorkOrder = { ...order, customerApprovalStatus: '待客户确认', customerApprovalUrl: url, documentSendHistory: [...(order.documentSendHistory || []), { id: uid(), documentType: '短信在线维修确认', phone: phone.trim(), channel: 'sms', sentAt: new Date().toISOString(), status: result.status === 'queued' ? 'queued' : 'sent', providerId: result.id }] };
    await cloud.upsertRecord('workOrders', updated as unknown as CloudRow);
    alert('在线维修确认短信已发送。客户可打开链接查看、签字、批准或拒绝，结果会自动回传系统。');
  };
  const choose = async (value: string) => {
    if (!value) return;
    if (value === 'copy' && order.customerApprovalUrl) { const copied = await copyText(order.customerApprovalUrl); if (copied) alert('客户确认链接已复制。'); return; }
    setSending(true);
    try { if (value === 'approval') await approval(); else if (value === 'sms-approval') await sendSmsApproval(); else if (value === 'sms-repair') await sendSmsNotice('repair'); else if (value === 'sms-invoice') await sendSmsNotice('invoice'); else if (value === 'sms-progress') await sendSmsNotice('progress'); else if (['estimate','repair','invoice','receipt'].includes(value)) await sendCustomerDocument(value); else await regularEmail(value); }
    catch (error) { alert(`发送失败：${explainSendError(error)}`); }
    finally { setSending(false); }
  };
  return <select className="send-select" value="" disabled={sending} onChange={event => { void choose(event.target.value); event.target.value = ''; }}><option value="">{sending ? '发送中…' : '发送…'}</option><optgroup label="短信通知"><option value="sms-approval">短信：在线维修确认</option><option value="sms-repair">短信：工单通知</option><option value="sms-invoice">短信：发票/余额通知</option><option value="sms-progress">短信：维修进度通知</option></optgroup><optgroup label="电子邮件"><option value="estimate">邮件：发送报价单</option><option value="repair">邮件：发送维修工单</option><option value="invoice">邮件：发送发票</option><option value="receipt">邮件：发送收据</option><option value="inspection">邮件：发送检查结果</option><option value="payment">邮件：发送催费/结账</option><option value="approval">邮件：在线维修确认</option></optgroup>{order.customerApprovalUrl && <option value="copy">复制现有确认链接</option>}</select>;
}

function printDocument(order: WorkOrder, settings: ShopSettings, documentType: string) {
  const isReceipt = documentType === 'Receipt'; const paid = isReceipt ? order.paid : order.total;
  const shopAddress = settings.address || '319 Agostino Rd, San Gabriel, CA 91776';
  const shopPhone = settings.phone || '626-508-0888';
  documentType = ({ Estimate: 'ESTIMATE / 报价单', 'Repair Order': 'REPAIR ORDER / 维修工单', Invoice: 'INVOICE / 发票', Receipt: 'RECEIPT / 收据' } as Record<string, string>)[documentType] || documentType;
  const laborRows = order.laborItems.map(item => { const flat = item.billingMode === 'flat'; const qty = Number(item.qty || 1); return `<tr><td>${escapeHtml(item.description)}${qty !== 1 ? ` × ${qty}` : ''}${item.descriptionEn ? `<br><em>${escapeHtml(item.descriptionEn)}</em>` : ''}</td><td class="num">${flat ? 'Flat' : item.hours.toFixed(1)}${qty !== 1 ? ` ×${qty}` : ''}</td><td class="num">${flat ? '—' : money(item.rate)}</td><td class="num">${money(item.total)}</td></tr>`; }).join('');
  const partRows = order.partItems.filter(item => !!(item.partId || item.partNo?.trim() || item.name?.trim())).map(item => `<tr><td>${escapeHtml(item.partNo)}</td><td>${escapeHtml(item.name)}${item.nameEn ? `<br><em>${escapeHtml(item.nameEn)}</em>` : ''}</td><td class="num">${item.qty}</td><td class="num">${money(item.price)}</td><td class="num">${money(item.total)}</td></tr>`).join('');
  const signatureName = order.customerSignedBy || order.customer || '';
  const signatureTime = order.customerSignedAt ? new Date(order.customerSignedAt).toLocaleString() : '';
  const customerSignature = order.customerSignature
    ? `<div style="border-top:1px solid #222;padding-top:3px"><img src="${escapeHtml(order.customerSignature)}" alt="Customer signature" style="display:block;max-width:220px;max-height:56px;object-fit:contain"><span style="display:block;font-size:7pt">${escapeHtml(signatureName)}${signatureTime ? ` · ${escapeHtml(signatureTime)}` : ''}</span><b style="display:block;font-size:7pt">Customer Signature / 客户签字</b></div>`
    : '<div class="line">Customer Signature / Date · 客户签字/日期</div>';
  const paymentMethodRow = (isReceipt || documentType.includes('INVOICE')) && order.paymentMethod
    ? `<tr><td>Payment Method / 支付方式</td><td class="num">${escapeHtml(order.paymentMethod)}</td></tr>`
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(documentType)} ${escapeHtml(order.number)}</title><style>@page{size:Letter;margin:.35in}*{box-sizing:border-box}body{font:8pt Arial;color:#111;margin:0}.header{text-align:center;border-bottom:2px solid #111;padding-bottom:8px}.logo{font:bold 18pt Arial;letter-spacing:2px}.header h1{font-size:12pt;margin:3px}.header p{margin:2px}.doc-title{display:flex;justify-content:space-between;align-items:end;margin:10px 0 5px}.doc-title h2{font-size:13pt;margin:0}.ro-number{text-align:right;font-size:8pt}.ro-number b{font-size:10pt}.box-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}.box{border:1px solid #999;padding:5px;min-height:52px}.box b{display:inline-block;min-width:55px}.section{margin-top:7px}.section h3{font-size:8pt;background:#222;color:#fff;margin:0;padding:4px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:3px;vertical-align:top}th{background:#eee;text-align:left}.num{text-align:right}.totals{width:46%;margin:7px 0 0 auto}.totals td:first-child{text-align:right}.grand td{font-size:10pt;font-weight:bold;border-top:2px solid #111}.notes{border:1px solid #aaa;padding:5px;min-height:36px}.sign{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:24px}.line{border-top:1px solid #222;padding-top:3px}.footer{text-align:center;margin-top:10px;font-size:7pt;color:#555}</style></head><body><div class="header"><div class="logo">Z&G</div><h1>${escapeHtml(settings.shopName || 'Z&G AUTO REPAIR')}</h1><p>${escapeHtml(shopAddress)} · Tel / 电话 ${escapeHtml(shopPhone)}${settings.email ? ` · ${escapeHtml(settings.email)}` : ''}</p></div><div class="doc-title"><h2>${escapeHtml(documentType)}</h2><div class="ro-number"><span>Repair Order No. / 工单编号</span><br><b>${escapeHtml(order.number)}</b><br>${escapeHtml(order.date)}</div></div><div class="box-grid"><div class="box"><b>Customer</b>${escapeHtml(order.customer)}<br><b>Phone</b>${escapeHtml(order.phone)}<br><b>Company</b>${escapeHtml(order.company || '')}<br><b>Driver</b>${escapeHtml(order.driver || '')} ${escapeHtml(order.driverPhone || '')}</div><div class="box"><b>Vehicle</b>${escapeHtml(order.vehicle)}<br><b>Plate</b>${escapeHtml(order.plate)}<br><b>VIN</b>${escapeHtml(order.vin)}<br><b>Mileage</b>${escapeHtml(order.mileage)} &nbsp; <b>PO</b>${escapeHtml(order.po || '')}</div></div><div class="section"><h3>Customer Concern / 客户描述</h3><div class="notes">${escapeHtml(order.complaint)}</div></div><div class="section"><h3>Diagnosis & Work Performed / 诊断与维修</h3><div class="notes">${escapeHtml(order.diagnosis)}<br>${escapeHtml(order.workPerformed)}</div></div>${laborRows ? `<div class="section"><h3>Labor / 人工</h3><table><thead><tr><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>${laborRows}</tbody></table></div>` : ''}${partRows ? `<div class="section"><h3>Parts / 配件</h3><table><thead><tr><th>Part #</th><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>${partRows}</tbody></table></div>` : ''}<table class="totals"><tr><td>Labor</td><td class="num">${money(order.laborTotal)}</td></tr><tr><td>Parts</td><td class="num">${money(order.partsTotal)}</td></tr><tr><td>Outsource</td><td class="num">${money(order.outsource)}</td></tr><tr><td>Tax</td><td class="num">${money(order.tax)}</td></tr><tr><td>Discount</td><td class="num">-${money(order.discount)}</td></tr><tr class="grand"><td>${isReceipt ? 'Amount Paid' : 'Total'}</td><td class="num">${money(paid)}</td></tr>${!isReceipt ? `<tr><td>Paid</td><td class="num">${money(order.paid)}</td></tr><tr><td>Balance Due</td><td class="num">${money(order.balance)}</td></tr>` : ''}</table><div class="sign"><div class="line">Customer Signature / Date</div><div class="line">Authorized By / Date</div></div><div class="footer">${escapeHtml(settings.invoiceTerms || 'Thank you for your business.')}</div><script>window.onload=()=>window.print()</script></body></html>`;
  const finalHtml = html
    .replace('<tr><td>Tax</td>', '<tr><td>Parts Sales Tax / 配件销售税</td>')
    .replace('</table><div class="sign">', `${paymentMethodRow}</table><div class="sign">`)
    .replace('<div class="line">Customer Signature / Date</div>', customerSignature);
  const win = window.open('', '_blank');
  if (!win) return alert('浏览器阻止了打印窗口，请允许弹出窗口。');
  win.document.write(finalHtml);
  const printLogo = win.document.querySelector('.header .logo');
  if (printLogo) printLogo.innerHTML = BRAND_LOGO_SVG;
  const repeatedShopName = win.document.querySelector('.header h1') as HTMLElement | null;
  if (repeatedShopName) repeatedShopName.style.display = 'none';
  win.document.close();
}

function normalizeStore(raw: CloudStore): AppStore {
  const result = { ...emptyStore } as AppStore;
  for (const key of Object.keys(emptyStore)) result[key] = (raw[key] || []) as unknown[];
  // Reconcile settled amounts from immutable payment rows on every cloud load.
  // This repairs a stale work-order balance after a later edit and keeps paid
  // orders settled across midnight, refreshes and other devices.
  const ledgerByOrder = new Map<string, number>();
  const ledgerOrderIds = new Set<string>();
  for (const payment of result.payments) {
    if (!payment.workOrderId || payment.archivedAt) continue;
    ledgerOrderIds.add(payment.workOrderId);
    ledgerByOrder.set(payment.workOrderId, (ledgerByOrder.get(payment.workOrderId) || 0) + Number(payment.amount || 0));
  }
  result.workOrders = result.workOrders.map(item => {
    const paid = ledgerOrderIds.has(item.id) ? Number((ledgerByOrder.get(item.id) || 0).toFixed(2)) : Number(item.paid || 0);
    return recalculateWorkOrder({ ...item, paid, laborItems: Array.isArray(item.laborItems) ? item.laborItems : legacyLabor(item), partItems: Array.isArray(item.partItems) ? item.partItems : legacyParts(item) });
  });
  result.parts = result.parts.map(item => ({ ...item, cost: Number(item.cost || 0), price: Number(item.price || 0), qty: Number(item.qty || 0), minimum: Number(item.minimum || 0) }));
  return result;
}
function legacyLabor(item: Partial<WorkOrder>) { const hours = Number((item as unknown as Record<string, unknown>).laborHours || 0), rate = Number((item as unknown as Record<string, unknown>).laborRate || 0); return hours || rate ? [{ id: uid(), description: '人工费（旧版导入）', hours, rate, total: hours * rate }] : []; }
function legacyParts(item: Partial<WorkOrder>) { const record = item as unknown as Record<string, unknown>, total = Number(record.partsTotal || 0), cost = Number(record.partsCost || 0); return total ? [{ id: uid(), partNo: '', name: '配件（旧版导入）', qty: 1, price: total, cost, total, costTotal: cost }] : []; }
function usageMap(order?: WorkOrder) { const map: Record<string, number> = {}; if (!order) return map; for (const item of order.partItems || []) if (item.partId) map[item.partId] = (map[item.partId] || 0) + Number(item.qty || 0); return map; }
function upsertLocal<T extends { id: string }>(rows: T[], row: T) { const index = rows.findIndex(item => item.id === row.id); return index < 0 ? [...rows, row] : rows.map(item => item.id === row.id ? row : item); }
function normalizeSearch(value: unknown) { return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\-()./]/g, ''); }
function filterRows<T extends object>(rows: T[], search: string) { const active = rows.filter(row => !(row as Record<string, unknown>).archived); const query = normalizeSearch(search); return query ? active.filter(row => normalizeSearch(JSON.stringify(row)).includes(query)) : active; }
function nextWorkOrderNumber(rows: WorkOrder[]) { const year = new Date().getFullYear(); const max = rows.map(item => Number(item.number.match(/(\d+)$/)?.[1] || 0)).reduce((a, b) => Math.max(a, b), 0); return `RO-${year}-${String(max + 1).padStart(4, '0')}`; }
function losAngelesDateKey(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const normalized = value
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/\+00(?::00)?$/, 'Z');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function dashboardMetrics(store: AppStore) { const date = losAngelesDateKey(new Date().toISOString()), month = date.slice(0, 7), valid = store.workOrders.filter(item => item.status !== '已取消'); const todayOrders = valid.filter(item => losAngelesDateKey(item.date) === date), monthOrders = valid.filter(item => losAngelesDateKey(item.date).startsWith(month)); const todayPayments = store.payments.filter(item => losAngelesDateKey(item.date) === date), monthPayments = store.payments.filter(item => losAngelesDateKey(item.date).startsWith(month)), todayExpensesRows = store.expenses.filter(item => losAngelesDateKey(item.date) === date), monthExpensesRows = store.expenses.filter(item => losAngelesDateKey(item.date).startsWith(month)); const monthReceived = sum(monthPayments, 'amount'), monthExpenses = sum(monthExpensesRows, 'amount'); return { todaySales: sum(todayOrders, 'total'), monthSales: sum(monthOrders, 'total'), todayReceived: sum(todayPayments, 'amount'), monthReceived, todayExpenses: sum(todayExpensesRows, 'amount'), todayPartsExpenses: sum(todayExpensesRows.filter(item => item.category === '配件采购'), 'amount'), todayGross: sum(todayOrders, 'grossProfit'), monthGross: sum(monthOrders, 'grossProfit'), monthExpenses, monthBookBalance: monthReceived - monthExpenses, monthNet: sum(monthOrders, 'grossProfit') - monthExpenses, receivables: sum(valid, 'balance') }; }
function sum<T extends object>(rows: T[], key: keyof T) { return rows.reduce((total, row) => total + Number(row[key] || 0), 0); }

registerPwa();
const approvalToken = new URLSearchParams(window.location.search).get('approval');
const publicHost = ['zgautorepair.com', 'www.zgautorepair.com'].includes(window.location.hostname);
const publicPreview = window.location.pathname === '/website' || window.location.pathname.startsWith('/website/');
const publicPath = publicPreview ? (window.location.pathname.replace(/^\/website/, '') || '/') : window.location.pathname;
createRoot(document.getElementById('root')!).render(<React.StrictMode>{publicHost || publicPreview ? <PublicWebsite path={publicPath} /> : approvalToken ? <CustomerApprovalPage token={approvalToken} /> : <><PwaInstall /><FormalGate>{cloud => <App cloud={cloud} />}</FormalGate></>}</React.StrictMode>);
