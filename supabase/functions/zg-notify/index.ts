import { corsHeaders } from '../_shared/cors.ts';
import { requireOrganizationMember } from '../_shared/auth.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await request.json();
    const { to, message, organizationId, channel = 'sms', subject, html } = body;
    await requireOrganizationMember(request, String(organizationId || ''));
    if (channel === 'email') {
      const resendKey = Deno.env.get('RESEND_API_KEY');
      const emailFrom = Deno.env.get('EMAIL_FROM') || 'Z&G AUTO REPAIR <onboarding@resend.dev>';
      if (!resendKey) throw new Error('邮件服务尚未配置 RESEND_API_KEY');
      if (!to || !subject || !html) throw new Error('缺少收件邮箱、主题或邮件内容');
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: emailFrom, to: [to], subject, html }),
      });
      const emailResult = await emailResponse.json();
      if (!emailResponse.ok) throw new Error(emailResult.message || '邮件发送失败');
      return new Response(JSON.stringify({ id: emailResult.id, status: 'sent' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const token = Deno.env.get('TWILIO_AUTH_TOKEN');
    const from = Deno.env.get('TWILIO_FROM_NUMBER');
    if (!sid || !token || !from) throw new Error('Twilio 环境变量尚未配置');
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
