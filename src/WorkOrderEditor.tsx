import { useMemo, useState } from 'react';
import type { Customer, Driver, Fleet, LaborItem, Part, PartItem, ShopSettings, Vehicle, WorkOrder, WorkOrderStatus } from './types';
import { money, recalculateWorkOrder, today, uid } from './lib/erp';

type Props = {
  value?: WorkOrder; customers: Customer[]; vehicles: Vehicle[]; fleets: Fleet[]; drivers: Driver[];
  parts: Part[]; settings: ShopSettings; nextNumber: string;
  onSave: (order: WorkOrder) => Promise<void>; onCancel: () => void;
};

const statuses: WorkOrderStatus[] = ['等待检查', '等待批准', '等待配件', '维修中', '已完成', '已交车', '已取消'];

export function WorkOrderEditor({ value, customers, vehicles, fleets, drivers, parts, settings, nextNumber, onSave, onCancel }: Props) {
  const [order, setOrder] = useState<WorkOrder>(() => recalculateWorkOrder(value || {
    id: uid(), number: nextNumber, date: today(), customer: '', vehicle: '', status: '等待检查',
    laborItems: [], partItems: [], outsource: 0, discount: 0, taxRate: settings.defaultTaxRate,
  }));
  const [saving, setSaving] = useState(false);
  const calculated = useMemo(() => recalculateWorkOrder(order), [order]);
  const selectedVehicle = vehicles.find(v => v.id === order.vehicleId);

  const patch = (changes: Partial<WorkOrder>) => setOrder(current => recalculateWorkOrder({ ...current, ...changes }));

  const selectCustomer = (id: string) => {
    const customer = customers.find(item => item.id === id);
    patch({ customerId: id, customer: customer?.name || '', phone: customer?.phone || '' });
  };

  const selectVehicle = (id: string) => {
    const vehicle = vehicles.find(item => item.id === id);
    const fleet = fleets.find(item => item.id === vehicle?.ownerId);
    const driver = drivers.find(item => item.id === vehicle?.driverId);
    patch({
      vehicleId: id, vehicle: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim() : '',
      plate: vehicle?.plate || '', vin: vehicle?.vin || '', mileage: vehicle?.mileage || 0,
      fleetId: fleet?.id || '', company: fleet?.company || '', driverId: driver?.id || vehicle?.driverId || '',
      driver: driver?.name || vehicle?.driverName || '', driverPhone: driver?.phone || vehicle?.driverPhone || '',
    });
  };

  const selectDriver = (id: string) => {
    const driver = drivers.find(item => item.id === id);
    patch({ driverId: id, driver: driver?.name || '', driverPhone: driver?.phone || '' });
  };

  const addLabor = () => patch({ laborItems: [...calculated.laborItems, {
    id: uid(), description: '', hours: 1, rate: settings.defaultLaborRate, technician: '', total: settings.defaultLaborRate,
  }] });
  const updateLabor = (id: string, changes: Partial<LaborItem>) => patch({
    laborItems: calculated.laborItems.map(item => item.id === id ? { ...item, ...changes } : item),
  });
  const removeLabor = (id: string) => patch({ laborItems: calculated.laborItems.filter(item => item.id !== id) });

  const addPart = () => patch({ partItems: [...calculated.partItems, {
    id: uid(), partId: '', partNo: '', name: '', qty: 1, cost: 0, price: 0, total: 0, costTotal: 0,
  }] });
  const choosePart = (lineId: string, partId: string) => {
    const part = parts.find(item => item.id === partId);
    updatePart(lineId, { partId, partNo: part?.partNo || '', name: part?.name || '', cost: part?.cost || 0, price: part?.price || 0 });
  };
  const updatePart = (id: string, changes: Partial<PartItem>) => patch({
    partItems: calculated.partItems.map(item => item.id === id ? { ...item, ...changes } : item),
  });
  const removePart = (id: string) => patch({ partItems: calculated.partItems.filter(item => item.id !== id) });

  const submit = async () => {
    if (!calculated.customer || !calculated.vehicle) return alert('请选择客户和车辆。');
    if (calculated.laborItems.some(item => !item.description)) return alert('请填写所有人工项目名称。');
    if (calculated.partItems.some(item => !item.name || item.qty <= 0)) return alert('请检查配件名称和数量。');
    setSaving(true);
    try { await onSave(calculated); } finally { setSaving(false); }
  };

  return <div className="editor-screen">
    <div className="editor-head"><div><p className="eyebrow">维修工单 / Repair Order</p><h2>{value ? `编辑 ${order.number}` : '新建维修工单'}</h2></div><div className="toolbar"><button onClick={onCancel}>取消</button><button className="primary" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存工单'}</button></div></div>

    <section className="form-section"><h3>客户与车辆</h3><div className="form-grid four">
      <label>工单号<input value={order.number} onChange={e => patch({ number: e.target.value })} /></label>
      <label>日期<input type="date" value={order.date} onChange={e => patch({ date: e.target.value })} /></label>
      <label>状态<select value={order.status} onChange={e => patch({ status: e.target.value as WorkOrderStatus })}>{statuses.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>负责技师<input value={order.technician || ''} onChange={e => patch({ technician: e.target.value })} /></label>
      <label>客户<select value={order.customerId || ''} onChange={e => selectCustomer(e.target.value)}><option value="">选择客户</option>{customers.map(item => <option key={item.id} value={item.id}>{item.name} · {item.phone}</option>)}</select></label>
      <label>联系电话<input value={order.phone || ''} onChange={e => patch({ phone: e.target.value })} /></label>
      <label>车辆<select value={order.vehicleId || ''} onChange={e => selectVehicle(e.target.value)}><option value="">选择车辆</option>{vehicles.map(item => <option key={item.id} value={item.id}>{item.plate || item.vin} · {item.year} {item.make} {item.model}</option>)}</select></label>
      <label>当前里程<input type="number" value={order.mileage || ''} onChange={e => patch({ mileage: Number(e.target.value) })} /></label>
    </div>{selectedVehicle && <div className="vehicle-strip"><b>{selectedVehicle.plate || '无车牌'}</b><span>VIN {selectedVehicle.vin || '—'}</span><span>Unit {selectedVehicle.unit || '—'}</span><span>{selectedVehicle.ownerName}</span></div>}</section>

    {(order.company || selectedVehicle?.ownerType === '车队') && <section className="form-section"><h3>车队送修信息</h3><div className="form-grid four">
      <label>公司名称<input value={order.company || ''} onChange={e => patch({ company: e.target.value })} /></label>
      <label>本次司机<select value={order.driverId || ''} onChange={e => selectDriver(e.target.value)}><option value="">选择司机</option>{drivers.filter(item => !order.fleetId || item.fleetId === order.fleetId).map(item => <option key={item.id} value={item.id}>{item.name} · {item.phone}</option>)}</select></label>
      <label>司机电话<input value={order.driverPhone || ''} onChange={e => patch({ driverPhone: e.target.value })} /></label>
      <label>PO Number<input value={order.po || ''} onChange={e => patch({ po: e.target.value })} /></label>
      <label className="span-2">维修授权人<input value={order.authorizedContact || ''} onChange={e => patch({ authorizedContact: e.target.value })} /></label>
    </div></section>}

    <section className="form-section"><h3>维修内容</h3><div className="form-grid three">
      <label>客户描述<textarea value={order.complaint || ''} onChange={e => patch({ complaint: e.target.value })} /></label>
      <label>检查/诊断结果<textarea value={order.diagnosis || ''} onChange={e => patch({ diagnosis: e.target.value })} /></label>
      <label>完成的维修<textarea value={order.workPerformed || ''} onChange={e => patch({ workPerformed: e.target.value })} /></label>
    </div></section>

    <section className="form-section"><div className="section-title"><h3>人工项目</h3><button onClick={addLabor}>＋ 添加工时</button></div>
      <div className="line-table"><div className="line-head labor-grid"><span>项目</span><span>工时</span><span>费率</span><span>技师</span><span>小计</span><span /></div>
      {calculated.laborItems.map(item => <div className="line-row labor-grid" key={item.id}><input value={item.description} onChange={e => updateLabor(item.id, { description: e.target.value })} placeholder="例如：更换水泵" /><input type="number" step="0.1" value={item.hours} onChange={e => updateLabor(item.id, { hours: Number(e.target.value) })} /><input type="number" step="0.01" value={item.rate} onChange={e => updateLabor(item.id, { rate: Number(e.target.value) })} /><input value={item.technician || ''} onChange={e => updateLabor(item.id, { technician: e.target.value })} /><b>{money(item.total)}</b><button className="danger-link" onClick={() => removeLabor(item.id)}>删除</button></div>)}
      {!calculated.laborItems.length && <div className="empty-line">尚未添加人工项目</div>}</div>
    </section>

    <section className="form-section"><div className="section-title"><h3>配件项目</h3><button onClick={addPart}>＋ 添加配件</button></div>
      <div className="line-table"><div className="line-head parts-grid"><span>库存配件</span><span>编号/名称</span><span>数量</span><span>售价</span><span>小计</span><span /></div>
      {calculated.partItems.map(item => <div className="line-row parts-grid" key={item.id}><select value={item.partId || ''} onChange={e => choosePart(item.id, e.target.value)}><option value="">手动项目</option>{parts.map(part => <option key={part.id} value={part.id}>{part.partNo} · {part.name}（库存 {part.qty}）</option>)}</select><div><input value={item.partNo} onChange={e => updatePart(item.id, { partNo: e.target.value })} placeholder="配件编号" /><input value={item.name} onChange={e => updatePart(item.id, { name: e.target.value })} placeholder="配件名称" /></div><input type="number" step="1" value={item.qty} onChange={e => updatePart(item.id, { qty: Number(e.target.value) })} /><input type="number" step="0.01" value={item.price} onChange={e => updatePart(item.id, { price: Number(e.target.value) })} /><b>{money(item.total)}</b><button className="danger-link" onClick={() => removePart(item.id)}>删除</button></div>)}
      {!calculated.partItems.length && <div className="empty-line">尚未添加配件</div>}</div>
    </section>

    <section className="form-section totals-section"><div className="form-grid four compact">
      <label>外包费用<input type="number" step="0.01" value={order.outsource} onChange={e => patch({ outsource: Number(e.target.value) })} /></label>
      <label>折扣<input type="number" step="0.01" value={order.discount} onChange={e => patch({ discount: Number(e.target.value) })} /></label>
      <label>配件税率 %<input type="number" step="0.01" value={order.taxRate} onChange={e => patch({ taxRate: Number(e.target.value) })} /></label>
      <label>已付款<input type="number" step="0.01" value={order.paid} onChange={e => patch({ paid: Number(e.target.value) })} /></label>
    </div><div className="totals-card"><div><span>人工</span><b>{money(calculated.laborTotal)}</b></div><div><span>配件</span><b>{money(calculated.partsTotal)}</b></div><div><span>税费</span><b>{money(calculated.tax)}</b></div><div className="grand"><span>总价</span><b>{money(calculated.total)}</b></div><div className="balance"><span>欠款</span><b>{money(calculated.balance)}</b></div></div></section>
  </div>;
}
