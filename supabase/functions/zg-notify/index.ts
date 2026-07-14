import { corsHeaders } from '../_shared/cors.ts';
import { requireOrganizationMember } from '../_shared/auth.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const token = Deno.env.get('TWILIO_AUTH_TOKEN');
    const from = Deno.env.get('TWILIO_FROM_NUMBER');
    if (!sid || !token || !from) throw new Error('Twilio 环境变量尚未配置');
    const { to, message, organizationId } = await request.json();
    await requireOrganizationMember(request, String(organizationId || ''));
    if (!to || !message) throw new Error('缺少收件号码或短信内容');
    const params = new URLSearchParams({ To: to, From: from, Body: message });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '短信发送失败');
    return new Response(JSON.stringify({ id: result.sid, status: result.status }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
