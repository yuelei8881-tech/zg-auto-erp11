import type { Campaign, Vehicle, Warranty } from './types';

type Props = {
  campaigns: Campaign[]; warranties: Warranty[]; vehicles: Vehicle[];
  onAddCampaign: () => void; onEditCampaign: (item: Campaign) => void;
  onAddWarranty: () => void; onEditWarranty: (item: Warranty) => void;
  onRemoveCampaign: (id: string) => Promise<void>; onRemoveWarranty: (id: string) => Promise<void>;
};

export function ActivityCenter(props: Props) {
  return <div className="page">
    <div className="page-title"><div><p className="eyebrow">PROMOTIONS & WARRANTY</p><h2>活动与保修</h2><p>设置优惠活动，并把保修期限绑定到具体车辆和原始工单。</p></div><div className="toolbar"><button onClick={props.onAddWarranty}>＋ 添加车辆保修</button><button className="primary" onClick={props.onAddCampaign}>＋ 新建活动</button></div></div>
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
