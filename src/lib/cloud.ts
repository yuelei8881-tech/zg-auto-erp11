import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type CloudRow = { id: string; [key: string]: JsonValue };
export type CloudStore = Record<string, CloudRow[]>;

export type CloudUser = { id: string; email: string; name?: string };
export type StaffMember = { userId: string; displayName: string; phone: string; role: string; status: string; permissions: Record<string, boolean> };
export type StaffInvite = { id: string; email: string; role: string; status: string; expiresAt?: string; activationCode?: string };

export type CloudSession = {
  user: CloudUser;
  organizationId: string;
  organizationName: string;
  role: string;
  permissions: Record<string, boolean>;
  loadStore: () => Promise<CloudStore>;
  upsertRecord: (module: string, row: CloudRow) => Promise<void>;
  deleteRecord: (module: string, id: string) => Promise<void>;
  subscribe: (refresh: () => void) => () => void;
  invokeFunction: <T = unknown>(name: string, body: Record<string, unknown>) => Promise<T>;
  listStaff: () => Promise<{ members: StaffMember[]; invites: StaffInvite[] }>;
  createStaffInvite: (email: string, role: string) => Promise<{ activationCode: string }>;
  updateStaff: (userId: string, changes: Partial<Pick<StaffMember, 'displayName' | 'phone' | 'role' | 'status' | 'permissions'>>) => Promise<void>;
  updateOwnProfile: (displayName: string, phone?: string) => Promise<void>;
  cancelStaffInvite: (id: string) => Promise<void>;
  deleteStaffByEmail: (email: string) => Promise<boolean>;
  signOut: () => Promise<void>;
};

function requireClient() {
  if (!supabase) throw new Error('服务器尚未配置，请先填写 Supabase 环境变量。');
  return supabase;
}

export async function openCloudSession(user: User): Promise<CloudSession> {
  const client = requireClient();

  const findMembership = async () => {
    const { data, error } = await client
      .from('zg_organization_members')
      .select('organization_id, role, display_name, permissions')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  let membership = await findMembership();
  if (!membership) {
    const activationCode = sessionStorage.getItem('zg_staff_activation_code') || '';
    const { error: inviteError } = await client.rpc('zg_accept_staff_invite', { p_code: activationCode });
    const missingActivationRpc = inviteError && String(inviteError.message || '').includes('Could not find the function');
    if (inviteError && !missingActivationRpc) throw inviteError;
    if (missingActivationRpc && activationCode) {
      throw new Error('员工激活服务正在升级，请稍后再登录。');
    }
    membership = await findMembership();
    if (membership) sessionStorage.removeItem('zg_staff_activation_code');
    if (activationCode && !membership) {
      sessionStorage.removeItem('zg_staff_activation_code');
      throw new Error('员工激活码无效、已过期或与当前邮箱不匹配。请向老板索取新的激活码。');
    }
  }
  if (!membership) {
    const { error } = await client.rpc('zg_bootstrap_organization', { p_name: 'Z&G AUTO REPAIR' });
    if (error) throw error;
    membership = await findMembership();
  }
  if (!membership) throw new Error('无法建立修理厂账号，请联系系统管理员。');

  const organizationId = String(membership.organization_id);
  const { data: organization, error: organizationError } = await client
    .from('zg_organizations').select('name').eq('id', organizationId).single();
  if (organizationError) throw organizationError;

  const loadStore = async () => {
    const { data, error } = await client
      .from('zg_erp_records')
      .select('module, record_id, payload')
      .eq('organization_id', organizationId);
    if (error) throw error;
    const store: CloudStore = {};
    for (const item of data || []) {
      const module = String(item.module);
      const payload = (item.payload || {}) as Omit<CloudRow, 'id'>;
      (store[module] ||= []).push({ ...payload, id: String(item.record_id) });
    }
    return store;
  };

  const upsertRecord = async (module: string, row: CloudRow) => {
    const { error } = await client.from('zg_erp_records').upsert({
      organization_id: organizationId,
      module,
      record_id: row.id,
      payload: row,
      updated_by: user.id,
    }, { onConflict: 'organization_id,module,record_id' });
    if (error) throw error;
  };

  const deleteRecord = async (module: string, id: string) => {
    const { error } = await client.from('zg_erp_records').delete()
      .eq('organization_id', organizationId).eq('module', module).eq('record_id', id);
    if (error) throw error;
  };

  const subscribe = (refresh: () => void) => {
    const channel = client.channel(`zg-v075-${organizationId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'zg_erp_records',
        filter: `organization_id=eq.${organizationId}`,
      }, refresh).subscribe();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      void client.removeChannel(channel);
    };
  };

  const invokeFunction = async <T,>(name: string, body: Record<string, unknown>) => {
    const { data, error } = await client.functions.invoke(name, { body: { ...body, organizationId } });
    if (error) throw error;
    return data as T;
  };

  const listStaff = async () => {
    const memberResult = await client.from('zg_organization_members').select('user_id,display_name,phone,role,status,permissions').eq('organization_id', organizationId).order('created_at');
    let inviteResult = await client.from('zg_staff_invites').select('id,email,role,status,expires_at,activation_code').eq('organization_id', organizationId).order('created_at', { ascending: false });
    if (inviteResult.error && String(inviteResult.error.message || '').includes('activation_code')) {
      inviteResult = await client.from('zg_staff_invites').select('id,email,role,status,expires_at').eq('organization_id', organizationId).order('created_at', { ascending: false }) as typeof inviteResult;
    }
    if (memberResult.error) throw memberResult.error;
    if (inviteResult.error) throw inviteResult.error;
    return {
      members: (memberResult.data || []).map(item => ({ userId: String(item.user_id), displayName: String(item.display_name || ''), phone: String(item.phone || ''), role: String(item.role), status: String(item.status), permissions: (item.permissions || {}) as Record<string, boolean> })),
      invites: (inviteResult.data || []).map(item => ({ id: String(item.id), email: String(item.email), role: String(item.role), status: String(item.status), expiresAt: item.expires_at ? String(item.expires_at) : undefined, activationCode: item.activation_code ? String(item.activation_code) : undefined })),
    };
  };

  const createStaffInvite = async (email: string, role: string) => {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    const activationCode = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('').slice(0, 8).toUpperCase();
    const { error } = await client.from('zg_staff_invites').insert({ organization_id: organizationId, email: email.trim().toLowerCase(), role, invited_by: user.id, status: 'pending', activation_code: activationCode });
    if (error) throw error;
    return { activationCode };
  };

  const updateStaff = async (userId: string, changes: Partial<Pick<StaffMember, 'displayName' | 'phone' | 'role' | 'status' | 'permissions'>>) => {
    const payload: Record<string, unknown> = {};
    if (changes.displayName !== undefined) payload.display_name = changes.displayName;
    if (changes.phone !== undefined) payload.phone = changes.phone;
    if (changes.role !== undefined) payload.role = changes.role;
    if (changes.status !== undefined) payload.status = changes.status;
    if (changes.permissions !== undefined) payload.permissions = changes.permissions;
    const { error } = await client.from('zg_organization_members').update(payload).eq('organization_id', organizationId).eq('user_id', userId);
    if (error) throw error;
  };

  const updateOwnProfile = async (displayName: string, phone = '') => {
    const cleanName = displayName.trim();
    const cleanPhone = phone.trim();
    const { error: authError } = await client.auth.updateUser({ data: { display_name: cleanName, full_name: cleanName, phone: cleanPhone || undefined } });
    if (authError) throw authError;
    const { error } = await client.rpc('zg_update_own_profile', { p_display_name: cleanName, p_phone: cleanPhone || null });
    if (error && !/zg_update_own_profile|schema cache|function/i.test(error.message)) throw error;
  };

  const cancelStaffInvite = async (id: string) => {
    const { error } = await client.from('zg_staff_invites').update({ status: 'cancelled' }).eq('organization_id', organizationId).eq('id', id);
    if (error) throw error;
  };

  const deleteStaffByEmail = async (email: string) => {
    const { data, error } = await client.rpc('zg_delete_staff_by_email', { p_email: email.trim().toLowerCase() });
    if (error) throw error;
    return Boolean(data);
  };

  return {
    user: { id: user.id, email: user.email || 'unknown', name: membership.display_name || String(user.user_metadata?.display_name || user.user_metadata?.full_name || '') || undefined },
    organizationId,
    organizationName: organization?.name || 'Z&G AUTO REPAIR',
    role: String(membership.role),
    permissions: (membership.permissions || {}) as Record<string, boolean>,
    loadStore, upsertRecord, deleteRecord, subscribe, invokeFunction, listStaff, createStaffInvite, updateStaff, updateOwnProfile, cancelStaffInvite, deleteStaffByEmail,
    signOut: async () => { await client.auth.signOut(); },
  };
}
