import { useRef, useState } from 'react';
import type { AppStore, Vehicle } from './types';
import type { CloudSession } from './lib/cloud';

export function VehicleTransfer({ vehicle, store, cloud, onClose, onSaved }: {
  vehicle: Vehicle; store: AppStore; cloud: CloudSession;
  onClose: () => void; onSaved: (vehicle: Vehicle) => void;
}) {
  const [target, setTarget] = useState('');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('车辆已更换车主');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Keep identical request arguments after a network error: retry is idempotent.
  const request = useRef<{ id: string; module: string; target: string; note: string } | null>(null);
  const choices = [
    ...store.customers.filter(c => c.type === '公司' || c.type === '车队').map(c => ({ key: `customers:${c.id}`, name: c.name, phone: c.phone, id: c.id })),
    ...store.fleets.map(f => ({ key: `fleets:${f.id}`, name: f.company, phone: f.phone, id: f.id })),
  ].filter(c => c.id !== vehicle.ownerId);
  const selected = choices.find(c => c.key === target);
  const version = (vehicle as Vehicle & { _cloudUpdatedAt?: string })._cloudUpdatedAt;
  const submit = async () => {
    if (busy || !confirmed || !selected || !version || note.trim().length < 2) return;
    if (!request.current) {
      const [module, targetId] = target.split(':');
      request.current = { id: crypto.randomUUID(), module, target: targetId, note: note.trim() };
    }
    setBusy(true); setError('');
    try {
      const r = request.current;
      const saved = await cloud.transferVehicle(vehicle.id, r.module, r.target, version, r.note, r.id);
      onSaved(saved as unknown as Vehicle);
    } catch (e) {
      setError(e instanceof Error ? e.message : '过户未确认，请保持当前选项重试；不要重复新建车辆。');
    } finally { setBusy(false); }
  };
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
    <div className="modal-head"><h2 id="transfer-title">车辆过户</h2><button disabled={busy} onClick={onClose}>关闭</button></div>
    <div className="form-section">
      <p><b>{vehicle.plate} · {vehicle.year} {vehicle.make} {vehicle.model}</b></p>
      <p>VIN：{vehicle.vin || '—'}<br />当前归属：{vehicle.ownerName}</p>
      <label>搜索新公司<input value={query} disabled={busy || !!request.current} onChange={e => setQuery(e.target.value)} placeholder="公司名称或电话" /></label>
      <label>过户给<select value={target} disabled={busy || !!request.current} onChange={e => { setTarget(e.target.value); setConfirmed(false); }}>
        <option value="">请选择已建立档案的公司／车队</option>
        {choices.filter(c => c.key === target || `${c.name} ${c.phone}`.toLowerCase().includes(query.toLowerCase())).map(c => <option key={c.key} value={c.key}>{c.name} · {c.phone || '无电话'}</option>)}
      </select></label>
      {!choices.length && <p>请先在客户管理或车队管理中建立新公司档案，再办理过户。</p>}
      <label>过户原因<input value={note} maxLength={500} disabled={busy || !!request.current} onChange={e => setNote(e.target.value)} /></label>
      <p>过户立即生效。活动进度重新从 <b>0/5</b> 开始，原车主未使用的免费保养资格不转移。车辆维修档案、旧工单、发票及欠款保持原样。</p>
      <p>原司机和车队 Unit 编号将解除，请为新公司重新设置。只有过户后新建并实际完成换机油的工单才会累计。</p>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> 我确认过户至“{selected?.name || '请选择公司'}”，并将活动累计清零。</label>
      {!version && <p role="alert">车辆版本信息缺失，请关闭窗口并刷新数据后重试。</p>}
      {error && <p role="alert">{error}</p>}
      <button className="primary" disabled={busy || !confirmed || !selected || !version || note.trim().length < 2} onClick={() => void submit()}>{busy ? '正在过户，请勿重复操作…' : request.current ? '重试同一过户请求' : '确认过户并清零活动'}</button>
    </div>
  </div></div>;
}
