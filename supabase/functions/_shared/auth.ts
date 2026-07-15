export async function requireOrganizationMember(request: Request, organizationId: string) {
  const authorization = request.headers.get('Authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!authorization || !url || !anonKey || !organizationId) {
    throw new Error('未登录或缺少修理厂信息');
  }

  const authHeaders = { apikey: anonKey, Authorization: authorization };
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: authHeaders });
  if (!userResponse.ok) throw new Error('登录已过期，请重新登录');
  const user = await userResponse.json();

  const query = new URL(`${url}/rest/v1/zg_organization_members`);
  query.searchParams.set('select', 'role');
  query.searchParams.set('organization_id', `eq.${organizationId}`);
  query.searchParams.set('user_id', `eq.${user.id}`);
  query.searchParams.set('status', 'eq.active');
  const memberResponse = await fetch(query, { headers: authHeaders });
  const rows = await memberResponse.json();
  if (!memberResponse.ok || !Array.isArray(rows) || !rows.length) {
    throw new Error('没有使用此修理厂服务的权限');
  }
  return { userId: user.id as string, role: String(rows[0].role) };
}
