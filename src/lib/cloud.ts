import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type CloudRow = Record<string, string | number | boolean>;
export type CloudStore = Record<string, CloudRow[]>;

export type CloudUser = {
  email: string;
  name?: string;
};

export type CloudSession = {
  user: CloudUser;
  organizationId: string;
  organizationName: string;
  role: string;
  loadStore: () => Promise<CloudStore>;
  upsertRecord: (module: string, row: CloudRow) => Promise<void>;
  deleteRecord: (module: string, id: string) => Promise<void>;
  subscribe: (refresh: () => void) => () => void;
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
      .select('organization_id, role, display_name')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  let membership = await findMembership();
  if (!membership) {
    const { error } = await client.rpc('zg_bootstrap_organization', { p_name: 'Z&G AUTO REPAIR' });
    if (error) throw error;
    membership = await findMembership();
  }
  if (!membership) throw new Error('无法建立修理厂账号，请联系系统管理员。');

  const organizationId = membership.organization_id as string;
  const { data: organization, error: organizationError } = await client
    .from('zg_organizations')
    .select('name')
    .eq('id', organizationId)
    .single();
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
      const payload = (item.payload || {}) as CloudRow;
      (store[module] ||= []).push({ ...payload, id: String(item.record_id) });
    }
    return store;
  };

  const upsertRecord = async (module: string, row: CloudRow) => {
    const recordId = String(row.id);
    const { error } = await client.from('zg_erp_records').upsert({
      organization_id: organizationId,
      module,
      record_id: recordId,
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
    const channel = client.channel(`zg-v074-${organizationId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'zg_erp_records',
        filter: `organization_id=eq.${organizationId}`,
      }, refresh)
      .subscribe();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      void client.removeChannel(channel);
    };
  };

  return {
    user: { email: user.email || 'unknown', name: membership.display_name || undefined },
    organizationId,
    organizationName: organization?.name || 'Z&G AUTO REPAIR',
    role: String(membership.role),
    loadStore,
    upsertRecord,
    deleteRecord,
    subscribe,
    signOut: async () => { await client.auth.signOut(); },
  };
}
