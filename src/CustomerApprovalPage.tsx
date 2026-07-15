import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { SignaturePad } from './SignaturePad';

type ApprovalData = {
  status: string; customer_name?: string; customer_email?: string; expires_at?: string;
  decision_note?: string; decided_at?: string; snapshot: Record<string, any>;
};

const money = (value: unknown) => `$${Number(value || 0).toFixed(2)}`;

export function CustomerApprovalPage({ token }: { token: string }) {
  const [data, setData] = useState<ApprovalData | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [signature, setSignature] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) { setError('服务器尚未配置。'); return; }
    void supabase.rpc('zg_get_customer_approval', { p_token: token }).then(({ data: result, error: rpcError }) => {
      if (rpcError) setError(rpcError.message); else if (!result) setError('确认链接无效或已过期。'); else setData(result as ApprovalData);
    });
  }, [token]);

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!supabase || !data) return;
    if (decision === 'approved' && !signature) { alert('请先完成手写签名。'); return; }
    setSaving(true);
    const { data: result, error: rpcError } = await supabase.rpc('zg_submit_customer_approval', {
      p_token: token, p_decision: decision, p_note: note || null, p_signature: signature || null,
    });
    setSaving(false);
    if (rpcError) { alert(rpcError.message); return; }
    if (!result) { alert('链接无效、已使用或已过期。'); return; }
    setData({ ...data, status: decision, decision_note: note, decided_at: new Date().toISOString() });
  };

  if (error) return <main className="approval-public"><section className="approval-card"><h1>Z&amp;G AUTO REPAIR</h1><p className="error-text">{error}</p></section></main>;
  if (!data) return <main className="approval-public"><section className="approval-card"><h1>Z&amp;G AUTO REPAIR</h1><p>正在读取维修确认单…</p></section></main>;
  const order = data.snapshot || {};
  const finished = data.status === 'approved' || data.status === 'rejected';
  return <main className="approval-public">
    <section className="approval-card">
      <header><div><strong>Z&amp;G AUTO REPAIR</strong><small>319 Agostino Rd, San Gabriel, CA 91776 · 626-508-0888</small></div><b>{order.number || '维修确认单'}</b></header>
      <h1>维修项目在线确认 <small>REPAIR AUTHORIZATION</small></h1>
      <div className="approval-grid"><p><b>客户</b>{order.customer || data.customer_name || '-'}</p><p><b>车辆</b>{order.vehicle || '-'}</p><p><b>车牌</b>{order.plate || '-'}</p><p><b>VIN</b>{order.vin || '-'}</p></div>
      <article><h2>客户描述 / Concern</h2><p>{order.complaint || '-'}</p><h2>检查与建议 / Diagnosis</h2><p>{order.diagnosis || '-'}</p><h2>计划维修 / Proposed Work</h2><p>{order.workPerformed || '-'}</p></article>
      <div className="approval-total"><span>人工 {money(order.laborTotal)}</span><span>配件 {money(order.partsTotal)}</span><span>税费 {money(order.tax)}</span><strong>总计 {money(order.total)}</strong></div>
      {finished ? <div className={data.status === 'approved' ? 'approval-result approved' : 'approval-result rejected'}>{data.status === 'approved' ? '✓ 客户已批准维修' : '✕ 客户已拒绝维修'}<small>{data.decided_at ? new Date(data.decided_at).toLocaleString() : ''}</small></div> : <>
        <label>客户备注（可选）<textarea value={note} onChange={e => setNote(e.target.value)} /></label>
        <SignaturePad value={signature} onChange={setSignature} />
        <p className="approval-terms">本人确认已阅读以上项目和金额，并授权 Z&amp;G AUTO REPAIR 按所选决定处理车辆。</p>
        <div className="approval-actions"><button disabled={saving} className="primary" onClick={() => void decide('approved')}>批准维修并签名</button><button disabled={saving} onClick={() => void decide('rejected')}>拒绝维修</button></div>
      </>}
    </section>
  </main>;
}
