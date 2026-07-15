import { useMemo, useState } from 'react';
import type { Customer, Driver, EvidencePhoto, Fleet, InspectionChecklist, LaborItem, Part, PartItem, ShopSettings, Vehicle, WorkOrder, WorkOrderStatus } from './types';
import { decodeVin, money, recalculateWorkOrder, today, uid } from './lib/erp';
import { recognizePlatePhoto, recognizeVinPhoto } from './lib/ocr';
import { SignaturePad } from './SignaturePad';
import type { StaffMember } from './lib/cloud';

type Props = {
  value?: WorkOrder; customers: Customer[]; vehicles: Vehicle[]; fleets: Fleet[]; drivers: Driver[];
  parts: Part[]; settings: ShopSettings; nextNumber: string;
  onSave: (order: WorkOrder) => Promise<void>; onCancel: () => void;
  onCreateVehicle: (vehicle: Vehicle) => Promise<void>;
  onPrint: (order: WorkOrder, documentType: string) => void;
  currentUser: string;
  currentUserId: string; technicians: StaffMember[];
  canApproveReview: boolean; canAssignTechnician: boolean; canEditPricing: boolean; canViewFinancials: boolean;
};

const statuses: WorkOrderStatus[] = ['等待检查', '等待批准', '等待配件', '维修中', '已完成', '已交车'];
const inspectionItems: Array<[keyof InspectionChecklist, string]> = [
  ['intake', '接车资料、里程和客户描述已确认'],
  ['exterior', '车辆外观、已有损伤和照片已记录'],
  ['scan', '维修前故障扫描或故障码已保存'],
  ['diagnosis', '检查与诊断结果已填写'],
  ['estimate', '人工、配件和报价明细已核对'],
];

const evidenceCategories: EvidencePhoto['category'][] = ['车牌', '左前', '右前', '左后', '右后', '仪表里程', '已有损伤', '故障扫描', '维修中', '维修完成', '其他'];

async function compressEvidence(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image(); element.onload = () => resolve(element); element.onerror = reject; element.src = source;
  });
  const max = 1280;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

export function WorkOrderEditor({ value, customers, vehicles, fleets, drivers, parts, settings, nextNumber, onSave, onCancel, onCreateVehicle, onPrint, currentUser, currentUserId, technicians, canApproveReview, canAssignTechnician, canEditPricing, canViewFinancials }: Props) {
  const [order, setOrder] = useState<WorkOrder>(() => recalculateWorkOrder(value || {
    id: uid(), number: nextNumber, date: today(), customer: '', vehicle: '', status: '等待检查',
    technician: canAssignTechnician ? '' : currentUser, technicianUserId: canAssignTechnician ? '' : currentUserId,
    laborItems: [], partItems: [], outsource: 0, discount: 0, taxRate: settings.defaultTaxRate,
  }));
  const [saving, setSaving] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [vinScanning, setVinScanning] = useState(false);
  const [plateScanning, setPlateScanning] = useState(false);
  const [evidenceCategory, setEvidenceCategory] = useState<EvidencePhoto['category']>('其他');
  const [evidenceSaving, setEvidenceSaving] = useState(false);
  const [vehicleDraft, setVehicleDraft] = useState({ plate: '', vin: '', year: String(new Date().getFullYear()), make: '', model: '', engine: '', mileage: 0 });
  const calculated = useMemo(() => recalculateWorkOrder(order), [order]);
  const selectedVehicle = vehicles.find(v => v.id === order.vehicleId);
  const checklist: InspectionChecklist = order.inspectionChecklist || { intake: false, exterior: false, scan: false, diagnosis: false, estimate: false };
  const inspectionDone = inspectionItems.filter(([key]) => checklist[key]).length;
  const reviewStatus = order.reviewStatus || (order.status === '等待批准' ? '待审查' : ['维修中', '已完成', '已交车'].includes(order.status) ? '已通过' : '未提交');
  const activeEvidence = (order.evidencePhotos || []).filter(item => !item.archivedAt);

  const patch = (changes: Partial<WorkOrder>) => setOrder(current => recalculateWorkOrder({ ...current, ...changes }));

  const selectCustomer = (id: string) => {
    const customer = customers.find(item => item.id === id);
    patch({ customerId: id, customer: customer?.name || '', phone: customer?.phone || '', vehicleId: '', vehicle: '', plate: '', vin: '', mileage: 0 });
  };

  const createVehicle = async () => {
    const customer = customers.find(item => item.id === order.customerId);
    if (!customer) return alert('请先选择客户。');
    if (!vehicleDraft.plate.trim() || !vehicleDraft.year.trim() || !vehicleDraft.make.trim() || !vehicleDraft.model.trim()) return alert('请填写车牌、年份、品牌和车型。');
    const duplicate = vehicles.find(item => item.plate.trim().toUpperCase() === vehicleDraft.plate.trim().toUpperCase());
    if (duplicate) { selectVehicle(duplicate.id); setAddingVehicle(false); return alert('该车牌已存在，已经为您自动选中。'); }
    const vehicle: Vehicle = {
      id: uid(), ownerType: customer.type, ownerId: customer.id, ownerName: customer.name,
      plate: vehicleDraft.plate.trim().toUpperCase(), vin: vehicleDraft.vin.trim().toUpperCase(),
      year: vehicleDraft.year.trim(), make: vehicleDraft.make.trim(), model: vehicleDraft.model.trim(), engine: vehicleDraft.engine.trim(), mileage: Number(vehicleDraft.mileage || 0),
    };
    setVehicleSaving(true);
    try {
      await onCreateVehicle(vehicle);
      patch({ vehicleId: vehicle.id, vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, plate: vehicle.plate, vin: vehicle.vin, mileage: vehicle.mileage });
      setAddingVehicle(false);
      setVehicleDraft({ plate: '', vin: '', year: String(new Date().getFullYear()), make: '', model: '', engine: '', mileage: 0 });
    } finally { setVehicleSaving(false); }
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

  const scanVehicleVin = async (file?: File) => {
    if (!file) return;
    setVinScanning(true);
    try {
      const vin = await recognizeVinPhoto(file);
      const decoded = await decodeVin(vin);
      setVehicleDraft(current => ({ ...current, vin, year: decoded.year || current.year, make: decoded.make || current.make, model: decoded.model || current.model, engine: decoded.engine || current.engine }));
      alert(`已识别 VIN：${vin}\n车辆资料已自动填写，请核对后保存。`);
    } catch (error) { alert(`VIN 识别失败：${error instanceof Error ? error.message : error}`); }
    finally { setVinScanning(false); }
  };

  const scanVehiclePlate = async (file?: File) => {
    if (!file) return;
    setPlateScanning(true);
    try {
      const plate = await recognizePlatePhoto(file);
      setVehicleDraft(current => ({ ...current, plate }));
      alert(`已识别车牌：${plate}\n请核对后保存车辆。`);
    } catch (error) { alert(`车牌识别失败：${error instanceof Error ? error.message : error}`); }
    finally { setPlateScanning(false); }
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

  const transitionReview = (action: '提交审查' | '批准维修' | '退回补充', changes: Partial<WorkOrder>) => {
    patch({ ...changes, reviewHistory: [...(order.reviewHistory || []), { id: uid(), action, by: currentUser, at: new Date().toISOString(), note: order.reviewNotes || '' }] });
  };
  const submitReview = () => {
    if (inspectionDone < inspectionItems.length) return alert('请先完成全部接车检查项目。');
    if (!order.diagnosis?.trim()) return alert('请先填写检查/诊断结果。');
    transitionReview('提交审查', { status: '等待批准', reviewStatus: '待审查', submittedForReviewAt: new Date().toISOString() });
  };
  const approveReview = () => transitionReview('批准维修', { status: '维修中', reviewStatus: '已通过', reviewedBy: currentUser, reviewedAt: new Date().toISOString() });
  const returnReview = () => {
    if (!order.reviewNotes?.trim()) return alert('请填写退回补充的原因。');
    transitionReview('退回补充', { status: '等待检查', reviewStatus: '退回补充', reviewedBy: currentUser, reviewedAt: new Date().toISOString() });
  };

  const addEvidence = async (files: FileList | null) => {
    if (!files?.length) return;
    if ((order.evidencePhotos || []).length + files.length > 24) return alert('每张工单最多保留 24 张证据照片。');
    setEvidenceSaving(true);
    try {
      const additions: EvidencePhoto[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        additions.push({ id: uid(), category: evidenceCategory, dataUrl: await compressEvidence(file), fileName: file.name, capturedAt: new Date().toISOString(), capturedBy: currentUser });
      }
      const evidencePhotos = [...(order.evidencePhotos || []), ...additions];
      const exteriorCategories: EvidencePhoto['category'][] = ['左前', '右前', '左后', '右后', '已有损伤'];
      patch({ evidencePhotos, inspectionChecklist: exteriorCategories.includes(evidenceCategory) ? { ...checklist, exterior: true } : checklist });
    } catch (error) { alert(`照片处理失败：${error instanceof Error ? error.message : error}`); }
    finally { setEvidenceSaving(false); }
  };

  const archiveEvidence = (photo: EvidencePhoto) => {
    const reason = prompt('照片不会被删除，只会标记作废并永久保留。请输入作废原因：', '重复照片');
    if (!reason?.trim()) return;
    patch({ evidencePhotos: (order.evidencePhotos || []).map(item => item.id === photo.id ? { ...item, archivedAt: new Date().toISOString(), archivedBy: currentUser, archiveReason: reason.trim() } : item) });
  };

  const submit = async () => {
    if (!calculated.customer || !calculated.vehicle) return alert('请选择客户和车辆。');
    if (calculated.laborItems.some(item => !item.description)) return alert('请填写所有人工项目名称。');
    if (calculated.partItems.some(item => !item.name || item.qty <= 0)) return alert('请检查配件名称和数量。');
    setSaving(true);
    try { await onSave(calculated); } finally { setSaving(false); }
  };

  return <div className="editor-screen">
    <div className="editor-head"><div><p className="eyebrow">维修工单 / Repair Order</p><h2>{value ? `编辑 ${order.number}` : '新建维修工单'}</h2></div><div className="toolbar"><button type="button" onClick={() => onPrint(calculated, 'Repair Order')}>打印工单</button><button type="button" onClick={onCancel}>取消</button><button type="button" className="primary" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存工单'}</button></div></div>
    <div className="work-order-shop-head"><div><b>{settings.shopName || 'Z&G AUTO REPAIR'}</b><span>{settings.address || '319 Agostino Rd, San Gabriel, CA 91776'}</span><span>Tel / 电话：{settings.phone || '626-508-0888'}</span></div><div><small>Repair Order No. / 工单编号</small><strong>{order.number}</strong></div></div>

    <section className="form-section"><h3>客户与车辆</h3><div className="form-grid four">
      <label>工单号<input value={order.number} onChange={e => patch({ number: e.target.value })} /></label>
      <label>日期<input type="date" value={order.date} onChange={e => patch({ date: e.target.value })} /></label>
      <label>状态<select value={order.status} disabled={!!order.archivedAt} onChange={e => patch({ status: e.target.value as WorkOrderStatus })}>{order.archivedAt && <option>已取消</option>}{statuses.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>负责技师{canAssignTechnician ? <select value={order.technicianUserId || ''} onChange={e => { const member = technicians.find(item => item.userId === e.target.value); patch({ technicianUserId: member?.userId || '', technician: member?.displayName || '' }); }}><option value="">未分配</option>{technicians.filter(item => item.role === 'technician' || item.role === 'manager').map(item => <option key={item.userId} value={item.userId}>{item.displayName || item.userId.slice(0, 8)}</option>)}</select> : <input value={order.technician || currentUser} readOnly />}</label>
      <label>客户<select value={order.customerId || ''} onChange={e => selectCustomer(e.target.value)}><option value="">选择客户</option>{customers.map(item => <option key={item.id} value={item.id}>{item.name} · {item.phone}</option>)}</select></label>
      <label>联系电话<input value={order.phone || ''} onChange={e => patch({ phone: e.target.value })} /></label>
      <label>车辆<div className="input-action"><select value={order.vehicleId || ''} onChange={e => selectVehicle(e.target.value)}><option value="">{vehicles.length ? '选择车辆' : '暂无车辆，请快速添加'}</option>{vehicles.map(item => <option key={item.id} value={item.id}>{item.plate || item.vin} · {item.year} {item.make} {item.model}{item.ownerName ? ` · ${item.ownerName}` : ''}</option>)}</select><button type="button" onClick={() => setAddingVehicle(current => !current)}>＋ 添加</button></div></label>
      <label>当前里程<input type="number" value={order.mileage || ''} onChange={e => patch({ mileage: Number(e.target.value) })} /></label>
    </div>{addingVehicle && <div className="quick-vehicle">
      <div><b>快速添加当前客户车辆</b><span>可拍摄车牌或车架号自动识别；保存后会自动选中。</span></div>
      <div className="quick-vehicle-grid">
        <div className="vin-field"><span>车牌号码</span><input value={vehicleDraft.plate} onChange={e => setVehicleDraft(current => ({ ...current, plate: e.target.value.toUpperCase() }))} /><label className="vin-scan-button">{plateScanning ? '识别中…' : '📷 拍照识别车牌'}<input type="file" accept="image/*" capture="environment" disabled={plateScanning} onChange={e => { void scanVehiclePlate(e.target.files?.[0]); e.currentTarget.value = ''; }} /></label></div>
        <div className="vin-field"><span>VIN / 车架号</span><input value={vehicleDraft.vin} maxLength={17} onChange={e => setVehicleDraft(current => ({ ...current, vin: e.target.value.toUpperCase() }))} /><label className="vin-scan-button">{vinScanning ? '识别中…' : '📷 扫描 / 拍照识别'}<input type="file" accept="image/*" capture="environment" disabled={vinScanning} onChange={e => { void scanVehicleVin(e.target.files?.[0]); e.currentTarget.value = ''; }} /></label></div>
        <label>年份<input value={vehicleDraft.year} onChange={e => setVehicleDraft(current => ({ ...current, year: e.target.value }))} /></label>
        <label>品牌<input value={vehicleDraft.make} onChange={e => setVehicleDraft(current => ({ ...current, make: e.target.value }))} /></label>
        <label>车型<input value={vehicleDraft.model} onChange={e => setVehicleDraft(current => ({ ...current, model: e.target.value }))} /></label>
        <label>发动机<input value={vehicleDraft.engine} onChange={e => setVehicleDraft(current => ({ ...current, engine: e.target.value }))} /></label>
        <label>里程<input type="number" value={vehicleDraft.mileage || ''} onChange={e => setVehicleDraft(current => ({ ...current, mileage: Number(e.target.value) }))} /></label>
      </div><div className="toolbar"><button type="button" onClick={() => setAddingVehicle(false)}>取消</button><button type="button" className="primary" onClick={createVehicle} disabled={vehicleSaving}>{vehicleSaving ? '保存中…' : '保存并选择车辆'}</button></div>
    </div>}{selectedVehicle && <div className="vehicle-strip"><b>{selectedVehicle.plate || '无车牌'}</b><span>VIN {selectedVehicle.vin || '—'}</span><span>Unit {selectedVehicle.unit || '—'}</span><span>{selectedVehicle.ownerName}</span></div>}</section>

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

    <section className="form-section evidence-section"><div className="section-title"><div><h3>证据留存 / Evidence</h3><span>照片同步保存在工单档案中；打印报价单、工单、发票和收据时不会打印照片。</span></div><b>{activeEvidence.length} 张有效照片</b></div>
      <div className="evidence-toolbar"><label>照片类别<select value={evidenceCategory} onChange={e => setEvidenceCategory(e.target.value as EvidencePhoto['category'])}>{evidenceCategories.map(item => <option key={item}>{item}</option>)}</select></label><label className="camera-button">{evidenceSaving ? '正在处理照片…' : '＋ 拍照 / 选择照片'}<input type="file" accept="image/*" capture="environment" multiple disabled={evidenceSaving} onChange={e => { void addEvidence(e.target.files); e.currentTarget.value = ''; }} /></label><span>手机打开时会优先调用后置相机，系统自动压缩并记录拍摄人和时间。</span></div>
      <div className="evidence-grid">{activeEvidence.map(photo => <article key={photo.id}><button type="button" className="evidence-image" onClick={() => window.open(photo.dataUrl, '_blank')}><img src={photo.dataUrl} alt={photo.category} /></button><div><b>{photo.category}</b><small>{photo.capturedBy} · {new Date(photo.capturedAt).toLocaleString()}</small><input value={photo.note || ''} placeholder="照片备注（例如：右前保险杠原有划痕）" onChange={e => patch({ evidencePhotos: (order.evidencePhotos || []).map(item => item.id === photo.id ? { ...item, note: e.target.value } : item) })} /><button type="button" className="danger-link" onClick={() => archiveEvidence(photo)}>作废归档</button></div></article>)}</div>
      {!activeEvidence.length && <div className="empty-line">尚未留存证据照片。建议至少拍摄车牌、四角、仪表里程和已有损伤。</div>}
      {!!order.evidencePhotos?.some(item => item.archivedAt) && <details className="archived-evidence"><summary>查看已作废照片（{order.evidencePhotos.filter(item => item.archivedAt).length}）</summary>{order.evidencePhotos.filter(item => item.archivedAt).map(item => <div key={item.id}><span>{item.category} · {item.fileName}</span><small>{item.archivedBy} 作废于 {new Date(item.archivedAt!).toLocaleString()} · {item.archiveReason}</small></div>)}</details>}
    </section>

    <section className="form-section signature-section"><div className="section-title"><div><h3>客户手写签字 / Customer Signature</h3><span>客户可在手机、平板或电脑触摸屏直接签字；签名随工单同步并显示在打印工单中。</span></div>{order.customerSignedAt && <b>已签字</b>}</div>
      <label className="signature-name">签字人姓名<input value={order.customerSignedBy || ''} onChange={e => patch({ customerSignedBy: e.target.value })} placeholder={order.customer || '客户姓名'} /></label>
      <SignaturePad value={order.customerSignature} onChange={(customerSignature, customerSignedAt) => patch({ customerSignature, customerSignedAt, customerSignedBy: customerSignature ? (order.customerSignedBy || order.customer) : order.customerSignedBy })} />
      {order.customerSignedAt && <small className="signature-time">签署时间：{new Date(order.customerSignedAt).toLocaleString()}</small>}
    </section>

    <section className="form-section review-section"><div className="section-title"><div><h3>检查与审查流程</h3><span>Inspection & Review · 已完成 {inspectionDone}/{inspectionItems.length}</span></div><span className={`review-badge review-${reviewStatus}`}>{reviewStatus}</span></div>
      <div className="inspection-grid">{inspectionItems.map(([key, label]) => <label key={key}><input type="checkbox" checked={checklist[key]} onChange={e => patch({ inspectionChecklist: { ...checklist, [key]: e.target.checked } })} /><span>{label}</span></label>)}</div>
      <label className="review-notes">审查意见 / 退回原因<textarea value={order.reviewNotes || ''} onChange={e => patch({ reviewNotes: e.target.value })} placeholder="记录审查意见、需要补充的照片或检查项目" /></label>
      <div className="review-actions"><button type="button" onClick={submitReview} disabled={reviewStatus === '待审查'}>完成检查并提交审查</button>{reviewStatus === '待审查' && canApproveReview && <><button type="button" className="primary" onClick={approveReview}>批准并开始维修</button><button type="button" className="danger-soft" onClick={returnReview}>退回补充</button></>}{reviewStatus === '待审查' && !canApproveReview && <span className="muted">已提交，等待经理或老板审查</span>}</div>
      {(order.submittedForReviewAt || order.reviewedAt) && <div className="review-meta">{order.submittedForReviewAt && <span>提交：{new Date(order.submittedForReviewAt).toLocaleString()}</span>}{order.reviewedAt && <span>审查：{order.reviewedBy} · {new Date(order.reviewedAt).toLocaleString()}</span>}</div>}
      {!!order.reviewHistory?.length && <div className="review-history"><b>审查记录</b>{[...order.reviewHistory].reverse().map(item => <div key={item.id}><span>{item.action}</span><small>{item.by} · {new Date(item.at).toLocaleString()}{item.note ? ` · ${item.note}` : ''}</small></div>)}</div>}
    </section>

    <section className="form-section"><div className="section-title"><h3>人工项目</h3><button onClick={addLabor}>＋ 添加工时</button></div>
      <div className="line-table"><div className="line-head labor-grid"><span>项目</span><span>工时</span><span>费率</span><span>技师</span><span>小计</span><span /></div>
      {calculated.laborItems.map(item => <div className="line-row labor-grid" key={item.id}><input value={item.description} onChange={e => updateLabor(item.id, { description: e.target.value })} placeholder="例如：更换水泵" /><input type="number" step="0.1" value={item.hours} onChange={e => updateLabor(item.id, { hours: Number(e.target.value) })} /><input type="number" step="0.01" value={item.rate} disabled={!canEditPricing} onChange={e => updateLabor(item.id, { rate: Number(e.target.value) })} /><input value={item.technician || ''} onChange={e => updateLabor(item.id, { technician: e.target.value })} /><b>{canViewFinancials ? money(item.total) : '—'}</b><button className="danger-link" onClick={() => removeLabor(item.id)}>删除</button></div>)}
      {!calculated.laborItems.length && <div className="empty-line">尚未添加人工项目</div>}</div>
    </section>

    <section className="form-section"><div className="section-title"><h3>配件项目</h3><button onClick={addPart}>＋ 添加配件</button></div>
      <div className="line-table"><div className="line-head parts-grid"><span>库存配件</span><span>编号/名称</span><span>数量</span><span>售价</span><span>小计</span><span /></div>
      {calculated.partItems.map(item => <div className="line-row parts-grid" key={item.id}><select value={item.partId || ''} onChange={e => choosePart(item.id, e.target.value)}><option value="">手动项目</option>{parts.map(part => <option key={part.id} value={part.id}>{part.partNo} · {part.name}（库存 {part.qty}）</option>)}</select><div><input value={item.partNo} onChange={e => updatePart(item.id, { partNo: e.target.value })} placeholder="配件编号" /><input value={item.name} onChange={e => updatePart(item.id, { name: e.target.value })} placeholder="配件名称" /></div><input type="number" step="1" value={item.qty} onChange={e => updatePart(item.id, { qty: Number(e.target.value) })} /><input type="number" step="0.01" value={item.price} disabled={!canEditPricing} onChange={e => updatePart(item.id, { price: Number(e.target.value) })} /><b>{canViewFinancials ? money(item.total) : '—'}</b><button className="danger-link" onClick={() => removePart(item.id)}>删除</button></div>)}
      {!calculated.partItems.length && <div className="empty-line">尚未添加配件</div>}</div>
    </section>

    {canViewFinancials && <section className="form-section totals-section"><div><div className="form-grid four compact">
      <label>外包费用<input type="number" step="0.01" value={order.outsource} onChange={e => patch({ outsource: Number(e.target.value) })} /></label>
      <label>折扣<input type="number" step="0.01" value={order.discount} onChange={e => patch({ discount: Number(e.target.value) })} /></label>
      <label>配件销售税率 %（人工不计税）<input type="number" step="0.01" value={order.taxRate} onChange={e => patch({ taxRate: Number(e.target.value) })} /></label>
      <label>已付款<input type="number" step="0.01" value={order.paid} onChange={e => patch({ paid: Number(e.target.value) })} /></label>
      <label>实际结账金额（需双人授权）<input type="number" step="0.01" placeholder={String(calculated.laborTotal + calculated.partsTotal + calculated.outsource + calculated.tax - calculated.discount)} value={order.settlementTotal ?? ''} onChange={e => patch({ settlementTotal: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
    </div><p className="tax-guidance">加州默认规则：系统仅对配件销售额计算销售税；单独列示的维修/安装人工通常不计销售税。制造加工人工等例外请由会计确认。参考：<a href="https://www.cdtfa.ca.gov/formspubs/pub25.pdf" target="_blank" rel="noreferrer">CDTFA Publication 25</a>、<a href="https://www.cdtfa.ca.gov/lawguides/vol1/sutr/1546.html" target="_blank" rel="noreferrer">Regulation 1546</a>。</p></div><div className="totals-card"><div><span>人工（免销售税）</span><b>{money(calculated.laborTotal)}</b></div><div><span>配件</span><b>{money(calculated.partsTotal)}</b></div><div><span>配件销售税</span><b>{money(calculated.tax)}</b></div><div className="grand"><span>总价</span><b>{money(calculated.total)}</b></div><div className="balance"><span>欠款</span><b>{money(calculated.balance)}</b></div></div></section>}
  </div>;
}
