import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FormalGate } from './FormalGate';
import type { CloudRow, CloudSession, CloudStore, StaffMember } from './lib/cloud';
import { decodeVin, escapeHtml, money, recalculateWorkOrder, today, uid } from './lib/erp';
import type { AppStore, ApprovalRequest, Campaign, ChangeLog, Customer, Driver, Expense, Fleet, InventoryLog, Part, Payment, ShopSettings, Vehicle, Warranty, WorkOrder } from './types';
import { WorkOrderEditor } from './WorkOrderEditor';
import { SmartTools } from './SmartTools';
import { ActivityCenter } from './ActivityCenter';
import { StaffPage } from './StaffPage';
import { BRAND_LOGO_SVG } from './brandLogo';
import { PwaInstall } from './PwaInstall';
import { registerPwa } from './pwa';
import { recognizePlatePhoto, recognizeVinPhoto } from './lib/ocr';
import { CustomerApprovalPage } from './CustomerApprovalPage';
import { printDocumentV077 } from './printDocument';
import './styles.css';
import './v0763.css';
import './extra.css';
import './v0770.css';

type Page = 'dashboard' | 'customers' | 'fleets' | 'vehicles' | 'workOrders' | 'parts' | 'finance' | 'campaigns' | 'staff' | 'smart' | 'settings';
type ModalState = { type: 'customer' | 'fleet' | 'driver' | 'vehicle' | 'part' | 'expense' | 'campaign' | 'warranty' | 'settings'; value?: Record<string, unknown> } | null;

const emptyStore: AppStore = { customers: [], fleets: [], drivers: [], vehicles: [], workOrders: [], parts: [], inventoryLogs: [], payments: [], expenses: [], settings: [], campaigns: [], warranties: [], approvalRequests: [], changeLogs: [] };
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
  manager: ['customers', 'customerContact', 'workOrders', 'createWorkOrders', 'diagnosis', 'pricing', 'assignTechnician', 'collectPayment', 'finance', 'inventory', 'campaigns', 'staff', 'archive', 'approve', 'smart', 'settings'],
  frontdesk: ['customers', 'customerContact', 'workOrders', 'createWorkOrders', 'diagnosis', 'pricing', 'assignTechnician', 'collectPayment', 'campaigns', 'smart'],
  technician: ['assignedWorkOrders', 'claimWorkOrders', 'completeWorkOrders', 'diagnosis', 'smart'],
  finance: ['customers', 'customerContact', 'workOrders', 'pricing', 'collectPayment', 'finance', 'approve'],
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

  const refresh = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { setStore(normalizeStore(await cloud.loadStore())); }
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
      alert(`姓名保存失败：${error instanceof Error ? error.message : error}\n请确认服务器已安装 v0.77.0 数据库升级。`);
    }
  };

  const persist = async <T extends { id: string }>(module: keyof AppStore, row: T) => {
    setSyncing(true);
    const previous = store;
    setStore(current => ({ ...current, [module]: upsertLocal(current[module] as unknown as T[], row) }));
    try { await cloud.upsertRecord(String(module), row as unknown as CloudRow); }
    catch (error) { setStore(previous); alert(`保存失败：${error instanceof Error ? error.message : error}`); throw error; }
    finally { setSyncing(false); }
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
    const log: ChangeLog = { id: uid(), workOrderId: order.id, workOrderNumber: order.number, action, actor: actorName, actorId: cloud.user.id, at: new Date().toISOString(), detail, before, after };
    await persist('changeLogs', log);
  };

  const requestApproval = async (request: Omit<ApprovalRequest, 'id' | 'status' | 'requestedBy' | 'requestedById' | 'requestedAt'>) => {
    const row: ApprovalRequest = { ...request, id: uid(), status: '待授权', requestedBy: actorName, requestedById: cloud.user.id, requestedAt: new Date().toISOString() };
    await persist('approvalRequests', row);
    const relatedOrder = store.workOrders.find(item => item.id === row.workOrderId) || row.proposedOrder;
    if (relatedOrder) await writeChangeLog(relatedOrder, '申请双人授权', `${row.type}：${row.reason}`);
  };

  const saveWorkOrder = async (rawOrder: WorkOrder) => {
    const order = recalculateWorkOrder(rawOrder);
    const old = store.workOrders.find(item => item.id === order.id);
    const discountNeedsApproval = Number(order.discount || 0) !== Number(old?.discount || 0);
    const settlementNeedsApproval = order.settlementTotal !== old?.settlementTotal;
    const safeOrder = recalculateWorkOrder({ ...order, discount: old?.discount || 0, settlementTotal: old?.settlementTotal });
    const oldUsage = usageMap(old && old.status !== '已取消' ? old : undefined);
    const newUsage = usageMap(order.status !== '已取消' ? order : undefined);
    const partChanges: Array<{ part: Part; nextQty: number; delta: number }> = [];
    for (const partId of new Set([...Object.keys(oldUsage), ...Object.keys(newUsage)])) {
      const part = store.parts.find(item => item.id === partId);
      if (!part) continue;
      const delta = (newUsage[partId] || 0) - (oldUsage[partId] || 0);
      const nextQty = Number(part.qty || 0) - delta;
      if (nextQty < 0) return alert(`${part.partNo} ${part.name} 库存不足。当前 ${part.qty}，本次还需 ${delta}。`);
      if (delta) partChanges.push({ part, nextQty, delta });
    }
    try {
      for (const change of partChanges) {
        await persist('parts', { ...change.part, qty: change.nextQty });
        const log: InventoryLog = { id: uid(), date: new Date().toISOString(), partId: change.part.id, partNo: change.part.partNo, partName: change.part.name, type: change.delta > 0 ? '工单领用' : '工单退回', change: -change.delta, before: change.part.qty, after: change.nextQty, reference: order.number };
        await persist('inventoryLogs', log);
      }
      const savedOrder = discountNeedsApproval || settlementNeedsApproval ? safeOrder : order;
      await persist('workOrders', { ...savedOrder, inventoryCommitted: savedOrder.status !== '已取消' });
      await writeChangeLog(savedOrder, old ? '修改工单' : '新建工单', old ? '工单内容已更新并保存到服务器' : '工单已建立并保存到服务器', old, savedOrder);
      if (discountNeedsApproval) await requestApproval({ workOrderId: order.id, workOrderNumber: order.number, type: '工单折扣', reason: `折扣由 ${money(old?.discount || 0)} 调整为 ${money(order.discount)}`, oldValue: old?.discount || 0, newValue: order.discount, proposedOrder: savedOrder });
      if (settlementNeedsApproval) await requestApproval({ workOrderId: order.id, workOrderNumber: order.number, type: '实际结账金额', reason: `实际结账金额申请调整为 ${money(order.settlementTotal)}`, oldValue: old?.settlementTotal ?? order.total, newValue: order.settlementTotal, proposedOrder: savedOrder });
      setEditingOrder(null); setPage('workOrders');
      alert(discountNeedsApproval || settlementNeedsApproval ? `工单 ${order.number} 已保存到服务器；折扣/结账金额将在第二人授权后生效。` : `工单 ${order.number} 已保存到正式服务器，其他账号会自动同步。`);
    } catch { /* persist already explains the error */ }
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

  const approveRequest = async (request: ApprovalRequest) => {
    if (request.requestedById === cloud.user.id) return alert('双人授权规则：申请人不能批准自己的申请。请让另一位有审批权限的员工登录处理。');
    const order = store.workOrders.find(item => item.id === request.workOrderId);
    if (!order) return alert('关联工单不存在。');
    if (!confirm(`批准“${request.type}”？\n工单：${request.workOrderNumber}\n申请人：${request.requestedBy}\n原因：${request.reason}`)) return;
    if (request.type === '删除工单') await executeWorkOrderArchive(order, request.reason);
    if (request.type === '工单折扣') await persist('workOrders', recalculateWorkOrder({ ...order, discount: Number(request.newValue || 0) }));
    if (request.type === '实际结账金额') await persist('workOrders', recalculateWorkOrder({ ...order, settlementTotal: Number(request.newValue || 0) }));
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
    const raw = prompt(`工单 ${order.number} 欠款 ${money(order.balance)}\n请输入本次收款金额：`, String(order.balance));
    if (!raw) return; const amount = Number(raw);
    if (!amount || amount < 0 || amount > order.balance + 0.01) return alert('收款金额不正确。');
    const method = prompt('付款方式：现金 / 刷卡 / Zelle / 支票 / 在线付款', '现金') || '现金';
    const payment: Payment = { id: uid(), date: new Date().toISOString(), workOrderId: order.id, workOrderNumber: order.number, customer: order.customer, amount, method };
    await persist('payments', payment);
    await persist('workOrders', recalculateWorkOrder({ ...order, paid: order.paid + amount, paymentMethod: method }));
  };

  const receiveStock = async (part: Part) => {
    const raw = prompt(`${part.partNo} ${part.name}\n当前库存：${part.qty}\n请输入入库数量：`, '1');
    if (!raw) return; const qty = Number(raw); if (!qty || qty <= 0) return alert('请输入正确数量。');
    const next = part.qty + qty;
    await persist('parts', { ...part, qty: next });
    await persist('inventoryLogs', { id: uid(), date: new Date().toISOString(), partId: part.id, partNo: part.partNo, partName: part.name, type: '采购入库', change: qty, before: part.qty, after: next, reference: prompt('采购单/收据号码（可选）', '') || '' } as InventoryLog);
  };

  const claimWorkOrder = async (order: WorkOrder) => {
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
    const updated = recalculateWorkOrder({ ...order, technicianUserId: order.technicianUserId || cloud.user.id, technician: order.technician || actorName, status: '已完成', technicianCompletedAt: now, completedBy: actorName, completedByUserId: cloud.user.id });
    await persist('workOrders', updated);
    await writeChangeLog(updated, '维修完成', `${actorName} 标记维修完成。`, order, updated);
  };

  const openModal = (type: NonNullable<ModalState>['type'], value?: object) => setModal({ type, value: value ? { ...value } as Record<string, unknown> : undefined });
  const closeModal = () => setModal(null);

  const saveModal = async (type: NonNullable<ModalState>['type'], data: Record<string, unknown>) => {
    const row: Record<string, unknown> & { id: string } = { ...data, id: String(data.id || uid()) };
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
    if (type === 'settings') await persist('settings', row as unknown as ShopSettings);
    else await persist(`${type}s` as keyof AppStore, row as { id: string });
    closeModal();
  };

  if (editingOrder) return <WorkOrderEditor value={editingOrder === 'new' ? undefined : editingOrder} customers={store.customers} vehicles={store.vehicles} fleets={store.fleets} drivers={store.drivers} parts={store.parts} settings={settings} nextNumber={nextWorkOrderNumber(store.workOrders)} onCreateVehicle={vehicle => persist('vehicles', vehicle)} onPrint={(order, type) => printDocumentV077(recalculateWorkOrder(order), settings, type)} onSave={saveWorkOrder} onCancel={() => setEditingOrder(null)} currentUser={actorName} currentUserId={cloud.user.id} technicians={staffMembers} canApproveReview={can(cloud, 'approve')} canAssignTechnician={can(cloud, 'assignTechnician')} canEditPricing={can(cloud, 'pricing')} canViewFinancials={can(cloud, 'pricing') || can(cloud, 'finance')} />;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">Z&G</div><div><b>AUTO ERP</b><small>正式服务器版</small></div></div>
      <nav>{nav.filter(item => canOpenPage(cloud, item.id)).map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setSearch(''); setSearchDraft(''); }}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <div className="side-foot"><small>{cloud.organizationName}</small><b>{actorName}</b><span>{cloud.user.email}</span><button onClick={() => void editOwnProfile()}>编辑我的姓名</button><button onClick={() => confirm('确定退出当前账号？') && void cloud.signOut()}>退出登录</button></div>
    </aside>
    <main className="main"><header className="topbar"><div className="global-search">⌕<input value={searchDraft} onChange={e => setSearchDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && runGlobalSearch()} placeholder="搜索客户、电话、VIN、车牌、工单、司机…" /><button type="button" onClick={runGlobalSearch}>搜索</button>{searchSuggestions.length > 0 && <div className="search-suggestions">{searchSuggestions.map((item, index) => <button type="button" key={`${item.page}-${item.label}-${index}`} onClick={() => { setSearchDraft(item.query); setSearch(item.query); setPage(item.page); }}><b>{item.label}</b><small>{item.meta}</small></button>)}</div>}</div><div className="top-status"><span className={syncing ? 'syncing' : ''}>{syncing ? '正在同步…' : '● 云端已同步'}</span><button type="button" onClick={() => void editOwnProfile()}>{actorName}</button><b>v0.77.0</b><button type="button" className="topbar-logout" onClick={() => confirm('确定退出当前账号？') && void cloud.signOut()}>退出</button></div></header>
      {loading ? <div className="loading">正在读取正式服务器数据…</div> : <PageContent page={page} search={search} store={store} settings={settings} cloud={cloud} setPage={setPage} openModal={openModal} setEditingOrder={setEditingOrder} persist={persist} remove={remove} receiveStock={receiveStock} addPayment={addPayment} deleteWorkOrder={deleteWorkOrder} approveRequest={approveRequest} rejectRequest={rejectRequest} claimWorkOrder={claimWorkOrder} completeWorkOrder={completeWorkOrder} actorName={actorName} editOwnProfile={editOwnProfile} />}
    </main>
    {modal && <EntityModal state={modal} store={store} settings={settings} onClose={closeModal} onSave={saveModal} />}
  </div>;
}

type ContentProps = {
  page: Page; search: string; store: AppStore; settings: ShopSettings; cloud: CloudSession;
  setPage: (page: Page) => void; openModal: (type: NonNullable<ModalState>['type'], value?: object) => void;
  setEditingOrder: (value: WorkOrder | 'new' | null) => void;
  persist: <T extends { id: string }>(module: keyof AppStore, row: T) => Promise<void>;
  remove: (module: keyof AppStore, id: string) => Promise<void>; receiveStock: (part: Part) => Promise<void>;
  addPayment: (order: WorkOrder) => Promise<void>; deleteWorkOrder: (order: WorkOrder) => Promise<void>;
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
  if (page === 'campaigns') return <ActivityCenter campaigns={store.campaigns} warranties={store.warranties} vehicles={store.vehicles} onAddCampaign={() => props.openModal('campaign')} onEditCampaign={item => props.openModal('campaign', item)} onAddWarranty={() => props.openModal('warranty')} onEditWarranty={item => props.openModal('warranty', item)} onRemoveCampaign={id => props.remove('campaigns', id)} onRemoveWarranty={id => props.remove('warranties', id)} />;
  if (page === 'staff') return <StaffPage cloud={cloud} />;
  if (page === 'smart') return <SmartTools cloud={cloud} workOrders={store.workOrders} />;
  return <SettingsPage settings={settings} openModal={props.openModal} />;
}

function Dashboard({ store, setPage, setEditingOrder, cloud, actorName, editOwnProfile }: ContentProps) {
  const metrics = useMemo(() => dashboardMetrics(store), [store]);
  const isTechnician = cloud.role === 'technician' && !can(cloud, 'workOrders');
  const visibleOrders = isTechnician ? store.workOrders.filter(order => !order.technicianUserId && !order.technician || order.technicianUserId === cloud.user.id || order.technician === actorName || order.technician === cloud.user.email) : store.workOrders;
  const recent = [...visibleOrders].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const showFinance = can(cloud, 'pricing') || can(cloud, 'finance');
  return <div className="page"><div className="hero"><div><p className="eyebrow">{isTechnician ? '技师工作台' : '老板经营驾驶舱'}</p><h1>早上好，{actorName || 'Z&G AUTO REPAIR'}</h1><p>{isTechnician ? '这里显示分配给您的任务和可自行领取的未分配工单。领取、完成和修改都会留下员工姓名与时间。' : '营业、工单、库存和欠款都来自正式服务器实时数据。'}</p></div><div className="toolbar"><button onClick={() => void editOwnProfile()}>编辑我的姓名</button>{can(cloud, 'customers') && <button onClick={() => setPage('customers')}>＋ 新客户</button>}{can(cloud, 'createWorkOrders') && <button className="primary" onClick={() => setEditingOrder('new')}>＋ 新建工单</button>}</div></div>
    {showFinance ? <div className="kpi-grid"><Kpi label="今日开单营业额" value={money(metrics.todaySales)} tone="blue" /><Kpi label="今日实收" value={money(metrics.todayReceived)} tone="green" /><Kpi label="今日毛利润" value={money(metrics.todayGross)} tone="purple" /><Kpi label="未收款总额" value={money(metrics.receivables)} tone="orange" /><Kpi label="本月营业额" value={money(metrics.monthSales)} /><Kpi label="本月实收" value={money(metrics.monthReceived)} /><Kpi label="本月支出" value={money(metrics.monthExpenses)} /><Kpi label="本月净经营收益" value={money(metrics.monthNet)} /></div> : <div className="kpi-grid technician-kpis"><Kpi label="分配给我的工单" value={String(visibleOrders.length)} tone="blue" /><Kpi label="等待检查" value={String(visibleOrders.filter(item => item.status === '等待检查').length)} /><Kpi label="维修中" value={String(visibleOrders.filter(item => item.status === '维修中').length)} tone="purple" /><Kpi label="今日完成" value={String(visibleOrders.filter(item => item.date === today() && item.status === '已完成').length)} tone="green" /></div>}
    <div className="dashboard-grid"><section className="panel wide"><div className="section-title"><h3>最近工单</h3><button onClick={() => setPage('workOrders')}>查看全部</button></div><table><thead><tr><th>工单</th><th>客户/车辆</th><th>状态</th>{showFinance && <><th>总价</th><th>欠款</th></>}</tr></thead><tbody>{recent.map(order => <tr key={order.id}><td><b>{order.number}</b><small>{order.date}</small></td><td>{order.customer}<small>{order.plate} · {order.vehicle}</small></td><td><Status value={order.status} /></td>{showFinance && <><td>{money(order.total)}</td><td className={order.balance > 0 ? 'warning-text' : ''}>{money(order.balance)}</td></>}</tr>)}</tbody></table>{!recent.length && <Empty text="还没有分配给您的工单。" />}</section>
      <section className="panel"><h3>今日车间</h3><div className="count-list"><div><span>等待批准</span><b>{visibleOrders.filter(item => item.status === '等待批准').length}</b></div><div><span>等待配件</span><b>{visibleOrders.filter(item => item.status === '等待配件').length}</b></div><div><span>维修中</span><b>{visibleOrders.filter(item => item.status === '维修中').length}</b></div><div><span>今日完成</span><b>{visibleOrders.filter(item => item.date === today() && item.status === '已完成').length}</b></div></div></section>
      {can(cloud, 'inventory') && <section className="panel"><h3>库存提醒</h3><div className="count-list"><div><span>低库存配件</span><b className="warning-text">{store.parts.filter(item => item.qty <= item.minimum).length}</b></div><div><span>库存品种</span><b>{store.parts.length}</b></div><div><span>库存成本</span><b>{money(store.parts.reduce((sum, item) => sum + item.qty * item.cost, 0))}</b></div></div><button className="full" onClick={() => setPage('parts')}>打开库存中心</button></section>}
    </div>
  </div>;
}

function Customers({ store, search, openModal, remove }: ContentProps) {
  const rows = filterRows(store.customers, search);
  return <ListPage title="客户管理" subtitle="个人、公司和车队客户统一管理" action="＋ 添加客户" onAction={() => openModal('customer')}><table><thead><tr><th>客户</th><th>类型</th><th>电话</th><th>邮箱/地址</th><th>车辆</th><th /></tr></thead><tbody>{rows.map(item => <tr key={item.id}><td><b>{item.name}</b><small>{item.membership || '普通客户'}</small></td><td>{item.type}</td><td>{item.phone}<small>{item.secondaryPhone}</small></td><td>{item.email || '—'}<small>{item.address}</small></td><td>{store.vehicles.filter(vehicle => vehicle.ownerId === item.id).length}</td><td className="actions"><button onClick={() => openModal('customer', item)}>编辑</button><button className="danger-link" onClick={() => confirm('确定删除客户？') && remove('customers', item.id)}>删除</button></td></tr>)}</tbody></table>{!rows.length && <Empty text="没有找到客户。" />}</ListPage>;
}

function Fleets({ store, search, openModal, remove }: ContentProps) {
  const fleets = filterRows(store.fleets, search); const drivers = filterRows(store.drivers, search);
  return <div className="page"><div className="page-title"><div><p className="eyebrow">Fleet Management</p><h2>车队公司与司机</h2></div><div className="toolbar"><button onClick={() => openModal('driver')}>＋ 添加司机</button><button className="primary" onClick={() => openModal('fleet')}>＋ 添加车队公司</button></div></div>
    <div className="split-panels"><section className="panel"><h3>车队公司</h3><table><thead><tr><th>公司</th><th>联系人</th><th>月结</th><th /></tr></thead><tbody>{fleets.map(item => <tr key={item.id}><td><b>{item.company}</b><small>{item.phone}</small></td><td>{item.contact}<small>{item.billingEmail}</small></td><td>{item.terms || '现场付款'}</td><td className="actions"><button onClick={() => openModal('fleet', item)}>编辑</button><button className="danger-link" onClick={() => confirm('确定删除？') && remove('fleets', item.id)}>删除</button></td></tr>)}</tbody></table>{!fleets.length && <Empty text="尚未添加车队公司。" />}</section>
    <section className="panel"><h3>司机</h3><table><thead><tr><th>司机</th><th>公司</th><th>授权</th><th /></tr></thead><tbody>{drivers.map(item => <tr key={item.id}><td><b>{item.name}</b><small>{item.phone}</small></td><td>{item.company || '—'}</td><td>{item.authorized ? '可签字' : '仅送车'}</td><td className="actions"><button onClick={() => openModal('driver', item)}>编辑</button><button className="danger-link" onClick={() => confirm('确定删除？') && remove('drivers', item.id)}>删除</button></td></tr>)}</tbody></table>{!drivers.length && <Empty text="尚未添加司机。" />}</section></div></div>;
}

function Vehicles({ store, search, openModal, remove, setEditingOrder }: ContentProps) {
  const rows = filterRows(store.vehicles, search);
  const [historyVehicle, setHistoryVehicle] = useState<Vehicle | null>(null);
  const history = historyVehicle ? store.workOrders.filter(order => order.vehicleId === historyVehicle.id || (!!historyVehicle.vin && order.vin === historyVehicle.vin) || (!!historyVehicle.plate && order.plate === historyVehicle.plate)).sort((a,b) => `${b.date}${b.number}`.localeCompare(`${a.date}${a.number}`)) : [];
  return <><ListPage title="车辆管理" subtitle="每辆车建立永久维修档案，支持按车牌、VIN、Unit Number、客户和司机搜索" action="＋ 添加车辆" onAction={() => openModal('vehicle')}><div className="card-table">{rows.map(item => { const count = store.workOrders.filter(order => order.vehicleId === item.id || (!!item.vin && order.vin === item.vin) || (!!item.plate && order.plate === item.plate)).length; return <article className="vehicle-card" key={item.id}><div className="vehicle-avatar">{item.make?.slice(0, 1) || '🚗'}</div><div className="vehicle-main"><div><b>{item.year} {item.make} {item.model}</b><Status value={item.ownerType} /></div><p>{item.plate || '无车牌'} · Unit {item.unit || '—'}</p><small>VIN {item.vin || '—'}</small><small>{item.ownerName} {item.driverName ? `· 司机 ${item.driverName} ${item.driverPhone || ''}` : ''}</small><small className="history-count">维修记录 {count} 次</small></div><div className="vehicle-actions"><button className="primary-soft" onClick={() => setHistoryVehicle(item)}>维修档案</button><button onClick={() => openModal('vehicle', item)}>编辑</button><button onClick={() => setEditingOrder('new')}>开工单</button><button className="danger-link" onClick={() => confirm('确定删除车辆？') && remove('vehicles', item.id)}>删除</button></div></article>})}</div>{!rows.length && <Empty text="没有找到车辆。" />}</ListPage>
    {historyVehicle && <div className="modal-backdrop"><div className="modal vehicle-history-modal"><div className="modal-head"><div><p className="eyebrow">Vehicle Health Record / 车辆永久档案</p><h2>{historyVehicle.year} {historyVehicle.make} {historyVehicle.model}</h2><span>{historyVehicle.plate} · VIN {historyVehicle.vin || '—'} · {historyVehicle.ownerName}</span></div><button onClick={() => setHistoryVehicle(null)}>×</button></div><div className="vehicle-history-summary"><div><span>维修次数</span><b>{history.length}</b></div><div><span>累计金额</span><b>{money(history.reduce((sum,item) => sum + item.total,0))}</b></div><div><span>最后里程</span><b>{history[0]?.mileage?.toLocaleString() || historyVehicle.mileage?.toLocaleString() || '—'}</b></div><div><span>有效保修</span><b>{store.warranties.filter(item => item.vehicleId === historyVehicle.id && item.status === '有效').length}</b></div></div><div className="vehicle-timeline">{history.map(order => <article key={order.id}><div className="timeline-date"><b>{order.date}</b><span>{order.mileage?.toLocaleString() || '—'} mi</span></div><div className="timeline-card"><div><b>{order.number}</b><Status value={order.status} /><span className={`review-badge review-${order.reviewStatus || '未提交'}`}>{order.reviewStatus || '未提交'}</span></div><p><strong>客户描述：</strong>{order.complaint || '—'}</p><p><strong>诊断：</strong>{order.diagnosis || '—'}</p><p><strong>完成维修：</strong>{order.workPerformed || '—'}</p><small>人工：{order.laborItems.map(item => item.description).filter(Boolean).join('、') || '—'}</small><small>配件：{order.partItems.map(item => `${item.name} ×${item.qty}`).filter(Boolean).join('、') || '—'}</small><div className="timeline-total"><b>{money(order.total)}</b><button onClick={() => { setHistoryVehicle(null); setEditingOrder(order); }}>打开工单</button></div></div></article>)}{!history.length && <Empty text="这辆车还没有维修记录。" />}</div></div></div>}
  </>;
}

function WorkOrders({ store, search, settings, cloud, setEditingOrder, addPayment, deleteWorkOrder, approveRequest, rejectRequest, claimWorkOrder, completeWorkOrder, actorName }: ContentProps) {
  const assignedOnly = cloud.role === 'technician' && !can(cloud, 'workOrders');
  const visible = assignedOnly ? store.workOrders.filter(order => (!order.technicianUserId && !order.technician) || order.technicianUserId === cloud.user.id || order.technician === actorName || order.technician === cloud.user.email) : store.workOrders;
  const rows = filterRows(visible, search).sort((a, b) => b.date.localeCompare(a.date));
  const pending = store.approvalRequests.filter(item => item.status === '待授权' && (can(cloud, 'approve') || item.requestedById === cloud.user.id));
  const canApprove = can(cloud, 'approve');
  const showFinance = can(cloud, 'pricing') || can(cloud, 'finance');
  const canEdit = can(cloud, 'workOrders') || can(cloud, 'diagnosis');
  const canPrint = can(cloud, 'workOrders');
  const canSend = can(cloud, 'customerContact') || can(cloud, 'workOrders');
  const visibleLogs = store.changeLogs.filter(log => visible.some(order => order.id === log.workOrderId));
  return <div className="page"><div className="page-title"><div><p className="eyebrow">Z&G AUTO ERP</p><h2>{assignedOnly ? '我的维修任务' : '维修工单'}</h2><p>检查审查、客户在线确认、双人授权、证据留存、邮件、收款、打印和修改记录自动联动</p></div>{can(cloud, 'createWorkOrders') && <button className="primary" onClick={() => setEditingOrder('new')}>＋ 新建工单</button>}</div>
    {!!pending.length && <section className="panel approval-panel"><div className="section-title"><div><h3>待双人授权</h3><span>申请人与批准人必须是两个不同账号；所有决定永久记入日志</span></div><b>{pending.length} 项</b></div>{pending.map(item => <article className="approval-row" key={item.id}><div><b>{item.type === '删除工单' ? '作废/归档工单' : item.type} · {item.workOrderNumber}</b><small>申请人 {item.requestedBy} · {new Date(item.requestedAt).toLocaleString()}</small><p>{item.reason}</p></div><div className="actions">{canApprove && item.requestedById !== cloud.user.id ? <><button className="primary" onClick={() => void approveRequest(item)}>批准并执行</button><button onClick={() => void rejectRequest(item)}>拒绝</button></> : <span className="muted">{item.requestedById === cloud.user.id ? '等待另一账号批准' : '需要审批权限'}</span>}</div></article>)}</section>}
    <section className="panel work-order-table"><table><thead><tr><th>工单/日期</th><th>客户与车辆</th><th>技师/状态</th><th>检查/审查</th>{showFinance && <><th>总价</th><th>已付/欠款</th></>}<th /></tr></thead><tbody>{rows.map(order => { const checks = Object.values(order.inspectionChecklist || {}).filter(Boolean).length; const evidenceCount = (order.evidencePhotos || []).filter(item => !item.archivedAt).length; const isMine = order.technicianUserId === cloud.user.id || order.technician === actorName || order.technician === cloud.user.email; const isUnassigned = !order.technicianUserId && !order.technician; const isFinished = order.status === '已完成' || order.status === '已交车'; return <tr key={order.id} className={order.archivedAt ? 'archived-row' : ''}><td><b>{order.number}</b><small>{order.date} {order.po ? `· PO ${order.po}` : ''}</small>{order.archivedAt && <small className="archive-badge">已作废并归档</small>}</td><td>{order.customer}<small>{order.plate} · {order.vehicle}{order.driver ? ` · 司机 ${order.driver}` : ''}</small><small>证据 {evidenceCount} 张</small></td><td>{order.technician || '未分配（可领取）'}<small><Status value={order.status} /></small>{order.completedBy && <small className="success-text">完成：{order.completedBy}{order.technicianCompletedAt ? ` · ${new Date(order.technicianCompletedAt).toLocaleString()}` : ''}</small>}</td><td><b>{checks}/5</b><small><span className={`review-badge review-${order.reviewStatus || '未提交'}`}>{order.reviewStatus || '未提交'}</span></small><small className={`approval-state approval-${order.customerApprovalStatus || '未发送'}`}>客户：{order.customerApprovalStatus || '未发送'}</small></td>{showFinance && <><td><b>{money(order.total)}</b><small>毛利 {money(order.grossProfit)}</small></td><td>{money(order.paid)}<small className={order.balance > 0 ? 'warning-text' : ''}>欠 {money(order.balance)}</small></td></>}<td className="actions">{assignedOnly && isUnassigned && !order.archivedAt && <button className="primary" onClick={() => void claimWorkOrder(order)}>领取工单</button>}{assignedOnly && isMine && !isFinished && !order.archivedAt && <button className="primary" onClick={() => void completeWorkOrder(order)}>维修完成</button>}{canEdit && <button className={order.reviewStatus === '待审查' && canApprove ? 'primary' : ''} onClick={() => setEditingOrder(order)}>{order.reviewStatus === '待审查' && canApprove ? '审查' : '查看/编辑'}</button>}{can(cloud, 'collectPayment') && !order.archivedAt && <button onClick={() => addPayment(order)} disabled={order.balance <= 0}>收款</button>}{canPrint && <PrintMenu order={order} settings={settings} />}{canSend && !order.archivedAt && <SendMenu order={order} settings={settings} store={store} cloud={cloud} />}{can(cloud, 'archive') && !order.archivedAt && <button className="danger-link" onClick={() => deleteWorkOrder(order)}>申请作废</button>}{order.archivedAt && <small title={order.archiveReason}>原因：{order.archiveReason || '未填写'}</small>}</td></tr>})}</tbody></table>{!rows.length && <Empty text={assignedOnly ? '目前没有可领取或已分配给您的工单。' : '没有找到工单。'} />}</section>
    {(canApprove || cloud.role === 'owner' || cloud.role === 'manager') && <section className="panel"><div className="section-title"><h3>最近修改记录</h3><span>保留修改人、时间、内容以及授权结果，不允许清除</span></div><div className="change-log-list">{[...visibleLogs].sort((a,b) => b.at.localeCompare(a.at)).slice(0,50).map(log => <div key={log.id}><b>{log.workOrderNumber} · {log.action}</b><span>{log.actor} · {new Date(log.at).toLocaleString()}</span><small>{log.detail}</small></div>)}</div>{!visibleLogs.length && <Empty text="尚无工单修改记录。" />}</section>}
  </div>;
}

function Inventory({ store, search, openModal, remove, receiveStock }: ContentProps) {
  const rows = filterRows(store.parts, search); const low = rows.filter(item => item.qty <= item.minimum).length;
  return <div className="page"><div className="page-title"><div><p className="eyebrow">Parts & Inventory</p><h2>库存管理</h2><p>{rows.length} 种配件 · {low} 项低库存 · 成本 {money(rows.reduce((sum, item) => sum + item.qty * item.cost, 0))}</p></div><button className="primary" onClick={() => openModal('part')}>＋ 添加配件</button></div><section className="panel"><table><thead><tr><th>配件编号/名称</th><th>品牌/供应商</th><th>进货价</th><th>销售价</th><th>库存</th><th>位置</th><th /></tr></thead><tbody>{rows.map(item => <tr className={item.qty <= item.minimum ? 'low-stock' : ''} key={item.id}><td><b>{item.partNo}</b><small>{item.oemNo ? `OEM ${item.oemNo} · ` : ''}{item.name}</small></td><td>{item.brand || '—'}<small>{item.supplier}</small></td><td>{money(item.cost)}</td><td>{money(item.price)}</td><td><b>{item.qty}</b><small>最低 {item.minimum}</small></td><td>{item.location || '—'}</td><td className="actions"><button className="primary-soft" onClick={() => receiveStock(item)}>入库</button><button onClick={() => openModal('part', item)}>编辑</button><button className="danger-link" onClick={() => confirm('确定删除配件？') && remove('parts', item.id)}>删除</button></td></tr>)}</tbody></table>{!rows.length && <Empty text="尚未添加库存配件。" />}</section><section className="panel"><h3>最近库存流水</h3><table><thead><tr><th>时间</th><th>配件</th><th>类型</th><th>变化</th><th>结存</th><th>关联</th></tr></thead><tbody>{[...store.inventoryLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map(log => <tr key={log.id}><td>{new Date(log.date).toLocaleString()}</td><td>{log.partNo}<small>{log.partName}</small></td><td>{log.type}</td><td className={log.change >= 0 ? 'success-text' : 'warning-text'}>{log.change > 0 ? '+' : ''}{log.change}</td><td>{log.after}</td><td>{log.reference || '—'}</td></tr>)}</tbody></table></section></div>;
}

function Finance({ store, openModal }: ContentProps) {
  const metrics = dashboardMetrics(store);
  return <div className="page"><div className="page-title"><div><p className="eyebrow">Finance Center</p><h2>财务、收款与支出</h2></div><button className="primary" onClick={() => openModal('expense')}>＋ 记录支出</button></div><div className="kpi-grid"><Kpi label="今日实收" value={money(metrics.todayReceived)} tone="green" /><Kpi label="本月实收" value={money(metrics.monthReceived)} /><Kpi label="本月支出" value={money(metrics.monthExpenses)} tone="orange" /><Kpi label="本月净经营收益" value={money(metrics.monthNet)} tone="purple" /></div><div className="split-panels"><section className="panel"><h3>最近收款</h3><table><thead><tr><th>日期/工单</th><th>客户</th><th>方式</th><th>金额</th></tr></thead><tbody>{[...store.payments].sort((a, b) => b.date.localeCompare(a.date)).map(item => <tr key={item.id}><td>{new Date(item.date).toLocaleDateString()}<small>{item.workOrderNumber}</small></td><td>{item.customer}</td><td>{item.method}</td><td className="success-text"><b>{money(item.amount)}</b></td></tr>)}</tbody></table></section><section className="panel"><h3>最近支出</h3><table><thead><tr><th>日期</th><th>类别/收款方</th><th>方式</th><th>金额</th></tr></thead><tbody>{[...store.expenses].sort((a, b) => b.date.localeCompare(a.date)).map(item => <tr key={item.id}><td>{item.date}</td><td>{item.category}<small>{item.vendor}</small></td><td>{item.method || '—'}</td><td className="warning-text"><b>{money(item.amount)}</b></td></tr>)}</tbody></table></section></div></div>;
}

function SettingsPage({ settings, openModal }: { settings: ShopSettings; openModal: ContentProps['openModal'] }) {
  return <div className="page"><div className="page-title"><div><p className="eyebrow">System Settings</p><h2>修理厂设置</h2></div><button className="primary" onClick={() => openModal('settings', settings)}>编辑设置</button></div><section className="settings-card"><div className="print-logo">Z&G</div><div><h2>{settings.shopName}</h2><p>{settings.address || '尚未填写地址'}</p><p>{settings.phone || '尚未填写电话'} · {settings.email}</p></div><dl><div><dt>默认工时费率</dt><dd>{money(settings.defaultLaborRate)}/小时</dd></div><div><dt>默认配件税率</dt><dd>{settings.defaultTaxRate}%</dd></div></dl></section><section className="panel"><h3>智能服务状态</h3><div className="integration-list"><div><b>VIN 自动识别</b><span className="success-text">已启用（NHTSA vPIC）</span></div><div><b>本地 OCR 车牌识别</b><span className="success-text">已启用（Tesseract）</span></div><div><b>浏览器语音输入</b><span className="success-text">兼容 Edge / Chrome</span></div><div><b>AI 故障诊断与照片分类</b><span>需部署 zg-ai 云函数并配置 OPENAI_API_KEY</span></div><div><b>短信通知</b><span>需部署 zg-notify 云函数并配置 Twilio</span></div><div><b>在线付款</b><span>需部署 zg-payment 云函数并配置 Stripe</span></div></div></section></div>;
}

function EntityModal({ state, store, settings, onClose, onSave }: { state: NonNullable<ModalState>; store: AppStore; settings: ShopSettings; onClose: () => void; onSave: (type: NonNullable<ModalState>['type'], data: Record<string, unknown>) => Promise<void> }) {
  const [data, setData] = useState<Record<string, unknown>>(() => initialForm(state.type, state.value, settings));
  const [saving, setSaving] = useState(false);
  const [vinBusy, setVinBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState<'plate' | 'vin' | ''>('');
  const fields = formFields(state.type, store);
  const patch = (key: string, value: unknown) => setData(current => ({ ...current, [key]: value }));
  const runVin = async () => { setVinBusy(true); try { const result = await decodeVin(String(data.vin || '')); setData(current => ({ ...current, ...result })); } catch (error) { alert(error instanceof Error ? error.message : error); } finally { setVinBusy(false); } };
  const recognizePhoto = async (key: 'plate' | 'vin', file?: File) => {
    if (!file) return;
    setOcrBusy(key);
    try {
      const recognized = key === 'plate' ? await recognizePlatePhoto(file) : await recognizeVinPhoto(file);
      if (!recognized) throw new Error(key === 'plate' ? '没有识别到车牌，请重新拍摄清晰、正面的车牌照片。' : '没有识别到17位 VIN，请重新拍摄仪表台或车门标签。');
      patch(key, recognized.toUpperCase());
      if (key === 'vin') {
        try { const result = await decodeVin(recognized); setData(current => ({ ...current, ...result, vin: recognized.toUpperCase() })); }
        catch { /* OCR value is still kept for manual confirmation. */ }
      }
    } catch (error) { alert(error instanceof Error ? error.message : String(error)); }
    finally { setOcrBusy(''); }
  };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { await onSave(state.type, data); } finally { setSaving(false); } };
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">Z&G AUTO ERP</p><h2>{modalTitle(state.type, Boolean(state.value))}</h2></div><button type="button" onClick={onClose}>×</button></div><div className="form-grid two">{fields.map(field => {
    const photoField = state.type === 'vehicle' && (field.key === 'plate' || field.key === 'vin');
    return <label key={field.key} className={field.wide ? 'span-2' : ''}><span>{field.label}</span>{field.type === 'select' ? <select required={field.required} value={String(data[field.key] ?? '')} onChange={e => patch(field.key, e.target.value)}><option value="">请选择</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === 'textarea' ? <textarea value={String(data[field.key] ?? '')} onChange={e => patch(field.key, e.target.value)} /> : field.type === 'checkbox' ? <input type="checkbox" checked={Boolean(data[field.key])} onChange={e => patch(field.key, e.target.checked)} /> : <div className={field.key === 'vin' || photoField ? 'input-action' : ''}><input required={field.required} type={field.type || 'text'} step={field.step} value={String(data[field.key] ?? '')} onChange={e => patch(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)} />{field.key === 'vin' && <button type="button" onClick={runVin}>{vinBusy ? '解析中…' : '联网解析'}</button>}{photoField && <span className="ocr-upload"><span>{ocrBusy === field.key ? '识别中…' : field.key === 'plate' ? '📷 拍照识别车牌' : '📷 拍照识别 VIN'}</span><input type="file" accept="image/*" capture="environment" disabled={Boolean(ocrBusy)} onChange={event => { void recognizePhoto(field.key as 'plate' | 'vin', event.target.files?.[0]); event.currentTarget.value = ''; }} /></span>}</div>}</label>;
  })}</div><div className="modal-foot"><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button></div></form></div>;
}

type Field = { key: string; label: string; type?: string; required?: boolean; wide?: boolean; step?: string; options?: Array<{ value: string; label: string }> };
function formFields(type: NonNullable<ModalState>['type'], store: AppStore): Field[] {
  const fleetOptions = store.fleets.map(item => ({ value: item.id, label: item.company }));
  const ownerOptions = [...store.customers.map(item => ({ value: item.id, label: `${item.name}（${item.type}）` })), ...store.fleets.map(item => ({ value: item.id, label: `${item.company}（车队）` }))];
  const driverOptions = store.drivers.map(item => ({ value: item.id, label: `${item.name} · ${item.phone}` }));
  if (type === 'customer') return [{ key: 'type', label: '客户类型', type: 'select', required: true, options: ['个人','公司','车队'].map(v => ({ value: v, label: v })) }, { key: 'name', label: '客户/公司名称', required: true }, { key: 'phone', label: '手机号码', required: true }, { key: 'secondaryPhone', label: '备用电话' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'address', label: '地址', wide: true }, { key: 'membership', label: '会员等级', type: 'select', options: ['普通会员','银卡会员','金卡会员','VIP会员'].map(v => ({ value: v, label: v })) }, { key: 'notes', label: '备注', type: 'textarea', wide: true }];
  if (type === 'fleet') return [{ key: 'company', label: '公司名称', required: true }, { key: 'contact', label: '主要联系人', required: true }, { key: 'phone', label: '联系电话', required: true }, { key: 'billingEmail', label: '账单邮箱', type: 'email' }, { key: 'terms', label: '付款条款', type: 'select', options: ['现场付款','Net 15','Net 30','Net 45'].map(v => ({ value: v, label: v })) }, { key: 'creditLimit', label: '信用额度', type: 'number', step: '0.01' }, { key: 'notes', label: '车队备注', type: 'textarea', wide: true }];
  if (type === 'driver') return [{ key: 'fleetId', label: '所属公司', type: 'select', options: fleetOptions }, { key: 'company', label: '公司名称' }, { key: 'name', label: '司机姓名', required: true }, { key: 'phone', label: '司机电话', required: true }, { key: 'licenseLast4', label: '驾照后四位' }, { key: 'authorized', label: '允许签字/批准', type: 'checkbox' }, { key: 'notes', label: '备注', type: 'textarea', wide: true }];
  if (type === 'vehicle') return [{ key: 'ownerType', label: '客户类型', type: 'select', required: true, options: ['个人','公司','车队'].map(v => ({ value: v, label: v })) }, { key: 'ownerId', label: '所属客户/公司', type: 'select', options: ownerOptions }, { key: 'ownerName', label: '客户/公司名称', required: true }, { key: 'unit', label: 'Unit Number' }, { key: 'plate', label: '车牌', required: true }, { key: 'state', label: '州' }, { key: 'vin', label: 'VIN（17位）' }, { key: 'year', label: '年份', required: true }, { key: 'make', label: '品牌', required: true }, { key: 'model', label: '车型', required: true }, { key: 'engine', label: '发动机' }, { key: 'color', label: '颜色' }, { key: 'mileage', label: '当前里程', type: 'number' }, { key: 'driverId', label: '常用司机', type: 'select', options: driverOptions }, { key: 'driverName', label: '司机姓名' }, { key: 'driverPhone', label: '司机电话' }, { key: 'notes', label: '车辆备注', type: 'textarea', wide: true }];
  if (type === 'part') return [{ key: 'partNo', label: '配件编号/SKU', required: true }, { key: 'oemNo', label: 'OEM 编号' }, { key: 'name', label: '配件名称', required: true }, { key: 'brand', label: '品牌' }, { key: 'supplier', label: '供应商' }, { key: 'location', label: '货架位置' }, { key: 'cost', label: '进货单价', type: 'number', step: '0.01', required: true }, { key: 'price', label: '销售单价', type: 'number', step: '0.01', required: true }, { key: 'qty', label: '当前库存', type: 'number', required: true }, { key: 'minimum', label: '最低库存', type: 'number', required: true }, { key: 'notes', label: '备注', type: 'textarea', wide: true }];
  if (type === 'expense') return [{ key: 'date', label: '日期', type: 'date', required: true }, { key: 'category', label: '支出类别', type: 'select', required: true, options: ['配件采购','房租','水电','工资','工具设备','外包加工','拖车','保险','广告','退款','其他'].map(v => ({ value: v, label: v })) }, { key: 'vendor', label: '收款方' }, { key: 'amount', label: '金额', type: 'number', step: '0.01', required: true }, { key: 'method', label: '付款方式', type: 'select', options: ['现金','银行卡','Zelle','支票','ACH'].map(v => ({ value: v, label: v })) }, { key: 'note', label: '备注/收据号', type: 'textarea', wide: true }];
  if (type === 'campaign') return [{ key: 'name', label: '活动名称', required: true }, { key: 'status', label: '状态', type: 'select', required: true, options: ['启用','停用'].map(v => ({ value: v, label: v })) }, { key: 'start', label: '开始日期', type: 'date', required: true }, { key: 'end', label: '结束日期', type: 'date', required: true }, { key: 'benefit', label: '活动权益', type: 'textarea', wide: true, required: true }, { key: 'warrantyMonths', label: '保修月数', type: 'number' }, { key: 'warrantyMiles', label: '保修里程', type: 'number' }, { key: 'partsFree', label: '配件免费', type: 'checkbox' }, { key: 'laborFree', label: '人工免费', type: 'checkbox' }, { key: 'terms', label: '活动与保修条款', type: 'textarea', wide: true }];
  if (type === 'warranty') return [{ key: 'vehicleId', label: '车辆', type: 'select', required: true, options: store.vehicles.map(item => ({ value: item.id, label: `${item.plate || '无车牌'} · ${item.year} ${item.make} ${item.model}` })) }, { key: 'item', label: '保修项目', required: true }, { key: 'originalRO', label: '原始工单号' }, { key: 'start', label: '开始日期', type: 'date', required: true }, { key: 'end', label: '到期日期', type: 'date', required: true }, { key: 'mileageLimit', label: '里程上限', type: 'number' }, { key: 'coverage', label: '保障范围', type: 'select', required: true, options: ['仅配件','仅人工','配件和人工'].map(v => ({ value: v, label: v })) }, { key: 'status', label: '状态', type: 'select', required: true, options: ['有效','已使用','已到期','作废'].map(v => ({ value: v, label: v })) }, { key: 'notes', label: '保修说明', type: 'textarea', wide: true }];
  return [{ key: 'shopName', label: '修理厂名称', required: true }, { key: 'phone', label: '电话' }, { key: 'email', label: 'Email' }, { key: 'address', label: '地址', wide: true }, { key: 'defaultLaborRate', label: '默认工时费率', type: 'number', step: '0.01' }, { key: 'defaultTaxRate', label: '默认配件税率 %', type: 'number', step: '0.01' }, { key: 'invoiceTerms', label: '发票条款', type: 'textarea', wide: true }];
}

function initialForm(type: NonNullable<ModalState>['type'], value: Record<string, unknown> | undefined, settings: ShopSettings): Record<string, unknown> {
  if (value) return value;
  if (type === 'customer') return { type: '个人', membership: '普通会员', name: '', phone: '' };
  if (type === 'fleet') return { terms: 'Net 30', creditLimit: 0 };
  if (type === 'driver') return { authorized: false };
  if (type === 'vehicle') return { ownerType: '个人', mileage: 0 };
  if (type === 'part') return { cost: 0, price: 0, qty: 0, minimum: 1 };
  if (type === 'expense') return { date: today(), category: '配件采购', amount: 0, method: '银行卡' };
  if (type === 'campaign') return { start: today(), end: today(), warrantyMonths: 12, warrantyMiles: 12000, partsFree: true, laborFree: false, status: '启用' };
  if (type === 'warranty') return { start: today(), end: today(), mileageLimit: 12000, coverage: '仅配件', status: '有效' };
  return settings as unknown as Record<string, unknown>;
}

function modalTitle(type: NonNullable<ModalState>['type'], editing: boolean) { const names = { customer: '客户', fleet: '车队公司', driver: '司机', vehicle: '车辆', part: '配件', expense: '支出', campaign: '优惠活动', warranty: '车辆保修', settings: '系统设置' }; return `${editing ? '编辑' : '添加'}${names[type]}`; }

function ListPage({ title, subtitle, action, onAction, children }: { title: string; subtitle: string; action: string; onAction: () => void; children: React.ReactNode }) { return <div className="page"><div className="page-title"><div><p className="eyebrow">Z&G AUTO ERP</p><h2>{title}</h2><p>{subtitle}</p></div><button className="primary" onClick={onAction}>{action}</button></div><section className="panel">{children}</section></div>; }
function Kpi({ label, value, tone = '' }: { label: string; value: string; tone?: string }) { return <div className={`kpi ${tone}`}><span>{label}</span><b>{value}</b></div>; }
function Status({ value }: { value: string }) { return <span className={`status status-${value.replace(/\s/g, '')}`}>{value}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty"><b>暂无数据</b><span>{text}</span></div>; }

function PrintMenu({ order, settings }: { order: WorkOrder; settings: ShopSettings }) { return <select className="print-select" value="" onChange={event => { const type = event.target.value; if (type) printDocumentV077(order, settings, type); event.target.value = ''; }}><option value="">打印…</option><option value="Estimate">Estimate 报价单</option><option value="Repair Order">Repair Order 工单</option><option value="Invoice">Invoice 发票</option><option value="Receipt">Receipt 收据</option></select>; }

function SendMenu({ order, settings, store, cloud }: { order: WorkOrder; settings: ShopSettings; store: AppStore; cloud: CloudSession }) {
  const [sending, setSending] = useState(false);
  const customer = store.customers.find(item => item.id === order.customerId || item.name === order.customer);
  const fleet = store.fleets.find(item => item.id === order.customerId || item.company === order.company || item.company === order.customer);
  const savedEmail = customer?.email || fleet?.billingEmail || '';
  const notify = async (subject: string, html: string, email: string) => cloud.invokeFunction('zg-notify', { channel: 'email', to: email, subject, html });
  const regularEmail = async (kind: string) => {
    const email = prompt('客户邮箱：', savedEmail);
    if (!email?.trim()) return;
    const title = kind === 'invoice' ? 'Invoice / 发票' : kind === 'inspection' ? 'Inspection Result / 检查结果' : 'Repair Order / 维修工单';
    const detail = kind === 'inspection' ? `<p><b>检查/诊断：</b>${escapeHtml(order.diagnosis || '尚未填写')}</p><p><b>已完成维修：</b>${escapeHtml(order.workPerformed || '尚未填写')}</p>` : `<p><b>客户描述：</b>${escapeHtml(order.complaint || '—')}</p><p><b>诊断与维修：</b>${escapeHtml(`${order.diagnosis || ''} ${order.workPerformed || ''}`)}</p><p><b>总价：</b>${money(order.total)}　<b>已付：</b>${money(order.paid)}　<b>欠款：</b>${money(order.balance)}</p>`;
    await notify(`${settings.shopName} · ${title} · ${order.number}`, `<h2>${escapeHtml(settings.shopName)}</h2><p>${escapeHtml(settings.address)} · ${escapeHtml(settings.phone)}</p><hr><h3>${title} ${escapeHtml(order.number)}</h3><p>${escapeHtml(order.customer)} · ${escapeHtml(order.vehicle)} · ${escapeHtml(order.plate)}</p>${detail}<p>如有问题请致电 ${escapeHtml(settings.phone)}。</p>`, email.trim());
    alert('邮件已发送。');
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
    } catch {
      await navigator.clipboard?.writeText(url);
      alert(`确认链接已生成并复制，但邮件服务尚未配置。可通过短信或微信发送给客户：\n${url}`);
    }
  };
  const choose = async (value: string) => {
    if (!value) return;
    if (value === 'copy' && order.customerApprovalUrl) { await navigator.clipboard.writeText(order.customerApprovalUrl); alert('确认链接已复制。'); return; }
    setSending(true);
    try { if (value === 'approval') await approval(); else await regularEmail(value); }
    catch (error) { alert(`发送失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setSending(false); }
  };
  return <select className="send-select" value="" disabled={sending} onChange={event => { void choose(event.target.value); event.target.value = ''; }}><option value="">{sending ? '发送中…' : '发送…'}</option><option value="repair">邮件发送工单</option><option value="invoice">邮件发送发票</option><option value="inspection">邮件发送检查结果</option><option value="approval">发送在线维修确认</option>{order.customerApprovalUrl && <option value="copy">复制现有确认链接</option>}</select>;
}

function printDocument(order: WorkOrder, settings: ShopSettings, documentType: string) {
  const isReceipt = documentType === 'Receipt'; const paid = isReceipt ? order.paid : order.total;
  const shopAddress = settings.address || '319 Agostino Rd, San Gabriel, CA 91776';
  const shopPhone = settings.phone || '626-508-0888';
  documentType = ({ Estimate: 'ESTIMATE / 报价单', 'Repair Order': 'REPAIR ORDER / 维修工单', Invoice: 'INVOICE / 发票', Receipt: 'RECEIPT / 收据' } as Record<string, string>)[documentType] || documentType;
  const laborRows = order.laborItems.map(item => `<tr><td>${escapeHtml(item.description)}</td><td class="num">${item.hours.toFixed(1)}</td><td class="num">${money(item.rate)}</td><td class="num">${money(item.total)}</td></tr>`).join('');
  const partRows = order.partItems.map(item => `<tr><td>${escapeHtml(item.partNo)}</td><td>${escapeHtml(item.name)}</td><td class="num">${item.qty}</td><td class="num">${money(item.price)}</td><td class="num">${money(item.total)}</td></tr>`).join('');
  const signatureName = order.customerSignedBy || order.customer || '';
  const signatureTime = order.customerSignedAt ? new Date(order.customerSignedAt).toLocaleString() : '';
  const customerSignature = order.customerSignature
    ? `<div style="border-top:1px solid #222;padding-top:3px"><img src="${escapeHtml(order.customerSignature)}" alt="Customer signature" style="display:block;max-width:220px;max-height:56px;object-fit:contain"><span style="display:block;font-size:7pt">${escapeHtml(signatureName)}${signatureTime ? ` · ${escapeHtml(signatureTime)}` : ''}</span><b style="display:block;font-size:7pt">Customer Signature / 客户签字</b></div>`
    : '<div class="line">Customer Signature / Date · 客户签字/日期</div>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(documentType)} ${escapeHtml(order.number)}</title><style>@page{size:Letter;margin:.35in}*{box-sizing:border-box}body{font:8pt Arial;color:#111;margin:0}.header{text-align:center;border-bottom:2px solid #111;padding-bottom:8px}.logo{font:bold 18pt Arial;letter-spacing:2px}.header h1{font-size:12pt;margin:3px}.header p{margin:2px}.doc-title{display:flex;justify-content:space-between;align-items:end;margin:10px 0 5px}.doc-title h2{font-size:13pt;margin:0}.ro-number{text-align:right;font-size:8pt}.ro-number b{font-size:10pt}.box-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}.box{border:1px solid #999;padding:5px;min-height:52px}.box b{display:inline-block;min-width:55px}.section{margin-top:7px}.section h3{font-size:8pt;background:#222;color:#fff;margin:0;padding:4px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:3px;vertical-align:top}th{background:#eee;text-align:left}.num{text-align:right}.totals{width:46%;margin:7px 0 0 auto}.totals td:first-child{text-align:right}.grand td{font-size:10pt;font-weight:bold;border-top:2px solid #111}.notes{border:1px solid #aaa;padding:5px;min-height:36px}.sign{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:24px}.line{border-top:1px solid #222;padding-top:3px}.footer{text-align:center;margin-top:10px;font-size:7pt;color:#555}</style></head><body><div class="header"><div class="logo">Z&G</div><h1>${escapeHtml(settings.shopName || 'Z&G AUTO REPAIR')}</h1><p>${escapeHtml(shopAddress)} · Tel / 电话 ${escapeHtml(shopPhone)}${settings.email ? ` · ${escapeHtml(settings.email)}` : ''}</p></div><div class="doc-title"><h2>${escapeHtml(documentType)}</h2><div class="ro-number"><span>Repair Order No. / 工单编号</span><br><b>${escapeHtml(order.number)}</b><br>${escapeHtml(order.date)}</div></div><div class="box-grid"><div class="box"><b>Customer</b>${escapeHtml(order.customer)}<br><b>Phone</b>${escapeHtml(order.phone)}<br><b>Company</b>${escapeHtml(order.company || '')}<br><b>Driver</b>${escapeHtml(order.driver || '')} ${escapeHtml(order.driverPhone || '')}</div><div class="box"><b>Vehicle</b>${escapeHtml(order.vehicle)}<br><b>Plate</b>${escapeHtml(order.plate)}<br><b>VIN</b>${escapeHtml(order.vin)}<br><b>Mileage</b>${escapeHtml(order.mileage)} &nbsp; <b>PO</b>${escapeHtml(order.po || '')}</div></div><div class="section"><h3>Customer Concern / 客户描述</h3><div class="notes">${escapeHtml(order.complaint)}</div></div><div class="section"><h3>Diagnosis & Work Performed / 诊断与维修</h3><div class="notes">${escapeHtml(order.diagnosis)}<br>${escapeHtml(order.workPerformed)}</div></div>${laborRows ? `<div class="section"><h3>Labor / 人工</h3><table><thead><tr><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>${laborRows}</tbody></table></div>` : ''}${partRows ? `<div class="section"><h3>Parts / 配件</h3><table><thead><tr><th>Part #</th><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>${partRows}</tbody></table></div>` : ''}<table class="totals"><tr><td>Labor</td><td class="num">${money(order.laborTotal)}</td></tr><tr><td>Parts</td><td class="num">${money(order.partsTotal)}</td></tr><tr><td>Outsource</td><td class="num">${money(order.outsource)}</td></tr><tr><td>Tax</td><td class="num">${money(order.tax)}</td></tr><tr><td>Discount</td><td class="num">-${money(order.discount)}</td></tr><tr class="grand"><td>${isReceipt ? 'Amount Paid' : 'Total'}</td><td class="num">${money(paid)}</td></tr>${!isReceipt ? `<tr><td>Paid</td><td class="num">${money(order.paid)}</td></tr><tr><td>Balance Due</td><td class="num">${money(order.balance)}</td></tr>` : ''}</table><div class="sign"><div class="line">Customer Signature / Date</div><div class="line">Authorized By / Date</div></div><div class="footer">${escapeHtml(settings.invoiceTerms || 'Thank you for your business.')}</div><script>window.onload=()=>window.print()</script></body></html>`;
  const finalHtml = html
    .replace('<tr><td>Tax</td>', '<tr><td>Parts Sales Tax / 配件销售税</td>')
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
  result.workOrders = result.workOrders.map(item => recalculateWorkOrder({ ...item, laborItems: Array.isArray(item.laborItems) ? item.laborItems : legacyLabor(item), partItems: Array.isArray(item.partItems) ? item.partItems : legacyParts(item) }));
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
function dashboardMetrics(store: AppStore) { const date = today(), month = date.slice(0, 7), valid = store.workOrders.filter(item => item.status !== '已取消'); const todayOrders = valid.filter(item => item.date === date), monthOrders = valid.filter(item => item.date.startsWith(month)); const todayPayments = store.payments.filter(item => item.date.startsWith(date)), monthPayments = store.payments.filter(item => item.date.startsWith(month)), monthExpensesRows = store.expenses.filter(item => item.date.startsWith(month)); return { todaySales: sum(todayOrders, 'total'), monthSales: sum(monthOrders, 'total'), todayReceived: sum(todayPayments, 'amount'), monthReceived: sum(monthPayments, 'amount'), todayGross: sum(todayOrders, 'grossProfit'), monthGross: sum(monthOrders, 'grossProfit'), monthExpenses: sum(monthExpensesRows, 'amount'), monthNet: sum(monthOrders, 'grossProfit') - sum(monthExpensesRows, 'amount'), receivables: sum(valid, 'balance') }; }
function sum<T extends object>(rows: T[], key: keyof T) { return rows.reduce((total, row) => total + Number(row[key] || 0), 0); }

registerPwa();
const approvalToken = new URLSearchParams(window.location.search).get('approval');
createRoot(document.getElementById('root')!).render(<React.StrictMode>{approvalToken ? <CustomerApprovalPage token={approvalToken} /> : <><PwaInstall /><FormalGate>{cloud => <App cloud={cloud} />}</FormalGate></>}</React.StrictMode>);
