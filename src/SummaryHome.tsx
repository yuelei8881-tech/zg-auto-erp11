import type { DashboardSummary } from './lib/cloud';
import { money } from './lib/erp';

const amounts = [
  ['todaySales','今日开单营业额'],['todayReceived','今日实收'],['todayGross','今日毛利润'],['receivables','未收款总额'],
  ['monthSales','本月营业额'],['monthReceived','本月实收'],['monthExpenses','本月支出'],['monthNet','本月现金净流入'],
  ['todayExpenses','今日支出（洛杉矶时间）'],['todayPartsExpenses','今日配件支出总额'],['monthBookBalance','累计账面余额（实收－支出）'],
];
export function SummaryHome({summary, name, financial, customers, createOrder, error, refresh, navigate, openMetric, newOrder, actions}: {
 summary: DashboardSummary | null; name: string; financial: boolean; customers: boolean; createOrder: boolean; error: string;
 refresh: () => void; navigate: (page: 'customers'|'vehicles'|'fleets'|'workOrders') => void;
 openMetric: (key: string) => void; newOrder: () => void;
 actions: Array<{label: string; onClick: () => void}>;
}) {
 const card = (key: string, label: string, value: string, click: () => void) => <button key={key} className="kpi kpi-button blue" onClick={click}><span>{label}</span><b>{value}</b><small>点击查看明细</small></button>;
 return <div className="page">
  <div className="hero"><h1>{name}，欢迎回来</h1><div className="toolbar">{customers && <button onClick={()=>navigate('customers')}>＋ 新客户</button>}{createOrder && <button className="primary" onClick={newOrder}>＋ 新建工单</button>}</div></div>
  <div className="dashboard-actions">{actions.map(action=><button key={action.label} onClick={action.onClick}><b>{action.label}</b><span>点击查看详情</span></button>)}</div>
  <div className="dashboard-sync-status" role="status">{error ? '汇总读取失败，请重试；未加载数据不会显示成零。' : summary ? `汇总已更新 · ${new Date(summary.generatedAt).toLocaleTimeString()} · 明细按需读取` : '正在读取首页汇总，无需等待全部明细…'}<button onClick={refresh}>刷新汇总</button></div>
  {error && <section className="panel" role="alert">{error}</section>}
  {customers && <details className="relationship-overview relationship-overview-collapsible"><summary><span><b>客户与车辆统计</b><small>点击展开统计，点击数字查看资料</small></span></summary><div className="relationship-overview-body"><div className="kpi-grid">{[
   ['customers','客户档案','customers'],['fleets','公司 / 车队','fleets'],['vehicles','车辆档案','vehicles'],['newVehiclesThisMonth','本月新增车辆','vehicles'],['servicedVehicles','有维修记录车辆','vehicles']
  ].map(([key,label,page])=>card(key,label,summary?.relationships?.[key] === undefined ? '加载中…' : String(summary.relationships[key]),()=>navigate(page as 'customers'|'fleets'|'vehicles')))}</div></div></details>}
  <div className="kpi-grid">{financial ? amounts.filter(([key])=>!summary || key in summary.metrics).map(([key,label])=>card(key,label,summary ? money(summary.metrics[key]) : '加载中…',()=>openMetric(key))) : [
   ['orders','可查看工单'],['waiting','等待检查'],['repairing','维修中'],['completed','今日完成']
  ].map(([key,label])=>card(key,label,summary ? String(summary.operations[key]) : '加载中…',()=>navigate('workOrders')))}</div>
  <section className="panel"><h3>工单与详细记录</h3><p>首页只读取汇总数字。需要查看具体客户、车辆、工单或金额组成时，再加载完整明细。</p><button onClick={()=>navigate('workOrders')}>查看维修工单</button></section>
 </div>;
}
