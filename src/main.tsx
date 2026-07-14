import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FormalGate } from './FormalGate';
import type { CloudRow, CloudSession, CloudStore } from './lib/cloud';
import { decodeVin, escapeHtml, money, recalculateWorkOrder, today, uid } from './lib/erp';
import type { AppStore, Customer, Driver, Expense, Fleet, InventoryLog, Part, Payment, ShopSettings, Vehicle, WorkOrder } from './types';
import { WorkOrderEditor } from './WorkOrderEditor';
import { SmartTools } from './SmartTools';
import './styles.css';

type Page = 'dashboard' | 'customers' | 'fleets' | 'vehicles' | 'workOrders' | 'parts' | 'finance' | 'smart' | 'settings';
type ModalState = { type: 'customer' | 'fleet' | 'driver' | 'vehicle' | 'part' | 'expense' | 'settings'; value?: Record<string, unknown> } | null;

const emptyStore: AppStore = { customers: [], fleets: [], drivers: [], vehicles: [], workOrders: [], parts: [], inventoryLogs: [], payments: [], expenses: [], settings: [] };
const defaultSettings: ShopSettings = { id: '00000000-0000-4000-8000-000000000075', shopName: 'Z&G AUTO REPAIR', address: '', phone: '', email: '', defaultLaborRate: 165, defaultTaxRate: 9.5, invoiceTerms: 'Thank you for your business.' };

const nav: Array<{ id: Page; icon: string; label: string }> = [
  { id: 'dashboard', icon: '⌂', label: '经营首页' }, { id: 'customers', icon: '👤', label: '客户管理' },
  { id: 'fleets', icon: '🚛', label: '车队与司机' }, { id: 'vehicles', icon: '🚗', label: '车辆管理' },
  { id: 'workOrders', icon: '▤', label: '维修工单' }, { id: 'parts', icon: '▦', label: '库存管理' },
  { id: 'finance', icon: '$', label: '财务与收款' }, { id: 'smart', icon: '✦', label: '智能工具' },
  { id: 'settings', icon: '⚙', label: '系统设置' },
];

function App({ cloud }: { cloud: CloudSession }) {
  const [store, setStore] = useState<AppStore>(emptyStore);
  const [page, setPage] = useState<Page>('dashboard');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [editingOrder, setEditingOrder] = useState<WorkOrder | 'new' | null>(null);

  const refresh = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { setStore(normalizeStore(await cloud.loadStore())); }
    catch (error) { if (!quiet) alert(`读取服务器失败：${error instanceof Error ? error.message : error}`); }
    finally { if (!quiet) setLoading(false); }
  };

  useEffect(() => { void refresh(); return cloud.subscribe(() => { void refresh(true); }); }, [cloud.organizationId]);

  const settings = store.settings[0] || defaultSettings;

  const persist = async <T extends { id: string }>(module: keyof AppStore, row: T) => {
    setSyncing(true);
    const previous = store;
    setStore(current => ({ ...current, [module]: upsertLocal(current[module] as unknown as T[], row) }));
    try { await cloud.upsertRecord(String(module), row as unknown as CloudRow); }
    catch (error) { setStore(previous); alert(`保存失败：${error instanceof Error ? error.message : error}`); throw error; }
    finally { setSyncing(false); }
  };

  const remove = async (module: keyof AppStore, id: string) => {
    setSyncing(true);
    const previous = store;
    setStore(current => ({ ...current, [module]: (current[module] as unknown as Array<{ id: string }>).filter(item => item.id !== id) }));
    try { await cloud.deleteRecord(String(module), id); }
    catch (error) { setStore(previous); alert(`删除失败：${error instanceof Error ? error.message : error}`); }
    finally { setSyncing(false); }
  };

  const saveWorkOrder = async (rawOrder: WorkOrder) => {
    const order = recalculateWorkOrder(rawOrder);
    const old = store.workOrders.find(item => item.id === order.id);
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
      await persist('workOrders', { ...order, inventoryCommitted: order.status !== '已取消' });
      setEditingOrder(null); setPage('workOrders');
    } catch { /* persist already explains the error */ }
  };

  const deleteWorkOrder = async (order: WorkOrder) => {
    if (!confirm(`确定删除工单 ${order.number}？已领用的库存会自动退回。`)) return;
    if (order.status !== '已取消') {
      for (const [partId, qty] of Object.entries(usageMap(order))) {
        const part = store.parts.find(item => item.id === partId); if (!part) continue;
        const next = part.qty + qty;
        await persist('parts', { ...part, qty: next });
        await persist('inventoryLogs', { id: uid(), date: new Date().toISOString(), partId, partNo: part.partNo, partName: part.name, type: '删除工单退回', change: qty, before: part.qty, after: next, reference: order.number } as InventoryLog);
      }
    }
    await remove('workOrders', order.id);
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
    if (type === 'settings') await persist('settings', row as unknown as ShopSettings);
    else await persist(`${type}s` as keyof AppStore, row as { id: string });
    closeModal();
  };

  if (editingOrder) return <WorkOrderEditor value={editingOrder === 'new' ? undefined : editingOrder} customers={store.customers} vehicles={store.vehicles} fleets={store.fleets} drivers={store.drivers} parts={store.parts} settings={settings} nextNumber={nextWorkOrderNumber(store.workOrders)} onSave={saveWorkOrder} onCancel={() => setEditingOrder(null)} />;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">Z&G</div><div><b>AUTO ERP</b><small>正式服务器版</small></div></div>
      <nav>{nav.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setSearch(''); }}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <div className="side-foot"><small>{cloud.organizationName}</small><span>{cloud.user.email}</span><button onClick={() => cloud.signOut()}>退出登录</button></div>
    </aside>
    <main className="main"><header className="topbar"><div className="global-search">⌕<input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索客户、电话、VIN、车牌、工单、司机…" /></div><div className="top-status"><span className={syncing ? 'syncing' : ''}>{syncing ? '正在同步…' : '● 云端已同步'}</span><b>v0.75.0</b></div></header>
      {loading ? <div className="loading">正在读取正式服务器数据…</div> : <PageContent page={page} search={search} store={store} settings={settings} cloud={cloud} setPage={setPage} openModal={openModal} setEditingOrder={setEditingOrder} persist={persist} remove={remove} receiveStock={receiveStock} addPayment={addPayment} deleteWorkOrder={deleteWorkOrder} />}
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
  if (page === 'smart') return <SmartTools cloud={cloud} workOrders={store.workOrders} />;
  return <SettingsPage settings={settings} openModal={props.openModal} />;
}

function Dashboard({ store, setPage, setEditingOrder }: ContentProps) {
  const metrics = useMemo(() => dashboardMetrics(store), [store]);
  const recent = [...store.workOrders].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  return <div className="page"><div className="hero"><div><p className="eyebrow">老板经营驾驶舱</p><h1>早上好，Z&G AUTO REPAIR</h1><p>营业、工单、库存和欠款都来自正式服务器实时数据。</p></div><div className="toolbar"><button onClick={() => setPage('customers')}>＋ 新客户</button><button className="primary" onClick={() => setEditingOrder('new')}>＋ 新建工单</button></div></div>
    <div className="kpi-grid"><Kpi label="今日开单营业额" value={money(metrics.todaySales)} tone="blue" /><Kpi label="今日实收" value={money(metrics.todayReceived)} tone="green" /><Kpi label="今日毛利润" value={money(metrics.todayGross)} tone="purple" /><Kpi label="未收款总额" value={money(metrics.receivables)} tone="orange" /><Kpi label="本月营业额" value={money(metrics.monthSales)} /><Kpi label="本月实收" value={money(metrics.monthReceived)} /><Kpi label="本月支出" value={money(metrics.monthExpenses)} /><Kpi label="本月净经营收益" value={money(metrics.monthNet)} /></div>
    <div className="dashboard-grid"><section className="panel wide"><div className="section-title"><h3>最近工单</h3><button onClick={() => setPage('workOrders')}>查看全部</button></div><table><thead><tr><th>工单</th><th>客户/车辆</th><th>状态</th><th>总价</th><th>欠款</th></tr></thead><tbody>{recent.map(order => <tr key={order.id}><td><b>{order.number}</b><small>{order.date}</small></td><td>{order.customer}<small>{order.plate} · {order.vehicle}</small></td><td><Status value={order.status} /></td><td>{money(order.total)}</td><td className={order.balance > 0 ? 'warning-text' : ''}>{money(order.balance)}</td></tr>)}</tbody></table>{!recent.length && <Empty text="还没有工单，点击右上角建立第一张工单。" />}</section>
      <section className="panel"><h3>今日车间</h3><div className="count-list"><div><span>等待批准</span><b>{store.workOrders.filter(item => item.status === '等待批准').length}</b></div><div><span>等待配件</span><b>{store.workOrders.filter(item => item.status === '等待配件').length}</b></div><div><span>维修中</span><b>{store.workOrders.filter(item => item.status === '维修中').length}</b></div><div><span>今日完成</span><b>{store.workOrders.filter(item => item.date === today() && item.status === '已完成').length}</b></div></div></section>
      <section className="panel"><h3>库存提醒</h3><div className="count-list"><div><span>低库存配件</span><b className="warning-text">{store.parts.filter(item => item.qty <= item.minimum).length}</b></div><div><span>库存品种</span><b>{store.parts.length}</b></div><div><span>库存成本</span><b>{money(store.parts.reduce((sum, item) => sum + item.qty * item.cost, 0))}</b></div></div><button className="full" onClick={() => setPage('parts')}>打开库存中心</button></section>
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
  return <ListPage title="车辆管理" subtitle="支持按车牌、VIN、Unit Number、客户和司机搜索" action="＋ 添加车辆" onAction={() => openModal('vehicle')}><div className="card-table">{rows.map(item => <article className="vehicle-card" key={item.id}><div className="vehicle-avatar">{item.make?.slice(0, 1) || '🚗'}</div><div className="vehicle-main"><div><b>{item.year} {item.make} {item.model}</b><Status value={item.ownerType} /></div><p>{item.plate || '无车牌'} · Unit {item.unit || '—'}</p><small>VIN {item.vin || '—'}</small><small>{item.ownerName} {item.driverName ? `· 司机 ${item.driverName} ${item.driverPhone || ''}` : ''}</small></div><div className="vehicle-actions"><button onClick={() => openModal('vehicle', item)}>编辑</button><button onClick={() => setEditingOrder('new')}>开工单</button><button className="danger-link" onClick={() => confirm('确定删除车辆？') && remove('vehicles', item.id)}>删除</button></div></article>)}</div>{!rows.length && <Empty text="没有找到车辆。" />}</ListPage>;
}

function WorkOrders({ store, search, settings, setEditingOrder, addPayment, deleteWorkOrder }: ContentProps) {
  const rows = filterRows(store.workOrders, search).sort((a, b) => b.date.localeCompare(a.date));
  return <ListPage title="维修工单" subtitle="人工、配件、库存、收款和打印自动联动" action="＋ 新建工单" onAction={() => setEditingOrder('new')}><table><thead><tr><th>工单/日期</th><th>客户与车辆</th><th>技师/状态</th><th>总价</th><th>已付/欠款</th><th /></tr></thead><tbody>{rows.map(order => <tr key={order.id}><td><b>{order.number}</b><small>{order.date} {order.po ? `· PO ${order.po}` : ''}</small></td><td>{order.customer}<small>{order.plate} · {order.vehicle}{order.driver ? ` · 司机 ${order.driver}` : ''}</small></td><td>{order.technician || '未分配'}<small><Status value={order.status} /></small></td><td><b>{money(order.total)}</b><small>毛利 {money(order.grossProfit)}</small></td><td>{money(order.paid)}<small className={order.balance > 0 ? 'warning-text' : ''}>欠 {money(order.balance)}</small></td><td className="actions"><button onClick={() => setEditingOrder(order)}>编辑</button><button onClick={() => addPayment(order)} disabled={order.balance <= 0}>收款</button><PrintMenu order={order} settings={settings} /><button className="danger-link" onClick={() => deleteWorkOrder(order)}>删除</button></td></tr>)}</tbody></table>{!rows.length && <Empty text="没有找到工单。" />}</ListPage>;
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
  const [saving, setSaving] = useState(false); const [vinBusy, setVinBusy] = useState(false);
  const fields = formFields(state.type, store);
  const patch = (key: string, value: unknown) => setData(current => ({ ...current, [key]: value }));
  const runVin = async () => { setVinBusy(true); try { const result = await decodeVin(String(data.vin || '')); setData(current => ({ ...current, ...result })); } catch (error) { alert(error instanceof Error ? error.message : error); } finally { setVinBusy(false); } };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { await onSave(state.type, data); } finally { setSaving(false); } };
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">Z&G AUTO ERP</p><h2>{modalTitle(state.type, Boolean(state.value))}</h2></div><button type="button" onClick={onClose}>×</button></div><div className="form-grid two">{fields.map(field => <label key={field.key} className={field.wide ? 'span-2' : ''}><span>{field.label}</span>{field.type === 'select' ? <select required={field.required} value={String(data[field.key] ?? '')} onChange={e => patch(field.key, e.target.value)}><option value="">请选择</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === 'textarea' ? <textarea value={String(data[field.key] ?? '')} onChange={e => patch(field.key, e.target.value)} /> : field.type === 'checkbox' ? <input type="checkbox" checked={Boolean(data[field.key])} onChange={e => patch(field.key, e.target.checked)} /> : <div className={field.key === 'vin' ? 'input-action' : ''}><input required={field.required} type={field.type || 'text'} step={field.step} value={String(data[field.key] ?? '')} onChange={e => patch(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)} />{field.key === 'vin' && <button type="button" onClick={runVin}>{vinBusy ? '识别中…' : '识别 VIN'}</button>}</div>}</label>)}</div><div className="modal-foot"><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button></div></form></div>;
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
  return settings as unknown as Record<string, unknown>;
}

function modalTitle(type: NonNullable<ModalState>['type'], editing: boolean) { const names = { customer: '客户', fleet: '车队公司', driver: '司机', vehicle: '车辆', part: '配件', expense: '支出', settings: '系统设置' }; return `${editing ? '编辑' : '添加'}${names[type]}`; }

function ListPage({ title, subtitle, action, onAction, children }: { title: string; subtitle: string; action: string; onAction: () => void; children: React.ReactNode }) { return <div className="page"><div className="page-title"><div><p className="eyebrow">Z&G AUTO ERP</p><h2>{title}</h2><p>{subtitle}</p></div><button className="primary" onClick={onAction}>{action}</button></div><section className="panel">{children}</section></div>; }
function Kpi({ label, value, tone = '' }: { label: string; value: string; tone?: string }) { return <div className={`kpi ${tone}`}><span>{label}</span><b>{value}</b></div>; }
function Status({ value }: { value: string }) { return <span className={`status status-${value.replace(/\s/g, '')}`}>{value}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty"><b>暂无数据</b><span>{text}</span></div>; }

function PrintMenu({ order, settings }: { order: WorkOrder; settings: ShopSettings }) { return <select className="print-select" value="" onChange={event => { const type = event.target.value; if (type) printDocument(order, settings, type); event.target.value = ''; }}><option value="">打印…</option><option value="Estimate">Estimate 报价单</option><option value="Repair Order">Repair Order 工单</option><option value="Invoice">Invoice 发票</option><option value="Receipt">Receipt 收据</option></select>; }

function printDocument(order: WorkOrder, settings: ShopSettings, documentType: string) {
  const isReceipt = documentType === 'Receipt'; const paid = isReceipt ? order.paid : order.total;
  const laborRows = order.laborItems.map(item => `<tr><td>${escapeHtml(item.description)}</td><td class="num">${item.hours.toFixed(1)}</td><td class="num">${money(item.rate)}</td><td class="num">${money(item.total)}</td></tr>`).join('');
  const partRows = order.partItems.map(item => `<tr><td>${escapeHtml(item.partNo)}</td><td>${escapeHtml(item.name)}</td><td class="num">${item.qty}</td><td class="num">${money(item.price)}</td><td class="num">${money(item.total)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(documentType)} ${escapeHtml(order.number)}</title><style>@page{size:Letter;margin:.35in}*{box-sizing:border-box}body{font:8pt Arial;color:#111;margin:0}.header{text-align:center;border-bottom:2px solid #111;padding-bottom:8px}.logo{font:bold 18pt Arial;letter-spacing:2px}.header h1{font-size:12pt;margin:3px}.header p{margin:2px}.doc-title{display:flex;justify-content:space-between;align-items:end;margin:10px 0 5px}.doc-title h2{font-size:13pt;margin:0}.box-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}.box{border:1px solid #999;padding:5px;min-height:52px}.box b{display:inline-block;min-width:55px}.section{margin-top:7px}.section h3{font-size:8pt;background:#222;color:#fff;margin:0;padding:4px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:3px;vertical-align:top}th{background:#eee;text-align:left}.num{text-align:right}.totals{width:46%;margin:7px 0 0 auto}.totals td:first-child{text-align:right}.grand td{font-size:10pt;font-weight:bold;border-top:2px solid #111}.notes{border:1px solid #aaa;padding:5px;min-height:36px}.sign{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:24px}.line{border-top:1px solid #222;padding-top:3px}.footer{text-align:center;margin-top:10px;font-size:7pt;color:#555}</style></head><body><div class="header"><div class="logo">Z&G</div><h1>${escapeHtml(settings.shopName)}</h1><p>${escapeHtml(settings.address)} · ${escapeHtml(settings.phone)} · ${escapeHtml(settings.email || '')}</p></div><div class="doc-title"><h2>${escapeHtml(documentType)}</h2><div><b>${escapeHtml(order.number)}</b><br>${escapeHtml(order.date)}</div></div><div class="box-grid"><div class="box"><b>Customer</b>${escapeHtml(order.customer)}<br><b>Phone</b>${escapeHtml(order.phone)}<br><b>Company</b>${escapeHtml(order.company || '')}<br><b>Driver</b>${escapeHtml(order.driver || '')} ${escapeHtml(order.driverPhone || '')}</div><div class="box"><b>Vehicle</b>${escapeHtml(order.vehicle)}<br><b>Plate</b>${escapeHtml(order.plate)}<br><b>VIN</b>${escapeHtml(order.vin)}<br><b>Mileage</b>${escapeHtml(order.mileage)} &nbsp; <b>PO</b>${escapeHtml(order.po || '')}</div></div><div class="section"><h3>Customer Concern / 客户描述</h3><div class="notes">${escapeHtml(order.complaint)}</div></div><div class="section"><h3>Diagnosis & Work Performed / 诊断与维修</h3><div class="notes">${escapeHtml(order.diagnosis)}<br>${escapeHtml(order.workPerformed)}</div></div>${laborRows ? `<div class="section"><h3>Labor / 人工</h3><table><thead><tr><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>${laborRows}</tbody></table></div>` : ''}${partRows ? `<div class="section"><h3>Parts / 配件</h3><table><thead><tr><th>Part #</th><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>${partRows}</tbody></table></div>` : ''}<table class="totals"><tr><td>Labor</td><td class="num">${money(order.laborTotal)}</td></tr><tr><td>Parts</td><td class="num">${money(order.partsTotal)}</td></tr><tr><td>Outsource</td><td class="num">${money(order.outsource)}</td></tr><tr><td>Tax</td><td class="num">${money(order.tax)}</td></tr><tr><td>Discount</td><td class="num">-${money(order.discount)}</td></tr><tr class="grand"><td>${isReceipt ? 'Amount Paid' : 'Total'}</td><td class="num">${money(paid)}</td></tr>${!isReceipt ? `<tr><td>Paid</td><td class="num">${money(order.paid)}</td></tr><tr><td>Balance Due</td><td class="num">${money(order.balance)}</td></tr>` : ''}</table><div class="sign"><div class="line">Customer Signature / Date</div><div class="line">Authorized By / Date</div></div><div class="footer">${escapeHtml(settings.invoiceTerms || 'Thank you for your business.')}</div><script>window.onload=()=>window.print()</script></body></html>`;
  const win = window.open('', '_blank'); if (!win) return alert('浏览器阻止了打印窗口，请允许弹出窗口。'); win.document.write(html); win.document.close();
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
function filterRows<T extends object>(rows: T[], search: string) { const query = search.trim().toLowerCase(); return query ? rows.filter(row => Object.values(row).some(value => typeof value !== 'object' && String(value ?? '').toLowerCase().includes(query))) : rows; }
function nextWorkOrderNumber(rows: WorkOrder[]) { const year = new Date().getFullYear(); const max = rows.map(item => Number(item.number.match(/(\d+)$/)?.[1] || 0)).reduce((a, b) => Math.max(a, b), 0); return `RO-${year}-${String(max + 1).padStart(4, '0')}`; }
function dashboardMetrics(store: AppStore) { const date = today(), month = date.slice(0, 7), valid = store.workOrders.filter(item => item.status !== '已取消'); const todayOrders = valid.filter(item => item.date === date), monthOrders = valid.filter(item => item.date.startsWith(month)); const todayPayments = store.payments.filter(item => item.date.startsWith(date)), monthPayments = store.payments.filter(item => item.date.startsWith(month)), monthExpensesRows = store.expenses.filter(item => item.date.startsWith(month)); return { todaySales: sum(todayOrders, 'total'), monthSales: sum(monthOrders, 'total'), todayReceived: sum(todayPayments, 'amount'), monthReceived: sum(monthPayments, 'amount'), todayGross: sum(todayOrders, 'grossProfit'), monthGross: sum(monthOrders, 'grossProfit'), monthExpenses: sum(monthExpensesRows, 'amount'), monthNet: sum(monthOrders, 'grossProfit') - sum(monthExpensesRows, 'amount'), receivables: sum(valid, 'balance') }; }
function sum<T extends object>(rows: T[], key: keyof T) { return rows.reduce((total, row) => total + Number(row[key] || 0), 0); }

createRoot(document.getElementById('root')!).render(<React.StrictMode><FormalGate>{cloud => <App cloud={cloud} />}</FormalGate></React.StrictMode>);
