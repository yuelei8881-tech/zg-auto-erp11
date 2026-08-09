import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { SignaturePad } from './SignaturePad';

type ApprovalData = {
  status: string;
  customer_name?: string;
  customer_email?: string;
  expires_at?: string;
  decision_note?: string;
  decided_at?: string;
  snapshot: Record<string, any>;
};

type ApprovalChoice = 'approved' | 'rejected' | null;

const money = (value: unknown) => `$${Number(value || 0).toFixed(2)}`;

export function CustomerApprovalPage({ token }: { token: string }) {
  const [data, setData] = useState<ApprovalData | null>(null);
  const [error, setError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [choice, setChoice] = useState<ApprovalChoice>(null);
  const [note, setNote] = useState('');
  const [signature, setSignature] = useState('');
  const [authorizationAccepted, setAuthorizationAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setError('服务器暂时无法连接，请稍后重试或致电 626-508-0888。');
      return;
    }
    void supabase.rpc('zg_get_customer_approval', { p_token: token }).then(({ data: result, error: rpcError }) => {
      if (rpcError) setError('无法读取维修确认单，请稍后重试或致电 626-508-0888。');
      else if (!result) setError('此确认链接无效、已使用或已经过期。');
      else setData(result as ApprovalData);
    });
  }, [token]);

  const submitDecision = async (decision: 'approved' | 'rejected') => {
    if (!supabase || !data) return;
    if (decision === 'approved' && !signature) {
      alert('请先完成手写签名。');
      return;
    }
    if (decision === 'approved' && !authorizationAccepted) {
      alert('请勾选授权确认后再提交。');
      return;
    }
    const promptText = decision === 'approved'
      ? '确认同意本维修项目和金额吗？\n\n提交后签名与授权将被锁定，不能自行修改。'
      : '确认拒绝本次维修吗？';
    if (!window.confirm(promptText)) return;
    setSaving(true);
    const { data: result, error: rpcError } = await supabase.rpc('zg_submit_customer_approval', {
      p_token: token,
      p_decision: decision,
      p_note: note || null,
      p_signature: decision === 'approved' ? signature : null,
    });
    setSaving(false);
    if (rpcError) {
      alert(`提交失败：${rpcError.message}`);
      return;
    }
    if (!result) {
      alert('此链接无效、已使用或已经过期。');
      return;
    }
    setData({ ...data, status: decision, decision_note: note, decided_at: new Date().toISOString() });
  };

  if (error) return <main className="approval-public"><section className="approval-card approval-message"><h1>Z&amp;G AUTO REPAIR</h1><p className="error-text">{error}</p></section></main>;
  if (!data) return <main className="approval-public"><section className="approval-card approval-message"><h1>Z&amp;G AUTO REPAIR</h1><p>正在读取维修确认单…</p></section></main>;

  const order = data.snapshot || {};
  const finished = data.status === 'approved' || data.status === 'rejected';
  const laborItems = Array.isArray(order.laborItems) ? order.laborItems : [];
  const partItems = Array.isArray(order.partItems) ? order.partItems : [];

  return <main className="approval-public">
    <section className="approval-card approval-simple-card">
      <header className="approval-simple-header">
        <div><strong>Z&amp;G AUTO REPAIR</strong><small>319 Agostino Rd, San Gabriel, CA 91776</small><small>626-508-0888</small></div>
        <b>{order.number || '维修确认单'}</b>
      </header>

      <div className="approval-simple-title">
        <span>REPAIR AUTHORIZATION</span>
        <h1>维修项目确认</h1>
        <p>请核对车辆、维修项目和金额，然后选择同意或拒绝。</p>
      </div>

      <div className="approval-vehicle-summary">
        <div><span>客户 / Customer</span><b>{order.customer || data.customer_name || '—'}</b></div>
        <div><span>车辆 / Vehicle</span><b>{order.vehicle || '—'}</b></div>
        <div><span>车牌 / Plate</span><b>{order.plate || '—'}</b></div>
        <div><span>VIN</span><b>{order.vin || '—'}</b></div>
      </div>

      <div className="approval-grand-total"><span>预计总金额 / Estimated Total</span><strong>{money(order.total)}</strong></div>

      <button type="button" className="approval-details-toggle" onClick={() => setDetailsOpen(value => !value)}>
        {detailsOpen ? '收起详情 / Hide Details' : '查看维修详情 / View Details'}
        <span>{detailsOpen ? '⌃' : '⌄'}</span>
      </button>

      {detailsOpen && <section className="approval-details">
        <article><h2>客户描述 / Concern</h2><p>{order.complaint || '—'}</p></article>
        <article><h2>检查与建议 / Diagnosis</h2><p>{order.diagnosis || '—'}</p></article>
        <article><h2>计划维修 / Proposed Work</h2><p>{order.workPerformed || '—'}</p></article>

        {!!laborItems.length && <div className="approval-line-items"><h2>人工项目 / Labor</h2>{laborItems.map((item: any, index: number) => <div key={item.id || index}><span>{item.description || '人工'}{item.descriptionEn ? <small>{item.descriptionEn}</small> : null}</span><b>{money(item.total)}</b></div>)}</div>}
        {!!partItems.length && <div className="approval-line-items"><h2>配件项目 / Parts</h2>{partItems.map((item: any, index: number) => <div key={item.id || index}><span>{item.name || item.partNo || '配件'}{item.nameEn ? <small>{item.nameEn}</small> : null}</span><b>{Number(item.qty || 0)} × {money(item.price)}</b></div>)}</div>}

        <div className="approval-total-breakdown"><span>人工 / Labor <b>{money(order.laborTotal)}</b></span><span>配件 / Parts <b>{money(order.partsTotal)}</b></span><span>税费 / Tax <b>{money(order.tax)}</b></span><strong>总计 / Total <b>{money(order.total)}</b></strong></div>
      </section>}

      {finished ? <div className={data.status === 'approved' ? 'approval-result approved' : 'approval-result rejected'}>
        {data.status === 'approved' ? '✓ 已同意维修 / APPROVED' : '✕ 已拒绝维修 / REJECTED'}
        <small>{data.decided_at ? new Date(data.decided_at).toLocaleString() : ''}</small>
      </div> : <>
        {!choice && <div className="approval-choice-actions">
          <button type="button" className="approval-accept" onClick={() => { setDetailsOpen(true); setChoice('approved'); }}>同意维修<small>APPROVE</small></button>
          <button type="button" className="approval-decline" onClick={() => { setDetailsOpen(true); setChoice('rejected'); }}>拒绝维修<small>DECLINE</small></button>
        </div>}

        {choice === 'approved' && <section className="approval-decision-panel">
          <div className="approval-decision-heading"><div><b>签名并确认授权</b><small>Sign and authorize the repair</small></div><button type="button" onClick={() => setChoice(null)}>返回</button></div>
          <SignaturePad value={signature} onChange={setSignature} />
          <label className="approval-confirm"><input type="checkbox" checked={authorizationAccepted} onChange={event => setAuthorizationAccepted(event.target.checked)} /><span>本人已阅读维修项目和金额，并授权 Z&amp;G AUTO REPAIR 进行维修。提交后，本次签名和授权不能自行修改。<small>I have reviewed the repairs and amount and authorize the work. This signature and authorization cannot be changed after submission.</small></span></label>
          <label className="approval-note-label">备注 / Note（可选）<textarea value={note} onChange={event => setNote(event.target.value)} /></label>
          <button type="button" disabled={saving || !signature || !authorizationAccepted} className="approval-final-approve" onClick={() => void submitDecision('approved')}>{saving ? '正在提交…' : '确认签名并同意维修'}</button>
        </section>}

        {choice === 'rejected' && <section className="approval-decision-panel approval-reject-panel">
          <div className="approval-decision-heading"><div><b>拒绝本次维修</b><small>Decline this repair</small></div><button type="button" onClick={() => setChoice(null)}>返回</button></div>
          <label className="approval-note-label">拒绝原因 / Reason（可选）<textarea value={note} onChange={event => setNote(event.target.value)} /></label>
          <button type="button" disabled={saving} className="approval-final-reject" onClick={() => void submitDecision('rejected')}>{saving ? '正在提交…' : '确认拒绝维修'}</button>
        </section>}
      </>}
    </section>
  </main>;
}
