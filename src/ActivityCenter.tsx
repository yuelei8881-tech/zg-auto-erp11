import { useEffect, useState } from 'react';
import type { Campaign, Vehicle, Warranty } from './types';
import { supabase } from './lib/supabase';

type RewardVehicle = { id: string; plate: string; vin: string; year: string; make: string; model: string; qualifying_count: number; reward_earned_at?: string; reward_expires_at?: string; status: string };
type RewardEnrollment = { id: string; account_type: string; contact_name: string; phone: string; email: string; company_name?: string; tcp_number?: string; status: string; created_at: string; zg_reward_vehicles: RewardVehicle[] };

function OilRewardAdmin({ organizationId }: { organizationId: string }) {
  const [items, setItems] = useState<RewardEnrollment[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const refresh = async () => { if (!supabase) return; setLoading(true); const { data, error: queryError } = await supabase.from('zg_reward_enrollments').select('id,account_type,contact_name,phone,email,company_name,tcp_number,status,created_at,zg_reward_vehicles(id,plate,vin,year,make,model,qualifying_count,reward_earned_at,reward_expires_at,status)').eq('organization_id', organizationId).order('created_at', { ascending: false }); if (queryError) setError(queryError.message); else { setItems((data || []) as RewardEnrollment[]); setError(''); } setLoading(false); };
  useEffect(() => { void refresh(); }, [organizationId]);
  const review = async (id: string, approve: boolean) => { if (!supabase || !confirm(approve ? '批准后将查重并关联到客户、车队与车辆资料库。确定批准？' : '确定拒绝这份报名？')) return; const { error: reviewError } = await supabase.rpc('zg_review_oil_reward_enrollment', { p_enrollment: id, p_approve: approve, p_note: null }); if (reviewError) alert(reviewError.message); else void refresh(); };
  return <section className="panel reward-admin"><div className="section-title"><div><h3>机油保养奖励 / Oil Change Rewards</h3><small>公开报名、车辆独立进度与奖励到期日</small></div><div className="toolbar"><a className="button" href="https://zgautorepair.com/oil-change-rewards" target="_blank" rel="noreferrer">打开活动页</a><button onClick={() => void refresh()}>刷新</button></div></div>
    {loading && <div className="empty">正在读取活动报名…</div>}{error && <div className="empty"><b>活动数据库尚未启用</b><span>{error}</span></div>}
    {!loading && !error && <table><thead><tr><th>客户 / 公司</th><th>联系方式</th><th>参加车辆与进度</th><th>状态</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><b>{item.company_name || item.contact_name}</b><small>{item.account_type === 'fleet' ? `车队 · TCP ${item.tcp_number || '—'}` : '个人客户'}</small></td><td>{item.phone}<small>{item.email}</small></td><td>{item.zg_reward_vehicles.map(vehicle => <div key={vehicle.id}><b>{vehicle.plate}</b> {vehicle.year} {vehicle.make} {vehicle.model}<small>VIN …{vehicle.vin.slice(-6)} · {vehicle.qualifying_count}/5 {vehicle.reward_earned_at ? `· 奖励有效至 ${new Date(vehicle.reward_expires_at || '').toLocaleDateString()}` : ''}</small></div>)}</td><td><span className="status">{item.status === 'pending' ? '待审核' : item.status === 'approved' ? '已启用' : item.status === 'rejected' ? '已拒绝' : '重复'}</span><small>{new Date(item.created_at).toLocaleString()}</small></td><td className="actions">{item.status === 'pending' && <><button className="primary" onClick={() => void review(item.id, true)}>批准并关联</button><button className="danger-link" onClick={() => void review(item.id, false)}>拒绝</button></>}</td></tr>)}</tbody></table>}
    {!loading && !error && !items.length && <div className="empty"><b>还没有活动报名</b><span>客户通过公开活动页登记后会显示在这里。</span></div>}
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
