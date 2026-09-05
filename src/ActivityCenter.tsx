import { useEffect, useState } from 'react';
import type { Campaign, Vehicle, Warranty } from './types';
import { supabase } from './lib/supabase';

type RewardVehicle = { id: string; plate: string; vin: string; year: string; make: string; model: string; qualifying_count: number; reward_earned_at?: string; reward_expires_at?: string; status: string };
type RewardEnrollment = { id: string; account_type: string; contact_name: string; phone: string; email: string; company_name?: string; tcp_number?: string; status: string; created_at: string; zg_reward_vehicles: RewardVehicle[] };

function OilRewardAdmin({ organizationId }: { organizationId: string }) {
  const pageSize = 30;
  const [items, setItems] = useState<RewardEnrollment[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busyVehicle, setBusyVehicle] = useState(''); const [hasMore, setHasMore] = useState(false);
  const refresh = async (append = false) => { if (!supabase) return; setLoading(true); const offset = append ? items.length : 0; const { data, error: queryError } = await supabase.from('zg_reward_enrollments').select('id,account_type,contact_name,phone,email,company_name,tcp_number,status,created_at,zg_reward_vehicles(id,plate,vin,year,make,model,qualifying_count,reward_earned_at,reward_expires_at,status)').eq('organization_id', organizationId).order('created_at', { ascending: false }).range(offset, offset + pageSize - 1); if (queryError) setError(queryError.message); else { const rows = (data || []) as RewardEnrollment[]; setItems(previous => append ? [...previous, ...rows] : rows); setHasMore(rows.length === pageSize); setError(''); } setLoading(false); };
  useEffect(() => { void refresh(); }, [organizationId]);
  const review = async (id: string, approve: boolean) => { if (!supabase || !confirm(approve ? '批准后将查重并关联到客户、车队与车辆资料库。确定批准？' : '确定拒绝这份报名？')) return; const { error: reviewError } = await supabase.rpc('zg_review_oil_reward_enrollment', { p_enrollment: id, p_approve: approve, p_note: null }); if (reviewError) alert(reviewError.message); else void refresh(); };
  const adjustCount = async (vehicle: RewardVehicle) => { if (!supabase) return; const raw = prompt(`修改 ${vehicle.plate} 的保养次数（0–5）`, String(vehicle.qualifying_count)); if (raw === null) return; const count = Number(raw); if (!Number.isInteger(count) || count < 0 || count > 5) return alert('请输入 0 到 5 的整数。'); if (count === vehicle.qualifying_count) return; const note = prompt('请输入修改原因（系统会永久保留修改人、时间和原因）', '工作人员核对后调整'); if (!note?.trim()) return; setBusyVehicle(vehicle.id); const { error: adjustError } = await supabase.rpc('zg_set_oil_reward_count', { p_reward_vehicle: vehicle.id, p_count: count, p_note: note.trim() }); setBusyVehicle(''); if (adjustError) alert(adjustError.message); else void refresh(); };
  const viewHistory = async (vehicle: RewardVehicle) => { if (!supabase) return; setBusyVehicle(vehicle.id); const { data, error: historyError } = await supabase.from('zg_reward_events').select('event_type,delta,work_order_number,note,created_at').eq('reward_vehicle_id', vehicle.id).order('created_at', { ascending: false }).limit(30); setBusyVehicle(''); if (historyError) return alert(historyError.message); const labels: Record<string,string> = { qualifying_service: '自动累计', manual_adjustment: '人工调整', reward_earned: '奖励生效', reward_redeemed: '奖励使用', reversal: '自动撤销' }; alert(`${vehicle.plate} 当前 ${vehicle.qualifying_count}/5\n\n${(data || []).map(item => `${new Date(item.created_at).toLocaleString()}  ${labels[item.event_type] || item.event_type} ${Number(item.delta) > 0 ? '+' : ''}${item.delta}\n${item.work_order_number || ''} ${item.note || ''}`.trim()).join('\n\n') || '暂无记录'}`); };
  return <section className="panel reward-admin"><div className="section-title"><div><h3>机油保养奖励 / Oil Change Rewards</h3><small>活动数据与日常工单隔离；每次最多读取 {pageSize} 位客户，记录按需读取</small></div><div className="toolbar"><a className="button" href="https://zgautorepair.com/oil-change-rewards" target="_blank" rel="noreferrer">打开活动页</a><button onClick={() => void refresh()}>刷新</button></div></div>
    {loading && <div className="empty">正在读取活动报名…</div>}{error && <div className="empty"><b>活动数据库尚未启用</b><span>{error}</span></div>}
    {!loading && !error && <table><thead><tr><th>客户 / 公司</th><th>联系方式</th><th>参加车辆与进度</th><th>状态</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><b>{item.company_name || item.contact_name}</b><small>{item.account_type === 'fleet' ? `车队 · TCP ${item.tcp_number || '—'}` : '个人客户'}</small></td><td>{item.phone}<small>{item.email}</small></td><td>{item.zg_reward_vehicles.map(vehicle => <div key={vehicle.id}><b>{vehicle.plate}</b> {vehicle.year} {vehicle.make} {vehicle.model}<small>VIN …{vehicle.vin.slice(-6)} · {vehicle.qualifying_count}/5 {vehicle.reward_earned_at ? `· 奖励有效至 ${new Date(vehicle.reward_expires_at || '').toLocaleDateString()}` : ''}</small><span className="actions"><button disabled={busyVehicle === vehicle.id} onClick={() => void viewHistory(vehicle)}>查看记录</button><button disabled={busyVehicle === vehicle.id} onClick={() => void adjustCount(vehicle)}>授权修改次数</button></span></div>)}</td><td><span className="status">{item.status === 'pending' ? '待审核' : item.status === 'approved' ? '已启用' : item.status === 'rejected' ? '已拒绝' : '重复'}</span><small>{new Date(item.created_at).toLocaleString()}</small></td><td className="actions">{item.status === 'pending' && <><button className="primary" onClick={() => void review(item.id, true)}>批准并关联</button><button className="danger-link" onClick={() => void review(item.id, false)}>拒绝</button></>}</td></tr>)}</tbody></table>}
    {!loading && !error && !items.length && <div className="empty"><b>还没有活动报名</b><span>客户通过公开活动页登记后会显示在这里。</span></div>}
    {!error && hasMore && <div className="toolbar"><button disabled={loading} onClick={() => void refresh(true)}>{loading ? '读取中…' : `继续读取下 ${pageSize} 位`}</button></div>}
  </section>;
}

type Props = {
  organizationId: string;
  campaigns: Campaign[]; warranties: Warranty[]; vehicles: Vehicle[];
  onAddCampaign: () => void; onEditCampaign: (item: Campaign) => void;
  onAddWarranty: () => void; onEditWarranty: (item: Warranty) => void;
  onRemoveCampaign: (id: string) => Promise<void>; onRemoveWarranty: (id: string) => Promise<void>;
};

export function ActivityCenter(props: Props) {
  return <div className="page">
    <div className="page-title"><div><p className="eyebrow">PROMOTIONS & WARRANTY</p><h2>活动与保修</h2><p>设置优惠活动，并把保修期限绑定到具体车辆和原始工单。</p></div><div className="toolbar"><button onClick={props.onAddWarranty}>＋ 添加车辆保修</button><button className="primary" onClick={props.onAddCampaign}>＋ 新建活动</button></div></div>
    <OilRewardAdmin organizationId={props.organizationId} />
    <div className="split-panels">
      <section className="panel"><div className="section-title"><h3>优惠活动</h3><span>{props.campaigns.length} 项</span></div>
        <table><thead><tr><th>活动</th><th>时间</th><th>权益</th><th>保修</th><th>状态</th><th /></tr></thead><tbody>{props.campaigns.map(item => <tr key={item.id}><td><b>{item.name}</b><small>{item.terms || '—'}</small></td><td>{item.start}<small>至 {item.end}</small></td><td>{item.benefit}<small>{item.partsFree ? '配件免费' : '配件收费'} · {item.laborFree ? '人工免费' : '人工收费'}</small></td><td>{item.warrantyMonths} 个月<small>{Number(item.warrantyMiles || 0).toLocaleString()} miles</small></td><td><span className="status">{item.status}</span></td><td className="actions"><button onClick={() => props.onEditCampaign(item)}>编辑</button><button className="danger-link" onClick={() => confirm('确定删除这个活动？') && void props.onRemoveCampaign(item.id)}>删除</button></td></tr>)}</tbody></table>
        {!props.campaigns.length && <div className="empty"><b>暂无活动</b><span>可以建立“刹车片一年配件免费、人工正常收费”等活动。</span></div>}
      </section>
      <section className="panel"><div className="section-title"><h3>车辆保修记录</h3><span>{props.warranties.length} 条</span></div>
        <table><thead><tr><th>车辆</th><th>保修项目</th><th>期限</th><th>保障范围</th><th>状态</th><th /></tr></thead><tbody>{props.warranties.map(item => <tr key={item.id}><td><b>{item.plate || item.vehicle}</b><small>{item.vehicle}</small></td><td>{item.item}<small>{item.originalRO ? `原工单 ${item.originalRO}` : '—'}</small></td><td>{item.start}<small>至 {item.end} · {Number(item.mileageLimit || 0).toLocaleString()} miles</small></td><td>{item.coverage}</td><td><span className="status">{item.status}</span></td><td className="actions"><button onClick={() => props.onEditWarranty(item)}>编辑</button><button className="danger-link" onClick={() => confirm('确定删除这条保修记录？') && void props.onRemoveWarranty(item.id)}>删除</button></td></tr>)}</tbody></table>
        {!props.warranties.length && <div className="empty"><b>暂无车辆保修</b><span>完成符合条件的维修后，在这里登记车辆保修。</span></div>}
      </section>
    </div>
  </div>;
}
