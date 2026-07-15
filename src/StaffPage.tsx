import { useEffect, useState } from 'react';
import type { CloudSession, StaffInvite, StaffMember } from './lib/cloud';

const roles = [
  { value: 'owner', label: '老板' }, { value: 'manager', label: '经理' },
  { value: 'frontdesk', label: '前台' }, { value: 'technician', label: '技师' },
  { value: 'finance', label: '财务' }, { value: 'warehouse', label: '仓库' },
];
const permissionItems = [
  ['customers', '查看客户与车辆'], ['customerContact', '查看客户电话与地址'],
  ['workOrders', '查看全部工单'], ['assignedWorkOrders', '仅查看分配给自己的工单'],
  ['createWorkOrders', '新建工单'], ['diagnosis', '填写诊断与维修记录'],
  ['pricing', '查看和修改价格'], ['assignTechnician', '分配技师'],
  ['collectPayment', '收款与结账'], ['finance', '财务与利润'],
  ['inventory', '库存与采购'], ['campaigns', '活动与保修'], ['staff', '员工与授权'],
  ['archive', '申请作废/归档资料'], ['approve', '审批与双人授权'],
] as const;

export function StaffPage({ cloud }: { cloud: CloudSession }) {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [email, setEmail] = useState(''); const [role, setRole] = useState('technician');
  const [lastInvite, setLastInvite] = useState<{ email: string; activationCode: string } | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState(''); const [deleteBusy, setDeleteBusy] = useState(false);
  const canManage = cloud.role === 'owner' || cloud.role === 'manager' || Boolean(cloud.permissions.staff);
  const refresh = async () => { setLoading(true); try { const data = await cloud.listStaff(); setMembers(data.members); setInvites(data.invites); } catch (error) { alert(`读取员工资料失败：${error instanceof Error ? error.message : error}`); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, [cloud.organizationId]);

  const invite = async () => {
    if (!email.trim() || !email.includes('@')) return alert('请输入正确的员工邮箱。');
    setBusy(true); try { const result = await cloud.createStaffInvite(email, role); setLastInvite({ email: email.trim().toLowerCase(), activationCode: result.activationCode }); setEmail(''); await refresh(); } catch (error) { alert(`建立邀请失败：${error instanceof Error ? error.message : error}`); } finally { setBusy(false); }
  };
  const update = async (member: StaffMember, changes: Partial<StaffMember>) => {
    try { await cloud.updateStaff(member.userId, changes); setMembers(items => items.map(item => item.userId === member.userId ? { ...item, ...changes } : item)); } catch (error) { alert(`更新权限失败：${error instanceof Error ? error.message : error}`); }
  };

  return <div className="page"><div className="page-title"><div><p className="eyebrow">STAFF & ACCESS</p><h2>员工子账号与权限</h2><p>为老板、经理、前台、技师、财务和仓库设置不同访问范围。</p></div></div>
    {!canManage && <section className="panel"><div className="empty"><b>没有管理员权限</b><span>只有老板或经理可以设置员工账号和权限。</span></div></section>}
    {canManage && <>
      <section className="panel"><div className="section-title"><h3>邀请新员工</h3><span>员工使用自己的邮箱和激活码设置密码</span></div><div className="form-grid"><label><span>员工邮箱</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="employee@example.com" /></label><label><span>默认角色</span><select value={role} onChange={e => setRole(e.target.value)}>{roles.filter(item => item.value !== 'owner').map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="form-actions"><button className="primary" disabled={busy} onClick={() => void invite()}>{busy ? '正在保存…' : '生成员工激活码'}</button></div></div>{lastInvite && <div className="staff-invite-result"><div><b>员工激活码：{lastInvite.activationCode}</b><span>{lastInvite.email}</span></div><button onClick={async () => { const text = `Z&G AUTO ERP 员工账号激活\n网址：https://zg-auto-erp-v2.vercel.app\n邮箱：${lastInvite.email}\n激活码：${lastInvite.activationCode}\n请点击“收到邀请？首次建立员工账号”设置密码。`; if (navigator.share) await navigator.share({ title: 'Z&G AUTO ERP 员工邀请', text }); else { await navigator.clipboard.writeText(text); alert('邀请信息已复制。'); } }}>分享给员工</button></div>}<p className="muted">邀请和激活码保存在服务器。员工无需等待邮件，打开系统后点击“收到邀请？首次建立员工账号”即可设置密码。</p></section>
      <section className="panel"><div className="section-title"><h3>已启用员工</h3><span>{members.length} 人</span></div>{loading ? <div className="loading">正在读取员工资料…</div> : <div className="staff-list">{members.map(member => <article className="staff-card" key={member.userId}><div className="staff-head"><div><b>{member.displayName || (member.userId === cloud.user.email ? cloud.user.email : '员工账号')}</b><small>{member.phone || `ID ${member.userId.slice(0, 8)}…`}</small></div><label className="inline-field"><span>角色</span><select value={member.role} disabled={member.role === 'owner'} onChange={e => void update(member, { role: e.target.value })}>{roles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="inline-field"><span>状态</span><select value={member.status} disabled={member.role === 'owner'} onChange={e => void update(member, { status: e.target.value })}><option value="active">启用</option><option value="disabled">停用</option></select></label></div><div className="permission-grid">{permissionItems.map(([key, label]) => <label key={key}><input type="checkbox" checked={member.role === 'owner' || Boolean(member.permissions[key])} disabled={member.role === 'owner'} onChange={e => void update(member, { permissions: { ...member.permissions, [key]: e.target.checked } })} /> {label}</label>)}</div></article>)}</div>}
        {!loading && !members.length && <div className="empty"><b>暂无员工账号</b><span>先在上方建立员工邀请。</span></div>}
      </section>
      <section className="panel"><div className="section-title"><h3>待处理邀请</h3><span>{invites.filter(item => item.status === 'pending').length} 项</span></div><table><thead><tr><th>邮箱</th><th>角色</th><th>激活码</th><th>状态</th><th>有效期</th><th /></tr></thead><tbody>{invites.map(item => <tr key={item.id}><td>{item.email}</td><td>{roles.find(roleItem => roleItem.value === item.role)?.label || item.role}</td><td><b>{item.activationCode || '—'}</b></td><td>{item.status}</td><td>{item.expiresAt?.slice(0, 10) || '—'}</td><td className="actions">{item.status === 'pending' && <><button onClick={async () => { await navigator.clipboard.writeText(item.activationCode || ''); alert('激活码已复制。'); }}>复制码</button><button className="danger-link" onClick={async () => { await cloud.cancelStaffInvite(item.id); await refresh(); }}>取消</button></>}</td></tr>)}</tbody></table></section>
      {cloud.role === 'owner' && <section className="panel staff-delete-panel"><div className="section-title"><div><h3>删除员工账号</h3><span>仅老板可执行；会同时删除该员工的组织权限和未处理邀请。</span></div></div><div className="staff-delete-row"><input type="email" value={deleteEmail} onChange={event => setDeleteEmail(event.target.value)} placeholder="输入要删除的员工邮箱" /><button className="danger-button" disabled={deleteBusy || !deleteEmail.includes('@')} onClick={async () => { const target = deleteEmail.trim().toLowerCase(); if (!confirm(`确定删除员工账号 ${target} 吗？`)) return; setDeleteBusy(true); try { const deleted = await cloud.deleteStaffByEmail(target); alert(deleted ? '员工账号已删除。' : '未找到该员工账号，已清理同邮箱的待处理邀请。'); setDeleteEmail(''); await refresh(); } catch (error) { alert(`删除失败：${error instanceof Error ? error.message : error}`); } finally { setDeleteBusy(false); } }}>{deleteBusy ? '正在删除…' : '删除员工'}</button></div></section>}
    </>}
  </div>;
}
